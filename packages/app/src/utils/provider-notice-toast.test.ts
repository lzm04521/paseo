import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_PROVIDER_NOTICE_CODES } from "@getpaseo/protocol/agent-types";
import { i18n } from "@/i18n/i18next";
import type { ToastApi } from "@/components/toast-host";
import { NOTICE_MESSAGE_KEYS, showProviderNoticeToast } from "./provider-notice-toast";

interface RecordingToast extends ToastApi {
  show: ReturnType<typeof vi.fn<ToastApi["show"]>>;
  error: ReturnType<typeof vi.fn<ToastApi["error"]>>;
}

function createToast(): RecordingToast {
  return {
    show: vi.fn<ToastApi["show"]>(),
    copied: vi.fn<ToastApi["copied"]>(),
    error: vi.fn<ToastApi["error"]>(),
  };
}

const SUPPORTED_LOCALES = ["ar", "es", "fr", "ja", "ko", "pt-BR", "ru", "zh-CN"] as const;

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("showProviderNoticeToast", () => {
  it("renders the English message for a notice the daemon sends without a code", () => {
    const toast = createToast();

    showProviderNoticeToast(toast, { type: "warning", message: "Something happened" });

    expect(toast.show).toHaveBeenCalledWith("Something happened", {
      variant: "warning",
      durationMs: 5000,
    });
  });

  it("translates a recognized notice code instead of showing the daemon message", () => {
    const toast = createToast();

    showProviderNoticeToast(toast, {
      type: "warning",
      message: "Thinking level applies next turn",
      code: "thinking_applies_next_turn",
    });

    expect(toast.show).toHaveBeenCalledWith("Thinking level applies next turn", {
      variant: "warning",
      durationMs: 5000,
    });
  });

  it("renders the active language for a recognized notice code", async () => {
    await i18n.changeLanguage("zh-CN");
    const toast = createToast();

    showProviderNoticeToast(toast, {
      type: "warning",
      message: "Permission mode applies next turn",
      code: "mode_applies_next_turn",
    });

    expect(toast.show).toHaveBeenCalledWith("权限模式将在下一轮生效", {
      variant: "warning",
      durationMs: 5000,
    });
  });

  it("falls back to the daemon message for an unrecognized notice code", () => {
    const toast = createToast();

    showProviderNoticeToast(toast, {
      type: "warning",
      message: "Some future notice",
      code: "invented_next_version",
    });

    expect(toast.show).toHaveBeenCalledWith("Some future notice", {
      variant: "warning",
      durationMs: 5000,
    });
  });

  it("routes error notices through the error toast with translated text", async () => {
    await i18n.changeLanguage("zh-CN");
    const toast = createToast();

    showProviderNoticeToast(toast, {
      type: "error",
      message: "Thinking level applies next turn",
      code: "thinking_applies_next_turn",
    });

    expect(toast.error).toHaveBeenCalledWith("思考级别将在下一轮生效");
    expect(toast.show).not.toHaveBeenCalled();
  });

  it("ignores a missing notice", () => {
    const toast = createToast();

    showProviderNoticeToast(toast, null);
    showProviderNoticeToast(toast, undefined);

    expect(toast.show).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("keeps every daemon code mapped to a translation key", () => {
    // A code the daemon can send with no entry here would show the English fallback.
    expect(Object.keys(NOTICE_MESSAGE_KEYS).sort()).toEqual(
      Object.values(AGENT_PROVIDER_NOTICE_CODES).sort(),
    );
  });

  it("shows localized text for every mapped code in every supported locale", async () => {
    for (const [code, key] of Object.entries(NOTICE_MESSAGE_KEYS)) {
      const english = i18n.getFixedT("en")(key);
      expect(english, `${key} missing in en`).not.toBe(key);

      for (const lng of SUPPORTED_LOCALES) {
        const toast = createToast();
        await i18n.changeLanguage(lng);
        showProviderNoticeToast(toast, { type: "warning", message: english, code });

        const [shown] = toast.show.mock.calls[0] ?? [];
        // An untranslated copy renders English; a missing key renders the key path.
        expect(shown, `${code} in ${lng}`).not.toBe(english);
        expect(shown, `${code} in ${lng}`).not.toBe(key);
      }
    }
  });
});
