export const PRIMARY_LAUNCH_ORDER = [
  "agent",
  "terminal",
  "powershell",
  "changes",
  "diff",
  "files",
  "browser",
  "pullRequest",
] as const;

export const SUPPORTING_LAUNCH_ORDER = [
  "changes",
  "diff",
  "files",
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
