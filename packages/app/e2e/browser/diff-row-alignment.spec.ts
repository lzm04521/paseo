import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Locator, type Page } from "@playwright/test";
import { buildHostWorkspaceRoute, buildSettingsSectionRoute } from "../../src/utils/host-routes";
import { test, expect } from "../support/fixtures";
import { getServerId } from "../support/helpers/server-id";
import { connectSeedClient } from "../support/helpers/seed-client";
import { createTempGitRepo } from "../support/helpers/workspace";
import { waitForWorkspaceTabsVisible } from "../support/helpers/workspace-tabs";

interface DirtyWorkspace {
  id: string;
  repoPath: string;
}

interface WorkspaceFixtureOptions {
  includeDeletedFile?: boolean;
}

interface CleanupTask {
  run: () => Promise<void>;
}

const cleanupTasks: CleanupTask[] = [];
const APP_SETTINGS_KEY = "@paseo:app-settings";
const CHANGES_PREFERENCES_KEY = "@paseo:changes-preferences";

interface HorizontalInkBounds {
  left: number;
  right: number;
}

async function readSvgInkBounds(svgLocator: Locator): Promise<HorizontalInkBounds> {
  return svgLocator.evaluate((svg) => {
    const graphics = Array.from(svg.querySelectorAll<SVGGraphicsElement>("path, line, polyline"));
    const bounds = graphics.map((graphic) => {
      const box = graphic.getBBox();
      const matrix = graphic.getScreenCTM();
      if (!matrix) {
        throw new Error("SVG glyph has no screen transform");
      }
      const strokeInset = Number.parseFloat(getComputedStyle(graphic).strokeWidth) / 2 || 0;
      const corners = [
        new DOMPoint(box.x - strokeInset, box.y - strokeInset),
        new DOMPoint(box.x + box.width + strokeInset, box.y - strokeInset),
        new DOMPoint(box.x - strokeInset, box.y + box.height + strokeInset),
        new DOMPoint(box.x + box.width + strokeInset, box.y + box.height + strokeInset),
      ].map((point) => point.matrixTransform(matrix));
      return {
        left: Math.min(...corners.map((point) => point.x)),
        right: Math.max(...corners.map((point) => point.x)),
      };
    });
    return {
      left: Math.min(...bounds.map((bound) => bound.left)),
      right: Math.max(...bounds.map((bound) => bound.right)),
    };
  });
}

async function readTextInkBounds(
  container: Locator,
  edge: "first" | "last" = "first",
): Promise<HorizontalInkBounds> {
  return container.evaluate((root, requestedEdge) => {
    const textElements = [root, ...Array.from(root.querySelectorAll("*"))].filter((element) =>
      Array.from(element.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
      ),
    );
    const element = textElements[requestedEdge === "first" ? 0 : textElements.length - 1];
    const text = Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? "")
      .join("")
      .trim();
    const style = getComputedStyle(element);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context || !text) {
      throw new Error("Text glyph could not be measured");
    }
    context.font = style.font;
    const metrics = context.measureText(text);
    const origin = element.getBoundingClientRect().left;
    return {
      left: origin - metrics.actualBoundingBoxLeft,
      right: origin + metrics.actualBoundingBoxRight,
    };
  }, edge);
}

async function readScrollbarGutter(scrollContainer: Locator): Promise<number> {
  return scrollContainer.evaluate((element) => {
    const htmlElement = element as HTMLElement;
    return htmlElement.offsetWidth - htmlElement.clientWidth;
  });
}

