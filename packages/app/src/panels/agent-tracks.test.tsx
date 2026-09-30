/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockState } = vi.hoisted(() => ({
  mockState: { sessions: {} as Record<string, unknown> },
}));

/** Every child of the track bar is a marker, so the only thing this file can assert is their order. */
function marker(name: string) {
  const Marker = ({ children }: React.PropsWithChildren) =>
    React.createElement("div", { "data-marker": name }, children);
  Marker.displayName = name;
  return Marker;
}

vi.mock("react-native", () => ({
  Platform: { OS: "web", select: (options: Record<string, unknown>) => options.default },
  View: ({ children, testID, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement(
      "div",
      testID === undefined ? props : { ...props, "data-testid": testID },
      children,
    ),
  Text: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement("span", props, children),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: (value: unknown) => unknown) => factory({}),
    withUnistyles: () => marker("icon"),
  },
}));

vi.mock("@/composer/tracks", () => ({ ComposerTrackBar: marker("ComposerTrackBar") }));
vi.mock("@/composer/diff-stat-pill", () => ({
  WorkspaceDiffStatPill: marker("WorkspaceDiffStatPill"),
}));
vi.mock("@/composer/task-list", () => ({ AgentTaskList: marker("AgentTaskList") }));
vi.mock("@/composer/stats-pill", () => ({
  AgentStatsPill: marker("AgentStatsPill"),
  useAgentStatsPillVisible: () => true,
}));
vi.mock("@/plugins", () => ({ PluginComposerPills: marker("PluginComposerPills") }));
vi.mock("@/subagents/track", () => ({ SubagentsTrack: marker("SubagentsTrack") }));

vi.mock("@/composer/workspace-diff-stat", () => ({ useWorkspaceHasDiffStat: () => false }));
vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => false,
  supportsDesktopPaneSplits: () => false,
}));
vi.mock("@/panels/pane-context", () => ({
  usePaneContext: () => ({ tabId: null, openTab: vi.fn() }),
}));
vi.mock("@/hooks/use-settings", () => ({ useSettings: () => false }));
vi.mock("@/subagents", () => ({
  useArchiveSubagent: () => vi.fn(),
  useDetachSubagent: () => vi.fn(),
}));
vi.mock("@/utils/navigate-to-agent", () => ({ navigateToAgent: vi.fn() }));
vi.mock("@/workspace-tabs/model", () => ({
  buildWorkspaceTabPersistenceKey: () => "workspace-key",
}));
vi.mock("@/workspace-tabs/open-beside", () => ({ openPreferredWorkspaceTarget: vi.fn() }));
vi.mock("@/workspace-tabs/open-supporting-view", () => ({ openComposerChanges: vi.fn() }));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: typeof mockState) => unknown) => selector(mockState),
}));

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import { AgentTracks, hasAgentTracks } from "./agent-tracks";

// Module scope, so the render-prop lint sees stable values.
const IDLE_ARCHIVE_STATUS = { kind: "idle" } as const;
const NOOP = () => undefined;

describe("hasAgentTracks", () => {
  const base = {
    subagentRows: [],
    tasks: undefined,
    archiveFinishedStatus: IDLE_ARCHIVE_STATUS,
  };

  it("is true when session stats are the only thing on the row", () => {
    expect(hasAgentTracks({ ...base, hasStats: true })).toBe(true);
  });

  it("is false when nothing at all is on the row", () => {
    expect(hasAgentTracks(base)).toBe(false);
    expect(hasAgentTracks({ ...base, hasStats: false, hasPluginComposerPills: false })).toBe(false);
  });
});

describe("AgentTracks", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    mockState.sessions = {};
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("mounts the stats pill between the subagents track and the plugin pills", () => {
    mockState.sessions = {
      "server-tracks": {
        serverInfo: { features: { agentSessionStats: true } },
        agents: new Map([["agent-tracks", { id: "agent-tracks", stats: { requestCount: 1 } }]]),
      },
    };

    act(() =>
      root.render(
        <AgentTracks
          serverId="server-tracks"
          workspaceId="workspace"
          agentId="agent-tracks"
          cwd="/repo"
          subagentRows={[]}
          tasks={undefined}
          archiveFinishedStatus={IDLE_ARCHIVE_STATUS}
          onArchiveFinished={NOOP}
          hasPluginComposerPills
        />,
      ),
    );

    const order = [...container.querySelectorAll("[data-marker]")].map((element) =>
      element.getAttribute("data-marker"),
    );
    expect(order).toEqual([
      "ComposerTrackBar",
      "AgentTaskList",
      "SubagentsTrack",
      "AgentStatsPill",
      "PluginComposerPills",
      "WorkspaceDiffStatPill",
    ]);
  });
});
