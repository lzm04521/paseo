import {
  paneContentToolbarIconSize,
  paneContentToolbarTrailingPadding,
} from "@/components/ui/pane-content-toolbar";
import { smallIconButtonChromeFrameSize } from "@/components/ui/icon-button-chrome";

export function explorerSidebarCloseButtonLayout(compact: boolean) {
  // The inline native dock retains its padded close action and touch slop.
  if (!compact) {
    return { size: 34, iconSize: 18, hitSlop: 8, trailingPadding: 8 };
  }
  return {
    size: smallIconButtonChromeFrameSize(compact),
    iconSize: paneContentToolbarIconSize(compact),
    hitSlop: 0,
    trailingPadding: paneContentToolbarTrailingPadding(compact, "glyph"),
  };
}

/**
 * Outer inset of an Explorer tab rail. With each tab's own horizontal padding it puts
 * the tab label on the pane's shared leading rail (`treeRowPaddingLeft(0)`).
 */
export const EXPLORER_TAB_RAIL_INSET = 4;

const DEFAULT_EXPLORER_SIDEBAR_WIDTH = 320;
const MIN_EXPLORER_SIDEBAR_WIDTH = 240;
const MIN_WORKSPACE_BODY_WIDTH = 400;

export function resolveExplorerSidebarWidth(input: {
  requestedWidth?: number;
  containerWidth: number;
  /** Fallback share of the container used when requestedWidth is unset (e.g. 0.25). */
  defaultWidthRatio?: number;
}): number {
  const requestedWidth =
    input.requestedWidth ??
    (input.defaultWidthRatio !== undefined && input.containerWidth > 0
      ? input.containerWidth * input.defaultWidthRatio
      : undefined) ??
    DEFAULT_EXPLORER_SIDEBAR_WIDTH;
  const maximumVisibleWidth =
    input.containerWidth > 0
      ? Math.max(MIN_EXPLORER_SIDEBAR_WIDTH, input.containerWidth - MIN_WORKSPACE_BODY_WIDTH)
      : requestedWidth;
  return Math.max(MIN_EXPLORER_SIDEBAR_WIDTH, Math.min(maximumVisibleWidth, requestedWidth));
}

export function resolveExplorerSidebarDockSizes(input: {
  requestedWidth?: number;
  containerWidth: number;
  defaultWidthRatio?: number;
}): number[] {
  if (input.containerWidth <= 0) {
    return [1, 0];
  }
  const width = resolveExplorerSidebarWidth(input);
  const ratio = width / input.containerWidth;
  return [1 - ratio, ratio];
}
