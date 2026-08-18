import { DEFAULT_IDLE_AUTO_RESTART_CONFIG } from "@getpaseo/protocol/messages";

export const IDLE_RESTART_TICK_MS = 30_000;

export interface IdleRestartWatchdogState {
  startedAtMs: number;
  idleSince: number | null;
  fired: boolean;
}

export interface IdleAutoRestartTickConfig {
  enabled?: boolean;
  uptimeThresholdMinutes?: number;
  idleThresholdMinutes?: number;
}

export interface IdleRestartTickOutcome extends IdleRestartWatchdogState {
  shouldRestart: boolean;
  resolved: { uptimeThresholdMinutes: number; idleThresholdMinutes: number };
}

export function createIdleRestartWatchdogState(nowMs: number): IdleRestartWatchdogState {
  return { startedAtMs: nowMs, idleSince: null, fired: false };
}

export function agentCountsAsBusy(agent: { lifecycle: string }): boolean {
  return agent.lifecycle === "running" || agent.lifecycle === "initializing";
}

export function evaluateTick(
  state: IdleRestartWatchdogState,
  config: IdleAutoRestartTickConfig | undefined,
  busyNow: boolean,
  nowMs: number,
): IdleRestartTickOutcome {
  const resolved = {
    uptimeThresholdMinutes:
      config?.uptimeThresholdMinutes ?? DEFAULT_IDLE_AUTO_RESTART_CONFIG.uptimeThresholdMinutes,
    idleThresholdMinutes:
      config?.idleThresholdMinutes ?? DEFAULT_IDLE_AUTO_RESTART_CONFIG.idleThresholdMinutes,
  };

  if (config?.enabled !== true) {
    return {
      startedAtMs: state.startedAtMs,
      idleSince: null,
      fired: false,
      shouldRestart: false,
      resolved,
    };
  }
  if (state.fired) {
    return { ...state, shouldRestart: false, resolved };
  }

  const idleSince = busyNow ? null : (state.idleSince ?? nowMs);
  const uptimeMinutes = (nowMs - state.startedAtMs) / 60_000;
  const idleMinutes = idleSince === null ? 0 : (nowMs - idleSince) / 60_000;
  const shouldRestart =
    idleSince !== null &&
    uptimeMinutes >= resolved.uptimeThresholdMinutes &&
    idleMinutes >= resolved.idleThresholdMinutes;

  return {
    startedAtMs: state.startedAtMs,
    idleSince,
    fired: state.fired || shouldRestart,
    shouldRestart,
    resolved,
  };
}
