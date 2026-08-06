import type { SpawnOptions } from "node:child_process";
import { describe, expect, it } from "vitest";

import { createEditorTargetRuntime } from "./runtime.js";

interface SpawnRecord {
  command: string;
  args: string[];
  options: SpawnOptions;
  unrefed: boolean;
}

function recordSpawn(
  records: SpawnRecord[],
  command: string,
  args: string[],
  options: SpawnOptions,
) {
  const record = { command, args, options, unrefed: false };
  records.push(record);
  const child = {
    once(event: "error" | "spawn", handler: (error?: Error) => void) {
      if (event === "spawn") queueMicrotask(() => handler());
      return child;
    },
    unref() {
      record.unrefed = true;
    },
  };
  return child;
}

describe("editor target runtime", () => {
  it("resolves command aliases and safely launches Windows command scripts", async () => {
    const records: SpawnRecord[] = [];
    const runtime = createEditorTargetRuntime({
      platform: "win32",
      env: {
        PATH: "C:/Program Files/Editors & Tools/bin",
        ELECTRON_RUN_AS_NODE: "1",
      },
      pathExists: (targetPath) => targetPath === "C:/Program Files/Editors & Tools/bin/code.cmd",
      spawn: (command, args, options) => recordSpawn(records, command, args, options),
    });

    const command = runtime.resolveCommand(["missing", "code"]);
    if (!command) throw new Error("Expected the editor command to resolve");
    await runtime.spawnDetached({
      command,
      args: ["C:/repo & workspace", "C:/repo/src/file & calculator.ts"],
    });

    expect(records).toEqual([
      {
        command: '"C:/Program Files/Editors & Tools/bin/code.cmd"',
        args: ['"C:/repo & workspace"', '"C:/repo/src/file & calculator.ts"'],
        options: {
          detached: true,
          env: { PATH: "C:/Program Files/Editors & Tools/bin" },
          shell: true,
          stdio: "ignore",
        },
        unrefed: true,
      },
    ]);
  });

  it("opens Windows paths through the shell default verb so Explorer replacements win", async () => {
    const records: SpawnRecord[] = [];
    let electronOpenPathCalls = 0;
    const runtime = createEditorTargetRuntime({
      platform: "win32",
      env: { ComSpec: "C:/WINDOWS/system32/cmd.exe", PASEO_DESKTOP_MANAGED: "1" },
      openPath: async () => {
        electronOpenPathCalls += 1;
        return "";
      },
      spawn: (command, args, options) => recordSpawn(records, command, args, options),
    });

    // A literal `%` in the path must survive: cmd would expand `%PATH%` if the
    // path were inlined into the command line.
    await runtime.openPath("C:/repo/pct-100%PATH%-x");

    expect(electronOpenPathCalls).toBe(0);
    expect(records).toEqual([
      {
        command: "C:/WINDOWS/system32/cmd.exe",
        args: ["/d", "/s", "/c", 'start "" "%PASEO_SHELL_OPEN_PATH%"'],
        options: {
          detached: true,
          env: {
            ComSpec: "C:/WINDOWS/system32/cmd.exe",
            PASEO_SHELL_OPEN_PATH: "C:/repo/pct-100%PATH%-x",
          },
          shell: false,
          stdio: "ignore",
          windowsHide: true,
          windowsVerbatimArguments: true,
        },
        unrefed: true,
      },
    ]);
  });

  it("keeps using the Electron shell to open paths off Windows", async () => {
    const openedPaths: string[] = [];
    const records: SpawnRecord[] = [];
    const runtime = createEditorTargetRuntime({
      platform: "darwin",
      env: {},
      openPath: async (targetPath) => {
        openedPaths.push(targetPath);
        return "";
      },
      spawn: (command, args, options) => recordSpawn(records, command, args, options),
    });

    await runtime.openPath("/repo/workspace");

    expect(openedPaths).toEqual(["/repo/workspace"]);
    expect(records).toEqual([]);
  });

  it("surfaces Electron shell open failures as errors", async () => {
    const runtime = createEditorTargetRuntime({
      platform: "linux",
      env: {},
      openPath: async () => "No application knows how to open this path",
    });

    await expect(runtime.openPath("/repo/workspace")).rejects.toThrow(
      "No application knows how to open this path",
    );
  });
});
