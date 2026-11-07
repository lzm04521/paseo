import equal from "fast-deep-equal";
import type { AgentSessionStats, AgentUsage } from "@getpaseo/protocol/agent-types";

interface AgentUpdateValue {
  updatedAt: Date | string;
  lastUsage?: AgentUsage;
  stats?: AgentSessionStats;
}

function timestamp(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

export function acceptAgentDirectoryUpdate<T extends AgentUpdateValue>(
  current: T | undefined,
  incoming: T,
): T {
  if (!current || timestamp(incoming.updatedAt) >= timestamp(current.updatedAt)) return incoming;
  // Usage and stats ride a directory row that may be older than the row already held: they are
  // pushed on their own cadence, so a stale row still carries fresher telemetry than the page
  // snapshot it loses to.
  let merged = current;
  if (incoming.lastUsage !== undefined && !equal(incoming.lastUsage, current.lastUsage)) {
    merged = { ...merged, lastUsage: incoming.lastUsage };
  }
  if (incoming.stats !== undefined && !equal(incoming.stats, current.stats)) {
    merged = { ...merged, stats: incoming.stats };
  }
  return merged;
}
