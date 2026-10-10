/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { renderHook } from "@testing-library/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { theme, mockState } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, 2: 8, 3: 12 },
    fontSize: { sm: 12, base: 14 },
    fontWeight: { medium: "#medium" },
    borderWidth: { 1: 1 },
    borderRadius: { sm: 2, "2xl": 16 },
    colors: {
      foreground: "#foreground",
      foregroundMuted: "#foregroundMuted",
      destructive: "#destructive",
      borderAccent: "#borderAccent",
      surface1: "#surface1",
      surface2: "#surface2",
      surface3: "#surface3",
      palette: { amber: { 500: "#amber500" }, green: { 500: "#green500" } },
    },
  },
  mockState: { sessions: {} as Record<string, unknown> },
}));

vi.mock("react-native", () => ({
  Platform: { OS: "web", select: (options: Record<string, unknown>) => options.default },
  View: ({
    children,
    testID,
    style,
    ...props
  }: React.PropsWithChildren<{ style?: unknown } & Record<string, unknown>>) => {
    // jsdom drops non-CSS colour values like the mock theme's "#foregroundMuted", so the fill's
    // colour is surfaced as an attribute instead.
    const resolved = Array.isArray(style) ? Object.assign({}, ...style) : style;
    const dimensions =
      resolved && typeof resolved === "object" ? (resolved as Record<string, unknown>) : undefined;
    return React.createElement(
      "div",
      {
        ...props,
        ...(testID === undefined ? {} : { "data-testid": testID }),
        ...(typeof dimensions?.backgroundColor === "string"
          ? { "data-background-color": dimensions.backgroundColor }
          : {}),
        ...(typeof dimensions?.width === "string" ? { "data-width": dimensions.width } : {}),
      },
      children,
    );
  },
  Text: ({ children, testID, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement(
      "span",
      testID === undefined ? props : { ...props, "data-testid": testID },
      children,
    ),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: (factory: (value: typeof theme) => unknown) => factory(theme) },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));

vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: typeof mockState) => unknown) => selector(mockState),
}));

vi.mock("@/components/ui/menu", () => ({
  // The real formula: spacing[1] + borderWidth[1] + spacing[2], against the mock theme below.
  menuRowContentInset: (value: { spacing: Record<string, number>; borderWidth: Record<string, number> }) =>
    value.spacing[1] + value.borderWidth[1] + value.spacing[2],
  // `onSelect` is wired to a DOM click the way the real item wires it to a press, so the
  // display-settings page can be driven from a test.
  MenuItem: ({
    children,
    testID,
    onSelect,
    selected,
  }: React.PropsWithChildren<{
    testID?: string;
    onSelect?: () => void;
    selected?: boolean;
  }>) =>
    React.createElement(
      "div",
      {
        "data-testid": testID,
        "data-selected": String(selected === true),
        onClick: onSelect,
      },
      children,
    ),
  MenuSeparator: () => React.createElement("hr"),
  MenuSubTrigger: ({ children, testID }: React.PropsWithChildren<{ testID?: string }>) =>
    React.createElement("div", { "data-testid": testID }, children),
}));

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import {
  AgentStatsPanel,
  buildAgentStatsPanelModel,
  useStatsPanelPages,
  type AgentStatsPanelTranslate,
} from "./stats-panel";
import { useStatsPillPreferences } from "@/stores/stats-pill-preferences";

const SERVER_ID = "server-stats-panel";
const AGENT_ID = "agent-stats-panel";

/** Keys pass through, so assertions read against the key rather than a translated sentence. */
const t: AgentStatsPanelTranslate = (key) => key;

const fullStats = {
  sessionInputTokens: 12_000,
  sessionCachedInputTokens: 8_000,
  sessionCacheWriteTokens: 1_200,
  sessionOutputTokens: 3_400,
  sessionTotalCostUsd: 1.23,
  requestCount: 27,
  turnCount: 6,
  lastGenTokensPerSec: 38,
  lastFirstTokenLatencyMs: 820,
  lastRequestDurationMs: 4_200,
  lastTurnDurationMs: 30_000,
  cacheHitRate: 0.66,
  toolCallTotal: 24,
  toolCallErrors: 1,
  toolCalls: [{ tool: "Bash", count: 12, errors: 1 }],
  subagents: [
    { agentId: "sub-1", label: "Explore", inputTokens: 900, outputTokens: 120, running: false },
  ],
};

const lastUsage = { contextWindowMaxTokens: 200_000, contextWindowUsedTokens: 85_000 };

