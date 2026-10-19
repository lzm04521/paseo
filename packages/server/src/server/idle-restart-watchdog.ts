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

export interface IdleRestartTriggerInfo {
  uptimeMinutes: number;
  idleMinutes: number;
  thresholds: { uptimeThresholdMinutes: number; idleThresholdMinutes: number };
}

export function startIdleRestartWatchdog(deps: {
  getConfig: () => IdleAutoRestartTickConfig | undefined;
  isBusy: () => boolean;
  now: () => number;
  onTrigger: (info: IdleRestartTriggerInfo) => void;
  tickMs?: number;
}): { stop(): void; getIdleSince(): number | null; getStartedAt(): number } {
  let state = createIdleRestartWatchdogState(deps.now());
  const tickMs = deps.tickMs ?? IDLE_RESTART_TICK_MS;
  const timer = setInterval(() => {
    const nowMs = deps.now();
    const outcome = evaluateTick(state, deps.getConfig(), deps.isBusy(), nowMs);
    state = {
      startedAtMs: outcome.startedAtMs,
      idleSince: outcome.idleSince,
      fired: outcome.fired,
    };
    if (!outcome.shouldRestart) {
      return;
    }
    const idleMinutes = outcome.idleSince === null ? 0 : (nowMs - outcome.idleSince) / 60_000;
    const uptimeMinutes = (nowMs - outcome.startedAtMs) / 60_000;
    deps.onTrigger({ uptimeMinutes, idleMinutes, thresholds: outcome.resolved });
  }, tickMs);
  timer.unref();
  return {
    stop: () => clearInterval(timer),
    // 供 daemon.get_status 暴露当前连续空闲起点（与触发判定同源）；配置禁用或忙碌时为 null。
    getIdleSince: () => state.idleSince,
    // 供 daemon.get_status 暴露 uptime 判定基线（worker bootstrap 时刻，重启即归零）。
    // 勿改用 pid 锁的 supervisor 启动时间：空闲重启只换 worker，那会让"本次启动于"不随重启变化。
    getStartedAt: () => state.startedAtMs,
  };
}
