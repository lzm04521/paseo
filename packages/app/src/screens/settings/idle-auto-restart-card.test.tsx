/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Alert } from "react-native";
import type { MutableDaemonConfig } from "@getpaseo/protocol/messages";

const { configState, patchConfigMock, timesState } = vi.hoisted(() => ({
  configState: {
    config: null as MutableDaemonConfig | null,
  },
  patchConfigMock: vi.fn(async () => undefined),
  timesState: {
    startedAt: null as Date | null,
    idleSince: null as Date | null,
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === "settings.host.daemon.idleAutoRestart.startedAtLine") {
        return `Started ${options?.time} · running for ${options?.uptime}`;
      }
      if (key === "settings.host.daemon.idleAutoRestart.idleFor") {
        return `idle for ${options?.duration}`;
      }
      return (
        {
          "settings.host.daemon.idleAutoRestart.title": "Idle auto-restart",
          "settings.host.daemon.idleAutoRestart.settings": "Settings",
          "settings.host.daemon.idleAutoRestart.sheetTitle": "Idle auto-restart",
          "settings.host.daemon.idleAutoRestart.uptimeLabel": "Minutes of uptime",
          "settings.host.daemon.idleAutoRestart.idleLabel": "Minutes without running tasks",
          "settings.host.daemon.idleAutoRestart.uptimeHint": "uptime hint",
          "settings.host.daemon.idleAutoRestart.idleHint": "idle hint",
          "settings.host.daemon.idleAutoRestart.invalidInteger": "Enter a whole number",
          "settings.host.daemon.idleAutoRestart.invalidRange":
            "Enter a value between {{min}} and {{max}}",
          "settings.host.daemon.idleAutoRestart.save": "Save",
          "settings.host.daemon.idleAutoRestart.cancel": "Cancel",
          "settings.host.daemon.idleAutoRestart.errorTitle": "Unable to update",
        }[key] ?? key
      );
    },
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
      "data-testid": testID ?? "host-page-idle-auto-restart-switch",
      onClick: () => onValueChange?.(!value),
    }),
}));

// jsdom 无法加载 AdaptiveModalSheet/Button/FormTextInput 的真实实现
// （@gorhom/bottom-sheet、react-native-reanimated 等原生依赖链）。
// 测试从不打开 sheet，这里按 Switch mock 的同样式替换为纯 DOM stub。
vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement("div", { "data-testid": testID }, children),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    disabled,
    testID,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    disabled?: boolean;
    testID?: string;
  }) =>
    React.createElement(
      "button",
      {
        "data-testid": testID,
        disabled,
        type: "button",
        onClick: () => onPress?.(),
      },
      children,
    ),
}));

