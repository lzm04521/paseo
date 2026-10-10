import { describe, expect, test, vi } from "vitest";
import { raceProviderRefreshDeadline } from "./provider-refresh-deadline.js";

describe("raceProviderRefreshDeadline", () => {
  test("resolves with the operation result before the deadline", async () => {
    await expect(
      raceProviderRefreshDeadline(Promise.resolve("ok"), 60_000, "availability"),
    ).resolves.toBe("ok");
  });

  test("rejects with a labeled error once the deadline elapses", async () => {
    vi.useFakeTimers();
    try {
      const pending = raceProviderRefreshDeadline(new Promise(() => {}), 10_000, "availability");
      const expectation = expect(pending).rejects.toThrow("availability timed out after 10000ms");
      await vi.advanceTimersByTimeAsync(10_000);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  test("clears the timer when the operation settles first", async () => {
    vi.useFakeTimers();
    try {
      await raceProviderRefreshDeadline(Promise.resolve(1), 10_000, "availability");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
