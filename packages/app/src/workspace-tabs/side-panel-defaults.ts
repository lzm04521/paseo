import { z } from "zod";
import type { ExplorerCheckoutContext } from "@/stores/explorer-checkout-context";
import type { OpenFileDisposition } from "@/workspace/file-open";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

/**
 * The "open when revealing the side panel" preference (Settings → Appearance).
 * Both entries are optional — an empty selection keeps the reveal behaviour
 * untouched: the pane shows whatever tabs it already holds.
 */
export interface SidePanelDefaultViews {
  changes: boolean;
  fileNav: boolean;
}

export const SidePanelDefaultViewsSchema = z.strictObject({
  changes: z.boolean().optional(),
  fileNav: z.boolean().optional(),
});

export const DEFAULT_SIDE_PANEL_DEFAULT_VIEWS: SidePanelDefaultViews = {
  changes: false,
  fileNav: false,
};

export function parseSidePanelDefaultViews(value: unknown): SidePanelDefaultViews {
  const parsed = SidePanelDefaultViewsSchema.safeParse(value);
  if (!parsed.success) {
    return DEFAULT_SIDE_PANEL_DEFAULT_VIEWS;
  }
  return {
    changes: parsed.data.changes ?? DEFAULT_SIDE_PANEL_DEFAULT_VIEWS.changes,
    fileNav: parsed.data.fileNav ?? DEFAULT_SIDE_PANEL_DEFAULT_VIEWS.fileNav,
  };
}

/**
 * The tab targets the reveal-the-side-panel path should open, in display order
 * (Changes first, matching the settings rows). A checkout without Git has no
 * Changes panel at all — `showChanges` in the launcher is gated on `isGit` — so
 * a selected Changes is dropped there instead of opening an empty panel. A null
 * checkout carries no Git answer and keeps the selection.
 */
export function sidePanelDefaultTargets(
  views: SidePanelDefaultViews | undefined,
  checkout: ExplorerCheckoutContext | null,
): WorkspaceTabTarget[] {
  if (!views) {
    return [];
  }
  const targets: WorkspaceTabTarget[] = [];
  if (views.changes && checkout?.isGit !== false) {
    targets.push({ kind: "working_diff" });
  }
  if (views.fileNav) {
    targets.push({ kind: "file_nav" });
  }
  return targets;
}

// ─── Reveal width ───────────────────────────────────────────────────────────

/** Clamped bounds for the "side panel share when revealed" preference, in percent. */
export const MIN_SIDE_PANEL_WIDTH_PERCENT = 10;
export const MAX_SIDE_PANEL_WIDTH_PERCENT = 90;
export const DEFAULT_SIDE_PANEL_WIDTH_PERCENT = 50;

export function clampSidePanelWidthPercent(value: number): number {
  return Math.min(
    MAX_SIDE_PANEL_WIDTH_PERCENT,
    Math.max(MIN_SIDE_PANEL_WIDTH_PERCENT, Math.round(value)),
  );
}

/** Accepts the persisted number or a legacy/stale string form; null means "no valid value". */
export function parseSidePanelWidthPercent(value: unknown): number | null {
  let numericValue = NaN;
  if (typeof value === "number") {
    numericValue = value;
  } else if (typeof value === "string" && value.trim().length > 0) {
    numericValue = Number(value);
  }
  if (!Number.isFinite(numericValue)) {
    return null;
  }
  return clampSidePanelWidthPercent(numericValue);
}

// ─── File open disposition ──────────────────────────────────────────────────

/**
 * Where chat file links and the file navigation panel open files. The default
 * keeps the historical behaviour: routed into the side panel.
 */
export const DEFAULT_FILE_OPEN_DISPOSITION: OpenFileDisposition = "side";

const VALID_FILE_OPEN_DISPOSITIONS = new Set<OpenFileDisposition>(["main", "side"]);

export function parseFileOpenDisposition(value: unknown): OpenFileDisposition | null {
  return typeof value === "string" && VALID_FILE_OPEN_DISPOSITIONS.has(value as OpenFileDisposition)
    ? (value as OpenFileDisposition)
    : null;
}