vi.mock("@/components/ui/form-field", () => ({
  Field: ({
    label,
    children,
    hint,
    error,
    testID,
  }: {
    label: string;
    children?: React.ReactNode;
    hint?: string;
    error?: string | null;
    testID?: string;
  }) => {
    const subtext = error ?? hint ?? null;
    return React.createElement(
      "div",
      { "data-testid": testID },
      React.createElement("label", null, label),
      children,
      subtext != null ? React.createElement("span", null, subtext) : null,
    );
  },
  FormTextInput: ({
    initialValue,
    resetKey,
    onChangeText,
    testID,
  }: {
    // 忠实模拟真实 AdaptiveTextInput 契约：非受控，value prop 被丢弃，
    // 种子值走 initialValue + resetKey 重挂载（见 adaptive-modal-sheet.tsx）。
    initialValue?: string;
    resetKey?: string | number;
    onChangeText?: (next: string) => void;
    testID?: string;
  }) =>
    React.createElement("input", {
      key: resetKey,
      "data-testid": testID,
      defaultValue: initialValue,
      onChange: (event: { target: { value: string } }) => onChangeText?.(event.target.value),
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

vi.mock("@/hooks/use-daemon-status-times", () => ({
  useDaemonStatusTimes: (_serverId: string, enabled: boolean) =>
    enabled
      ? { startedAt: timesState.startedAt, idleSince: timesState.idleSince }
      : { startedAt: null, idleSince: null },
}));

import { IdleAutoRestartCard } from "./idle-auto-restart-card";

// react-native resolves to react-native-web under vitest; its Alert.alert is a
// no-op static, so spy on it to observe failure alerts.
const alertSpy = vi.spyOn(Alert, "alert");

function makeConfig(enabled: boolean): MutableDaemonConfig {
  return {
    relay: { enabled: false },
    mcp: { injectIntoAgents: false },
    browserTools: { enabled: false },
    providers: {},
    metadataGeneration: { providers: [] },
    autoArchiveAfterMerge: false,
    enableTerminalAgentHooks: false,
    appendSystemPrompt: "",
    claudeImageDowngrade: "off",
    idleAutoRestart: { enabled, uptimeThresholdMinutes: 240, idleThresholdMinutes: 10 },
  };
}

describe("IdleAutoRestartCard", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    configState.config = null;
    timesState.startedAt = null;
    timesState.idleSince = null;
    patchConfigMock.mockReset();
    patchConfigMock.mockResolvedValue(undefined);
    alertSpy.mockClear();
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
      root?.render(<IdleAutoRestartCard serverId="server-1" />);
    });
  }

  function findSwitch(): HTMLElement {
    const el = container?.querySelector<HTMLElement>(
      '[data-testid="host-page-idle-auto-restart-switch"]',
    );
    if (!el) throw new Error("Expected idle auto-restart switch");
    return el;
  }

  function requireElement(selector: string): HTMLElement {
    const el = container?.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`Expected element matching ${selector}`);
    return el;
  }

  it("binds the switch to the daemon config value", () => {
    configState.config = makeConfig(true);
    render();
    expect(findSwitch().getAttribute("aria-checked")).toBe("true");

    configState.config = makeConfig(false);
    render();
    expect(findSwitch().getAttribute("aria-checked")).toBe("false");
  });

  it("patches only the enabled flag when toggled", async () => {
    configState.config = makeConfig(false);
    render();

    await act(async () => {
      findSwitch().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    expect(patchConfigMock).toHaveBeenCalledTimes(1);
    expect(patchConfigMock).toHaveBeenCalledWith({ idleAutoRestart: { enabled: true } });
  });

  it("renders nothing when disconnected", () => {
    // useHostRuntimeIsConnected mock 恒 true，此用例换个方式：config 为 null 时卡片仍渲染但 switch off
    configState.config = null;
    render();
    expect(findSwitch().getAttribute("aria-checked")).toBe("false");
  });

  it("seeds the threshold inputs with the persisted values when the sheet opens", async () => {
    // 回归：AdaptiveTextInput 非受控，回显必须走 initialValue（曾因传受控 value 被丢弃
    // 导致每次打开 sheet 输入框空白，被误判为"没保存成功"）。
    configState.config = makeConfig(true);
    render();

    const editButton = requireElement('[data-testid="host-page-idle-auto-restart-edit"]');
    await act(async () => {
      editButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    const uptimeInput = requireElement(
      '[data-testid="host-page-idle-auto-restart-uptime-input"]',
    ) as HTMLInputElement;
    const idleInput = requireElement(
      '[data-testid="host-page-idle-auto-restart-idle-input"]',
    ) as HTMLInputElement;
    expect(uptimeInput.defaultValue).toBe("240");
    expect(idleInput.defaultValue).toBe("10");
  });

  it("alerts when saving the thresholds fails and keeps the sheet open", async () => {
    configState.config = makeConfig(false);
    render();

    const editButton = requireElement('[data-testid="host-page-idle-auto-restart-edit"]');
    await act(async () => {
      editButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(requireElement('[data-testid="host-page-idle-auto-restart-sheet"]')).not.toBeNull();

    patchConfigMock.mockRejectedValueOnce(new Error("daemon offline"));
    const saveButton = requireElement('[data-testid="host-page-idle-auto-restart-save"]');
    await act(async () => {
      saveButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    expect(patchConfigMock).toHaveBeenCalledWith({
      idleAutoRestart: { enabled: false, uptimeThresholdMinutes: 240, idleThresholdMinutes: 10 },
    });
    expect(alertSpy).toHaveBeenCalledWith("Unable to update", "daemon offline");
    expect(requireElement('[data-testid="host-page-idle-auto-restart-sheet"]')).not.toBeNull();
  });

  it("shows the daemon start time, uptime and idle time when enabled", () => {
    configState.config = makeConfig(true);
    timesState.startedAt = new Date(Date.now() - 60 * 60 * 1000);
    timesState.idleSince = new Date(Date.now() - 5 * 60 * 1000);
    render();

    const line = requireElement('[data-testid="host-page-idle-auto-restart-started-at"]');
    // 1 小时/5 分钟整的时长经 formatDuration 是稳定的 "1h"/"5m"（分钟级渲染误差不影响前缀）。
    expect(line.textContent).toContain("running for 1h");
    expect(line.textContent).toContain("idle for 5m");
  });

  it("omits the idle segment while a task is running (idleSince is null)", () => {
    configState.config = makeConfig(true);
    timesState.startedAt = new Date(Date.now() - 60 * 60 * 1000);
    timesState.idleSince = null;
    render();

    const line = requireElement('[data-testid="host-page-idle-auto-restart-started-at"]');
    expect(line.textContent).toContain("running for 1h");
    expect(line.textContent).not.toContain("idle for");
  });

  it("hides the start time line while the switch is off or before the status loads", () => {
    configState.config = makeConfig(true);
    timesState.startedAt = null;
    render();
    expect(
      container?.querySelector('[data-testid="host-page-idle-auto-restart-started-at"]'),
    ).toBeNull();

    configState.config = makeConfig(false);
    timesState.startedAt = new Date(Date.now() - 60 * 60 * 1000);
    render();
    expect(
      container?.querySelector('[data-testid="host-page-idle-auto-restart-started-at"]'),
    ).toBeNull();
  });
});
