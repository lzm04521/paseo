import { Fragment, useCallback, useMemo, type ReactElement } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { AgentSessionStats, AgentUsage } from "@getpaseo/protocol/agent-types";
import type { AgentLifecycleStatus } from "@getpaseo/protocol/agent-lifecycle";
import {
  formatSessionCost,
  formatTokenCount,
  getMeterTone,
  type MeterTone,
} from "@/components/context-window-meter.utils";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useSessionStore } from "@/stores/session-store";
import { useStatsPillPreferences, type StatsPillSegmentId } from "@/stores/stats-pill-preferences";
import { composerPillStyles } from "./pill-styles";

export const AGENT_STATS_PILL_TEST_ID = "agent-stats-pill";

/**
 * Segment order, left to right. It is also the truncation priority: the compact pill keeps the
 * first `COMPACT_SEGMENT_COUNT` entries, so a phone shows the two that matter rather than a
 * clipped wide string.
 */
const SEGMENT_ORDER: readonly StatsPillSegmentId[] = [
  "contextPct",
  "cost",
  "contextAbs",
  "tokens",
  "tools",
  "speed",
];

/** How many segments survive on a phone. Two fit next to the composer without crowding it. */
const COMPACT_SEGMENT_COUNT = 2;

/** A finished turn leaves its speed reading on screen; dim it so it does not read as live. */
const DIM_OPACITY = 0.5;

export type AgentStatsTranslate = (key: string, options?: Record<string, unknown>) => string;

export interface AgentStatsPillSegment {
  id: StatsPillSegmentId;
  text: string;
  tone?: MeterTone;
  dimmed?: boolean;
  /** Spelled out, because "42%" and "🔧 24" say nothing out loud. */
  accessibilityLabel: string;
}

export interface BuildAgentStatsPillSegmentsInput {
  stats: AgentSessionStats | undefined;
  lastUsage: AgentUsage | undefined;
  status: AgentLifecycleStatus | null;
  hiddenSegments: readonly StatsPillSegmentId[];
  isCompact: boolean;
  t: AgentStatsTranslate;
}

function readContextWindow(
  lastUsage: AgentUsage | undefined,
): { max: number; used: number } | undefined {
  const max = lastUsage?.contextWindowMaxTokens;
  const used = lastUsage?.contextWindowUsedTokens;
  if (typeof max !== "number" || !Number.isFinite(max) || max <= 0) return undefined;
  if (typeof used !== "number" || !Number.isFinite(used) || used < 0) return undefined;
  return { max, used };
}

function buildContextPctSegment(
  input: BuildAgentStatsPillSegmentsInput,
  contextWindow: { max: number; used: number } | undefined,
): AgentStatsPillSegment | undefined {
  if (!contextWindow) return undefined;
  // Truncate rather than round: a window that is 99.6% full is not 100% full, and the ring
  // beside the pill reads the same number.
  const percent = Math.floor((contextWindow.used / contextWindow.max) * 100);
  return {
    id: "contextPct",
    text: `${percent}%`,
    tone: getMeterTone(percent),
    accessibilityLabel: input.t("agentStats.segments.contextPct", { percent }),
  };
}

function buildContextAbsSegment(
  input: BuildAgentStatsPillSegmentsInput,
  contextWindow: { max: number; used: number } | undefined,
): AgentStatsPillSegment | undefined {
  if (!contextWindow) return undefined;
  const used = formatTokenCount(contextWindow.used);
  const max = formatTokenCount(contextWindow.max);
  return {
    id: "contextAbs",
    text: `${used}/${max}`,
    accessibilityLabel: input.t("agentStats.segments.contextAbs", { used, max }),
  };
}

function buildCostSegment(
  input: BuildAgentStatsPillSegmentsInput,
): AgentStatsPillSegment | undefined {
  const cost = input.stats?.sessionTotalCostUsd;
  if (typeof cost !== "number") return undefined;
  const formatted = formatSessionCost(cost);
  if (formatted === null) return undefined;
  return {
    id: "cost",
    text: formatted,
    accessibilityLabel: input.t("agentStats.segments.cost", { cost: formatted }),
  };
}

function buildTokensSegment(
  input: BuildAgentStatsPillSegmentsInput,
): AgentStatsPillSegment | undefined {
  const inputTokens = input.stats?.sessionInputTokens;
  const outputTokens = input.stats?.sessionOutputTokens;
  if (typeof inputTokens !== "number" && typeof outputTokens !== "number") return undefined;
  const readableInput = formatTokenCount(inputTokens ?? 0);
  const readableOutput = formatTokenCount(outputTokens ?? 0);
  return {
    id: "tokens",
    text: `↑${readableInput} ↓${readableOutput}`,
    accessibilityLabel: input.t("agentStats.segments.tokens", {
      input: readableInput,
      output: readableOutput,
    }),
  };
}

function buildToolsSegment(
  input: BuildAgentStatsPillSegmentsInput,
): AgentStatsPillSegment | undefined {
  const total = input.stats?.toolCallTotal;
  if (typeof total !== "number" || total <= 0) return undefined;
  const errors = input.stats?.toolCallErrors ?? 0;
  const failed = errors > 0;
  return {
    id: "tools",
    text: failed ? `🔧 ${total} (${errors}✕)` : `🔧 ${total}`,
    tone: failed ? "critical" : undefined,
    accessibilityLabel: input.t(
      failed ? "agentStats.segments.toolsWithErrors" : "agentStats.segments.tools",
      { count: total, errors },
    ),
  };
}

