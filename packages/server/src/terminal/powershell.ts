import { access } from "node:fs/promises";
import { join } from "node:path";
import { findExecutable } from "../executable-resolution/executable-resolution.js";

// The app's built-in "打开PowerShell" menu sends this bare sentinel as the
// terminal command; the daemon resolves it to the best available PowerShell
// before spawning, so the preference chain lives where the file system is.
export const BUILTIN_POWERSHELL_COMMAND = "powershell";

async function defaultFileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isPathLike(candidate: string): boolean {
  return candidate.includes("/") || candidate.includes("\\");
}

// Candidates already validated by resolveExecutable are trusted as-is; literal
// paths (configured path, well-known install dirs) get an explicit existence
// probe so a stale configuration falls through to the next candidate.
async function probeCandidate(
  candidate: string,
  fileExists: (path: string) => Promise<boolean>,
  resolveExecutable: (name: string) => Promise<string | null>,
): Promise<string | null> {
  if (isPathLike(candidate)) {
    return (await fileExists(candidate)) ? candidate : null;
  }
  return resolveExecutable(candidate).catch(() => null);
}

export interface ResolveBuiltinPowerShellCommandOptions {
  configuredPath?: string;
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  fileExists?: (path: string) => Promise<boolean>;
  resolveExecutable?: (name: string) => Promise<string | null>;
}

/**
 * Resolve the built-in PowerShell launch command on Windows, in preference
 * order: the user-configured path, pwsh on PATH, the PowerShell 7 default
 * install dir (%ProgramFiles%\PowerShell\7), then Windows PowerShell on PATH
 * and finally its System32 fallback location. Returns null when nothing is
 * found or on non-Windows, leaving the original command untouched so the
 * terminal itself surfaces the spawn error.
 */
export async function resolveBuiltinPowerShellCommand(
  options: ResolveBuiltinPowerShellCommandOptions = {},
): Promise<string | null> {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    return null;
  }
  const env = options.env ?? process.env;
  const fileExists = options.fileExists ?? defaultFileExists;
  const resolveExecutable = options.resolveExecutable ?? findExecutable;

  const candidates: Array<() => Promise<string | null>> = [];
  const configured = options.configuredPath?.trim();
  if (configured) {
    candidates.push(() => probeCandidate(configured, fileExists, resolveExecutable));
  }
  candidates.push(async () => {
    const pwsh = await resolveExecutable("pwsh.exe").catch(() => null);
    return pwsh ?? null;
  });
  const programFiles = env.ProgramFiles ?? env["ProgramFiles"];
  if (programFiles) {
    const pwsh7Path = join(programFiles, "PowerShell", "7", "pwsh.exe");
    candidates.push(async () => ((await fileExists(pwsh7Path)) ? pwsh7Path : null));
  }
  candidates.push(async () => {
    const windowsPowershell = await resolveExecutable("powershell.exe").catch(() => null);
    return windowsPowershell ?? null;
  });
  const systemRoot = env.SystemRoot ?? env.windir;
  if (systemRoot) {
    const windowsPowershellPath = join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    candidates.push(async () =>
      (await fileExists(windowsPowershellPath)) ? windowsPowershellPath : null,
    );
  }

  for (const resolveCandidate of candidates) {
    const resolved = await resolveCandidate();
    if (resolved) {
      return resolved;
    }
  }
  return null;
}
