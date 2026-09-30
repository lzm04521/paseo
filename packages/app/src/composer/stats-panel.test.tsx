/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { theme, mockState } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, 2: 8, 3: 12 },
    fontSize: { sm: 12, base: 14 },
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
      palette: { amber: { 500: "#amber500" } },
    },
  },
  mockState: { sessions: {} as Record<string, unknown> },
}));

vi.mock("react-native", () => ({
  Platform: { OS: "web", select: (options: Record<string, unknown>) => options.default },
  View: ({ children, testID, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement(
      "div",
      testID === undefined ? props : { ...props, "data-testid": testID },
      children,
    ),
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
  MenuItem: ({ children, testID }: React.PropsWithChildren<{ testID?: string }>) =>
    React.createElement("div", { "data-testid": testID }, children),
  MenuSeparator: () => React.createElement("hr"),
  MenuSubTrigger: ({ children, testID }: React.PropsWithChildren<{ testID?: string }>) =>
    React.createElement("div", { "data-testid": testID }, children),
}));

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import {
  AgentStatsPanel,
  buildAgentStatsPanelModel,
  type AgentStatsPanelTranslate,
} from "./stats-panel";

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
    expect(model.sections[3]?.rows).toEqual([
      { id: "subagent.sub-1", label: "Explore", value: "↑900 ↓120" },
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

  function setAgent(stats: unknown): void {
    mockState.sessions[SERVER_ID] = {
      agents: new Map([[AGENT_ID, { id: AGENT_ID, status: "running", stats, lastUsage }]]),
    };
  }

  it("renders every section it has data for", () => {
    setAgent(fullStats);

    act(() => root.render(<AgentStatsPanel serverId={SERVER_ID} agentId={AGENT_ID} />));

    expect(container.querySelector('[data-testid="agent-stats-section-totals"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="agent-stats-section-timing"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="agent-stats-section-tools"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="agent-stats-section-subagents"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="agent-stats-display-settings"]')).not.toBeNull();
    expect(container.textContent).toContain("42%");
    expect(container.textContent).toContain("Bash");
  });

  it("hides a section the provider cannot fill", () => {
    setAgent({ sessionInputTokens: 5_000, sessionOutputTokens: 200 });

    act(() => root.render(<AgentStatsPanel serverId={SERVER_ID} agentId={AGENT_ID} />));

    expect(container.querySelector('[data-testid="agent-stats-section-totals"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="agent-stats-section-timing"]')).toBeNull();
    expect(container.querySelector('[data-testid="agent-stats-section-tools"]')).toBeNull();
  });
});
