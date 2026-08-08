import type { EditorTarget, EditorTargetRuntime } from "../target.js";

/**
 * Directory Opus (GPSoftware), a Windows file manager. Registered ahead of the built-in
 * `explorerTarget` so a machine that has Opus installed uses it for "Open in file manager";
 * machines without it fall through to Windows Explorer.
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
   * `dopusrt.exe` talks to the running Opus (starting it if needed) and can navigate plus select a
   * file via the internal `Go` command.
   */
  | { kind: "runtime"; command: string }
  /**
   * `dopus.exe` only opens a new lister at a path; it has no reliable reveal, so a file opens its
   * containing directory instead.
   */
  | { kind: "standalone"; command: string };

function resolveOpusRuntime(runtime: EditorTargetRuntime): ResolvedOpusRuntime | null {
  const runtimeCommand = runtime.resolveCommand(dopusrtCommands(runtime));
  if (runtimeCommand) return { kind: "runtime", command: runtimeCommand };
  const standaloneCommand = runtime.resolveCommand(dopusCommands(runtime));
  if (standaloneCommand) return { kind: "standalone", command: standaloneCommand };
  return null;
}

const launchOpus: EditorTarget["launch"] = async (input, runtime) => {
  const resolved = resolveOpusRuntime(runtime);
  if (!resolved) throw new Error("Directory Opus is not installed");
  if (resolved.kind === "runtime") {
    await runtime.spawnDetached({
      command: resolved.command,
      args: input.filePath
        ? ["/cmd", "Go", input.filePath, "SELECT"]
        : ["/cmd", "Go", input.workspacePath],
    });
    return;
  }
  await runtime.spawnDetached({
    command: resolved.command,
    args: [input.filePath ?? input.workspacePath],
  });
};

export const opusTarget: EditorTarget = {
  id: "opus",
  async describe() {
    return {
      id: this.id,
      label: "Opus",
      kind: "file-manager",
      icon: { kind: "symbol", name: "folder" },
    };
  },
  async isInstalled(runtime) {
    return runtime.platform === "win32" && resolveOpusRuntime(runtime) !== null;
  },
  launch: launchOpus,
};
