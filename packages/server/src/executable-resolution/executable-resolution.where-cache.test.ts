import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { execCommand } from "../utils/spawn.js";
import { isPlatform } from "../test-utils/platform.js";
import { findExecutable } from "./executable-resolution.js";

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

function writeExecutable(filePath: string): string {
  writeFileSync(filePath, "@echo off\r\n");
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
