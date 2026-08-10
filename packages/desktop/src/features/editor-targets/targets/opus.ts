import path from "node:path";
import type { EditorTargetLaunchInput, EditorTargetRuntime } from "../target.js";

/**
 * Directory Opus (GPSoftware), a Windows file manager. Not registered as its own target —
 * `explorerTarget` calls into `tryLaunchOpus` so a single "Explorer" entry uses Opus when
 * installed and otherwise falls back to Windows Explorer.
 */
function dopusrtCommands(runtime: EditorTargetRuntime): string[] {
  const candidates: string[] = [];
  if (runtime.platform === "win32") {
    if (runtime.env.ProgramFiles) {
      candidates.push(`${runtime.env.ProgramFiles}/GPSoftware/Directory Opus/dopusrt.exe`);
    }
    if (runtime.env["ProgramFiles(x86)"]) {
      candidates.push(`${runtime.env["ProgramFiles(x86)"]}/GPSoftware/Directory Opus/dopusrt.exe`);
    }
  }
  candidates.push("dopusrt.exe");
  return candidates;
}

function dopusCommands(runtime: EditorTargetRuntime): string[] {
  const candidates: string[] = [];
  if (runtime.platform === "win32") {
    if (runtime.env.ProgramFiles) {
      candidates.push(`${runtime.env.ProgramFiles}/GPSoftware/Directory Opus/dopus.exe`);
    }
    if (runtime.env["ProgramFiles(x86)"]) {
      candidates.push(`${runtime.env["ProgramFiles(x86)"]}/GPSoftware/Directory Opus/dopus.exe`);
    }
  }
  candidates.push("dopus.exe");
  return candidates;
}

type ResolvedOpusRuntime =
  /**
   * `dopusrt.exe` talks to the running Opus (starting it if needed) and navigates the active
   * lister via the internal `Go` command. Preferred so an existing lister is reused.
   */
  | { kind: "runtime"; command: string }
  /**
   * `dopus.exe` only opens a new lister at a path. Used when `dopusrt.exe` is absent.
   */
  | { kind: "standalone"; command: string };

function resolveOpusRuntime(runtime: EditorTargetRuntime): ResolvedOpusRuntime | null {
  const runtimeCommand = runtime.resolveCommand(dopusrtCommands(runtime));
  if (runtimeCommand) return { kind: "runtime", command: runtimeCommand };
  const standaloneCommand = runtime.resolveCommand(dopusCommands(runtime));
  if (standaloneCommand) return { kind: "standalone", command: standaloneCommand };
  return null;
}

/**
 * If Directory Opus is installed, open `input`'s path in it and return true. Returns false
 * when Opus isn't available so the caller can fall back to the platform file manager.
 *
 * Opus's `Go` command takes a directory. `SELECT` is a separate Opus command, not a `Go`
 * argument, so there's no reliable one-shot "reveal-and-select this file" from the command
 * line — for a file we navigate to its containing folder (reveal-without-select).
 */
export async function tryLaunchOpus(
  input: EditorTargetLaunchInput,
  runtime: EditorTargetRuntime,
): Promise<boolean> {
  const resolved = resolveOpusRuntime(runtime);
  if (!resolved) return false;
  const targetPath = input.filePath ? path.dirname(input.filePath) : input.workspacePath;
  if (resolved.kind === "runtime") {
    await runtime.spawnDetached({
      command: resolved.command,
      args: ["/cmd", "Go", targetPath],
    });
    return true;
  }
  await runtime.spawnDetached({
    command: resolved.command,
    args: [targetPath],
  });
  return true;
}
