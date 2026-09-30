import type {
  AgentSessionStats,
  AgentSubagentUsageStat,
  AgentToolCallStat,
} from "../agent-sdk-types.js";

const MAX_TOOL_CALLS = 10;
const MAX_SUBAGENTS = 50;

export interface SessionStatsAggregator {
  /**
   * Cumulative output tokens for the request in flight. `message_delta` carries
   * the running total for the message, not an increment, so the aggregator keeps
   * the last value and adds only the difference.
   */
  recordMessageStart(
    usage: { inputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number },
    at: number,
  ): void;
  recordMessageDelta(outputTokens: number, at: number): void;
  recordFirstAssistantToken(at: number): void;
  recordMessageComplete(at: number): void;
  /**
   * Optional: providers that cannot observe the outbound request use
   * `recordMessageStart`'s clock instead, which is what the daemon sees anyway.
   */
  recordRequestStart(at: number): void;
  /**
   * `totalCostUsd` is the only session-cumulative field the SDK result carries:
   * `SDKResultMessage.usage` is per-turn and main-loop-only, so its token
   * counters are deliberately not accepted here.
   */
  recordResultUsage(usage: { totalCostUsd?: number }): void;
  recordTurnStarted(at: number): void;
  recordTurnCompleted(at: number): void;
  recordToolUse(tool: string): void;
  recordToolResult(tool: string, isError: boolean): void;
  upsertSubagent(stat: AgentSubagentUsageStat): void;
  snapshot(): AgentSessionStats;
}

function isNonNegativeFinite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Detached copy, so callers cannot mutate the aggregator through a snapshot. */
function copySubagent(entry: AgentSubagentUsageStat): AgentSubagentUsageStat {
  const copy: AgentSubagentUsageStat = { agentId: entry.agentId, running: entry.running };
  if (entry.label !== undefined) {
    copy.label = entry.label;
  }
  if (entry.inputTokens !== undefined) {
    copy.inputTokens = entry.inputTokens;
  }
  if (entry.outputTokens !== undefined) {
    copy.outputTokens = entry.outputTokens;
  }
  return copy;
}