async function dragOverlayScrollbarDown(page: Page, scrollContainer: Locator): Promise<void> {
  const thumb = page.getByTestId("workspace-overlay-scrollbar-grab");
  const thumbBounds = await thumb.boundingBox();
  expect(thumbBounds).not.toBeNull();
  const initialOffset = await scrollContainer.evaluate((element) => element.scrollTop);
  await page.mouse.move(
    thumbBounds!.x + thumbBounds!.width / 2,
    thumbBounds!.y + thumbBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    thumbBounds!.x + thumbBounds!.width / 2,
    thumbBounds!.y + thumbBounds!.height / 2 + 40,
    { steps: 4 },
  );
  await page.mouse.up();
  await expect
    .poll(() => scrollContainer.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(initialOffset);
}

function expectSameRail(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
}

const BEFORE = `import { useLayoutEffect, useMemo, useRef, useState } from "react";

interface UseMountedTabSetInput {
  activeTabId: string | null;
  allTabIds: string[];
  cap: number;
}

interface UseMountedTabSetResult {
  mountedTabIds: Set<string>;
}

function createInitialMountedTabIds(input: UseMountedTabSetInput): Set<string> {
  if (!input.activeTabId || !input.allTabIds.includes(input.activeTabId)) {
    return new Set<string>();
  }
  return new Set<string>([input.activeTabId]);
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

export function useMountedTabSet(input: UseMountedTabSetInput): UseMountedTabSetResult {
  const { activeTabId, allTabIds, cap } = input;
  const allTabIdsKey = allTabIds.join("\\u0000");
  const availableTabIds = useMemo(() => {
    void allTabIdsKey;
    return new Set(allTabIds);
  }, [allTabIds, allTabIdsKey]);
  const [mountedTabIds, setMountedTabIds] = useState(() => createInitialMountedTabIds(input));
  const lruRef = useRef(activeTabId && allTabIds.includes(activeTabId) ? [activeTabId] : []);

  useLayoutEffect(() => {
    const nextLru = lruRef.current.filter((tabId) => availableTabIds.has(tabId));
    if (activeTabId && availableTabIds.has(activeTabId)) {
      const existingIndex = nextLru.indexOf(activeTabId);
      if (existingIndex >= 0) {
        nextLru.splice(existingIndex, 1);
      }
      nextLru.unshift(activeTabId);
    }
    if (nextLru.length > cap) {
      nextLru.length = cap;
    }

    lruRef.current = nextLru;
    setMountedTabIds((previousMountedTabIds) => {
      const nextMountedTabIds = new Set(nextLru);
      return setsEqual(previousMountedTabIds, nextMountedTabIds)
        ? previousMountedTabIds
        : nextMountedTabIds;
    });
  }, [activeTabId, availableTabIds, cap]);

  return { mountedTabIds };
}
`;

const AFTER = `import { useLayoutEffect, useMemo, useRef, useState } from "react";

interface UseMountedTabSetInput {
  activeTabId: string | null;
  allTabIds: string[];
  cap: number;
}

interface UseMountedTabSetResult {
  mountedTabIds: Set<string>;
}

interface DeriveRenderMountedTabIdsInput {
  activeTabId: string | null;
  availableTabIds: Set<string>;
  cap: number;
  mountedTabIds: Set<string>;
}

function createInitialMountedTabIds(input: UseMountedTabSetInput): Set<string> {
  if (!input.activeTabId || !input.allTabIds.includes(input.activeTabId)) {
    return new Set<string>();
  }
  return new Set<string>([input.activeTabId]);
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

function deriveRenderMountedTabIds(input: DeriveRenderMountedTabIdsInput): Set<string> {
  const { activeTabId, availableTabIds, cap, mountedTabIds } = input;
  if (!activeTabId || !availableTabIds.has(activeTabId) || mountedTabIds.has(activeTabId)) {
    return mountedTabIds;
  }

  const next = new Set<string>([activeTabId]);
  const maxSize = Math.max(1, cap);
  for (const tabId of mountedTabIds) {
    if (next.size >= maxSize) {
      break;
    }
    if (availableTabIds.has(tabId)) {
      next.add(tabId);
    }
  }
  return next;
}

export function useMountedTabSet(input: UseMountedTabSetInput): UseMountedTabSetResult {
  const { activeTabId, allTabIds, cap } = input;
  const allTabIdsKey = allTabIds.join("\\u0000");
  const availableTabIds = useMemo(() => {
    void allTabIdsKey;
    return new Set(allTabIds);
  }, [allTabIds, allTabIdsKey]);
  const [mountedTabIds, setMountedTabIds] = useState(() => createInitialMountedTabIds(input));
  const lruRef = useRef(activeTabId && allTabIds.includes(activeTabId) ? [activeTabId] : []);
  const renderMountedTabIds = useMemo(
    () =>
      deriveRenderMountedTabIds({
        activeTabId,
        availableTabIds,
        cap,
        mountedTabIds,
      }),
    [activeTabId, availableTabIds, cap, mountedTabIds],
  );

  useLayoutEffect(() => {
    const nextLru = lruRef.current.filter((tabId) => availableTabIds.has(tabId));
    if (activeTabId && availableTabIds.has(activeTabId)) {
      const existingIndex = nextLru.indexOf(activeTabId);
      if (existingIndex >= 0) {
        nextLru.splice(existingIndex, 1);
      }
      nextLru.unshift(activeTabId);
    }
    if (nextLru.length > cap) {
      nextLru.length = cap;
    }

    lruRef.current = nextLru;
    setMountedTabIds((previousMountedTabIds) => {
      const nextMountedTabIds = new Set(nextLru);
      return setsEqual(previousMountedTabIds, nextMountedTabIds)
        ? previousMountedTabIds
        : nextMountedTabIds;
    });
  }, [activeTabId, availableTabIds, cap]);

  return { mountedTabIds: renderMountedTabIds };
}
`;

test.afterEach(async () => {
  for (const task of cleanupTasks.splice(0)) {
    await task.run();
  }
});

test("changes diff keeps code rows aligned with the gutter", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useCodeFont(page, 9);
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await expectDiffCodeFontSize(page, 9);
  await expectVisibleDiffRowsAligned(page);
  await expectDiffCodeTextAlignedWithGutterText(page, [
    {
      codeText: "function createInitialMountedTabIds(input: UseMountedTabSetInput)",
      lineNumber: "20",
    },
    { codeText: "return next;", lineNumber: "55" },
    { codeText: "useLayoutEffect(() => {", lineNumber: "78" },
  ]);
  await expectHoverCommentButtonAlignedWithCodeLine(page, {
    codeText: "function createInitialMountedTabIds(input: UseMountedTabSetInput)",
    lineNumber: "20",
  });
});

