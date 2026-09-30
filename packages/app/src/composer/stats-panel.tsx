import { useCallback, useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { AgentSessionStats, AgentUsage } from "@getpaseo/protocol/agent-types";
import {
  MenuItem,
  MenuSeparator,
  MenuSubTrigger,
  type MenuPageDefinition,
} from "@/components/ui/menu";
import {
  formatSessionCost,
  formatTokenCount,
  getMeterTone,
  type MeterTone,
} from "@/components/context-window-meter.utils";
import { useSessionStore } from "@/stores/session-store";
import {
  STATS_PILL_SEGMENT_IDS,
  useStatsPillPreferences,
  type StatsPillSegmentId,
} from "@/stores/stats-pill-preferences";

export interface AgentStatsPanelRow {
  id: string;
  label: string;
  value: string;
}

export interface AgentStatsPanelSection {
  id: string;
  title: string;
  rows: AgentStatsPanelRow[];
}

export interface AgentStatsPanelModel {
  kpis: AgentStatsPanelRow[];
  progress: { percent: number; tone: MeterTone } | null;
  sections: AgentStatsPanelSection[];
}

export type AgentStatsPanelTranslate = (key: string, options?: Record<string, unknown>) => string;

export interface BuildAgentStatsPanelModelInput {
  stats: AgentSessionStats | undefined;
  lastUsage: AgentUsage | undefined;
  t: AgentStatsPanelTranslate;
}

const SEGMENT_LABEL_KEYS: Record<StatsPillSegmentId, string> = {
  contextPct: "agentStats.panel.segments.contextPct",
  cost: "agentStats.panel.segments.cost",
  contextAbs: "agentStats.panel.segments.contextAbs",
  tokens: "agentStats.panel.segments.tokens",
  tools: "agentStats.panel.segments.tools",
  speed: "agentStats.panel.segments.speed",
};

function formatDuration(ms: number): string {
  if (ms < 1_000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1_000).toFixed(1)}s`;
}

function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function buildKpis(input: BuildAgentStatsPanelModelInput): {
  kpis: AgentStatsPanelRow[];
  progress: { percent: number; tone: MeterTone } | null;
} {
  const kpis: AgentStatsPanelRow[] = [];
  let progress: { percent: number; tone: MeterTone } | null = null;

  const max = input.lastUsage?.contextWindowMaxTokens;
  const used = input.lastUsage?.contextWindowUsedTokens;
  if (
    typeof max === "number" &&
    Number.isFinite(max) &&
    max > 0 &&
    typeof used === "number" &&
    Number.isFinite(used) &&
    used >= 0
  ) {
    const percent = Math.floor((used / max) * 100);
    progress = { percent, tone: getMeterTone(percent) };
    kpis.push({
      id: "context",
      label: input.t("agentStats.panel.kpi.context"),
      value: `${percent}%`,
    });
  }

  const rate = input.stats?.lastGenTokensPerSec;
  if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
    kpis.push({
      id: "speed",
      label: input.t("agentStats.panel.kpi.speed"),
      value: `${Math.round(rate)} t/s`,
    });
  }

  const cacheHitRate = input.stats?.cacheHitRate;
  if (typeof cacheHitRate === "number" && Number.isFinite(cacheHitRate)) {
    kpis.push({
      id: "cacheHitRate",
      label: input.t("agentStats.panel.kpi.cacheHitRate"),
      value: formatPercent(cacheHitRate),
    });
  }

  const cost = input.stats?.sessionTotalCostUsd;
  if (typeof cost === "number") {
    const formatted = formatSessionCost(cost);
    if (formatted !== null) {
      kpis.push({ id: "cost", label: input.t("agentStats.panel.kpi.cost"), value: formatted });
    }
  }

  return { kpis, progress };
}

function buildTotalsSection(input: BuildAgentStatsPanelModelInput): AgentStatsPanelSection | null {
  const stats = input.stats;
  if (!stats) return null;
  const rows: AgentStatsPanelRow[] = [];
  const addTokens = (id: string, labelKey: string, value: number | undefined) => {
    if (typeof value !== "number") return;
    rows.push({ id, label: input.t(labelKey), value: formatTokenCount(value) });
  };
  addTokens("inputTokens", "agentStats.panel.rows.inputTokens", stats.sessionInputTokens);
  addTokens(
    "cachedInputTokens",
    "agentStats.panel.rows.cachedInputTokens",
    stats.sessionCachedInputTokens,
  );
  addTokens(
    "cacheWriteTokens",
    "agentStats.panel.rows.cacheWriteTokens",
    stats.sessionCacheWriteTokens,
  );
  addTokens("outputTokens", "agentStats.panel.rows.outputTokens", stats.sessionOutputTokens);
  if (typeof stats.sessionTotalCostUsd === "number") {
    const formatted = formatSessionCost(stats.sessionTotalCostUsd);
    if (formatted !== null) {
      rows.push({ id: "cost", label: input.t("agentStats.panel.rows.cost"), value: formatted });
    }
  }
  const parts: string[] = [];
  if (typeof stats.requestCount === "number") parts.push(String(stats.requestCount));
  if (typeof stats.turnCount === "number") parts.push(String(stats.turnCount));
  if (parts.length > 0) {
    rows.push({
      id: "requestsAndTurns",
      label: input.t("agentStats.panel.rows.requestsAndTurns"),
      value: parts.join(" · "),
    });
  }
  if (rows.length === 0) return null;
  return { id: "totals", title: input.t("agentStats.panel.sections.totals"), rows };
}

function buildTimingSection(input: BuildAgentStatsPanelModelInput): AgentStatsPanelSection | null {
  const stats = input.stats;
  if (!stats) return null;
  const rows: AgentStatsPanelRow[] = [];
  const addDuration = (id: string, labelKey: string, value: number | undefined) => {
    if (typeof value !== "number") return;
    rows.push({ id, label: input.t(labelKey), value: formatDuration(value) });
  };
  addDuration(
    "firstTokenLatency",
    "agentStats.panel.rows.firstTokenLatency",
    stats.lastFirstTokenLatencyMs,
  );
  addDuration(
    "requestDuration",
    "agentStats.panel.rows.requestDuration",
    stats.lastRequestDurationMs,
  );
  addDuration("turnDuration", "agentStats.panel.rows.turnDuration", stats.lastTurnDurationMs);
  if (rows.length === 0) return null;
  return { id: "timing", title: input.t("agentStats.panel.sections.timing"), rows };
}

function buildToolsSection(input: BuildAgentStatsPanelModelInput): AgentStatsPanelSection | null {
  const stats = input.stats;
  if (!stats) return null;
  const rows: AgentStatsPanelRow[] = [];
  if (typeof stats.toolCallTotal === "number") {
    rows.push({
      id: "toolCallTotal",
      label: input.t("agentStats.panel.rows.toolCallTotal"),
      value: String(stats.toolCallTotal),
    });
  }
  if (typeof stats.toolCallErrors === "number" && stats.toolCallErrors > 0) {
    rows.push({
      id: "toolCallErrors",
      label: input.t("agentStats.panel.rows.toolCallErrors"),
      value: String(stats.toolCallErrors),
    });
  }
  for (const call of stats.toolCalls ?? []) {
    rows.push({
      id: `tool.${call.tool}`,
      label: call.tool,
      value: call.errors > 0 ? `${call.count} (${call.errors}✕)` : String(call.count),
    });
  }
  if (rows.length === 0) return null;
  return { id: "tools", title: input.t("agentStats.panel.sections.tools"), rows };
}

function buildSubagentsSection(
  input: BuildAgentStatsPanelModelInput,
): AgentStatsPanelSection | null {
  const subagents = input.stats?.subagents;
  if (!subagents || subagents.length === 0) return null;
  const rows: AgentStatsPanelRow[] = subagents.map((subagent) => {
    const parts: string[] = [];
    if (typeof subagent.inputTokens === "number") {
      parts.push(`↑${formatTokenCount(subagent.inputTokens)}`);
    }
    if (typeof subagent.outputTokens === "number") {
      parts.push(`↓${formatTokenCount(subagent.outputTokens)}`);
    }
    return {
      id: `subagent.${subagent.agentId}`,
      label: subagent.label ?? subagent.agentId,
      value: parts.join(" "),
    };
  });
  return { id: "subagents", title: input.t("agentStats.panel.sections.subagents"), rows };
}

/**
 * The panel is a read of the same snapshot the pill abbreviates, so the model is derived here and
 * the component stays a mapping. A section with nothing to say is absent rather than empty — an
 * opencode session has no timings, and a heading over blank rows reads as broken.
 */
export function buildAgentStatsPanelModel(
  input: BuildAgentStatsPanelModelInput,
): AgentStatsPanelModel {
  const { kpis, progress } = buildKpis(input);
  const sections = [
    buildTotalsSection(input),
    buildTimingSection(input),
    buildToolsSection(input),
    buildSubagentsSection(input),
  ].filter((section): section is AgentStatsPanelSection => section !== null);
  return { kpis, progress, sections };
}

/** The display-settings page: one tick per pill segment. It never filters the panel itself. */
export function useStatsPanelPages(): MenuPageDefinition[] {
  const { t } = useTranslation();
  const hiddenSegments = useStatsPillPreferences((state) => state.hiddenSegments);
  const toggleSegment = useStatsPillPreferences((state) => state.toggleSegment);

  return useMemo(
    () => [
      {
        id: "segments",
        title: t("agentStats.panel.display.title"),
        content: STATS_PILL_SEGMENT_IDS.map((id) => (
          <SegmentToggleItem
            key={id}
            id={id}
            label={t(SEGMENT_LABEL_KEYS[id])}
            selected={!hiddenSegments.includes(id)}
            onToggle={toggleSegment}
          />
        )),
      },
    ],
    [t, hiddenSegments, toggleSegment],
  );
}

/** One tick per segment. Its own component so the press handler is memoized per row. */
function SegmentToggleItem({
  id,
  label,
  selected,
  onToggle,
}: {
  id: StatsPillSegmentId;
  label: string;
  selected: boolean;
  onToggle: (id: StatsPillSegmentId) => void;
}) {
  const handleSelect = useCallback(() => onToggle(id), [id, onToggle]);
  return (
    <MenuItem
      testID={`agent-stats-segment-toggle-${id}`}
      selected={selected}
      closeOnSelect={false}
      onSelect={handleSelect}
    >
      {label}
    </MenuItem>
  );
}

/** Panel body. `pages` for the display page live on the surface that hosts this content. */
export function AgentStatsPanel({
  serverId,
  agentId,
}: {
  serverId: string;
  agentId: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const stats = useSessionStore((state) => state.sessions[serverId]?.agents?.get(agentId)?.stats);
  const lastUsage = useSessionStore(
    (state) => state.sessions[serverId]?.agents?.get(agentId)?.lastUsage,
  );

  const model = useMemo(
    () => buildAgentStatsPanelModel({ stats, lastUsage, t: t as AgentStatsPanelTranslate }),
    [stats, lastUsage, t],
  );

  return (
    <>
      {model.kpis.length > 0 ? (
        <View style={styles.kpiRow} testID="agent-stats-panel-kpis">
          {model.kpis.map((kpi) => (
            <View key={kpi.id} style={styles.kpi} testID={`agent-stats-kpi-${kpi.id}`}>
              <Text style={styles.kpiLabel}>{kpi.label}</Text>
              <Text style={styles.kpiValue}>{kpi.value}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {model.progress ? (
        <View style={styles.progressTrack} testID="agent-stats-panel-progress">
          <View
            testID={`agent-stats-progress-${model.progress.tone}`}
            style={[styles.progressFill, progressStyle(model.progress.percent)]}
          />
        </View>
      ) : null}
      {model.sections.map((section) => (
        <View key={section.id} testID={`agent-stats-section-${section.id}`}>
          <MenuSeparator />
          <Text style={styles.sectionTitle}>{section.title}</Text>
          {section.rows.map((row) => (
            <View
              key={row.id}
              style={styles.row}
              testID={`agent-stats-row-${section.id}-${row.id}`}
            >
              <Text style={styles.rowLabel} numberOfLines={1}>
                {row.label}
              </Text>
              <Text style={styles.rowValue}>{row.value}</Text>
            </View>
          ))}
        </View>
      ))}
      <MenuSeparator />
      <MenuSubTrigger id="segments" testID="agent-stats-display-settings">
        {t("agentStats.panel.display.trigger")}
      </MenuSubTrigger>
    </>
  );
}

function progressStyle(percent: number): { width: `${number}%` } {
  return { width: `${Math.max(0, Math.min(100, percent))}%` };
}

const styles = StyleSheet.create((theme) => ({
  kpiRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  kpi: {
    flexDirection: "column",
  },
  kpiLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  kpiValue: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  progressTrack: {
    height: 4,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface3,
    overflow: "hidden",
  },
  progressFill: {
    height: 4,
    backgroundColor: theme.colors.foregroundMuted,
  },
  sectionTitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    paddingVertical: theme.spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
  rowLabel: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  rowValue: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
}));
