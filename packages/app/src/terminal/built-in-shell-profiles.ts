import type { TerminalProfile } from "@getpaseo/protocol/messages";

// Built-in shell launcher profiles. "打开cmd" keeps the daemon's default shell
// (ComSpec = cmd.exe on Windows), so it needs no profile; PowerShell launches
// through the same profile channel as user-configured terminal profiles.
export const POWERSHELL_PROFILE_ID = "powershell";

export const POWERSHELL_PROFILE: TerminalProfile = {
  id: POWERSHELL_PROFILE_ID,
  name: "PowerShell",
  // Sentinel command: the daemon resolves it to the best available PowerShell
  // (configured path → pwsh → PowerShell 7 install dir → Windows PowerShell).
  command: "powershell",
  args: [],
};