test("changes file actions open below the right-click without a reserved kebab", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithMountedTabDiff({ includeDeletedFile: true });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await expect(page.getByTestId("diff-file-1")).toContainText("zz-deleted.ts");
  await expect(page.getByTestId(/diff-file-\d+-actions/)).toHaveCount(0);
  await page.getByTestId("diff-file-1-toggle").click({ button: "right" });
  await expect(page.getByText("Copy path")).toBeVisible();
  await expect(page.getByTestId("diff-file-1-open-file")).toHaveCount(0);
  await page.keyboard.press("Escape");

  const fileRow = page.getByTestId("diff-file-0-toggle");
  const fileRowBounds = await fileRow.boundingBox();
  expect(fileRowBounds).not.toBeNull();
  await fileRow.click({ button: "right", position: { x: 80, y: 10 } });
  await expect(page.getByTestId("diff-file-0-open-file")).toBeVisible();
  const menuBounds = await page.getByTestId("diff-file-0-context-menu").boundingBox();
  expect(menuBounds).not.toBeNull();
  expect(menuBounds!.x).toBeCloseTo(fileRowBounds!.x + 80, 0);
  expect(menuBounds!.y).toBeGreaterThan(fileRowBounds!.y + 10);
  await page.getByTestId("diff-file-0-open-file").click();

  await expect(page.getByTestId("workspace-file-pane")).toBeVisible();
  await expect(page.getByTestId("workspace-tab-file_src/use-mounted-tab-set.ts")).toBeVisible();
});

