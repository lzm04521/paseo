export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${Math.round(value / 1_000_000)}m`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return Math.round(value).toString();
}

/** Provider-reported session cost, or null when there is nothing worth showing. */
export function formatSessionCost(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  if (value < 0.01) {
    return `$${value.toFixed(4)}`;
  }
  return `$${value.toFixed(2)}`;
}

/** How full the context window is, before it is turned into a colour. */
export type MeterTone = "critical" | "warning" | "muted";

/**
 * The one threshold ladder for context fullness. The ring and the stats pill share it, so a window
 * that reads amber in one place cannot read muted in the other.
 */
export function getMeterTone(percentage: number): MeterTone {
  if (percentage > 90) {
    return "critical";
  }
  if (percentage >= 70) {
    return "warning";
  }
  return "muted";
}
