/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { renderHook } from "@testing-library/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { theme } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, 2: 8, 3: 12 },
    fontSize: { sm: 13 },
    borderWidth: { 1: 1 },
    borderRadius: { "2xl": 16 },
    colors: {
      foreground: "#foreground",
      foregroundMuted: "#foregroundMuted",
      destructive: "#destructive",
      borderAccent: "#borderAccent",
      surface1: "#surface1",
      surface2: "#surface2",
      palette: { amber: { 500: "#amber500" } },
    },
  },
}));

const { compactState, mockState } = vi.hoisted(() => ({
  compactState: { value: false },
  mockState: {
    sessions: {} as Record<string, unknown>,
  },
}));

vi.mock("react-native", () => ({
  // `@react-native-async-storage/async-storage` reads `Platform.OS` at module scope, and the
  // preferences store pulls it in.
  Platform: {
    OS: "web",
    select: (options: Record<string, unknown>) => options.default,
  },
  View: ({ children, testID, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement("div", withTestId(props, testID), children),
  Pressable: ({
    children,
    style,
    testID,
    ...props
  }: React.PropsWithChildren<{ style?: unknown } & Record<string, unknown>>) => {
    const resolvedStyle =
      typeof style === "function" ? style({ hovered: false, pressed: false }) : style;
    return React.createElement(
      "div",
      {
        ...withTestId(props, testID),
        "data-pressable": "true",
        "data-color": readColor(resolvedStyle),
      },
      typeof children === "function"
        ? (children as (state: unknown) => React.ReactNode)({ hovered: false, pressed: false })
        : children,
    );
  },
  Text: ({
    children,
    style,
    testID,
    ...props
  }: React.PropsWithChildren<{ style?: unknown } & Record<string, unknown>>) => {
    const resolved = Object.assign({}, ...toStyleArray(style));
    return React.createElement(
      "span",
      {
        ...withTestId(props, testID),
        "data-color": resolved.color,
        "data-opacity": resolved.opacity,
      },
      children,
    );
  },
}));

/** React DOM renders a non-standard `testID` attribute verbatim; tests want `data-testid`. */
function withTestId(props: Record<string, unknown>, testID: unknown): Record<string, unknown> {
  return testID === undefined ? props : { ...props, "data-testid": testID };
}

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: (value: typeof theme) => unknown) => factory(theme),
  },
}));

vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => compactState.value,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));

// The menu engine and the panel body have their own files; this one is about the segments the pill
// shows before either of them exists.
vi.mock("@/components/ui/menu", () => ({
  MenuRoot: ({ children }: React.PropsWithChildren) =>
    React.createElement(React.Fragment, null, children),
  MenuTrigger: ({ children, testID }: React.PropsWithChildren<{ testID?: string }>) =>
    React.createElement("div", { "data-testid": testID }, children),
  MenuSurface: ({ children }: React.PropsWithChildren) =>
    React.createElement("div", null, children),
}));

vi.mock("./stats-panel", () => ({
  AgentStatsPanel: () => null,
  useStatsPanelPages: () => [],
}));

vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: typeof mockState) => unknown) => selector(mockState),
}));

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import { useStatsPillPreferences } from "@/stores/stats-pill-preferences";
import { AGENT_STATS_PILL_TEST_ID, AgentStatsPill, useAgentStatsPillVisible } from "./stats-pill";

function toStyleArray(style: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(style)) return style.flatMap((entry) => toStyleArray(entry));
  return style && typeof style === "object" ? [style as Record<string, unknown>] : [];
}

function readColor(style: unknown): string | undefined {
  const merged = Object.assign({}, ...toStyleArray(style));
  return typeof merged.color === "string" ? merged.color : undefined;
}

const SERVER_ID = "server-stats";
const AGENT_ID = "agent-stats";

function stats(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionInputTokens: 1_200,
    sessionOutputTokens: 3_400,
    sessionTotalCostUsd: 1.23,
    requestCount: 27,
    turnCount: 6,
    lastGenTokensPerSec: 38,
    toolCallTotal: 24,
    toolCallErrors: 0,
    ...overrides,
  };
}

function setAgent(
  agent: {
    stats?: Record<string, unknown>;
    lastUsage?: Record<string, unknown>;
    status?: string;
  },
  options: { features?: Record<string, boolean> | undefined } = {},
): void {
  mockState.sessions[SERVER_ID] = {
    serverInfo: options.features === undefined ? {} : { features: options.features },
    agents: new Map([
      [
        AGENT_ID,
        {
          id: AGENT_ID,
          status: agent.status ?? "running",
          stats: agent.stats,
          lastUsage: agent.lastUsage,
        },
      ],
    ]),
  };
}

function enableFeature(): void {
  setAgent(
    {
      stats: stats(),
      lastUsage: { contextWindowMaxTokens: 200_000, contextWindowUsedTokens: 85_000 },
    },
    {
      features: { agentSessionStats: true },
    },
  );
}

