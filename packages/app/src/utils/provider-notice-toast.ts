import {
  AGENT_PROVIDER_NOTICE_CODES,
  type AgentProviderNotice,
} from "@getpaseo/protocol/agent-types";
import type { ToastApi } from "@/components/toast-host";
import { i18n } from "@/i18n/i18next";

/**
 * Translated text keyed by the notice `code` the daemon sends. A daemon newer than this
 * client may send a code with no entry here; the caller falls back to `notice.message`.
 */
export const NOTICE_MESSAGE_KEYS: Record<string, string> = {
  [AGENT_PROVIDER_NOTICE_CODES.modeAppliesNextTurn]: "agentControls.notices.modeAppliesNextTurn",
  [AGENT_PROVIDER_NOTICE_CODES.thinkingAppliesNextTurn]:
    "agentControls.notices.thinkingAppliesNextTurn",
};

function resolveNoticeMessage(notice: AgentProviderNotice): string {
  const key = notice.code ? NOTICE_MESSAGE_KEYS[notice.code] : undefined;
  return key ? i18n.t(key) : notice.message;
}

export function showProviderNoticeToast(
  toast: ToastApi,
  notice: AgentProviderNotice | null | undefined,
): void {
  if (!notice) {
    return;
  }
  const message = resolveNoticeMessage(notice);
  if (notice.type === "error") {
    toast.error(message);
    return;
  }
  toast.show(message, {
    variant: notice.type,
    durationMs: notice.type === "warning" ? 5000 : undefined,
  });
}
