import { Fragment, useCallback, useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { AgentSessionStats, AgentUsage } from "@getpaseo/protocol/agent-types";
import {
  MenuItem,
  MenuSeparator,
  MenuSubTrigger,
  menuRowContentInset,
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
  /** Subagent rows only: the session is still waiting on this child. */
  running?: boolean;
  /** A row that summarises the rows under it — the tools total above its per-tool counts. */
  strong?: boolean;
}

export interface AgentStatsPanelSection {
  id: string;
  title: string;
  /**
   * `grid` lays the rows as label-over-value cells — six short counters read as two lines instead
   * of six, and never sit beside a long identifier the way a two-column row does. `rows` is for
   * identifiers (tool names, subagent labels) that need the full row width against their value.
   */
  layout: "grid" | "rows";
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
  return {
    id: "totals",
    title: input.t("agentStats.panel.sections.totals"),
    layout: "grid",
    rows,
  };
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
  return {
    id: "timing",
    title: input.t("agentStats.panel.sections.timing"),
    layout: "grid",
    rows,
  };
}

/** Per-tool rows kept before the fold. The daemon already sends only the top ten; any wider and the section outgrows the panel's height ceiling on its own. */
const MAX_TOOL_ROWS = 5;

/**
 * `mcp__<server>__<tool>` collapses to `server · tool`. The wire name is three namespaces of
 * noise, and in a count column the leaf is the part being compared.
 */
function displayToolName(name: string): string {
  const segments = name.split("__").filter((segment) => segment.length > 0);
  if (segments.length >= 3 && segments[0].toLowerCase() === "mcp") {
    return segments.slice(1).join(" · ");
  }
  return name;
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
      strong: true,
    });
  }
  if (typeof stats.toolCallErrors === "number" && stats.toolCallErrors > 0) {
    rows.push({
      id: "toolCallErrors",
      label: input.t("agentStats.panel.rows.toolCallErrors"),
      value: String(stats.toolCallErrors),
    });
  }
  const calls = stats.toolCalls ?? [];
  for (const call of calls.slice(0, MAX_TOOL_ROWS)) {
    rows.push({
      id: `tool.${call.tool}`,
      label: displayToolName(call.tool),
      value: call.errors > 0 ? `${call.count} (${call.errors}✕)` : String(call.count),
    });
  }
  const rest = calls.slice(MAX_TOOL_ROWS);
  if (rest.length > 0) {
    rows.push({
      id: "tool.more",
      label: input.t("agentStats.panel.rows.moreTools", { count: rest.length }),
      value: String(rest.reduce((total, call) => total + call.count, 0)),
    });
  }
  if (rows.length === 0) return null;
  return { id: "tools", title: input.t("agentStats.panel.sections.tools"), layout: "rows", rows };
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
      running: subagent.running,
    };
  });
  return {
    id: "subagents",
    title: input.t("agentStats.panel.sections.subagents"),
    layout: "rows",
    rows,
  };
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

  const hasOverview = model.kpis.length > 0 || model.progress !== null;

  return (
    <>
      {hasOverview ? (
        <View style={styles.rail} testID="agent-stats-section-overview">
          <Text style={styles.sectionTitle}>{t("agentStats.panel.sections.overview")}</Text>
          {model.kpis.length > 0 ? (
            <View style={styles.grid} testID="agent-stats-panel-kpis">
              {model.kpis.map((kpi) => (
                <View key={kpi.id} style={styles.gridCell} testID={`agent-stats-kpi-${kpi.id}`}>
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
                style={progressFillStyle(model.progress)}
              />
            </View>
          ) : null}
        </View>
      ) : null}
      {model.sections.map((section, index) => (
        <Fragment key={section.id}>
          {index > 0 || hasOverview ? <MenuSeparator /> : null}
          <View style={styles.rail} testID={`agent-stats-section-${section.id}`}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.layout === "grid" ? (
              <View style={styles.grid}>
                {section.rows.map((row) => (
                  <View
                    key={row.id}
                    style={styles.gridCell}
                    testID={`agent-stats-row-${section.id}-${row.id}`}
                  >
                    <Text style={styles.kpiLabel}>{row.label}</Text>
                    <Text style={styles.kpiValue}>{row.value}</Text>
                  </View>
                ))}
              </View>
            ) : (
              section.rows.map((row) => (
                <View
                  key={row.id}
                  style={styles.row}
                  testID={`agent-stats-row-${section.id}-${row.id}`}
                >
                  {row.running ? (
                    <View testID="agent-stats-subagent-running" style={styles.runningDot} />
                  ) : null}
                  <Text
                    style={row.strong ? [styles.rowLabel, styles.rowLabelStrong] : styles.rowLabel}
                    numberOfLines={1}
                  >
                    {row.label}
                  </Text>
                  <Text style={styles.rowValue}>{row.value}</Text>
                </View>
              ))
            )}
          </View>
        </Fragment>
      ))}
      <MenuSeparator />
      <MenuSubTrigger id="segments" testID="agent-stats-display-settings">
        {t("agentStats.panel.display.trigger")}
      </MenuSubTrigger>
    </>
  );
}

function progressFillStyle(progress: { percent: number; tone: MeterTone }): {
  width: `${number}%`;
  backgroundColor: string;
} {
  // Read the stylesheet at render time rather than caching colour values at module scope: the
  // persisted theme is applied after first paint, and a cached read keeps the light value.
  let tone = styles.progressFill;
  if (progress.tone === "critical") {
    tone = styles.progressCritical;
  } else if (progress.tone === "warning") {
    tone = styles.progressWarning;
  }
  const clamped = Math.max(0, Math.min(100, progress.percent));
  return { ...tone, width: `${clamped}%` };
}

const styles = StyleSheet.create((theme) => ({
  // The panel's own content sits on the same rail as a menu row's label, so it reads as part of
  // the list rather than a block pasted over its edges. Separators stay outside the rail — the
  // page has no horizontal padding so they keep running the full width of the surface.
  rail: {
    paddingHorizontal: menuRowContentInset(theme),
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
    marginTop: theme.spacing[2],
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface3,
    overflow: "hidden",
  },
  progressFill: {
    height: 4,
    backgroundColor: theme.colors.foregroundMuted,
  },
  progressWarning: {
    height: 4,
    backgroundColor: theme.colors.palette.amber[500],
  },
  progressCritical: {
    height: 4,
    backgroundColor: theme.colors.destructive,
  },
  runningDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.palette.green[500],
  },
  sectionTitle: {
    fontSize: theme.fontSize.sm,
    // Structural label above a group — medium per docs/design.md §3, so a section reads as a
    // section and not as one more muted row.
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
    paddingVertical: theme.spacing[1],
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  gridCell: {
    flexDirection: "column",
    flexGrow: 1,
    flexBasis: "30%",
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
  rowLabelStrong: {
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  rowValue: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
}));
