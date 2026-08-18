import { describe, expect, it } from "vitest";
import {
  agentCountsAsBusy,
  createIdleRestartWatchdogState,
  evaluateTick,
} from "./idle-restart-watchdog.js";

const MIN = 60_000;
const config = { enabled: true, uptimeThresholdMinutes: 240, idleThresholdMinutes: 10 };

describe("idle-restart-watchdog evaluateTick", () => {
  it("stays inert while disabled and resets all state including the fired latch", () => {
    let state = createIdleRestartWatchdogState(0);
    // 先制造已触发状态：uptime 与 idle 都超阈值
    // （3*MIN 的 tick 建立首个空闲观察点，5*MIN 时 idle 已达 2min ≥ 1min 才能触发）
    state = evaluateTick(
      state,
      { ...config, uptimeThresholdMinutes: 1, idleThresholdMinutes: 1 },
      false,
      3 * MIN,
    );
    state = evaluateTick(
      state,
      { ...config, uptimeThresholdMinutes: 1, idleThresholdMinutes: 1 },
      false,
      5 * MIN,
    );
    expect(state.shouldRestart).toBe(true);
    expect(state.fired).toBe(true);

    // 关闭开关 → 全部状态复位
    const disabled = evaluateTick(state, { ...config, enabled: false }, false, 6 * MIN);
    expect(disabled).toMatchObject({ idleSince: null, fired: false, shouldRestart: false });

    // config 节点整体缺失同样视为关闭
    const missing = evaluateTick(state, undefined, false, 6 * MIN);
    expect(missing).toMatchObject({ idleSince: null, fired: false, shouldRestart: false });
  });

  it("falls back to default thresholds when enabled without values", () => {
    const state = createIdleRestartWatchdogState(0);
    const outcome = evaluateTick(state, { enabled: true }, false, 60 * MIN);
    expect(outcome.resolved).toEqual({ uptimeThresholdMinutes: 240, idleThresholdMinutes: 10 });
    // uptime 60min < 240 → 不触发
    expect(outcome.shouldRestart).toBe(false);
  });

  it("records the first idle observation point and resets it on busy", () => {
    let state = createIdleRestartWatchdogState(0);
    state = evaluateTick(state, config, false, 2 * MIN);
    expect(state.idleSince).toBe(2 * MIN);

    state = evaluateTick(state, config, true, 3 * MIN);
    expect(state.idleSince).toBeNull();

    state = evaluateTick(state, config, false, 4 * MIN);
    expect(state.idleSince).toBe(4 * MIN);
  });

  it("re-times idle across busy→idle→busy→idle cycles", () => {
    let state = createIdleRestartWatchdogState(0);
    state = evaluateTick(state, { ...config, uptimeThresholdMinutes: 1 }, false, 2 * MIN);
    state = evaluateTick(state, { ...config, uptimeThresholdMinutes: 1 }, true, 3 * MIN);
    state = evaluateTick(state, { ...config, uptimeThresholdMinutes: 1 }, false, 4 * MIN);
    // uptime 8min ≥ 1，idle 4min < 10 → 不触发，且 idleSince 是第二轮的起点
    const outcome = evaluateTick(state, { ...config, uptimeThresholdMinutes: 1 }, false, 8 * MIN);
    expect(outcome.idleSince).toBe(4 * MIN);
    expect(outcome.shouldRestart).toBe(false);
  });

  it("fires exactly at the uptime boundary but not below it", () => {
    let state = createIdleRestartWatchdogState(0);
    state = evaluateTick(state, { ...config, idleThresholdMinutes: 1 }, false, 1 * MIN);
    const atBoundary = evaluateTick(
      state,
      { ...config, idleThresholdMinutes: 1 },
      false,
      240 * MIN,
    );
    expect(atBoundary.shouldRestart).toBe(true);

    state = createIdleRestartWatchdogState(0);
    state = evaluateTick(state, { ...config, idleThresholdMinutes: 1 }, false, 1 * MIN);
    const below = evaluateTick(state, { ...config, idleThresholdMinutes: 1 }, false, 239 * MIN);
    expect(below.shouldRestart).toBe(false);
  });

  it("fires only after the idle threshold, not at 9.5 minutes of a 10-minute threshold", () => {
    let state = createIdleRestartWatchdogState(0);
    // （隔离空闲阈值：uptime 阈值降到 1，仿照 uptime 边界用例只改另一维度）
    state = evaluateTick(state, { ...config, uptimeThresholdMinutes: 1 }, false, 1 * MIN);
    const notYet = evaluateTick(
      state,
      { ...config, uptimeThresholdMinutes: 1 },
      false,
      1 * MIN + 9.5 * MIN,
    );
    expect(notYet.shouldRestart).toBe(false);
    const reached = evaluateTick(
      state,
      { ...config, uptimeThresholdMinutes: 1 },
      false,
      1 * MIN + 10 * MIN,
    );
    expect(reached.shouldRestart).toBe(true);
  });

  it("does not fire when only one of the two conditions holds", () => {
    // 空闲够、uptime 不够
    let state = createIdleRestartWatchdogState(0);
    state = evaluateTick(state, config, false, 1 * MIN);
    expect(evaluateTick(state, config, false, 12 * MIN).shouldRestart).toBe(false);

    // uptime 够、空闲不够
    state = createIdleRestartWatchdogState(0);
    state = evaluateTick(state, config, false, 300 * MIN);
    expect(evaluateTick(state, config, false, 301 * MIN).shouldRestart).toBe(false);
  });

  it("latches fired after triggering and never re-fires", () => {
    let state = createIdleRestartWatchdogState(0);
    // （3*MIN 的 tick 建立首个空闲观察点，5*MIN 时 idle 已达 2min ≥ 1min 才能触发）
    state = evaluateTick(
      state,
      { ...config, uptimeThresholdMinutes: 1, idleThresholdMinutes: 1 },
      false,
      3 * MIN,
    );
    state = evaluateTick(
      state,
      { ...config, uptimeThresholdMinutes: 1, idleThresholdMinutes: 1 },
      false,
      5 * MIN,
    );
    expect(state.shouldRestart).toBe(true);
    const afterFire = evaluateTick(state, config, false, 400 * MIN);
    expect(afterFire.shouldRestart).toBe(false);
    expect(afterFire.fired).toBe(true);
  });

  it("applies hot-reloaded thresholds immediately", () => {
    let state = createIdleRestartWatchdogState(0);
    state = evaluateTick(state, config, false, 1 * MIN);
    // 阈值从 240 热改为 5：uptime 12min ≥ 5、idle 11min ≥ 10 → 立即触发
    const outcome = evaluateTick(state, { ...config, uptimeThresholdMinutes: 5 }, false, 12 * MIN);
    expect(outcome.shouldRestart).toBe(true);
  });
});

describe("agentCountsAsBusy", () => {
  it("counts running and initializing as busy, everything else as idle", () => {
    expect(agentCountsAsBusy({ lifecycle: "running" })).toBe(true);
    expect(agentCountsAsBusy({ lifecycle: "initializing" })).toBe(true);
    expect(agentCountsAsBusy({ lifecycle: "idle" })).toBe(false);
    expect(agentCountsAsBusy({ lifecycle: "error" })).toBe(false);
    expect(agentCountsAsBusy({ lifecycle: "closed" })).toBe(false);
  });
});
