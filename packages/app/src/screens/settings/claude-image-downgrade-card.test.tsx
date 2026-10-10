/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MutableDaemonConfig } from "@getpaseo/protocol/messages";

const { theme, configState, patchConfigMock } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, 3: 12, 4: 16, 6: 24 },
    fontSize: { xs: 11, base: 15 },
    fontWeight: { normal: "400" },
    borderRadius: { lg: 8 },
    colors: {
      surface1: "#111",
      border: "#555",
      foreground: "#fff",
      foregroundMuted: "#aaa",
    },
  },
  configState: {
    config: null as MutableDaemonConfig | null,
  },
  patchConfigMock: vi.fn(async () => undefined),
}));

vi.mock("react-native", () => ({
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("span", null, children),
  Alert: { alert: vi.fn() },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function" ? (factory as (t: typeof theme) => unknown)(theme) : factory,
  },
  useUnistyles: () => ({ theme, rt: { breakpoint: "md" } }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "settings.host.orchestration.imageDowngrade.title": "Claude image downgrade",
        "settings.host.orchestration.imageDowngrade.hint":
          "Send prompt images as file paths instead of base64 for text-only Claude models",
        "settings.host.orchestration.imageDowngrade.accessibilityLabel": "Claude image downgrade",
        "settings.host.orchestration.imageDowngrade.errorTitle":
          "Unable to update Claude image downgrade",
      })[key] ?? key,
  }),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    value,
    onValueChange,
    accessibilityLabel,
    testID,
  }: {
    value: boolean;
    onValueChange?: (next: boolean) => void;
    accessibilityLabel?: string;
    testID?: string;
  }) =>
    React.createElement("div", {
      role: "switch",
      "aria-checked": value ? "true" : "false",
      "aria-label": accessibilityLabel,
      "data-testid": testID ?? "host-page-claude-image-downgrade-switch",
      onClick: () => onValueChange?.(!value),
    }),
}));

vi.mock("@/hooks/use-daemon-config", () => ({
  useDaemonConfig: () => ({
    config: configState.config,
    isLoading: false,
    patchConfig: patchConfigMock,
  }),
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeIsConnected: () => true,
}));

import { ClaudeImageDowngradeCard } from "./claude-image-downgrade-card";

function makeConfig(downgrade: "off" | "on"): MutableDaemonConfig {
  return {
    relay: { enabled: false },
    mcp: { injectIntoAgents: false },
    browserTools: { enabled: false },
    providers: {},
    metadataGeneration: { providers: [] },
    autoArchiveAfterMerge: false,
    enableTerminalAgentHooks: false,
    appendSystemPrompt: "",
    claudeImageDowngrade: downgrade,
  };
}

describe("ClaudeImageDowngradeCard", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    configState.config = null;
    patchConfigMock.mockReset();
    patchConfigMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    vi.unstubAllGlobals();
  });

  function render(): void {
    act(() => {
      root?.render(<ClaudeImageDowngradeCard serverId="server-1" />);
    });
  }

  function findSwitch(): HTMLElement {
    const el = container?.querySelector<HTMLElement>(
      '[data-testid="host-page-claude-image-downgrade-switch"]',
    );
    if (!el) throw new Error("Expected claude image downgrade switch");
    return el;
  }

  it("binds the switch to the daemon config value", () => {
    configState.config = makeConfig("on");
    render();
    expect(findSwitch().getAttribute("aria-checked")).toBe("true");

    configState.config = makeConfig("off");
    render();
    expect(findSwitch().getAttribute("aria-checked")).toBe("false");
  });

  it("patches claudeImageDowngrade off when toggled from on", async () => {
    configState.config = makeConfig("on");
    render();

    await act(async () => {
      findSwitch().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    expect(patchConfigMock).toHaveBeenCalledTimes(1);
    expect(patchConfigMock).toHaveBeenCalledWith({ claudeImageDowngrade: "off" });
  });

  it("patches claudeImageDowngrade on when toggled from off", async () => {
    configState.config = makeConfig("off");
    render();

    await act(async () => {
      findSwitch().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    expect(patchConfigMock).toHaveBeenCalledTimes(1);
    expect(patchConfigMock).toHaveBeenCalledWith({ claudeImageDowngrade: "on" });
  });
});