function buildSpeedSegment(
  input: BuildAgentStatsPillSegmentsInput,
): AgentStatsPillSegment | undefined {
  const rate = input.stats?.lastGenTokensPerSec;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return undefined;
  const rounded = Math.round(rate);
  return {
    id: "speed",
    text: `${rounded} t/s`,
    dimmed: input.status !== "running",
    accessibilityLabel: input.t("agentStats.segments.speed", { rate: rounded }),
  };
}

export function buildAgentStatsPillSegments(
  input: BuildAgentStatsPillSegmentsInput,
): AgentStatsPillSegment[] {
  const contextWindow = readContextWindow(input.lastUsage);
  const candidates: Record<StatsPillSegmentId, AgentStatsPillSegment | undefined> = {
    contextPct: buildContextPctSegment(input, contextWindow),
    cost: buildCostSegment(input),
    contextAbs: buildContextAbsSegment(input, contextWindow),
    tokens: buildTokensSegment(input),
    tools: buildToolsSegment(input),
    speed: buildSpeedSegment(input),
  };
  const visible = SEGMENT_ORDER.filter((id) => !input.hiddenSegments.includes(id))
    .map((id) => candidates[id])
    .filter((segment): segment is AgentStatsPillSegment => segment !== undefined);
  return input.isCompact ? visible.slice(0, COMPACT_SEGMENT_COUNT) : visible;
}

export interface AgentStatsPillProps {
  serverId: string;
  agentId: string;
}

/**
 * Current-session statistics, always on, next to the composer.
 *
 * The daemon aggregates into an agent snapshot and the app reads it back through the directory, so
 * nothing here subscribes to `stats_updated`: the numbers arrive with the agent row like every
 * other agent field.
 */
export function AgentStatsPill({ serverId, agentId }: AgentStatsPillProps): ReactElement | null {
  // Gated once, on the daemon's advertised capability. An old daemon cannot produce a stats
  // snapshot, and there is no fallback worth rendering in its place.
  const enabled = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.agentSessionStats === true,
  );
  const stats = useSessionStore((state) => state.sessions[serverId]?.agents?.get(agentId)?.stats);
  const lastUsage = useSessionStore(
    (state) => state.sessions[serverId]?.agents?.get(agentId)?.lastUsage,
  );
  const status = useSessionStore(
    (state) => state.sessions[serverId]?.agents?.get(agentId)?.status ?? null,
  );
  const hiddenSegments = useStatsPillPreferences((state) => state.hiddenSegments);
  const isCompact = useIsCompactFormFactor();
  const { t } = useTranslation();

  const segments = useMemo(
    () =>
      buildAgentStatsPillSegments({
        stats,
        lastUsage,
        status,
        hiddenSegments,
        isCompact,
        t: t as AgentStatsTranslate,
      }),
    [stats, lastUsage, status, hiddenSegments, isCompact, t],
  );
  const pillStyle = useCallback((state: PressableStateCallbackType) => {
    // `hovered` is web-only and absent from the native state type, which is fine: on native this
    // reduces to the press state, and the pill has no appearance that depends on hover alone.
    const active = state.pressed || Boolean((state as { hovered?: boolean }).hovered);
    return active
      ? [composerPillStyles.body, composerPillStyles.bodyActive]
      : composerPillStyles.body;
  }, []);

  if (!enabled || segments.length === 0) {
    return null;
  }

  const accessibilityLabel = segments.map((segment) => segment.accessibilityLabel).join(", ");

  return (
    <Pressable
      testID={AGENT_STATS_PILL_TEST_ID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={pillStyle}
    >
      <View style={styles.segments}>
        {segments.map((segment, index) => (
          <Fragment key={segment.id}>
            {index > 0 ? <Text style={composerPillStyles.label}>·</Text> : null}
            <View style={styles.segment} testID={`${AGENT_STATS_PILL_TEST_ID}-segment-${index}`}>
              <Text style={segmentTextStyle(segment)} numberOfLines={1}>
                {segment.text}
              </Text>
            </View>
          </Fragment>
        ))}
      </View>
    </Pressable>
  );
}

function segmentTextStyle(segment: AgentStatsPillSegment) {
  // Read the stylesheet at render time rather than caching colour values at module scope: the
  // persisted theme is applied after first paint, and a cached read keeps the light value.
  let tone: object | null = null;
  if (segment.tone === "critical") {
    tone = styles.critical;
  } else if (segment.tone === "warning") {
    tone = styles.warning;
  } else if (segment.tone === "muted") {
    tone = composerPillStyles.label;
  }
  return [composerPillStyles.label, tone, segment.dimmed ? styles.dimmed : null];
}

const styles = StyleSheet.create((theme) => ({
  segments: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  segment: {
    flexDirection: "row",
    alignItems: "center",
  },
  // The separator is a sibling Text, so it keeps the pill's own colour instead of inheriting the
  // tone of the segment beside it.
  critical: { color: theme.colors.destructive },
  warning: { color: theme.colors.palette.amber[500] },
  dimmed: { opacity: DIM_OPACITY },
}));