test("Changes switches between inline and full-tab navigation", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff({ includeDeletedFile: true });
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  const changesTabToggle = page.getByTestId("changes-open-tab");
  await expect(changesTabToggle).toHaveAccessibleName("Open Changes tab");
  await changesTabToggle.click();
  await expect(changesTabToggle).toHaveAccessibleName("Close Changes tab");

  const visiblePanel = page.getByTestId("working-diff-panel").filter({ visible: true });
  await expect(visiblePanel).toBeVisible();
  await expect(visiblePanel.getByText("use-mounted-tab-set.ts", { exact: true })).toBeVisible();
  await expect(visiblePanel).toContainText("zz-deleted.ts");
  await expect(visiblePanel.getByTestId("diff-file-0-body")).toBeVisible();
  await expect(page.getByTestId("workspace-file-pane")).toHaveCount(0);
  await visiblePanel.getByTestId("diff-file-0-toggle").click();
  await expect(visiblePanel.getByTestId("diff-file-0-body")).toHaveCount(0);
  await visiblePanel.getByTestId("diff-file-0-toggle").click();
  await expect(visiblePanel.getByTestId("diff-file-0-body")).toBeVisible();
  const workingDiffLayoutToggle = visiblePanel.getByTestId("working-diff-toggle-layout");
  await expect(workingDiffLayoutToggle).toHaveAccessibleName("Switch to side-by-side diff");
  await workingDiffLayoutToggle.click();
  await expect(workingDiffLayoutToggle).toHaveAccessibleName("Switch to unified diff");
  await visiblePanel.getByTestId("working-diff-options-menu").click();
  await expect(page.getByTestId("working-diff-toggle-whitespace")).toContainText("Hide whitespace");
  await expect(page.getByTestId("working-diff-toggle-wrap-lines")).toContainText("Wrap long lines");
  await expect(page.getByTestId("working-diff-refresh")).toContainText("Refresh");
  await page.getByTestId("working-diff-toggle-wrap-lines").click();
  await visiblePanel.getByTestId("working-diff-options-menu").click();
  await expect(page.getByTestId("working-diff-toggle-wrap-lines")).toContainText(
    "Scroll long lines",
  );
  await page.keyboard.press("Escape");
  await visiblePanel.getByTestId("working-diff-toggle-expand-all").click();
  await expect(visiblePanel.getByTestId(/^diff-file-\d+-body$/)).toHaveCount(0);
  await visiblePanel.getByTestId("working-diff-toggle-expand-all").click();
  await expect(visiblePanel.getByTestId("diff-file-0-body")).toBeVisible();

  await page.getByTestId("explorer-content-area").getByTestId("diff-file-0-toggle").click();
  await expect(
    page.getByTestId("explorer-content-area").getByTestId("diff-file-0-body"),
  ).toHaveCount(0);
  await expect(page.getByTestId(/^workspace-working-diff-close-/)).toHaveCount(1);

  await writeFile(path.join(workspace.repoPath, "src/use-mounted-tab-set.ts"), BEFORE);
  await expect(visiblePanel.getByText("use-mounted-tab-set.ts", { exact: true })).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(visiblePanel).toContainText("zz-deleted.ts");
  await writeFile(path.join(workspace.repoPath, "src/use-mounted-tab-set.ts"), AFTER);
  await expect(visiblePanel.getByText("use-mounted-tab-set.ts", { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  await expect(page.getByTestId("explorer-content-area").getByTestId("diff-file-1")).toContainText(
    "zz-deleted.ts",
  );
  await page.getByTestId("explorer-content-area").getByTestId("diff-file-1-toggle").click();
  await expect(page.getByTestId(/^workspace-working-diff-close-/)).toHaveCount(1);
  await expect(visiblePanel.getByText("zz-deleted.ts", { exact: true })).toBeVisible();
  await expect(visiblePanel.getByRole("img", { name: "Deleted" })).toBeVisible();

  await changesTabToggle.click();
  await expect(page.getByTestId(/^workspace-working-diff-close-/)).toHaveCount(0);
  await expect(
    page.getByTestId("explorer-content-area").getByTestId("diff-file-0-body"),
  ).toBeVisible();
  await page.getByTestId("explorer-content-area").getByTestId("diff-file-0-toggle").click();
  await expect(
    page.getByTestId("explorer-content-area").getByTestId("diff-file-0-body"),
  ).toHaveCount(0);
});

test("changes diff switches between flat and tree file lists", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await expectFlatFileList(page);
  await expect(page.getByTestId("changes-toggle-layout")).toBeVisible();
  await expect(page.getByTestId("changes-layout-unified")).toHaveCount(0);
  await expect(page.getByTestId("changes-layout-split")).toHaveCount(0);

  await page.getByTestId("changes-options-menu").click();
  await expect(page.getByTestId("changes-options-menu-content")).toBeVisible();
  await expect(page.getByTestId("changes-toggle-whitespace")).toContainText("Hide whitespace");
  await expect(page.getByTestId("changes-toggle-wrap-lines")).toContainText("Wrap long lines");
  await expect(page.getByTestId("changes-refresh")).toContainText("Refresh");
  await page.getByTestId("changes-toggle-whitespace").click();
  await page.getByTestId("changes-options-menu").click();
  await expect(page.getByTestId("changes-toggle-whitespace")).toContainText("Show whitespace");
  await page.keyboard.press("Escape");

  await scrollToLowerUnwrappedDiffRows(page);
  await page.getByTestId("changes-toggle-view-mode").click();
  await expect(page.getByTestId("diff-folder-src")).toBeVisible();
  await expect(page.getByTestId("diff-file-0")).toBeVisible();
  await page.getByTestId("diff-file-0-toggle").click({ button: "right" });
  await expect(page.getByTestId("diff-file-0-context-menu")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Collapse all" }).click();
  await expect(page.getByTestId("diff-file-0")).toHaveCount(0);
  await page.getByRole("button", { name: "Expand all" }).click();
  await expect(page.getByTestId("diff-file-0-body")).toBeVisible();

  await page.getByTestId("diff-folder-src-toggle").click();
  await expect(page.getByTestId("diff-file-0")).toHaveCount(0);

  await page.getByTestId("changes-toggle-view-mode").click();
  await expectFlatFileList(page);
});

test("workspace file panes keep their controls on shared alignment rails", async ({ page }) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await openWorkspaceChanges(page, workspace);

  const diffScroll = page.getByTestId("git-diff-scroll");
  await diffScroll.evaluate((element) => {
    element.style.scrollbarGutter = "stable";
  });
  expect(await readScrollbarGutter(diffScroll)).toBe(0);
  const overlayScrollbarBounds = await page
    .getByTestId("workspace-overlay-scrollbar")
    .boundingBox();
  const overlayThumbBounds = await page
    .getByTestId("workspace-overlay-scrollbar-thumb")
    .boundingBox();
  expect(overlayScrollbarBounds?.width).toBe(8);
  expect(overlayThumbBounds?.width).toBe(4);
  const flatFileStat = await readTextInkBounds(page.getByTestId("diff-file-0-stat"), "last");
  await page.getByTestId("changes-toggle-view-mode").click();
  await expect(page.getByTestId("diff-folder-src")).toBeVisible();

  await expect(page.getByTestId("diff-file-0-actions")).toHaveCount(0);

  const folderRow = page.getByTestId("diff-folder-src-toggle");
  const fileRow = page.getByTestId("diff-file-0-toggle");
  await folderRow.hover();
  const folderHoverColor = await folderRow.evaluate((row) => getComputedStyle(row).backgroundColor);
  await fileRow.hover();
  const fileHoverColor = await fileRow.evaluate((row) => getComputedStyle(row).backgroundColor);
  expect(fileHoverColor).toBe(folderHoverColor);

  const diffFolderName = folderRow.getByText("src", { exact: true });
  const diffFileName = fileRow.getByText("use-mounted-tab-set.ts", { exact: true });
  const diffFolderIconLocator = folderRow.locator("svg").first();
  const diffFileIconLocator = fileRow.locator("svg").first();
  const [diffFolderIcon, diffFileIcon, diffFolderNameBounds, diffFileNameBounds] =
    await Promise.all([
      readSvgInkBounds(diffFolderIconLocator),
      readSvgInkBounds(diffFileIconLocator),
      diffFolderName.boundingBox(),
      diffFileName.boundingBox(),
    ]);
  expect(diffFolderNameBounds).not.toBeNull();
  expect(diffFileNameBounds).not.toBeNull();
  const diffTreeIconNameGap = diffFolderNameBounds!.x - diffFolderIcon.right;
  expectSameRail(diffTreeIconNameGap, diffFileNameBounds!.x - diffFileIcon.right);

  const [folderStat, fileStat, optionsChevron, explorerCloseIcon] = await Promise.all([
    readTextInkBounds(page.getByTestId("diff-folder-src-stat"), "last"),
    readTextInkBounds(page.getByTestId("diff-file-0-stat"), "last"),
    readSvgInkBounds(page.getByTestId("changes-options-menu").locator("svg")),
    readSvgInkBounds(page.getByTestId("explorer-close").locator("svg")),
  ]);
  expectSameRail(folderStat.right, fileStat.right);
  expectSameRail(flatFileStat.right, fileStat.right);
  expectSameRail(fileStat.right, explorerCloseIcon.right);
  expectSameRail(fileStat.right, optionsChevron.right);
  expectSameRail(optionsChevron.right, explorerCloseIcon.right);
  await folderRow.click();
  await folderRow.click();
  await dragOverlayScrollbarDown(page, diffScroll);

  await page.getByTestId("explorer-tab-files").click();
  await expect(page.getByTestId("file-explorer-row-0")).toBeVisible();
  const filesScroll = page.getByTestId("file-explorer-tree-scroll");
  await filesScroll.evaluate((element) => {
    element.style.scrollbarGutter = "stable";
  });
  expect(await readScrollbarGutter(filesScroll)).toBe(0);

  await expect(page.getByTestId("file-explorer-row-0-actions")).toHaveCount(0);
  const fileExplorerRow = page.getByTestId("file-explorer-row-0");
  const fileExplorerRowBounds = await fileExplorerRow.boundingBox();
  expect(fileExplorerRowBounds).not.toBeNull();
  await fileExplorerRow.click({ button: "right", position: { x: 80, y: 10 } });
  await expect(page.getByTestId("file-explorer-row-0-context-menu")).toBeVisible();
  const fileMenuBounds = await page.getByTestId("file-explorer-row-0-context-menu").boundingBox();
  expect(fileMenuBounds).not.toBeNull();
  expect(fileMenuBounds!.x).toBeCloseTo(fileExplorerRowBounds!.x + 80, 0);
  expect(fileMenuBounds!.y).toBeGreaterThan(fileExplorerRowBounds!.y + 10);
  await page.keyboard.press("Escape");

  const directoryRow = page.getByTestId(/^file-explorer-row-\d+$/).filter({ hasText: "src" });
  const directoryName = directoryRow.getByText("src", { exact: true });
  const [collapsedDirectoryIcon, collapsedDirectoryNameBounds] = await Promise.all([
    readSvgInkBounds(directoryRow.locator("svg").first()),
    directoryName.boundingBox(),
  ]);
  expect(collapsedDirectoryNameBounds).not.toBeNull();

  await directoryRow.click();
  const nestedFileRow = page
    .getByTestId(/^file-explorer-row-\d+$/)
    .filter({ hasText: "use-mounted-tab-set.ts" });
  await expect(nestedFileRow).toBeVisible();
  const [expandedDirectoryIcon, expandedDirectoryNameBounds, fileIcon, fileNameBounds] =
    await Promise.all([
      readSvgInkBounds(directoryRow.locator("svg").first()),
      directoryName.boundingBox(),
      readSvgInkBounds(nestedFileRow.locator("svg").first()),
      nestedFileRow.getByText("use-mounted-tab-set.ts", { exact: true }).boundingBox(),
    ]);
  expect(expandedDirectoryNameBounds).not.toBeNull();
  expect(fileNameBounds).not.toBeNull();
  expect(expandedDirectoryNameBounds!.x).toBeCloseTo(collapsedDirectoryNameBounds!.x, 1);
  expectSameRail(
    collapsedDirectoryNameBounds!.x - collapsedDirectoryIcon.right,
    fileNameBounds!.x - fileIcon.right,
  );
  expectSameRail(
    expandedDirectoryNameBounds!.x - expandedDirectoryIcon.right,
    fileNameBounds!.x - fileIcon.right,
  );
  expectSameRail(diffTreeIconNameGap, fileNameBounds!.x - fileIcon.right);

  const readmeRow = page.getByTestId(/^file-explorer-row-\d+$/).filter({ hasText: "README.md" });
  const [sortLabel, fileRowIcon, treeBounds, rowBounds] = await Promise.all([
    readTextInkBounds(page.getByTestId("files-sort-label")),
    readSvgInkBounds(readmeRow.locator("svg").first()),
    page.getByTestId("file-explorer-tree-scroll").boundingBox(),
    page.getByTestId("file-explorer-row-0").boundingBox(),
  ]);
  expect(treeBounds).not.toBeNull();
  expect(rowBounds).not.toBeNull();
  expectSameRail(fileRowIcon.left, sortLabel.left);
  expect(rowBounds!.x).toBeCloseTo(treeBounds!.x, 0);
  expect(rowBounds!.x + rowBounds!.width).toBeCloseTo(treeBounds!.x + treeBounds!.width, 0);
});

test("changes diff keeps unwrapped gutter and code rows aligned after code size changes", async ({
  page,
}) => {
  const workspace = await createWorkspaceWithMountedTabDiff();
  await useCodeFont(page, 12);
  await useUnwrappedDiffLines(page);
  await openWorkspaceChanges(page, workspace);

  await changeCodeFontSizeFromSettings(page, 18);
  await returnToWorkspaceChanges(page);
  await expectStoredCodeFontSize(page, 18);
  await scrollToLowerUnwrappedDiffRows(page);

  await expectDiffCodeFontSize(page, 18);
  await expectVisibleDiffRowsShareTypography(page);
  await expectVisibleDiffRowsAligned(page);
});

async function useCodeFont(page: Page, codeFontSize: number): Promise<void> {
  await page.addInitScript(
    ({ settingsKey, fontSize }) => {
      if (localStorage.getItem(settingsKey)) {
        return;
      }
      localStorage.setItem(
        settingsKey,
        JSON.stringify({
          theme: "dark",
          sendBehavior: "interrupt",
          serviceUrlBehavior: "ask",
          terminalScrollbackLines: 10_000,
          uiFontFamily: "",
          monoFontFamily: "",
          uiFontSize: 16,
          codeFontSize: fontSize,
          syntaxTheme: "one",
        }),
      );
    },
    { settingsKey: APP_SETTINGS_KEY, fontSize: codeFontSize },
  );
}

async function useUnwrappedDiffLines(page: Page): Promise<void> {
  await page.addInitScript(
    ({ preferencesKey }) => {
      localStorage.setItem(
        preferencesKey,
        JSON.stringify({
          layout: "unified",
          viewMode: "flat",
          wrapLines: false,
          hideWhitespace: false,
        }),
      );
    },
    { preferencesKey: CHANGES_PREFERENCES_KEY },
  );
}

async function expectFlatFileList(page: Page): Promise<void> {
  await expect(page.locator('[data-testid^="diff-folder-"]')).toHaveCount(0);
  await expect(page.getByTestId("diff-file-0")).toContainText("use-mounted-tab-set.ts");
  await expect(page.getByTestId("diff-file-0")).toContainText("src");
}

async function expectDiffCodeFontSize(page: Page, fontSize: number): Promise<void> {
  await expect
    .poll(async () => {
      return page
        .getByTestId("diff-code-text-1")
        .evaluate((text) => Number.parseFloat(getComputedStyle(text).fontSize));
    })
    .toBe(fontSize);
}

async function expectVisibleDiffRowsAligned(page: Page): Promise<void> {
  const geometry = await readVisibleDiffRowGeometry(page);
  expect(geometry.maxDelta, JSON.stringify(geometry.rows, null, 2)).toBeLessThanOrEqual(1);
}

async function expectVisibleDiffRowsShareTypography(page: Page): Promise<void> {
  const geometry = await readVisibleDiffRowGeometry(page);
  expect(geometry.mismatchedTypography, JSON.stringify(geometry, null, 2)).toEqual([]);
}

async function readVisibleDiffRowGeometry(page: Page): Promise<{
  maxDelta: number;
  mismatchedTypography: { index: number; gutterLineHeight: number; codeLineHeight: number }[];
  rows: {
    index: number;
    gutterTop: number;
    codeTop: number;
    delta: number;
    gutterLineHeight: number;
    codeLineHeight: number;
  }[];
}> {
  return page.locator("body").evaluate(({ ownerDocument }) => {
    const root = ownerDocument.querySelector('[data-testid="diff-file-0-body"]');
    if (!root) {
      throw new Error("Expanded diff body is not mounted");
    }

    const readRows = (prefix: string, textPrefix: string) =>
      Array.from(root.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}"]`)).map((row) => {
        const testId = row.getAttribute("data-testid") ?? "";
        const index = Number(testId.slice(prefix.length));
        const rect = row.getBoundingClientRect();
        const text = root.querySelector<HTMLElement>(`[data-testid="${textPrefix}${index}"]`);
        const lineHeight = text ? Number.parseFloat(getComputedStyle(text).lineHeight) : 0;
        return { index, top: rect.top, height: rect.height, lineHeight };
      });

    const gutters = new Map(
      readRows("diff-gutter-row-", "diff-gutter-text-").map((row) => [row.index, row]),
    );
    const codes = readRows("diff-code-row-", "diff-code-text-");
    const rows = codes
      .map((code) => {
        const gutter = gutters.get(code.index);
        if (!gutter) {
          throw new Error(`Missing gutter row ${code.index}`);
        }
        return {
          index: code.index,
          gutterTop: gutter.top,
          codeTop: code.top,
          delta: Math.abs(code.top - gutter.top),
          gutterLineHeight: gutter.lineHeight,
          codeLineHeight: code.lineHeight,
        };
      })
      .filter((row) => row.gutterTop >= 0 && row.codeTop >= 0);

    return {
      maxDelta: Math.max(...rows.map((row) => row.delta)),
      mismatchedTypography: rows
        .filter((row) => Math.abs(row.gutterLineHeight - row.codeLineHeight) > 0.5)
        .map((row) => ({
          index: row.index,
          gutterLineHeight: row.gutterLineHeight,
          codeLineHeight: row.codeLineHeight,
        })),
      rows,
    };
  });
}