describe("buildAgentStatsPanelModel", () => {
  it("reports KPIs and the four sections a full snapshot supports", () => {
    const model = buildAgentStatsPanelModel({ stats: fullStats, lastUsage, t });

    expect(model.kpis.map((kpi) => `${kpi.label}=${kpi.value}`)).toEqual([
      "agentStats.panel.kpi.context=42%",
      "agentStats.panel.kpi.speed=38 t/s",
      "agentStats.panel.kpi.cacheHitRate=66%",
      "agentStats.panel.kpi.cost=$1.23",
    ]);
    expect(model.progress).toEqual({ percent: 42, tone: "muted" });
    expect(model.sections.map((section) => section.id)).toEqual([
      "totals",
      "timing",
      "tools",
      "subagents",
    ]);
    expect(model.sections[0]?.rows.map((row) => `${row.label}=${row.value}`)).toEqual([
      "agentStats.panel.rows.inputTokens=12k",
      "agentStats.panel.rows.cachedInputTokens=8k",
      "agentStats.panel.rows.cacheWriteTokens=1k",
      "agentStats.panel.rows.outputTokens=3k",
      "agentStats.panel.rows.cost=$1.23",
      "agentStats.panel.rows.requestsAndTurns=27 · 6",
    ]);
    expect(model.sections[1]?.rows.map((row) => row.value)).toEqual(["820ms", "4.2s", "30.0s"]);
    expect(model.sections[2]?.rows.map((row) => `${row.label}=${row.value}`)).toEqual([
      "agentStats.panel.rows.toolCallTotal=24",
      "agentStats.panel.rows.toolCallErrors=1",
      "Bash=12 (1✕)",
    ]);
    // The total carries the section; the per-tool rows under it are the breakdown.
    expect(model.sections[2]?.rows[0]?.strong).toBe(true);
    expect(model.sections[2]?.rows[2]?.strong).toBeUndefined();
    expect(model.sections[3]?.rows).toEqual([
      { id: "subagent.sub-1", label: "Explore", value: "↑900 ↓120", running: false },
    ]);
  });

  it("collapses MCP tool namespaces and caps the per-tool rows", () => {
    // Counts 10,9,8,7,6,5,4: the top five stay, the last two (5+4=9 calls) fold into one row.
    const toolCalls = Array.from({ length: 7 }, (_, index) => ({
      tool: index === 0 ? "mcp__ssh-server__xterminal_ssh_exec" : `Tool${index}`,
      count: 10 - index,
      errors: 0,
    }));

    const model = buildAgentStatsPanelModel({
      stats: { toolCallTotal: 49, toolCalls },
      lastUsage,
      t,
    });

    const tools = model.sections[0];
    expect(tools?.layout).toBe("rows");
    expect(tools?.rows.map((row) => `${row.label}=${row.value}`)).toEqual([
      "agentStats.panel.rows.toolCallTotal=49",
      "ssh-server · xterminal_ssh_exec=10",
      "Tool1=9",
      "Tool2=8",
      "Tool3=7",
      "Tool4=6",
      "agentStats.panel.rows.moreTools=9",
    ]);
  });

  it("lays the counter sections out as grids and the identifier sections as rows", () => {
    const model = buildAgentStatsPanelModel({ stats: fullStats, lastUsage, t });

    expect(model.sections.map((section) => `${section.id}:${section.layout}`)).toEqual([
      "totals:grid",
      "timing:grid",
      "tools:rows",
      "subagents:rows",
    ]);
  });

  it("drops the sections a provider cannot fill", () => {
    // What opencode reports: usage and cost, no timings, no tools, no subagents.
    const model = buildAgentStatsPanelModel({
      stats: { sessionInputTokens: 5_000, sessionOutputTokens: 200, sessionTotalCostUsd: 0.5 },
      lastUsage,
      t,
    });

    expect(model.sections.map((section) => section.id)).toEqual(["totals"]);
    expect(model.kpis.map((kpi) => kpi.id)).toEqual(["context", "cost"]);
  });

  it("has nothing to show without a snapshot", () => {
    const model = buildAgentStatsPanelModel({ stats: undefined, lastUsage: undefined, t });

    expect(model).toEqual({ kpis: [], progress: null, sections: [] });
  });
});

