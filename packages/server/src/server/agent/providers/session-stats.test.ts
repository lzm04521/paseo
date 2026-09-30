import { describe, expect, test } from "vitest";

import { createSessionStatsAggregator } from "./session-stats.js";

describe("createSessionStatsAggregator", () => {
  test("accumulates input, cache read, and cache write across requests", () => {
    const aggregator = createSessionStatsAggregator();

    aggregator.recordRequestStart(0);
    aggregator.recordMessageStart(
      { inputTokens: 1_000, cacheReadTokens: 4_000, cacheWriteTokens: 500 },
      0,
    );
    aggregator.recordRequestStart(10_000);
    aggregator.recordMessageStart({ inputTokens: 200, cacheReadTokens: 800 }, 10_000);

    const stats = aggregator.snapshot();

    expect(stats.sessionInputTokens).toBe(6_500);
    expect(stats.sessionCachedInputTokens).toBe(4_800);
    expect(stats.sessionCacheWriteTokens).toBe(500);
    expect(stats.requestCount).toBe(2);
    expect(stats.cacheHitRate).toBeCloseTo(4_800 / 6_500);
  });

  test("treats message deltas as the running output total for the request", () => {
    const aggregator = createSessionStatsAggregator();

    aggregator.recordRequestStart(0);
    aggregator.recordMessageStart({ inputTokens: 10 }, 0);
    aggregator.recordMessageDelta(50, 100);
    aggregator.recordMessageDelta(120, 200);
    // Repeated cumulative values must not be counted twice.
    aggregator.recordMessageDelta(120, 300);

    expect(aggregator.snapshot().sessionOutputTokens).toBe(120);

    aggregator.recordRequestStart(1_000);
    aggregator.recordMessageStart({ inputTokens: 10 }, 1_000);
    aggregator.recordMessageDelta(30, 1_100);

    expect(aggregator.snapshot().sessionOutputTokens).toBe(150);
  });

  test("reports last-request speed and latency from recorded timestamps", () => {
    const aggregator = createSessionStatsAggregator();

    aggregator.recordRequestStart(1_000);
    aggregator.recordMessageStart({ inputTokens: 10 }, 1_000);
    aggregator.recordFirstAssistantToken(1_400);
    aggregator.recordMessageDelta(300, 2_000);
    aggregator.recordMessageComplete(3_400);

    const stats = aggregator.snapshot();

    expect(stats.lastFirstTokenLatencyMs).toBe(400);
    expect(stats.lastRequestDurationMs).toBe(2_400);
    expect(stats.lastGenTokensPerSec).toBeCloseTo(150);
  });

  test("falls back to the message-start clock when no request start was recorded", () => {
    const aggregator = createSessionStatsAggregator();

    aggregator.recordMessageStart({ inputTokens: 10 }, 5_000);
    aggregator.recordFirstAssistantToken(5_250);
    aggregator.recordMessageComplete(6_000);

    const stats = aggregator.snapshot();

    expect(stats.lastFirstTokenLatencyMs).toBe(250);
    expect(stats.lastRequestDurationMs).toBe(1_000);
  });

  test("measures each request against that request's own start", () => {
    const aggregator = createSessionStatsAggregator();

    aggregator.recordMessageStart({ inputTokens: 10 }, 1_000);
    aggregator.recordFirstAssistantToken(1_400);
    aggregator.recordMessageDelta(300, 2_000);
    aggregator.recordMessageComplete(3_400);
    expect(aggregator.snapshot().lastRequestDurationMs).toBe(2_400);

    // The session kept running for five minutes before the next request. That gap belongs to the
    // session, not to this request.
    aggregator.recordMessageStart({ inputTokens: 10 }, 300_000);
    aggregator.recordFirstAssistantToken(300_400);
    aggregator.recordMessageDelta(50, 300_500);
    aggregator.recordMessageComplete(301_000);

    expect(aggregator.snapshot().lastFirstTokenLatencyMs).toBe(400);
    expect(aggregator.snapshot().lastRequestDurationMs).toBe(1_000);
  });

  test("prefers an explicitly recorded request start over the message-start clock", () => {
    const aggregator = createSessionStatsAggregator();

    aggregator.recordRequestStart(900);
    aggregator.recordMessageStart({ inputTokens: 10 }, 1_000);
    aggregator.recordMessageComplete(1_900);

    expect(aggregator.snapshot().lastRequestDurationMs).toBe(1_000);
  });

  test("reports turn count and duration", () => {
    const aggregator = createSessionStatsAggregator();

    aggregator.recordTurnStarted(5_000);
    aggregator.recordTurnCompleted(11_500);
    aggregator.recordTurnStarted(20_000);
    aggregator.recordTurnCompleted(21_000);

    const stats = aggregator.snapshot();

    expect(stats.turnCount).toBe(2);
    expect(stats.lastTurnDurationMs).toBe(1_000);
  });

  test("omits timing fields that were never observed", () => {
    const aggregator = createSessionStatsAggregator();

    aggregator.recordMessageComplete(1_000);
    const stats = aggregator.snapshot();

    expect(stats.lastRequestDurationMs).toBeUndefined();
    expect(stats.lastFirstTokenLatencyMs).toBeUndefined();
    expect(stats.lastGenTokensPerSec).toBeUndefined();
    expect(stats.lastTurnDurationMs).toBeUndefined();
    expect(stats).toEqual({});
  });

  test("omits speed when the request produced no output", () => {
    const aggregator = createSessionStatsAggregator();

    aggregator.recordRequestStart(0);
    aggregator.recordMessageStart({ inputTokens: 10 }, 0);
    aggregator.recordFirstAssistantToken(100);
    aggregator.recordMessageComplete(200);

    const stats = aggregator.snapshot();

    expect(stats.lastFirstTokenLatencyMs).toBe(100);
    expect(stats.lastGenTokensPerSec).toBeUndefined();
  });

  test("counts tool calls and errors per tool name", () => {
    const aggregator = createSessionStatsAggregator();

    aggregator.recordToolUse("Bash");
    aggregator.recordToolUse("Bash");
    aggregator.recordToolUse("Read");
    aggregator.recordToolResult("Bash", false);
    aggregator.recordToolResult("Bash", true);

    const stats = aggregator.snapshot();

    expect(stats.toolCallTotal).toBe(3);
    expect(stats.toolCallErrors).toBe(1);
    expect(stats.toolCalls).toEqual([
      { tool: "Bash", count: 2, errors: 1 },
      { tool: "Read", count: 1, errors: 0 },
    ]);
  });

  test("keeps the ten busiest tools in descending order", () => {
    const aggregator = createSessionStatsAggregator();

    for (let index = 0; index < 12; index += 1) {
      for (let call = 0; call <= index; call += 1) {
        aggregator.recordToolUse(`Tool${index}`);
      }
    }

    const stats = aggregator.snapshot();

    expect(stats.toolCalls).toHaveLength(10);
    expect(stats.toolCalls?.[0]).toEqual({ tool: "Tool11", count: 12, errors: 0 });
    expect(stats.toolCalls?.at(-1)).toEqual({ tool: "Tool2", count: 3, errors: 0 });
  });

  test("replaces a subagent entry with the same id and caps the list at fifty", () => {
    const aggregator = createSessionStatsAggregator();

    aggregator.upsertSubagent({
      agentId: "agent-a",
      label: "Explore",
      inputTokens: 10,
      running: true,
    });
    aggregator.upsertSubagent({ agentId: "agent-a", outputTokens: 5, running: false });

    expect(aggregator.snapshot().subagents).toEqual([
      { agentId: "agent-a", outputTokens: 5, running: false },
    ]);

    for (let index = 0; index < 60; index += 1) {
      aggregator.upsertSubagent({ agentId: `sub-${index}`, running: true });
    }

    const subagents = aggregator.snapshot().subagents;
    expect(subagents).toHaveLength(50);
    expect(subagents?.at(-1)?.agentId).toBe("sub-59");
    expect(subagents?.some((entry) => entry.agentId === "sub-1")).toBe(false);
  });

  test("keeps the latest provider-reported session cost", () => {
    const aggregator = createSessionStatsAggregator();

    aggregator.recordResultUsage({ totalCostUsd: 1.23 });
    aggregator.recordResultUsage({ totalCostUsd: 2.5 });
    // Non-finite provider numbers must not clobber a good reading.
    aggregator.recordResultUsage({ totalCostUsd: Number.NaN });
    aggregator.recordResultUsage({});

    expect(aggregator.snapshot().sessionTotalCostUsd).toBe(2.5);
  });

  test("returns a detached copy on every snapshot", () => {
    const aggregator = createSessionStatsAggregator();

    aggregator.recordToolUse("Bash");
    const first = aggregator.snapshot();
    first.toolCalls?.push({ tool: "Injected", count: 99, errors: 0 });
    aggregator.recordToolUse("Read");

    expect(aggregator.snapshot().toolCalls).toEqual([
      { tool: "Bash", count: 1, errors: 0 },
      { tool: "Read", count: 1, errors: 0 },
    ]);
  });
});
