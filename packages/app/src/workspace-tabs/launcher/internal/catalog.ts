export const PRIMARY_LAUNCH_ORDER = [
  "agent",
  "terminal",
  "powershell",
  "changes",
  "files",
  "browser",
  "pullRequest",
] as const;

// fileNav is Side-panel only: the navigation tree lives beside the user's work,
// so it has no place in the main pane's launcher.
export const SUPPORTING_LAUNCH_ORDER = [
  "changes",
  "files",
  "fileNav",
  "terminal",
  "powershell",
  "agent",
  "browser",
  "pullRequest",
] as const;

export type BuiltInLaunchItemId =
  | (typeof PRIMARY_LAUNCH_ORDER)[number]
  | (typeof SUPPORTING_LAUNCH_ORDER)[number];

export function getBuiltInLaunchOrder(purpose: "primary" | "supporting") {
  return purpose === "supporting" ? SUPPORTING_LAUNCH_ORDER : PRIMARY_LAUNCH_ORDER;
}