describe("AgentStatsPanel", () => {
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

  function setAgent(stats: unknown, usedTokens = 85_000): void {
    mockState.sessions[SERVER_ID] = {
      agents: new Map([
        [
          AGENT_ID,
          {
            id: AGENT_ID,
            status: "running",
            stats,
            lastUsage: { contextWindowMaxTokens: 200_000, contextWindowUsedTokens: usedTokens },
          },
        ],
      ]),
    };
  }

  it("renders every section it has data for", () => {
    setAgent(fullStats);

    act(() => root.render(<AgentStatsPanel serverId={SERVER_ID} agentId={AGENT_ID} />));

    expect(container.querySelector('[data-testid="agent-stats-section-overview"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="agent-stats-section-totals"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="agent-stats-section-timing"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="agent-stats-section-tools"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="agent-stats-section-subagents"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="agent-stats-display-settings"]')).not.toBeNull();
    // Grid sections keep the row testID contract, so a cell is addressable like a row.
    expect(container.querySelector('[data-testid="agent-stats-row-totals-cost"]')).not.toBeNull();
    expect(container.textContent).toContain("42%");
    expect(container.textContent).toContain("Bash");
  });

  it("hides a section the provider cannot fill", () => {
    setAgent({ sessionInputTokens: 5_000, sessionOutputTokens: 200 });

    act(() => root.render(<AgentStatsPanel serverId={SERVER_ID} agentId={AGENT_ID} />));

    expect(container.querySelector('[data-testid="agent-stats-section-overview"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="agent-stats-section-totals"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="agent-stats-section-timing"]')).toBeNull();
    expect(container.querySelector('[data-testid="agent-stats-section-tools"]')).toBeNull();
  });

  it("tones the progress bar by how full the window is", () => {
    const fill = () =>
      container.querySelector<HTMLElement>('[data-testid^="agent-stats-progress-"]');

    setAgent(fullStats, 85_000);
    act(() => root.render(<AgentStatsPanel serverId={SERVER_ID} agentId={AGENT_ID} />));
    expect(fill()?.getAttribute("data-testid")).toBe("agent-stats-progress-muted");
    expect(fill()?.getAttribute("data-background-color")).toBe("#foregroundMuted");
    expect(fill()?.getAttribute("data-width")).toBe("42%");

    setAgent(fullStats, 150_000);
    act(() => root.render(<AgentStatsPanel serverId={SERVER_ID} agentId={AGENT_ID} />));
    expect(fill()?.getAttribute("data-testid")).toBe("agent-stats-progress-warning");
    expect(fill()?.getAttribute("data-background-color")).toBe("#amber500");

    setAgent(fullStats, 195_000);
    act(() => root.render(<AgentStatsPanel serverId={SERVER_ID} agentId={AGENT_ID} />));
    expect(fill()?.getAttribute("data-testid")).toBe("agent-stats-progress-critical");
    expect(fill()?.getAttribute("data-background-color")).toBe("#destructive");
    expect(fill()?.getAttribute("data-width")).toBe("97%");
  });

  it("marks subagents that are still running", () => {
    setAgent({
      ...fullStats,
      subagents: [
        {
          agentId: "sub-run",
          label: "Explore",
          inputTokens: 900,
          outputTokens: 120,
          running: true,
        },
        { agentId: "sub-done", label: "Verify", inputTokens: 10, outputTokens: 5, running: false },
      ],
    });

    act(() => root.render(<AgentStatsPanel serverId={SERVER_ID} agentId={AGENT_ID} />));

    const runningRow = container.querySelector(
      '[data-testid="agent-stats-row-subagents-subagent.sub-run"]',
    );
    const doneRow = container.querySelector(
      '[data-testid="agent-stats-row-subagents-subagent.sub-done"]',
    );
    expect(
      runningRow?.querySelector('[data-testid="agent-stats-subagent-running"]'),
    ).not.toBeNull();
    expect(doneRow?.querySelector('[data-testid="agent-stats-subagent-running"]')).toBeNull();
  });

  it("keeps rendering every panel section while a pill segment is hidden", () => {
    useStatsPillPreferences.setState({ hiddenSegments: ["speed"] });
    setAgent(fullStats);

    act(() => root.render(<AgentStatsPanel serverId={SERVER_ID} agentId={AGENT_ID} />));

    // The switches scope to the pill; the detail panel stays complete.
    expect(container.querySelector('[data-testid="agent-stats-kpi-speed"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="agent-stats-section-timing"]')).not.toBeNull();
  });

  it("toggles a pill segment from the display-settings page", () => {
    useStatsPillPreferences.setState({ hiddenSegments: [] });
    const { result } = renderHook(() => useStatsPanelPages());

    act(() => root.render(result.current[0]?.content));

    const costToggle = container.querySelector<HTMLElement>(
      '[data-testid="agent-stats-segment-toggle-cost"]',
    );
    expect(costToggle?.getAttribute("data-selected")).toBe("true");

    act(() => costToggle?.click());
    expect(useStatsPillPreferences.getState().hiddenSegments).toEqual(["cost"]);

    act(() => costToggle?.click());
    expect(useStatsPillPreferences.getState().hiddenSegments).toEqual([]);
  });
});
