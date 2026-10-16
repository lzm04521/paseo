import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { expect, test } from "vitest";
import {
  createPaseoDaemon,
  type DaemonLifecycleIntent,
  type PaseoDaemonConfig,
} from "./bootstrap.js";
import { createTestAgentClients } from "./test-utils/fake-agent-client.js";

const MIN = 60_000;

test("idle auto-restart emits a single restart intent once thresholds are met", async () => {
  const paseoHomeRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-idle-restart-smoke-"));
  const paseoHome = path.join(paseoHomeRoot, ".paseo");
  const staticDir = path.join(paseoHomeRoot, "static");
  await mkdir(paseoHome, { recursive: true });
  await mkdir(staticDir, { recursive: true });

  const intents: DaemonLifecycleIntent[] = [];
  let fakeNow = 1_000_000;
  const config: PaseoDaemonConfig = {
    listen: "127.0.0.1:0",
    paseoHome,
    corsAllowedOrigins: [],
    hostnames: true,
    mcpEnabled: false,
    staticDir,
    mcpDebug: false,
    agentClients: createTestAgentClients(),
    agentStoragePath: path.join(paseoHome, "agents"),
    relayEnabled: false,
    appBaseUrl: "https://app.paseo.sh",
    openai: undefined,
    speech: undefined,
    idleAutoRestart: { enabled: true, uptimeThresholdMinutes: 5, idleThresholdMinutes: 1 },
    onLifecycleIntent: (intent) => {
      intents.push(intent);
    },
  };

  const daemon = await createPaseoDaemon(config, pino({ level: "silent" }), {
    idleRestartWatchdog: { tickMs: 20, now: () => fakeNow },
  });

  try {
    await daemon.start();
    // 初始空转：无 agent → idleSince 记录 fakeNow 初值；uptime 尚不足
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(intents).toHaveLength(0);

    // 推进假时钟 6 分钟：uptime 6min ≥ 5、idle 6min ≥ 1 → 触发
    fakeNow += 6 * MIN;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(intents).toEqual([
      {
        type: "restart",
        clientId: "idle-auto-restart-watchdog",
        requestId: expect.any(String),
        reason: "idle_auto_restart",
      },
    ]);

    // 再推进不再触发（fired 自锁）
    fakeNow += 60 * MIN;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(intents).toHaveLength(1);
  } finally {
    await daemon.stop().catch(() => undefined);
    await rm(paseoHomeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