export function createSessionStatsAggregator(): SessionStatsAggregator {
  let sessionInputTokens = 0;
  let sessionCachedInputTokens = 0;
  let sessionOutputTokens = 0;
  let sessionCacheWriteTokens = 0;
  let requestCount = 0;
  let turnCount = 0;
  let sessionTotalCostUsd: number | undefined;

  let requestStartedAt: number | undefined;
  let firstAssistantTokenAt: number | undefined;
  let currentRequestOutputTokens = 0;
  let turnStartedAt: number | undefined;

  let lastGenTokensPerSec: number | undefined;
  let lastFirstTokenLatencyMs: number | undefined;
  let lastRequestDurationMs: number | undefined;
  let lastTurnDurationMs: number | undefined;

  const toolCalls = new Map<string, AgentToolCallStat>();
  const subagents = new Map<string, AgentSubagentUsageStat>();

  function recordTool(tool: string): AgentToolCallStat {
    const existing = toolCalls.get(tool);
    if (existing) {
      return existing;
    }
    const created: AgentToolCallStat = { tool, count: 0, errors: 0 };
    toolCalls.set(tool, created);
    return created;
  }

  return {
    recordMessageStart(usage, at) {
      requestStartedAt ??= at;
      firstAssistantTokenAt = undefined;
      currentRequestOutputTokens = 0;
      requestCount += 1;
      sessionInputTokens +=
        usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
      sessionCachedInputTokens += usage.cacheReadTokens ?? 0;
      sessionCacheWriteTokens += usage.cacheWriteTokens ?? 0;
    },

    recordMessageDelta(outputTokens) {
      const delta = outputTokens - currentRequestOutputTokens;
      if (delta > 0) {
        sessionOutputTokens += delta;
      }
      currentRequestOutputTokens = Math.max(currentRequestOutputTokens, outputTokens);
    },

    recordFirstAssistantToken(at) {
      firstAssistantTokenAt ??= at;
    },

    recordMessageComplete(at) {
      lastFirstTokenLatencyMs = undefined;
      lastRequestDurationMs = undefined;
      lastGenTokensPerSec = undefined;

      if (requestStartedAt !== undefined && at >= requestStartedAt) {
        lastRequestDurationMs = at - requestStartedAt;
      }
      if (
        firstAssistantTokenAt !== undefined &&
        requestStartedAt !== undefined &&
        firstAssistantTokenAt >= requestStartedAt
      ) {
        lastFirstTokenLatencyMs = firstAssistantTokenAt - requestStartedAt;
      }
      if (
        firstAssistantTokenAt !== undefined &&
        at > firstAssistantTokenAt &&
        currentRequestOutputTokens > 0
      ) {
        lastGenTokensPerSec = currentRequestOutputTokens / ((at - firstAssistantTokenAt) / 1_000);
      }
    },

    recordRequestStart(at) {
      requestStartedAt = at;
      firstAssistantTokenAt = undefined;
      currentRequestOutputTokens = 0;
    },

    recordResultUsage(usage) {
      if (isNonNegativeFinite(usage.totalCostUsd)) {
        sessionTotalCostUsd = usage.totalCostUsd;
      }
    },

    recordTurnStarted(at) {
      turnStartedAt = at;
    },

    recordTurnCompleted(at) {
      turnCount += 1;
      lastTurnDurationMs =
        turnStartedAt !== undefined && at >= turnStartedAt ? at - turnStartedAt : undefined;
      turnStartedAt = undefined;
    },

    recordToolUse(tool) {
      recordTool(tool).count += 1;
    },

    recordToolResult(tool, isError) {
      if (isError) {
        recordTool(tool).errors += 1;
      }
    },

    upsertSubagent(stat) {
      // Re-inserting moves the entry to the end of the map, so eviction below
      // drops the subagent that has gone longest without an update.
      subagents.delete(stat.agentId);
      subagents.set(stat.agentId, { ...stat });
    },

    snapshot() {
      const stats: AgentSessionStats = {};

      if (requestCount > 0) {
        stats.sessionInputTokens = sessionInputTokens;
        stats.sessionCachedInputTokens = sessionCachedInputTokens;
        stats.sessionOutputTokens = sessionOutputTokens;
        stats.sessionCacheWriteTokens = sessionCacheWriteTokens;
        stats.requestCount = requestCount;
        if (sessionInputTokens > 0) {
          stats.cacheHitRate = sessionCachedInputTokens / sessionInputTokens;
        }
      }
      if (turnCount > 0) {
        stats.turnCount = turnCount;
      }
      if (sessionTotalCostUsd !== undefined) {
        stats.sessionTotalCostUsd = sessionTotalCostUsd;
      }
      if (lastGenTokensPerSec !== undefined) {
        stats.lastGenTokensPerSec = lastGenTokensPerSec;
      }
      if (lastFirstTokenLatencyMs !== undefined) {
        stats.lastFirstTokenLatencyMs = lastFirstTokenLatencyMs;
      }
      if (lastRequestDurationMs !== undefined) {
        stats.lastRequestDurationMs = lastRequestDurationMs;
      }
      if (lastTurnDurationMs !== undefined) {
        stats.lastTurnDurationMs = lastTurnDurationMs;
      }
      if (toolCalls.size > 0) {
        const ordered = [...toolCalls.values()].sort((left, right) => right.count - left.count);
        const toolCallTotal = ordered.reduce((total, entry) => total + entry.count, 0);
        stats.toolCallTotal = toolCallTotal;
        stats.toolCallErrors = ordered.reduce((total, entry) => total + entry.errors, 0);
        stats.toolCalls = ordered
          .slice(0, MAX_TOOL_CALLS)
          .map((entry) => ({ tool: entry.tool, count: entry.count, errors: entry.errors }));
      }
      if (subagents.size > 0) {
        stats.subagents = [...subagents.values()].slice(-MAX_SUBAGENTS).map(copySubagent);
      }

      return stats;
    },
  };
}