async function createWorkspaceWithMountedTabDiff(
  options: WorkspaceFixtureOptions = {},
): Promise<DirtyWorkspace> {
  const files = [{ path: "src/use-mounted-tab-set.ts", content: BEFORE }];
  if (options.includeDeletedFile) {
    files.push({ path: "src/zz-deleted.ts", content: "export const deleted = true;\n" });
  }
  const repo = await createTempGitRepo("diff-row-alignment-", { files });
  const client = await connectSeedClient();
  cleanupTasks.push({
    run: async () => {
      await client.close().catch(() => undefined);
      await repo.cleanup().catch(() => undefined);
    },
  });

  await writeFile(path.join(repo.path, "src/use-mounted-tab-set.ts"), AFTER);
  if (options.includeDeletedFile) {
    await unlink(path.join(repo.path, "src/zz-deleted.ts"));
  }
  const createdWorkspace = await client.createWorkspace({
    source: { kind: "directory", path: repo.path },
  });
  if (!createdWorkspace.workspace) {
    throw new Error(createdWorkspace.error ?? `Failed to create workspace ${repo.path}`);
  }
  return { id: createdWorkspace.workspace.id, repoPath: repo.path };
}

async function openWorkspaceChanges(page: Page, workspace: DirtyWorkspace): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.id));
  await waitForWorkspaceTabsVisible(page);
  await page.getByRole("button", { name: "Open explorer" }).click();
  await openChangesInVisibleExplorer(page);
  await page.getByTestId("diff-file-0").click();
  await expectExpandedMountedTabDiff(page);
}

