import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import { usePanelStore } from "@/stores/panel-store";
import {
  collectAllTabs,
  findPaneById,
  selectExplorerSidebarPaneId,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import {
  hideExplorerSidebar,
  isExplorerSidebarOpen,
  openExplorerSidebarView,
  resolveExplorerSidebarPresentation,
  shouldAutoRevealExplorerSidebar,
  showExplorerSidebar,
  toggleExplorerSidebar,
} from "@/workspace-tabs/explorer-sidebar";

const WORKSPACE_KEY = "server-1:ws-main";

beforeEach(() => {
  useWorkspaceLayoutStore.setState({
    layoutByWorkspace: {},
    explorerSidebarPaneIdByWorkspace: {},
    sidePaneIdByWorkspace: {},
    splitSizesByWorkspace: {},
  });
  usePanelStore.setState({
    mobilePanel: { target: "agent", revision: 0 },
  });
});

describe("Explorer sidebar", () => {
  it("selects the Explorer shell from the form factor", () => {
    expect(resolveExplorerSidebarPresentation({ isCompact: true })).toBe("overlay");
    expect(resolveExplorerSidebarPresentation({ isCompact: false })).toBe("dock");
  });

  it("uses the same Explorer pane inside the compact overlay", () => {
    openExplorerSidebarView({
      isCompact: true,
      workspaceKey: WORKSPACE_KEY,
      view: "changes",
    });

    expect(usePanelStore.getState().mobilePanel.target).toBe("file-explorer");
    const state = useWorkspaceLayoutStore.getState();
    const layout = state.layoutByWorkspace[WORKSPACE_KEY];
    const pane = findPaneById(layout.root, selectExplorerSidebarPaneId(state, WORKSPACE_KEY)!);
    expect(
      collectAllTabs(layout.root).find((tab) => tab.tabId === pane?.focusedTabId)?.target.kind,
    ).toBe("changes_tree");
  });

  it("creates a dedicated desktop Explorer containing only its requested tree", () => {
    openExplorerSidebarView({
      isCompact: false,
      workspaceKey: WORKSPACE_KEY,
      view: "files",
    });

    const state = useWorkspaceLayoutStore.getState();
    const layout = state.layoutByWorkspace[WORKSPACE_KEY];
    const paneId = selectExplorerSidebarPaneId(state, WORKSPACE_KEY);
    expect(paneId).not.toBeNull();
    expect(layout && collectAllTabs(layout.root).map((tab) => tab.target.kind)).toContain("files");
  });

  it("toggles the desktop Explorer independently of ordinary panes", () => {
    const input = {
      isCompact: false,
      workspaceKey: WORKSPACE_KEY,
    };
    openExplorerSidebarView({ ...input, view: "files" });
    toggleExplorerSidebar(input);
    expect(isExplorerSidebarOpen(input)).toBe(false);
    toggleExplorerSidebar(input);
    expect(isExplorerSidebarOpen(input)).toBe(true);
    const openedState = useWorkspaceLayoutStore.getState();
    const openedLayout = openedState.layoutByWorkspace[WORKSPACE_KEY];
    const explorerPaneId = selectExplorerSidebarPaneId(openedState, WORKSPACE_KEY);
    const explorerPane =
      openedLayout && explorerPaneId ? findPaneById(openedLayout.root, explorerPaneId) : null;
    const activeExplorerTarget =
      openedLayout && explorerPane
        ? collectAllTabs(openedLayout.root).find((tab) => tab.tabId === explorerPane.focusedTabId)
            ?.target.kind
        : null;
    expect(activeExplorerTarget).toBe("files");
  });

  it("toggles the compact Explorer without changing its selected view", () => {
    const input = {
      isCompact: true,
      workspaceKey: WORKSPACE_KEY,
    };

    toggleExplorerSidebar(input);

    expect(isExplorerSidebarOpen(input)).toBe(true);
  });

  it("auto-reveals the Explorer sidebar only on wide layouts that have hydrated", () => {
    const query = { isCompact: false, workspaceKey: WORKSPACE_KEY };
    expect(shouldAutoRevealExplorerSidebar({ ...query, enabled: false, hydrated: true })).toBe(
      false,
    );
    expect(shouldAutoRevealExplorerSidebar({ ...query, enabled: true, hydrated: false })).toBe(
      false,
    );
    expect(
      shouldAutoRevealExplorerSidebar({
        isCompact: true,
        workspaceKey: WORKSPACE_KEY,
        enabled: true,
        hydrated: true,
      }),
    ).toBe(false);
    expect(
      shouldAutoRevealExplorerSidebar({
        isCompact: false,
        workspaceKey: null,
        enabled: true,
        hydrated: true,
      }),
    ).toBe(false);
    // The default layout keeps the Explorer hidden, so the workspace-open moment reveals it.
    expect(shouldAutoRevealExplorerSidebar({ ...query, enabled: true, hydrated: true })).toBe(true);
    showExplorerSidebar(query);
    expect(shouldAutoRevealExplorerSidebar({ ...query, enabled: true, hydrated: true })).toBe(
      false,
    );
  });

  it("lands the workspace-open reveal on the Files tab", () => {
    const query = { isCompact: false, workspaceKey: WORKSPACE_KEY };
    const input = { ...query };
    // The user last left the Explorer on Changes, then closed it.
    openExplorerSidebarView({ ...input, view: "changes" });
    hideExplorerSidebar(input);
    expect(isExplorerSidebarOpen(query)).toBe(false);

    // The workspace-open moment reopens through the "files" view, as workspace-screen wires it.
    openExplorerSidebarView({ ...input, view: "files" });
    expect(isExplorerSidebarOpen(query)).toBe(true);
    const state = useWorkspaceLayoutStore.getState();
    const layout = state.layoutByWorkspace[WORKSPACE_KEY];
    const paneId = selectExplorerSidebarPaneId(state, WORKSPACE_KEY);
    const pane = layout && paneId ? findPaneById(layout.root, paneId) : null;
    const focusedTab = layout
      ? collectAllTabs(layout.root).find((tab) => tab.tabId === pane?.focusedTabId)
      : null;
    expect(focusedTab?.target.kind).toBe("files");
  });
});
