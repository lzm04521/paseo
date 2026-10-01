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
  /**
   * Per-request input-side totals seen later on the wire, for gateways that cannot know prompt
   * tokens when the stream opens: OpenAI→Anthropic converters emit `message_start` with zeroed
   * usage and repeat the real numbers on `message_delta`. Absent fields keep the request's
   * current reading, so a compliant stream (input only in `message_start`) and repeated deltas
   * are both no-ops.
   */
  reconcileStreamUsage(usage: {
    inputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  }): void;
  recordFirstAssistantToken(at: number): void;
  recordMessageComplete(at: number): void;
  /**
   * Optional: providers that cannot observe the outbound request use `recordMessageStart`'s clock
   * instead, which is what the daemon sees anyway. The time supplied here only anchors the next
   * `message_start`; a request that never reaches the wire (client-side slash command) leaves the
   * last request's timing untouched.
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
  /** Set by {@link SessionStatsAggregator.recordRequestStart}, consumed by the next message start. */
  let pendingRequestStartedAt: number | undefined;
  /** Whether a `message_start` was observed since the anchor — a result without one had no request. */
  let streamRequestObserved = false;
  let firstAssistantTokenAt: number | undefined;
  let currentRequestOutputTokens = 0;
  /** Input-side components already counted into the session totals for the request in flight. */
  let currentRequestInputTokens = 0;
  let currentRequestCacheReadTokens = 0;
  let currentRequestCacheWriteTokens = 0;
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
      // Each request gets its own clock. Seeding it only once would measure every later request
      // against the first one, i.e. against the age of the session.
      requestStartedAt = pendingRequestStartedAt ?? at;
      pendingRequestStartedAt = undefined;
      streamRequestObserved = true;
      firstAssistantTokenAt = undefined;
      currentRequestOutputTokens = 0;
      requestCount += 1;
      currentRequestInputTokens = usage.inputTokens;
      currentRequestCacheReadTokens = usage.cacheReadTokens ?? 0;
      currentRequestCacheWriteTokens = usage.cacheWriteTokens ?? 0;
      sessionInputTokens +=
        currentRequestInputTokens + currentRequestCacheReadTokens + currentRequestCacheWriteTokens;
      sessionCachedInputTokens += currentRequestCacheReadTokens;
      sessionCacheWriteTokens += currentRequestCacheWriteTokens;
    },

    recordMessageDelta(outputTokens) {
      const delta = outputTokens - currentRequestOutputTokens;
      if (delta > 0) {
        sessionOutputTokens += delta;
      }
      currentRequestOutputTokens = Math.max(currentRequestOutputTokens, outputTokens);
    },

    reconcileStreamUsage(usage) {
      const inputGrowth = Math.max(
        0,
        (usage.inputTokens ?? currentRequestInputTokens) - currentRequestInputTokens,
      );
      const cacheReadGrowth = Math.max(
        0,
        (usage.cacheReadTokens ?? currentRequestCacheReadTokens) - currentRequestCacheReadTokens,
      );
      const cacheWriteGrowth = Math.max(
        0,
        (usage.cacheWriteTokens ?? currentRequestCacheWriteTokens) - currentRequestCacheWriteTokens,
      );
      if (inputGrowth === 0 && cacheReadGrowth === 0 && cacheWriteGrowth === 0) {
        return;
      }
      sessionInputTokens += inputGrowth + cacheReadGrowth + cacheWriteGrowth;
      sessionCachedInputTokens += cacheReadGrowth;
      sessionCacheWriteTokens += cacheWriteGrowth;
      currentRequestInputTokens += inputGrowth;
      currentRequestCacheReadTokens += cacheReadGrowth;
      currentRequestCacheWriteTokens += cacheWriteGrowth;
    },

    recordFirstAssistantToken(at) {
      firstAssistantTokenAt ??= at;
    },

    recordMessageComplete(at) {
      // A result without any streamed request (client-side slash command) must not overwrite the
      // last real request's timing.
      if (!streamRequestObserved) {
        return;
      }
      streamRequestObserved = false;
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
      pendingRequestStartedAt = at;
      streamRequestObserved = false;
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
      // A turn that never reached the wire (client-side slash command) must not lend its submit
      // time to the next turn's first request.
      pendingRequestStartedAt = undefined;
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
