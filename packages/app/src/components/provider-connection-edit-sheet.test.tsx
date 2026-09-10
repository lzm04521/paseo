/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { patchConfigMock, configState } = vi.hoisted(() => ({
  patchConfigMock: vi.fn(async () => undefined),
  configState: {
    config: {
      providers: {
        "my-relay": {
          extends: "claude",
          label: "My Relay",
          env: {
            ANTHROPIC_BASE_URL: "https://relay.example.com",
            ANTHROPIC_AUTH_TOKEN: "old-token",
            // 非托管键：用户手写在 config.json 里的额外 env，保存连接时必须原样保留。
            ANTHROPIC_MODEL: "claude-x",
          },
          fetchModels: true,
        },
      },
    },
  },
}));

vi.mock("@/hooks/use-daemon-config", () => ({
  useDaemonConfig: () => ({ config: configState.config, patchConfig: patchConfigMock }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "web" },
  View: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("span", null, children),
  Pressable: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) =>
    React.createElement("div", { onClick: onPress }, children),
  StyleSheet: { create: () => ({}) },
}));
vi.mock("react-native-unistyles", () => ({
  useUnistyles: () => ({
    theme: {
      spacing: { 1: 4, 2: 8, 3: 12, 4: 16 },
      iconSize: { sm: 14, md: 20 },
      fontSize: { base: 15, sm: 13 },
      colors: { foreground: "#fff", foregroundMuted: "#aaa", border: "#555" },
      borderRadius: { lg: 8 },
    },
  }),
  StyleSheet: { create: () => ({}) },
}));
vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "sheet" }, children),
  // 编辑表单需要回显已有配置，mock 里把 initialValue 转成受控 value 才能断言预填。
  AdaptiveTextInput: ({
    onChangeText,
    placeholder,
    testID,
    initialValue,
  }: {
    onChangeText?: (text: string) => void;
    placeholder?: string;
    testID?: string;
    initialValue?: string;
  }) =>
    React.createElement("input", {
      "data-testid": testID,
      placeholder,
      value: initialValue,
      onChange: (event: { target: { value: string } }) => onChangeText?.(event.target.value),
    }),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    disabled,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    disabled?: boolean;
  }) => React.createElement("button", { type: "button", onClick: onPress, disabled }, children),
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    value,
    onValueChange,
  }: {
    value: boolean;
    onValueChange?: (value: boolean) => void;
  }) =>
    React.createElement("input", {
      "data-testid": "fetch-models-switch",
      type: "checkbox",
      checked: value,
      onChange: (event: { target: { checked: boolean } }) => onValueChange?.(event.target.checked),
    }),
}));

import { ProviderConnectionEditSheet } from "./provider-connection-edit-sheet";

const noop = () => {};

describe("ProviderConnectionEditSheet", () => {
  let root: Root | null = null;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(() => {
    patchConfigMock.mockClear();
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    vi.unstubAllGlobals();
  });

  function renderSheet() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <ProviderConnectionEditSheet
          provider="my-relay"
          serverId="local"
          visible={true}
          onClose={noop}
          onSaved={noop}
        />,
      );
    });
  }

  function setInput(testId: string, value: string) {
    const input = document.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement;
    expect(input).not.toBeNull();
    // 直接赋值 input.value 会走 React 的 value tracker 拦截器导致 change 被去重，
    // 必须用原型上的原生 setter 再派发 input 事件（React Testing Library 同款机制）。
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      valueSetter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function clickSave() {
    const buttons = [...document.querySelectorAll("button")];
    const save = buttons.find(
      (button) => button.textContent === "settings.providers.connection.save",
    );
    expect(save).toBeDefined();
    act(() => save!.click());
  }

  it("prefills fields from daemon config and saves changed token", async () => {
    renderSheet();
    const urlInput = document.querySelector(
      '[data-testid="connection-base-url"]',
    ) as HTMLInputElement;
    expect(urlInput.value).toBe("https://relay.example.com");
    const tokenInput = document.querySelector(
      '[data-testid="connection-auth-token"]',
    ) as HTMLInputElement;
    expect(tokenInput.value).toBe("old-token");
    setInput("connection-auth-token", "new-token");
    clickSave();
    await act(async () => {});

    expect(patchConfigMock).toHaveBeenCalledTimes(1);
    expect(patchConfigMock).toHaveBeenCalledWith({
      providers: {
        "my-relay": {
          label: "My Relay",
          env: {
            ANTHROPIC_BASE_URL: "https://relay.example.com",
            ANTHROPIC_AUTH_TOKEN: "new-token",
            ANTHROPIC_MODEL: "claude-x",
          },
          fetchModels: true,
        },
      },
    });
  });

  it("drops the cleared managed token key but keeps other env keys", async () => {
    renderSheet();
    setInput("connection-auth-token", "");
    clickSave();
    await act(async () => {});

    expect(patchConfigMock).toHaveBeenCalledTimes(1);
    expect(patchConfigMock).toHaveBeenCalledWith({
      providers: {
        "my-relay": {
          label: "My Relay",
          env: {
            ANTHROPIC_BASE_URL: "https://relay.example.com",
            ANTHROPIC_MODEL: "claude-x",
          },
          fetchModels: true,
        },
      },
    });
  });
});
