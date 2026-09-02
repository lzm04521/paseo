import { describe, expect, it } from "vitest";
import {
  resolveExplorerSidebarDockSizes,
  resolveExplorerSidebarWidth,
} from "@/components/explorer-sidebar-layout";

describe("Explorer sidebar layout", () => {
  it("keeps the sidebar width fixed when the workspace body changes size", () => {
    const narrow = resolveExplorerSidebarDockSizes({ requestedWidth: 320, containerWidth: 1200 });
    const wide = resolveExplorerSidebarDockSizes({ requestedWidth: 320, containerWidth: 1520 });

    expect(narrow[1] * 1200).toBeCloseTo(320);
    expect(wide[1] * 1520).toBeCloseTo(320);
  });

  it("has no fixed maximum while preserving room for the workspace body", () => {
    expect(resolveExplorerSidebarWidth({ requestedWidth: 100, containerWidth: 1200 })).toBe(240);
    expect(resolveExplorerSidebarWidth({ requestedWidth: 900, containerWidth: 1600 })).toBe(900);
    expect(resolveExplorerSidebarWidth({ requestedWidth: 900, containerWidth: 1200 })).toBe(800);
    expect(resolveExplorerSidebarWidth({ requestedWidth: 600, containerWidth: 750 })).toBe(350);
  });

  it("derives the default width from the configured ratio when no width is remembered", () => {
    expect(resolveExplorerSidebarWidth({ containerWidth: 1600, defaultWidthRatio: 0.25 })).toBe(
      400,
    );
    expect(resolveExplorerSidebarWidth({ containerWidth: 1600, defaultWidthRatio: 0.4 })).toBe(640);
  });

  it("prefers the remembered width over the configured default ratio", () => {
    expect(
      resolveExplorerSidebarWidth({
        requestedWidth: 320,
        containerWidth: 1600,
        defaultWidthRatio: 0.4,
      }),
    ).toBe(320);
  });

  it("still clamps the ratio-derived width to the sidebar and body minimums", () => {
    // 10% of 1200 = 120 → the 240px sidebar floor wins.
    expect(resolveExplorerSidebarWidth({ containerWidth: 1200, defaultWidthRatio: 0.1 })).toBe(240);
    // 50% of 700 = 350 → capped to keep 400px for the workspace body.
    expect(resolveExplorerSidebarWidth({ containerWidth: 700, defaultWidthRatio: 0.5 })).toBe(300);
  });

  it("falls back to the fixed default while the container width is unknown", () => {
    expect(resolveExplorerSidebarWidth({ containerWidth: 0, defaultWidthRatio: 0.25 })).toBe(320);
    expect(resolveExplorerSidebarDockSizes({ containerWidth: 0, defaultWidthRatio: 0.25 })).toEqual(
      [1, 0],
    );
  });

  it("uses the ratio-derived width for dock sizes", () => {
    expect(
      resolveExplorerSidebarDockSizes({ containerWidth: 1600, defaultWidthRatio: 0.25 }),
    ).toEqual([0.75, 0.25]);
  });
});
