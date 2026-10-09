import { AGENT_PROVIDER_NOTICE_CODES } from "@getpaseo/protocol/agent-types";
import type { AgentProviderNotice } from "./agent-sdk-types.js";

// `message` is the English fallback for clients that don't recognize `code`.
export const MODE_APPLIES_NEXT_TURN_NOTICE: AgentProviderNotice = {
  type: "warning",
  message: "Permission mode applies next turn",
  code: AGENT_PROVIDER_NOTICE_CODES.modeAppliesNextTurn,
};

export const THINKING_APPLIES_NEXT_TURN_NOTICE: AgentProviderNotice = {
  type: "warning",
  message: "Thinking level applies next turn",
  code: AGENT_PROVIDER_NOTICE_CODES.thinkingAppliesNextTurn,
};
