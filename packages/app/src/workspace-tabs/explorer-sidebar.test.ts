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
const CHECKOUT = { serverId: "server-1", cwd: "/tmp/repo", isGit: true };

beforeEach(() => {
  useWorkspaceLayoutStore.setState({
    layoutByWorkspace: {},
    explorerSidebarPaneIdByWorkspace: {},
    sidePaneIdByWorkspace: {},
    splitSizesByWorkspace: {},
  });
  usePanelStore.setState({ mobilePanel: { target: "agent", revision: 0 } });
});

describe("Explorer sidebar", () => {
  it("selects the Explorer shell from layout and split capabilities", () => {
    expect(resolveExplorerSidebarPresentation({ isCompact: true })).toBe("overlay");
    expect(
      resolveExplorerSidebarPresentation({ isCompact: false, supportsPaneSplits: false }),
    ).toBe("dock");
    expect(resolveExplorerSidebarPresentation({ isCompact: false, supportsPaneSplits: true })).toBe(
      "pane",
    );
  });

  it("uses the compact explorer without creating a desktop pane", () => {
    openExplorerSidebarView({
      isCompact: true,
      workspaceKey: WORKSPACE_KEY,
      checkout: CHECKOUT,
      view: "changes",
    });

    expect(usePanelStore.getState().mobilePanel.target).toBe("file-explorer");
    expect(useWorkspaceLayoutStore.getState().layoutByWorkspace[WORKSPACE_KEY]).toBeUndefined();
  });

  it("creates a dedicated desktop Explorer containing only its requested tree", () => {
    openExplorerSidebarView({
      isCompact: false,
      supportsPaneSplits: true,
      workspaceKey: WORKSPACE_KEY,
      checkout: CHECKOUT,
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
      supportsPaneSplits: true,
      workspaceKey: WORKSPACE_KEY,
      checkout: CHECKOUT,
    };
    toggleExplorerSidebar(input);
    expect(isExplorerSidebarOpen(input)).toBe(true);
    toggleExplorerSidebar(input);
    expect(isExplorerSidebarOpen(input)).toBe(false);
  });

  it("auto-reveals the Explorer sidebar only on wide layouts that have hydrated", () => {
    const query = { isCompact: false, supportsPaneSplits: true, workspaceKey: WORKSPACE_KEY };
    expect(shouldAutoRevealExplorerSidebar({ ...query, enabled: false, hydrated: true })).toBe(
      false,
    );
    expect(shouldAutoRevealExplorerSidebar({ ...query, enabled: true, hydrated: false })).toBe(
      false,
    );
    expect(
      shouldAutoRevealExplorerSidebar({
        isCompact: true,
        supportsPaneSplits: true,
        workspaceKey: WORKSPACE_KEY,
        enabled: true,
        hydrated: true,
      }),
    ).toBe(false);
    expect(
      shouldAutoRevealExplorerSidebar({
        isCompact: false,
        supportsPaneSplits: true,
        workspaceKey: null,
        enabled: true,
        hydrated: true,
      }),
    ).toBe(false);
    // The default layout keeps the Explorer hidden, so the workspace-open moment reveals it.
    expect(shouldAutoRevealExplorerSidebar({ ...query, enabled: true, hydrated: true })).toBe(true);
    showExplorerSidebar({ ...query, checkout: CHECKOUT });
    expect(shouldAutoRevealExplorerSidebar({ ...query, enabled: true, hydrated: true })).toBe(
      false,
    );
  });

  it("lands the workspace-open reveal on the Files tab", () => {
    const query = { isCompact: false, supportsPaneSplits: true, workspaceKey: WORKSPACE_KEY };
    const input = { ...query, checkout: CHECKOUT };
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
