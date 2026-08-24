import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const storage = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
    },
  };
});

import { usePanelStore } from "@/stores/panel-store";
import {
  collectAllPanes,
  collectAllTabs,
  findPaneById,
  findPaneContainingTab,
  selectSidePanelPaneId,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import {
  autoRevealSidePanelForWorkspace,
  hideSidePanel,
  isSidePanelOpen,
  openSidePanelView,
  openSupportingTab,
  showSidePanel,
  toggleSidePanel,
  toggleSupportingTab,
} from "@/workspace-tabs/side-panel";

const WORKSPACE_KEY = "server-1:ws-main";
const CHECKOUT = { serverId: "server-1", cwd: "/tmp/repo", isGit: true };

function layout() {
  const value = useWorkspaceLayoutStore.getState().layoutByWorkspace[WORKSPACE_KEY];
  if (!value) throw new Error("workspace layout missing");
  return value;
}

function tabKinds(): string[] {
  return collectAllTabs(layout().root).map((tab) => tab.target.kind);
}

function focusedPaneTabKinds(): string[] {
  const current = layout();
  const pane = findPaneById(current.root, current.focusedPaneId);
  const tabs = collectAllTabs(current.root);
  return (pane?.tabIds ?? []).map(
    (tabId) => tabs.find((tab) => tab.tabId === tabId)?.target.kind ?? "?",
  );
}

function sidePanelPaneId(): string | null {
  return selectSidePanelPaneId(useWorkspaceLayoutStore.getState(), WORKSPACE_KEY);
}

function sidePanelSplitSizes(): number[] {
  const splits = useWorkspaceLayoutStore.getState().splitSizesByWorkspace[WORKSPACE_KEY];
  const values = Object.values(splits ?? {});
  expect(values).toHaveLength(1);
  return values[0];
}

function paneIdHolding(tabId: string): string | undefined {
  return findPaneContainingTab(layout().root, tabId)?.id;
}

beforeEach(() => {
  useWorkspaceLayoutStore.setState({
    layoutByWorkspace: {},
    sidePanelPaneIdByWorkspace: {},
    splitSizesByWorkspace: {},
  });
  usePanelStore.setState({ mobilePanel: { target: "agent", revision: 0 } });
});

describe("compact surface", () => {
  const compact = { isCompact: true, workspaceKey: WORKSPACE_KEY, checkout: CHECKOUT };

  it("opens Changes in the explorer overlay without creating a workspace tab", () => {
    toggleSupportingTab({
      ...compact,
      target: { kind: "working_diff" },
      openInSidePanelByDefault: true,
    });

    expect(usePanelStore.getState().mobilePanel.target).toBe("file-explorer");
    expect(usePanelStore.getState().explorerTab).toBe("changes");
    expect(useWorkspaceLayoutStore.getState().layoutByWorkspace[WORKSPACE_KEY]).toBeUndefined();
  });

  it("opens and closes the overlay without touching the layout", () => {
    openSidePanelView({ ...compact, view: "files" });

    expect(usePanelStore.getState().mobilePanel.target).toBe("file-explorer");
    expect(usePanelStore.getState().explorerTab).toBe("files");
    expect(useWorkspaceLayoutStore.getState().layoutByWorkspace[WORKSPACE_KEY]).toBeUndefined();

    toggleSidePanel(compact);
    expect(usePanelStore.getState().mobilePanel.target).toBe("agent");
  });

  it("reports the overlay state, not the layout state", () => {
    expect(isSidePanelOpen({ isCompact: true, workspaceKey: WORKSPACE_KEY })).toBe(false);
    toggleSidePanel(compact);
    expect(isSidePanelOpen({ isCompact: true, workspaceKey: WORKSPACE_KEY })).toBe(true);
  });

  it("never auto-reveals the overlay", () => {
    autoRevealSidePanelForWorkspace({
      ...compact,
      defaultViews: { changes: true, fileNav: true },
    });

    expect(usePanelStore.getState().mobilePanel.target).toBe("agent");
    expect(useWorkspaceLayoutStore.getState().layoutByWorkspace[WORKSPACE_KEY]).toBeUndefined();
  });
});

describe("non-compact with splits", () => {
  const wide = {
    isCompact: false,
    supportsPaneSplits: true,
    workspaceKey: WORKSPACE_KEY,
    checkout: CHECKOUT,
  };

  it("reveals a New tab pane rather than seeding a supporting view into it", () => {
    toggleSidePanel(wide);

    expect(isSidePanelOpen(wide)).toBe(true);
    expect(tabKinds()).toEqual(["new_tab", "new_tab"]);
    expect(collectAllPanes(layout().root).length).toBeGreaterThan(1);
  });

  it("opens the view the user picked from the revealed panel", () => {
    showSidePanel(wide);
    openSidePanelView({ ...wide, view: "changes" });

    const changesTabId = collectAllTabs(layout().root).find(
      (tab) => tab.target.kind === "working_diff",
    )?.tabId;
    expect(changesTabId).toBeTruthy();
    expect(paneIdHolding(changesTabId as string)).toBe(sidePanelPaneId());
  });

  it("hides the pane on the second toggle and restores its tabs on the third", () => {
    openSidePanelView({ ...wide, view: "changes" });
    toggleSidePanel(wide);
    expect(isSidePanelOpen(wide)).toBe(false);

    toggleSidePanel(wide);
    expect(isSidePanelOpen(wide)).toBe(true);
    expect(tabKinds().filter((kind) => kind === "working_diff")).toHaveLength(1);
  });

  it("leaves the compact overlay alone", () => {
    toggleSidePanel(wide);
    expect(usePanelStore.getState().mobilePanel.target).toBe("agent");
  });

  it("routes a new supporting tab into the side panel", () => {
    const tabId = openSupportingTab({
      isCompact: false,
      supportsPaneSplits: true,
      workspaceKey: WORKSPACE_KEY,
      target: { kind: "files" },
      openInSidePanelByDefault: true,
    });

    expect(tabId).not.toBeNull();
    expect(paneIdHolding(tabId as string)).toBe(sidePanelPaneId());
    expect(isSidePanelOpen(wide)).toBe(true);
  });

  it("finds a supporting tab the user moved instead of dragging it back", () => {
    const tabId = openSupportingTab({
      isCompact: false,
      supportsPaneSplits: true,
      workspaceKey: WORKSPACE_KEY,
      target: { kind: "files" },
      openInSidePanelByDefault: true,
    }) as string;
    useWorkspaceLayoutStore.getState().moveTabToPane(WORKSPACE_KEY, tabId, "main");

    const reopened = openSupportingTab({
      isCompact: false,
      supportsPaneSplits: true,
      workspaceKey: WORKSPACE_KEY,
      target: { kind: "files" },
      openInSidePanelByDefault: true,
    });

    expect(reopened).toBe(tabId);
    expect(paneIdHolding(tabId)).toBe("main");
  });

  it("opens a new supporting tab in the focused pane when routing is off", () => {
    const tabId = openSupportingTab({
      isCompact: false,
      supportsPaneSplits: true,
      workspaceKey: WORKSPACE_KEY,
      target: { kind: "files" },
      openInSidePanelByDefault: false,
    });

    expect(paneIdHolding(tabId as string)).toBe(layout().focusedPaneId);
    expect(isSidePanelOpen(wide)).toBe(false);
  });

  it("adds a background supporting tab without revealing the panel", () => {
    const tabId = openSupportingTab({
      isCompact: false,
      supportsPaneSplits: true,
      workspaceKey: WORKSPACE_KEY,
      target: { kind: "setup", workspaceId: "ws-main" },
      openInSidePanelByDefault: true,
      background: true,
    });

    expect(paneIdHolding(tabId as string)).toBe(sidePanelPaneId());
    expect(isSidePanelOpen(wide)).toBe(false);
  });

  it("keeps the panel's tabs when it is hidden", () => {
    openSidePanelView({ ...wide, view: "files" });
    hideSidePanel(wide);

    expect(isSidePanelOpen(wide)).toBe(false);
    expect(tabKinds()).toEqual(["new_tab", "files"]);
  });

  it("toggles the visible supporting target without closing its tab", () => {
    const changes = {
      ...wide,
      target: { kind: "working_diff" } as const,
      openInSidePanelByDefault: true,
    };
    const tabId = toggleSupportingTab(changes);
    openSidePanelView({ ...wide, view: "files" });

    toggleSupportingTab(changes);
    expect(isSidePanelOpen(wide)).toBe(true);
    expect(focusedPaneTabKinds()).toContain("working_diff");

    toggleSupportingTab(changes);
    expect(isSidePanelOpen(wide)).toBe(false);
    expect(tabKinds()).toContain("working_diff");

    expect(toggleSupportingTab(changes)).toBe(tabId);
    expect(isSidePanelOpen(wide)).toBe(true);
  });

  it("opens the selected default views in the side panel on reveal", () => {
    toggleSidePanel({ ...wide, defaultViews: { changes: true, fileNav: true } });

    expect(isSidePanelOpen(wide)).toBe(true);
    const tabs = collectAllTabs(layout().root);
    const changesTabId = tabs.find((tab) => tab.target.kind === "working_diff")?.tabId;
    const fileNavTabId = tabs.find((tab) => tab.target.kind === "file_nav")?.tabId;
    expect(changesTabId).toBeTruthy();
    expect(fileNavTabId).toBeTruthy();
    expect(paneIdHolding(changesTabId as string)).toBe(sidePanelPaneId());
    expect(paneIdHolding(fileNavTabId as string)).toBe(sidePanelPaneId());
  });

  it("skips a selected Changes default for a checkout without Git", () => {
    toggleSidePanel({
      ...wide,
      checkout: { ...CHECKOUT, isGit: false },
      defaultViews: { changes: true, fileNav: true },
    });

    expect(isSidePanelOpen(wide)).toBe(true);
    expect(tabKinds()).not.toContain("working_diff");
    expect(tabKinds()).toContain("file_nav");
  });

  it("reveals the pane without seeding tabs when no default is available", () => {
    toggleSidePanel({
      ...wide,
      checkout: { ...CHECKOUT, isGit: false },
      defaultViews: { changes: true, fileNav: false },
    });

    expect(isSidePanelOpen(wide)).toBe(true);
    expect(tabKinds()).toEqual(["new_tab", "new_tab"]);
  });

  it("sizes the revealed panel to the preferred width", () => {
    toggleSidePanel({ ...wide, defaultWidthPercent: 70 });

    const sizes = sidePanelSplitSizes();
    expect(sizes[0]).toBeCloseTo(0.3);
    expect(sizes[1]).toBeCloseTo(0.7);
  });

  it("applies the preferred width when a default view opens the panel too", () => {
    toggleSidePanel({
      ...wide,
      defaultViews: { changes: false, fileNav: true },
      defaultWidthPercent: 25,
    });

    expect(isSidePanelOpen(wide)).toBe(true);
    const sizes = sidePanelSplitSizes();
    expect(sizes[0]).toBeCloseTo(0.75);
    expect(sizes[1]).toBeCloseTo(0.25);
  });

  it("returns the split to the preferred width on the next reveal after a drag", () => {
    toggleSidePanel({ ...wide, defaultWidthPercent: 70 });
    const store = useWorkspaceLayoutStore.getState();
    const groupId = Object.keys(store.splitSizesByWorkspace[WORKSPACE_KEY])[0];
    store.resizeSplit(WORKSPACE_KEY, groupId, [0.5, 0.5]);
    toggleSidePanel(wide);
    expect(isSidePanelOpen(wide)).toBe(false);

    toggleSidePanel({ ...wide, defaultWidthPercent: 70 });

    const sizes = sidePanelSplitSizes();
    expect(sizes[0]).toBeCloseTo(0.3);
    expect(sizes[1]).toBeCloseTo(0.7);
  });

  it("auto-reveals with the default panels and width when the panel is hidden", () => {
    autoRevealSidePanelForWorkspace({
      ...wide,
      defaultViews: { changes: true, fileNav: true },
      defaultWidthPercent: 30,
    });

    expect(isSidePanelOpen(wide)).toBe(true);
    expect(tabKinds()).toContain("working_diff");
    expect(tabKinds()).toContain("file_nav");
    const sizes = sidePanelSplitSizes();
    expect(sizes[0]).toBeCloseTo(0.7);
    expect(sizes[1]).toBeCloseTo(0.3);
  });

  it("leaves an already-showing panel alone on auto-reveal", () => {
    openSidePanelView({ ...wide, view: "changes" });
    const before = tabKinds();

    autoRevealSidePanelForWorkspace({
      ...wide,
      defaultViews: { changes: true, fileNav: true },
    });

    expect(tabKinds()).toEqual(before);
    expect(useWorkspaceLayoutStore.getState().splitSizesByWorkspace[WORKSPACE_KEY]).toBeUndefined();
  });
});

describe("non-compact without splits", () => {
  const tablet = {
    isCompact: false,
    supportsPaneSplits: false,
    workspaceKey: WORKSPACE_KEY,
    checkout: CHECKOUT,
  };

  it("opens the side panel as a tab in the focused pane, never a second pane", () => {
    toggleSidePanel(tablet);

    expect(focusedPaneTabKinds()).toContain("working_diff");
    expect(collectAllPanes(layout().root)).toHaveLength(1);
    expect(isSidePanelOpen(tablet)).toBe(true);
  });

  it("closes the side panel tab on the second toggle", () => {
    toggleSidePanel(tablet);
    toggleSidePanel(tablet);

    expect(tabKinds()).not.toContain("working_diff");
    expect(isSidePanelOpen(tablet)).toBe(false);
  });

  it("keeps supporting tabs in the focused pane so the tab row still lists them", () => {
    const tabId = openSupportingTab({
      isCompact: false,
      supportsPaneSplits: false,
      workspaceKey: WORKSPACE_KEY,
      target: { kind: "files" },
      openInSidePanelByDefault: true,
    });

    expect(tabId).not.toBeNull();
    expect(paneIdHolding(tabId as string)).toBe(layout().focusedPaneId);
    expect(collectAllPanes(layout().root)).toHaveLength(1);
  });

  it("opens and closes a selected File navigation default like a side panel tab", () => {
    const input = { ...tablet, defaultViews: { changes: false, fileNav: true } };
    toggleSidePanel(input);

    expect(focusedPaneTabKinds()).toContain("file_nav");
    expect(collectAllPanes(layout().root)).toHaveLength(1);
    expect(isSidePanelOpen(input)).toBe(true);

    toggleSidePanel(input);
    expect(tabKinds()).not.toContain("file_nav");
    expect(isSidePanelOpen(input)).toBe(false);
  });

  it("falls back to Files when the only default is Changes and the checkout has no Git", () => {
    toggleSidePanel({
      ...tablet,
      checkout: { ...CHECKOUT, isGit: false },
      defaultViews: { changes: true, fileNav: false },
    });

    expect(focusedPaneTabKinds()).toContain("files");
    expect(focusedPaneTabKinds()).not.toContain("working_diff");
  });

  it("never auto-reveals a tab on its own", () => {
    autoRevealSidePanelForWorkspace({
      ...tablet,
      defaultViews: { changes: true, fileNav: true },
    });

    expect(useWorkspaceLayoutStore.getState().layoutByWorkspace[WORKSPACE_KEY]).toBeUndefined();
  });
});