async function openChangesInVisibleExplorer(page: Page): Promise<void> {
  await expect(page.getByTestId("explorer-tab-changes")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("use-mounted-tab-set.ts")).toBeVisible({ timeout: 30_000 });
}

async function expectExpandedMountedTabDiff(page: Page): Promise<void> {
  await expect(page.getByTestId("diff-file-0-body")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("function createInitialMountedTabIds")).toBeVisible({
    timeout: 30_000,
  });
}

async function changeCodeFontSizeFromSettings(page: Page, codeFontSize: number): Promise<void> {
  await page.getByTestId("sidebar-settings").click();
  await expect(page).toHaveURL(new RegExp(`${buildSettingsSectionRoute("general")}|/settings$`));
  await page.getByRole("button", { name: "Appearance" }).click();
  await page.getByLabel("Code font size").fill(String(codeFontSize));
  await page.getByLabel("Code font size").press("Enter");
  await expect(page.getByLabel("Code font size")).toHaveValue(String(codeFontSize));
  await expectStoredCodeFontSize(page, codeFontSize);
}

async function expectStoredCodeFontSize(page: Page, codeFontSize: number): Promise<void> {
  await expect
    .poll(async () => {
      const raw = await page.evaluate(
        (settingsKey) => localStorage.getItem(settingsKey),
        APP_SETTINGS_KEY,
      );
      if (!raw) {
        return null;
      }
      return (JSON.parse(raw) as { codeFontSize?: number }).codeFontSize ?? null;
    })
    .toBe(codeFontSize);
}

