import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { execCommand } from "../utils/spawn.js";
import { isPlatform } from "../test-utils/platform.js";
import {
  clearExecutableResolutionCacheForTests,
  EXECUTABLE_RESOLUTION_FOUND_TTL_MS,
  EXECUTABLE_RESOLUTION_NOT_FOUND_TTL_MS,
  findExecutable,
} from "./executable-resolution.js";

vi.mock("../utils/spawn.js", () => ({ execCommand: vi.fn() }));
const execCommandMock = vi.mocked(execCommand);

const itWindows = isPlatform("win32") ? test : test.skip;
const originalPath = process.env.PATH;
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "paseo-exec-res-"));
  tempDirs.push(dir);
  return dir;
}

function prependPath(...dirs: string[]): void {
  process.env.PATH = [...dirs, originalPath].filter(Boolean).join(path.delimiter);
}

function writeExecutable(filePath: string, content = "@echo off\r\n"): string {
  writeFileSync(filePath, content);
  return filePath;
}

function whereExeCallCount(): number {
  return execCommandMock.mock.calls.filter(([command]) => command === "where.exe").length;
}

afterEach(() => {
  process.env.PATH = originalPath;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("windows where.exe enumeration", () => {
  beforeEach(() => {
    execCommandMock.mockReset();
  });

  itWindows(
    "prefers where.exe candidates, filters cwd hits, probes only in-PATH candidate",
    async () => {
      const dir = makeTempDir();
      const inPath = writeExecutable(path.join(dir, "paseo-where-tool.cmd"));
      prependPath(dir);
      const cwdCandidate = path.join(process.cwd(), "paseo-where-tool.cmd");
      execCommandMock.mockImplementation(async (command: string, args: string[]) => {
        if (command === "where.exe" && args[0] === "paseo-where-tool") {
          return { stdout: `${inPath}\r\n${cwdCandidate}\r\n` };
        }
        if (command === inPath) {
          return { stdout: "v1.0.0" };
        }
        throw new Error(`unexpected execCommand: ${command}`);
      });

      const resolved = await findExecutable("paseo-where-tool");

      expect(resolved?.toLowerCase()).toBe(inPath.toLowerCase());
      expect(whereExeCallCount()).toBe(1);
      // cwd 命中被过滤：绝不能对它做 --version 探测
      expect(execCommandMock.mock.calls.some(([command]) => command === cwdCandidate)).toBe(false);
    },
  );

  itWindows("falls back to the which library when where.exe fails", async () => {
    const dir = makeTempDir();
    const exe = writeExecutable(path.join(dir, "paseo-where-fallback.cmd"));
    prependPath(dir);
    // where.exe 抛错走 which 库（真实 fs）；探测阶段的 execCommand(exe) 放行
    execCommandMock.mockImplementation(async (command: string) => {
      if (command === exe) {
        return { stdout: "v1.0.0" };
      }
      throw new Error(`unexpected execCommand: ${command}`);
    });

    const resolved = await findExecutable("paseo-where-fallback");
    expect(resolved?.toLowerCase()).toBe(exe.toLowerCase());
  });
});

describe("findExecutable result cache", () => {
  beforeEach(() => {
    clearExecutableResolutionCacheForTests();
    execCommandMock.mockReset();
  });

  function mockWhereResolves(exePath: string): void {
    execCommandMock.mockImplementation(async (command: string, args: string[]) => {
      if (command === "where.exe" && args[0] === "paseo-cache-tool") {
        return { stdout: exePath };
      }
      if (command === exePath) {
        return { stdout: "v1.0.0" };
      }
      throw new Error(`unexpected execCommand: ${command}`);
    });
  }

  itWindows("concurrent lookups dedupe to one enumeration; fresh entry skips re-scan", async () => {
    const dir = makeTempDir();
    const exe = writeExecutable(path.join(dir, "paseo-cache-tool.cmd"), "@echo off\r\n");
    mockWhereResolves(exe);

    const [first, second] = await Promise.all([
      findExecutable("paseo-cache-tool"),
      findExecutable("paseo-cache-tool"),
    ]);
    expect(first).toBe(exe);
    expect(second).toBe(exe);
    expect(whereExeCallCount()).toBe(1);

    await findExecutable("paseo-cache-tool");
    expect(whereExeCallCount()).toBe(1); // TTL 内复用缓存
  });

  itWindows("found entries expire after EXECUTABLE_RESOLUTION_FOUND_TTL_MS", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const dir = makeTempDir();
      const exe = writeExecutable(path.join(dir, "paseo-cache-tool.cmd"), "@echo off\r\n");
      mockWhereResolves(exe);

      await findExecutable("paseo-cache-tool");
      expect(whereExeCallCount()).toBe(1);

      vi.setSystemTime(Date.now() + EXECUTABLE_RESOLUTION_FOUND_TTL_MS + 1);
      await findExecutable("paseo-cache-tool");
      expect(whereExeCallCount()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  itWindows("negative results are cached briefly then retried", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      execCommandMock.mockRejectedValue(new Error("nothing anywhere"));
      expect(await findExecutable("paseo-no-such-binary-xyz")).toBeNull();
      expect(await findExecutable("paseo-no-such-binary-xyz")).toBeNull();
      expect(whereExeCallCount()).toBe(1);

      vi.setSystemTime(Date.now() + EXECUTABLE_RESOLUTION_NOT_FOUND_TTL_MS + 1);
      await findExecutable("paseo-no-such-binary-xyz");
      expect(whereExeCallCount()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
