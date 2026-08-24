import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILE_OPEN_DISPOSITION,
  DEFAULT_SIDE_PANEL_DEFAULT_VIEWS,
  DEFAULT_SIDE_PANEL_WIDTH_PERCENT,
  MAX_SIDE_PANEL_WIDTH_PERCENT,
  MIN_SIDE_PANEL_WIDTH_PERCENT,
  parseFileOpenDisposition,
  parseSidePanelDefaultViews,
  parseSidePanelWidthPercent,
  sidePanelDefaultTargets,
} from "@/workspace-tabs/side-panel-defaults";

describe("parseSidePanelDefaultViews", () => {
  it("returns both defaults off for missing or invalid input", () => {
    expect(parseSidePanelDefaultViews(undefined)).toEqual(DEFAULT_SIDE_PANEL_DEFAULT_VIEWS);
    expect(parseSidePanelDefaultViews(null)).toEqual(DEFAULT_SIDE_PANEL_DEFAULT_VIEWS);
    expect(parseSidePanelDefaultViews("changes")).toEqual(DEFAULT_SIDE_PANEL_DEFAULT_VIEWS);
    expect(parseSidePanelDefaultViews({ changes: "yes" })).toEqual(
      DEFAULT_SIDE_PANEL_DEFAULT_VIEWS,
    );
    expect(parseSidePanelDefaultViews({ unknown: true })).toEqual(DEFAULT_SIDE_PANEL_DEFAULT_VIEWS);
  });

  it("fills omitted entries with their defaults", () => {
    expect(parseSidePanelDefaultViews({ changes: true })).toEqual({
      changes: true,
      fileNav: false,
    });
    expect(parseSidePanelDefaultViews({})).toEqual(DEFAULT_SIDE_PANEL_DEFAULT_VIEWS);
  });

  it("keeps a stored selection", () => {
    expect(parseSidePanelDefaultViews({ changes: true, fileNav: true })).toEqual({
      changes: true,
      fileNav: true,
    });
    expect(parseSidePanelDefaultViews({ changes: false, fileNav: true })).toEqual({
      changes: false,
      fileNav: true,
    });
  });
});

describe("sidePanelDefaultTargets", () => {
  const gitCheckout = { serverId: "s", cwd: "/repo", isGit: true };
  const nonGitCheckout = { serverId: "s", cwd: "/repo", isGit: false };

  it("returns nothing without a preference", () => {
    expect(sidePanelDefaultTargets(undefined, gitCheckout)).toEqual([]);
    expect(sidePanelDefaultTargets(DEFAULT_SIDE_PANEL_DEFAULT_VIEWS, gitCheckout)).toEqual([]);
  });

  it("maps each selected entry to its tab target in settings-row order", () => {
    expect(sidePanelDefaultTargets({ changes: true, fileNav: false }, gitCheckout)).toEqual([
      { kind: "working_diff" },
    ]);
    expect(sidePanelDefaultTargets({ changes: false, fileNav: true }, gitCheckout)).toEqual([
      { kind: "file_nav" },
    ]);
    expect(sidePanelDefaultTargets({ changes: true, fileNav: true }, gitCheckout)).toEqual([
      { kind: "working_diff" },
      { kind: "file_nav" },
    ]);
  });

  it("drops Changes for a checkout without Git", () => {
    expect(sidePanelDefaultTargets({ changes: true, fileNav: false }, nonGitCheckout)).toEqual([]);
    expect(sidePanelDefaultTargets({ changes: true, fileNav: true }, nonGitCheckout)).toEqual([
      { kind: "file_nav" },
    ]);
  });

  it("keeps Changes when the checkout carries no Git answer", () => {
    expect(sidePanelDefaultTargets({ changes: true, fileNav: false }, null)).toEqual([
      { kind: "working_diff" },
    ]);
  });
});

describe("parseSidePanelWidthPercent", () => {
  it("clamps out-of-range values into the 10–90 bounds", () => {
    expect(parseSidePanelWidthPercent(0)).toBe(MIN_SIDE_PANEL_WIDTH_PERCENT);
    expect(parseSidePanelWidthPercent(5)).toBe(MIN_SIDE_PANEL_WIDTH_PERCENT);
    expect(parseSidePanelWidthPercent(95)).toBe(MAX_SIDE_PANEL_WIDTH_PERCENT);
    expect(parseSidePanelWidthPercent(1000)).toBe(MAX_SIDE_PANEL_WIDTH_PERCENT);
  });

  it("accepts numbers and numeric strings and rounds fractions", () => {
    expect(parseSidePanelWidthPercent(50)).toBe(50);
    expect(parseSidePanelWidthPercent("70")).toBe(70);
    expect(parseSidePanelWidthPercent(33.4)).toBe(33);
  });

  it("returns null for missing or non-numeric input", () => {
    expect(parseSidePanelWidthPercent(undefined)).toBeNull();
    expect(parseSidePanelWidthPercent(null)).toBeNull();
    expect(parseSidePanelWidthPercent("abc")).toBeNull();
    expect(parseSidePanelWidthPercent(Number.NaN)).toBeNull();
    expect(parseSidePanelWidthPercent("")).toBeNull();
  });

  it("defaults to an even split", () => {
    expect(DEFAULT_SIDE_PANEL_WIDTH_PERCENT).toBe(50);
  });
});

describe("parseFileOpenDisposition", () => {
  it("accepts the two dispositions and rejects anything else", () => {
    expect(parseFileOpenDisposition("main")).toBe("main");
    expect(parseFileOpenDisposition("side")).toBe("side");
    expect(parseFileOpenDisposition("center")).toBeNull();
    expect(parseFileOpenDisposition(3)).toBeNull();
    expect(parseFileOpenDisposition(undefined)).toBeNull();
    expect(DEFAULT_FILE_OPEN_DISPOSITION).toBe("side");
  });
});