async function returnToWorkspaceChanges(page: Page): Promise<void> {
  await page.getByTestId("settings-back-to-workspace").click();
  await waitForWorkspaceTabsVisible(page);
  await openChangesInVisibleExplorer(page);
  await expectExpandedMountedTabDiff(page);
}

async function scrollToLowerUnwrappedDiffRows(page: Page): Promise<void> {
  const lastRowIndex = await page.getByTestId("diff-file-0-body").evaluate((root) => {
    const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-testid^="diff-code-row-"]'));
    if (rows.length === 0) {
      throw new Error("No unwrapped code rows are mounted");
    }
    return Math.max(
      ...rows.map((row) => Number((row.getAttribute("data-testid") ?? "").slice(14))),
    );
  });
  await page.getByTestId(`diff-code-row-${lastRowIndex}`).scrollIntoViewIfNeeded();
  await expect(page.getByTestId(`diff-code-row-${lastRowIndex}`)).toBeVisible();
}

async function expectDiffCodeTextAlignedWithGutterText(
  page: Page,
  lines: { codeText: string; lineNumber: string }[],
): Promise<void> {
  const geometries = await readDiffTextGeometry(page, lines);
  for (const geometry of geometries) {
    expect(geometry.codeTop, geometry.codeText).toBeCloseTo(geometry.gutterTop, 0);
  }
}

