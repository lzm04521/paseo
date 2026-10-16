/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { patchConfigMock } = vi.hoisted(() => ({
  patchConfigMock: vi.fn(async () => undefined),
}));

vi.mock("@/hooks/use-daemon-config", () => ({
  useDaemonConfig: () => ({ config: null, patchConfig: patchConfigMock }),
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
  AdaptiveTextInput: ({
    onChangeText,
    placeholder,
    testID,
  }: {
    onChangeText?: (text: string) => void;
    placeholder?: string;
    testID?: string;
  }) =>
    React.createElement("input", {
      "data-testid": testID,
      placeholder,
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

import { AddCustomProviderSheet } from "./add-custom-provider-sheet";

const noop = () => {};

describe("AddCustomProviderSheet", () => {
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
        <AddCustomProviderSheet
          serverId="local"
          visible={true}
          onClose={noop}
          existingProviderIds={["claude", "codex"]}
          onAdded={noop}
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
      (button) => button.textContent === "settings.providers.addCustom.save",
    );
    expect(save).toBeDefined();
    act(() => save!.click());
  }

  it("patches config with only non-empty env values and fetchModels flag", async () => {
    renderSheet();
    setInput("add-provider-id", "my-relay");
    setInput("add-provider-label", "My Relay");
    setInput("add-provider-base-url", "https://relay.example.com");
    // token 留空、apiKey 留空：env 只应包含 baseUrl
    clickSave();
    await act(async () => {});

    expect(patchConfigMock).toHaveBeenCalledTimes(1);
    expect(patchConfigMock).toHaveBeenCalledWith({
      providers: {
        "my-relay": {
          extends: "claude",
          label: "My Relay",
          env: { ANTHROPIC_BASE_URL: "https://relay.example.com" },
          fetchModels: true,
        },
      },
    });
  });

  it("blocks invalid provider id", async () => {
    renderSheet();
    setInput("add-provider-id", "My_Relay");
    setInput("add-provider-label", "My Relay");
    clickSave();
    await act(async () => {});
    expect(patchConfigMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("settings.providers.addCustom.providerIdInvalid");
  });

  it("blocks duplicate provider id", async () => {
    renderSheet();
    setInput("add-provider-id", "claude");
    setInput("add-provider-label", "X");
    clickSave();
    await act(async () => {});
    expect(patchConfigMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("settings.providers.addCustom.providerIdExists");
  });
});
