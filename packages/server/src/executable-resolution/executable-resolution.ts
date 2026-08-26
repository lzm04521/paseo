import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execCommand } from "../utils/spawn.js";
import { isWindowsCommandScript } from "../utils/windows-command.js";
import { windowsExecutableResolution } from "./windows.js";

export { quoteWindowsArgument, quoteWindowsCommand } from "../utils/windows-command.js";

type Which = (command: string, options: { all: true }) => Promise<string[]>;

const require = createRequire(import.meta.url);
const which = require("which") as Which;
const PROBE_TIMEOUT_MS = 2000;

function hasPathSeparator(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

async function enumerateCandidates(name: string): Promise<string[]> {
  if (process.platform === "win32") {
    const viaWhere = await enumerateCandidatesViaWindowsWhere(name);
    if (viaWhere.length > 0) {
      return viaWhere;
    }
    return enumerateCandidatesViaLibrary(name);
  }
  if (existsSync("/usr/bin/which")) {
    return enumerateCandidatesViaSystemWhich(name);
  }
  return enumerateCandidatesViaLibrary(name);
}

// 单次子进程完成 PATH 枚举（实测空载 ~0.45s），替代 which 库上百次串行 fs 探测——
// 后者在事件循环饥饿下会被放大到分钟级（见 F5 诊断 R-B）。
// where.exe 会先搜当前目录，命中需过滤掉。
async function enumerateCandidatesViaWindowsWhere(name: string): Promise<string[]> {
  try {
    const { stdout } = await execCommand("where.exe", [name], {
      timeout: 3000,
      killSignal: "SIGKILL",
    });
    const cwd = resolve(process.cwd()).toLowerCase();
    return Array.from(new Set(stdout.trim().split(/\r?\n/).filter(Boolean))).filter((candidate) => {
      try {
        return dirname(resolve(candidate)).toLowerCase() !== cwd;
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

async function enumerateCandidatesViaSystemWhich(name: string): Promise<string[]> {
  try {
    const { stdout } = await execCommand("/usr/bin/which", ["-a", name], {
      timeout: 3000,
      killSignal: "SIGKILL",
    });
    return Array.from(new Set(stdout.trim().split("\n").filter(Boolean)));
  } catch {
    return [];
  }
}

async function enumerateCandidatesViaLibrary(name: string): Promise<string[]> {
  let candidates: string[];
  try {
    candidates = await which(name, { all: true });
  } catch (error) {
    // `which` throws ENOENT when the command is absent from PATH.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate)) {
      return false;
    }
    seen.add(candidate);
    return true;
  });
}

export async function probeExecutable(
  executablePath: string,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  try {
    await execCommand(executablePath, ["--version"], {
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: 64 * 1024,
      shell: isWindowsCommandScript(executablePath),
    });
    return true;
  } catch (error) {
    return classifyProbeError(error);
  }
}

function classifyProbeError(error: unknown): boolean {
  const err = error as NodeJS.ErrnoException & {
    killed?: boolean;
  };
  if (err.killed) {
    return true;
  }
  if (typeof err.code === "number") {
    return true;
  }
  if (
    err.code === "ENOENT" ||
    err.code === "EACCES" ||
    err.code === "ENOEXEC" ||
    err.code === "UNKNOWN"
  ) {
    return false;
  }
  return false;
}

/**
 * Check a literal executable path. PATH search is handled by findExecutable().
 */
export function executableExists(
  executablePath: string,
  exists: typeof existsSync = existsSync,
): string | null {
  if (process.platform === "win32") {
    return windowsExecutableResolution.exists(executablePath, { exists });
  }
  return exists(executablePath) ? executablePath : null;
}

export const EXECUTABLE_RESOLUTION_FOUND_TTL_MS = 30 * 60_000;
export const EXECUTABLE_RESOLUTION_NOT_FOUND_TTL_MS = 30_000;

interface ExecutableResolutionCacheEntry {
  promise: Promise<string | null>;
  settledAtMs: number | null;
  value: string | null;
}

const executableResolutionCache = new Map<string, ExecutableResolutionCacheEntry>();

export function clearExecutableResolutionCacheForTests(): void {
  executableResolutionCache.clear();
}

function isFreshCacheEntry(entry: ExecutableResolutionCacheEntry, nowMs: number): boolean {
  if (entry.settledAtMs === null) {
    return true; // in-flight：并发调用共享同一次解析
  }
  const ttlMs =
    entry.value === null
      ? EXECUTABLE_RESOLUTION_NOT_FOUND_TTL_MS
      : EXECUTABLE_RESOLUTION_FOUND_TTL_MS;
  return nowMs - entry.settledAtMs < ttlMs;
}

export async function findExecutable(
  name: string,
  probeTimeoutMs = PROBE_TIMEOUT_MS,
): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) {
    return null;
  }

  const cached = executableResolutionCache.get(trimmed);
  if (cached && isFreshCacheEntry(cached, Date.now())) {
    return cached.promise;
  }

  const entry: ExecutableResolutionCacheEntry = {
    promise: Promise.resolve(null),
    settledAtMs: null,
    value: null,
  };
  executableResolutionCache.set(trimmed, entry);
  entry.promise = (async () => {
    try {
      const resolved = await findExecutableUncached(trimmed, probeTimeoutMs);
      entry.value = resolved;
      return resolved;
    } catch (error) {
      executableResolutionCache.delete(trimmed);
      throw error;
    } finally {
      entry.settledAtMs = Date.now();
    }
  })();
  return entry.promise;
}

// 缓存键只含 name（不含 probeTimeoutMs）——全局 probe 超时一致，避免键组合爆炸。
async function findExecutableUncached(
  trimmed: string,
  probeTimeoutMs: number,
): Promise<string | null> {
  if (process.platform === "win32") {
    return windowsExecutableResolution.find(trimmed, {
      enumeratePathCandidates: enumerateCandidates,
      probeExecutable,
      exists: existsSync,
      probeTimeoutMs,
    });
  }

  if (hasPathSeparator(trimmed)) {
    return (await probeExecutable(trimmed, probeTimeoutMs)) ? trimmed : null;
  }

  const candidates = await enumerateCandidates(trimmed);
  for (const candidate of candidates) {
    if (await probeExecutable(candidate, probeTimeoutMs)) {
      return candidate;
    }
  }
  return null;
}

export async function isCommandAvailable(command: string): Promise<boolean> {
  return (await findExecutable(command)) !== null;
}