async function expectHoverCommentButtonAlignedWithCodeLine(
  page: Page,
  line: { codeText: string; lineNumber: string },
): Promise<void> {
  const target = await readDiffTextGeometry(page, [line]).then((rows) => rows[0]);
  if (!target) {
    throw new Error(`Could not find target line ${line.lineNumber}`);
  }
  await page.getByTestId(`diff-code-row-${target.index}`).hover();
  const geometry = await page
    .getByTestId(`diff-gutter-action-${target.index}`)
    .evaluate((action, expectedCodeCenterY) => {
      const rect = action.getBoundingClientRect();
      return {
        actionCenterY: rect.top + rect.height / 2,
        codeCenterY: expectedCodeCenterY,
      };
    }, target.codeCenterY);
  expect(geometry.actionCenterY).toBeCloseTo(geometry.codeCenterY, 0);
}

async function readDiffTextGeometry(
  page: Page,
  lines: { codeText: string; lineNumber: string }[],
): Promise<
  { index: number; codeText: string; codeTop: number; gutterTop: number; codeCenterY: number }[]
> {
  return page.locator("body").evaluate(({ ownerDocument }, targets) => {
    const root = ownerDocument.querySelector('[data-testid="explorer-content-area"]');
    if (!root) {
      throw new Error("Changes panel is not mounted");
    }

    const readIndexedElements = (prefix: string) =>
      Array.from(root.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}"]`)).map(
        (element) => {
          const testId = element.getAttribute("data-testid") ?? "";
          return { index: Number(testId.slice(prefix.length)), element };
        },
      );

    const gutterTexts = readIndexedElements("diff-gutter-text-");
    const codeTexts = readIndexedElements("diff-code-text-");

    return targets.map((target) => {
      const gutter = gutterTexts.find(
        ({ element }) => (element.textContent ?? "").trim() === target.lineNumber,
      );
      if (!gutter) {
        throw new Error(`Could not find gutter line ${target.lineNumber}`);
      }
      const code = codeTexts.find(
        ({ index, element }) =>
          index === gutter.index && (element.textContent ?? "").includes(target.codeText),
      );
      if (!code) {
        throw new Error(`Could not find code row ${target.codeText}`);
      }

      const codeRect = code.element.getBoundingClientRect();
      const gutterRect = gutter.element.getBoundingClientRect();

      return {
        index: gutter.index,
        codeText: target.codeText,
        codeTop: codeRect.top,
        gutterTop: gutterRect.top,
        codeCenterY: codeRect.top + codeRect.height / 2,
      };
    });
  }, lines);
}