describe("AgentStatsPill", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    compactState.value = false;
    mockState.sessions = {};
    useStatsPillPreferences.setState({ hiddenSegments: [] });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(): void {
    act(() => root.render(<AgentStatsPill serverId={SERVER_ID} agentId={AGENT_ID} />));
  }

  /** Remount from scratch so a case can change state before the pill's first render. */
  function remount(): void {
    act(() => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }

  function contextPctColor(): string | null {
    return (
      container
        .querySelector('[data-testid="agent-stats-pill-segment-0"] span')
        ?.getAttribute("data-color") ?? null
    );
  }

  function segmentTexts(): (string | null)[] {
    return [...container.querySelectorAll('[data-testid^="agent-stats-pill-segment-"]')].map(
      (element) => element.textContent,
    );
  }

  it("renders every available segment on a wide layout, in priority order", () => {
    enableFeature();

    render();

    expect(container.querySelector('[data-testid="agent-stats-pill"]')).not.toBeNull();
    expect(segmentTexts()).toEqual(["42%", "$1.23", "85k/200k", "↑1k ↓3k", "🔧 24", "38 t/s"]);
  });

  it("keeps only the two highest-priority segments on a compact layout", () => {
    enableFeature();
    compactState.value = true;

    render();

    expect(segmentTexts()).toEqual(["42%", "$1.23"]);
  });

  it("tones the context percentage by how full the window is", () => {
    setAgent(
      { lastUsage: { contextWindowMaxTokens: 200_000, contextWindowUsedTokens: 190_000 } },
      {
        features: { agentSessionStats: true },
      },
    );
    render();
    expect(segmentTexts()[0]).toBe("95%");
    expect(contextPctColor()).toBe("#destructive");

    remount();
    setAgent(
      { lastUsage: { contextWindowMaxTokens: 200_000, contextWindowUsedTokens: 170_000 } },
      {
        features: { agentSessionStats: true },
      },
    );
    render();
    expect(contextPctColor()).toBe("#amber500");

    remount();
    setAgent(
      { lastUsage: { contextWindowMaxTokens: 200_000, contextWindowUsedTokens: 40_000 } },
      {
        features: { agentSessionStats: true },
      },
    );
    render();
    expect(contextPctColor()).toBe("#foregroundMuted");
  });

  it("renders nothing when the daemon does not advertise the feature", () => {
    setAgent({ stats: stats() }, { features: undefined });
    render();
    expect(container.textContent).toBe("");

    setAgent({ stats: stats() }, { features: { agentSessionStats: false } });
    render();
    expect(container.textContent).toBe("");
  });

  it("renders nothing without session data, and only the available segments with partial data", () => {
    setAgent({}, { features: { agentSessionStats: true } });
    render();
    expect(container.textContent).toBe("");

    setAgent(
      { stats: { toolCallTotal: 24, toolCallErrors: 2 } },
      { features: { agentSessionStats: true } },
    );
    render();
    expect(segmentTexts()).toEqual(["🔧 24 (2✕)"]);
  });

  it("drops a segment the user turned off", () => {
    enableFeature();
    useStatsPillPreferences.setState({ hiddenSegments: ["cost"] });

    render();

    expect(segmentTexts()).toEqual(["42%", "85k/200k", "↑1k ↓3k", "🔧 24", "38 t/s"]);
  });

  it("keeps the pill on screen when every segment is hidden, so the panel stays reachable", () => {
    enableFeature();
    useStatsPillPreferences.setState({
      hiddenSegments: ["contextPct", "cost", "contextAbs", "tokens", "tools", "speed"],
    });

    render();

    // The display settings live inside the pill's own panel. Emptying the pill would take away the
    // only way to put a segment back.
    expect(container.querySelector(`[data-testid="${AGENT_STATS_PILL_TEST_ID}"]`)).not.toBeNull();
    expect(segmentTexts()).toEqual(["42%"]);
  });

  it("is visible from context usage alone, with no session snapshot yet", () => {
    setAgent(
      { lastUsage: { contextWindowMaxTokens: 200_000, contextWindowUsedTokens: 85_000 } },
      { features: { agentSessionStats: true } },
    );

    const { result } = renderHook(() => useAgentStatsPillVisible(SERVER_ID, AGENT_ID));

    expect(result.current).toBe(true);
  });

  it("dims the generation speed once the agent stops running", () => {
    enableFeature();
    render();
    const runningSpeed = container
      .querySelector('[data-testid="agent-stats-pill-segment-5"] span')
      ?.getAttribute("data-opacity");
    expect(runningSpeed).toBeNull();

    act(() => {
      setAgent(
        {
          stats: stats(),
          lastUsage: { contextWindowMaxTokens: 200_000, contextWindowUsedTokens: 85_000 },
          status: "idle",
        },
        { features: { agentSessionStats: true } },
      );
    });
    render();

    expect(
      container
        .querySelector('[data-testid="agent-stats-pill-segment-5"] span')
        ?.getAttribute("data-opacity"),
    ).toBe("0.5");
  });
});
