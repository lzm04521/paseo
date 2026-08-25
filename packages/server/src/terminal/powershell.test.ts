import { describe, expect, it } from "vitest";
import {
  BUILTIN_POWERSHELL_COMMAND,
  resolveBuiltinPowerShellCommand,
} from "./powershell.js";

const WIN_ENV = { ProgramFiles: "C:\\Program Files", SystemRoot: "C:\\Windows" };

function harness(input: {
  files: string[];
  executables?: Record<string, string | null>;
  configuredPath?: string;
}) {
  return resolveBuiltinPowerShellCommand({
    platform: "win32",
    env: WIN_ENV,
    configuredPath: input.configuredPath,
    fileExists: async (path) => input.files.includes(path),
    resolveExecutable: async (name) => input.executables?.[name] ?? null,
  });
}

describe("resolveBuiltinPowerShellCommand", () => {
  it("prefers the configured path when it exists", async () => {
    await expect(
      harness({
        files: ["D:\\shells\\pwsh.exe"],
        executables: { "pwsh.exe": "C:\\Program Files\\PowerShell\\7\\pwsh.exe" },
        configuredPath: "D:\\shells\\pwsh.exe",
      }),
    ).resolves.toBe("D:\\shells\\pwsh.exe");
  });

  it("falls through the chain when the configured path is missing", async () => {
    await expect(
      harness({
        files: ["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"],
        configuredPath: "D:\\missing\\pwsh.exe",
      }),
    ).resolves.toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  });

  it("prefers pwsh on PATH over the PowerShell 7 install dir", async () => {
    await expect(
      harness({
        files: ["C:\\Program Files\\PowerShell\\7\\pwsh.exe"],
        executables: { "pwsh.exe": "C:\\Tools\\pwsh.exe" },
      }),
    ).resolves.toBe("C:\\Tools\\pwsh.exe");
  });

  it("uses the PowerShell 7 default install dir when pwsh is not on PATH", async () => {
    await expect(
      harness({ files: ["C:\\Program Files\\PowerShell\\7\\pwsh.exe"] }),
    ).resolves.toBe("C:\\Program Files\\PowerShell\\7\\pwsh.exe");
  });

  it("falls back to Windows PowerShell", async () => {
    await expect(
      harness({
        files: ["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"],
        executables: { "powershell.exe": "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" },
      }),
    ).resolves.toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  });

  it("returns null when nothing exists", async () => {
    await expect(harness({ files: [] })).resolves.toBeNull();
  });

  it("returns null on non-Windows platforms", async () => {
    await expect(
      resolveBuiltinPowerShellCommand({
        platform: "darwin",
        configuredPath: "/opt/pwsh",
        fileExists: async () => true,
      }),
    ).resolves.toBeNull();
  });

  it("exports the sentinel the app sends", () => {
    expect(BUILTIN_POWERSHELL_COMMAND).toBe("powershell");
  });
});
