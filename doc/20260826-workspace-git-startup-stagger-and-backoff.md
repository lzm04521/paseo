# Workspace Git 服务启动错峰与失败退避 修复方案

> 状态：**待确认**（确认后出实施计划）
> 日期：2026-08-26
> 范围：`packages/server/src/server/workspace-git-service.ts`（主体）、`file-observer/`（诊断）
> 不改任何用户数据；所有改动可随上游重移植（补丁面集中、行为有 env 开关兜底）。

## 1. 问题

### 1.1 现象

Paseo 每次重启后，首次选择模型必现 `Timed out refreshing Claude after 120000ms; pending: availability/version`，手动点重试后约 10 秒恢复。daemon 启动后数分钟内整体卡顿。

### 1.2 量化证据（本机 `~/.paseo/daemon.log`，2026-08-25 采集）

| 指标 | 实测值 | 正常预期 |
|---|---|---|
| `daemon.get_status` 请求耗时 | **95,312 ms** | 毫秒级 |
| "Failed to run forge PR status self-heal refresh" | **551 次** | 0（或个位数） |
| "Background git fetch completed with errors" | **225 次** | 0 |
| "Failed to start working tree watcher; using degraded polling" | **40 次**（6 个 workspace 全部命中） | 0 |
| `/api/status` 启动后 3 分钟内延迟 | 0.24 ~ 2.0 s 持续 | 毫秒级 |
| provider 首次刷新 | 120 s 限期饿死 | 秒级 |

### 1.3 已排除项

- **不是扫描旧会话数据**：daemon 启动日志明确 `Agent registry loaded (853 records); agents will initialize on demand`，瞬时完成、按需初始化。
- 不是 PATH/二进制解析（全路径 0ms）、不是 MCP/技能（已另案优化，claude 会话启动 11~17s 正常）。

## 2. 根因

daemon 对每个已注册 workspace 持续运行三股 git 子进程负载，启动时同时爆发，把事件循环卡死：

```
daemon 启动
 └─ 6 个 workspace 同时注册观察（并发限 2，但无延迟）
     ├─ working-tree watcher 订阅（fs.watch recursive + 10s canary 验证）
     │    └─ 全部失败 → 退化每 5s git 轮询/workspace（永续）      ← F1
     ├─ ensureRepoTarget：注册即 fetch + setInterval 每 180s
     │    └─ fetch 持续报错无退避（225 次告警）                    ← F3
     └─ forge PR 状态轮询（schedule(0) 即刻首轮）
          └─ 无认证/不支持的仓库失败→重试，封顶 5min 永不放弃（551 次）← F2
 provider 首次刷新与上述爆发并发 → 活动饿死 → 120s 超时           ← F4
```

关键代码位置（`packages/server/src/server/workspace-git-service.ts`）：

| 机制 | 常量/位置 |
|---|---|
| 启动并发 | `WORKSPACE_GIT_OBSERVATION_SETUP_CONCURRENCY = 2`（L84）、`scheduleWorkspaceObservationSetup`（L1180） |
| 注册即 fetch | `ensureRepoTarget` 尾部 `void this.runRepoFetch(repoTarget)`（L1825） |
| fetch 周期 | `BACKGROUND_GIT_FETCH_INTERVAL_MS = 180_000`（L74），错误无退避（`runRepoFetch` L3105 起） |
| PR 轮询 | `retainGenericForgePrStatusPoll`（L2466 起）、`computeGenericForgeNextInterval`（L3520）：`min(base × 2^(n-1), 300_000)`，无放弃路径 |
| 退化轮询 | `startWorkingTreeWatchFallback`（L1495）、`DEGRADED_GIT_POLL_INTERVAL_MS = 5_000`（L80） |
| watcher 后端 | `file-observer/internal/native-recursive.ts`：`fs.watch(root, {recursive:true})`，订阅 10s 内需通过 liveness canary |

## 3. 修复设计

> 按 F4 → F3 → F2 → F1 实施；四项相互独立可并行。F4 直接满足"重启后零超时、马上可用"。

### F4 · 启动错峰与延迟（救首次选模型）

**现状**：workspace 注册即启动观察链；`ensureRepoTarget` 注册即 fetch；PR 轮询 `schedule(0)` 即刻首轮。provider 刷新与之并发抢事件循环。

**设计**：
1. 宽限期锚点为**工作区注册时刻**（而非 daemon 启动时刻）：每个 workspace 注册时起算 `WORKSPACE_GIT_BOOT_GRACE_MS = 30_000`（env `PASEO_WS_GIT_BOOT_GRACE_MS` 可覆盖，`0` 恢复现状）。宽限期内 `scheduleWorkspaceObservationSetup` 仅入队不执行。
   > 锚点必须是注册时刻：provider 刷新与 workspace 注册由**同一次 app 连接**触发。若锚在 daemon 启动（daemon 常驻后台、app 晚连），宽限早已过期，连接风暴依旧。
2. workspace 间错峰：同一连接批次内第 i 个 workspace 的观察启动时间 = `注册时刻 + GRACE + i × STAGGER_MS`（`STAGGER_MS = 2_000`）± 500ms 抖动；沿用现有并发限 2。
3. `ensureRepoTarget` 移除"注册即 fetch"：首个 fetch 与首个 interval 合并（即首次 fetch 最快出现在 GRACE + 180s），或按同一错峰表延迟 30s——取后者（保守）。
4. forge PR 轮询**无需改动**：核实代码（L2425）首轮 `pollImmediately = false`（按 base interval 调度，≥20s 后才执行）；`schedule(0)` 仅发生在轮询身份变化的重验证（git 事件驱动、低频），保留现状。
5. 依赖注入时钟（现有 `deps.now` 风格），保证可测。

**代价/风险**：启动后 ~30s 内 UI 的分支/变更/PR 状态显示为"加载中"（快照需允许 pending 态展示）。**agent 会话创建不依赖这些状态**（`resolveProviderCreateConfig` 仅用 mode/features），不影响"马上能用"。

### F3 · 后台 fetch 失败退避

**现状**：固定 180s interval；失败仅 warn 并继续；错误路径还触发 `scheduleRepoMetadataRefresh` 结构刷新（失败时额外负载）。

**设计**：
1. `RepoGitTarget` 增加 `consecutiveFetchErrors: number`；`runRepoFetch` 抛错或 `result.error` 非空时 +1，成功清零。
2. 定时器改 `setTimeout` 链动态调度：`min(180_000 × 2^(n-1), 1_800_000)`（封顶 30 分钟）。
3. 连续失败 ≥ 3 次后，退避期间跳过 `scheduleRepoMetadataRefresh` 的失败触发（避免错误放大）。
4. 告警聚合：同一 repo 连续失败只在第 1、5、20… 次各记一条 warn，其余 debug（消灭刷屏）。

**代价/风险**：远端变化感知在持续失败仓库上最多延迟 30 分钟；成功一次即恢复正常节奏。可接受。

### F2 · forge PR 轮询失败停摆（degraded 状态机）

**现状**：退避封顶 5 分钟、永不放弃；无凭据/不支持的仓库每 5 分钟失败一次直到永远（551 次来源）。

**设计**：
1. 错误分类（在 `ForgeService` 错误上识别）：认证类（401/403/无凭据）与"仓库/PR 不存在或不支持"类 → **立即退订**轮询并标记 `target.forgePrStatusDegraded = "auth" | "unsupported"`。
2. 其它错误：退避封顶提到 15 分钟；连续 ≥ 8 次进入 degraded（同上标记）。
3. 恢复路径（重订一次）：a) `pollTarget.headRef/headSha` 变化（git 事件驱动）；b) 消费侧显式请求（用户打开 PR 面板/手动刷新，挂在 `rememberForgePrStatusSnapshot` 消费事件上）。
4. degraded 状态进快照，UI 显示"PR 状态不可用"而非空白。

**代价/风险**：私有/无凭据仓库不再自动重试——由明确信号唤醒，属预期行为；恢复钩子漏挂会导致不再刷新（测试覆盖）。

### F1 · watcher 订阅失败：诊断 + 兜底缓解

**现状**：`fs.watch(recursive)` 订阅需 10s 内通过 canary 验证；本机 6 个 workspace 100% 失败 → 每 5s/仓 git 轮询（最大一股持续负载）。

**设计（两步）**：
1. **诊断先行**（不改行为）：订阅链路加分阶段耗时日志（fs.watch 建立、canary 写入→事件返回、首个事件），env 开关 `PASEO_WS_GIT_WATCH_DIAG=1` 启用；本机复现一次，判定是 watcher 建立慢（大目录/杀软/磁盘）还是 canary 事件丢失（Windows 平台缺陷→报上游）。
2. **兜底缓解**（无论诊断结论）：`DEGRADED_GIT_POLL_INTERVAL_MS` 5s → 30s，加 ±20% 抖动；连续 N 次轮询无变化时间隔渐进至 60s；任一变化事件重置。轮询去重（in-flight 检查已有，补齐退避期间跳过）。

**代价/风险**：watcher 未修好时 git 状态刷新最慢 30~60s（当前 5s 但代价是持续卡顿，值得换）；诊断结论若是 Node/Windows 递归监视缺陷，需要上游或换后端（watchman/自研清单对比），另行立项。

## 4. 实施顺序与依赖

```
F4（错峰）  ──┐
F3（fetch 退避）──┼── 相互独立，可并行；建议顺序 F4 → F3 → F2 → F1诊断 → F1缓解
F2（PR degraded）─┘
```

每项独立提交（fork 纪律：小补丁、可重移植），每项带单测。

## 5. 验收标准（量化）

1. 重启 daemon → 打开 Paseo 首次选模型：**≤ 10s 出模型列表**（对齐当前"重试后"的实际耗时），daemon 日志无 `Timed out refreshing`（当前必现 120s 超时）。
   > 注："<2s 出列表"只有配合快照持久化（F5，已明确不做）才可达；F4 的目标是**消灭 120s 超时与手动重试**，把首次刷新拉回到无竞争时的自然耗时（~10s）。
2. `daemon.get_status` 稳态 P95 < 500ms（当前有 95s 极端值）；启动 5 分钟内 API 延迟无 > 2s 尖峰。
3. 稳态运行 24h：workspace-git-service 告警 ≤ 个位数（当前 fetch 225 / 自愈 551 / watcher 40）。
4. watcher 失败场景（人为构造）：轮询间隔 ≥ 30s/仓，daemon CPU 稳定无周期尖峰。

## 6. 测试计划

- **单测**（vitest，fake timers，沿用 `session.workspace-git-watch.test.ts` 风格）：
  - F4：宽限期入队不执行；错峰间隔与抖动边界；GRACE=0 时行为等价现状
  - F3：退避序列 180s→…→30min 封顶；成功归零；告警聚合
  - F2：auth 错误立即退订；非 auth 错误 8 次进入 degraded；head 变化/消费请求触发重订
  - F1缓解：轮询间隔 30s 基线、无变化渐进 60s、抖动范围
- **集成/手工**：重启 daemon ×3 次的验收清单（对照 §5 指标，含 daemon 日志断言脚本）

## 7. 上游 issue 素材（附带产出）

本机完整数据可直接作为上游报告：95,312ms 的 `daemon.get_status`、551/225/40 三类告警统计、6/6 workspace watcher 订阅 10s 超时、`fs.watch(recursive)` 后端信息。F2/F3 属通用缺陷（任何无凭据/弱网环境都会复现），F4 的启动竞态与 #3821（0.6.0 OpenCode 就绪门控）同族，可一并引用。

## 8. 明确不做

- 不删除、不迁移任何用户数据（会话记录、workspace、`~/.claude` 一概不动）
- 不做 provider 快照持久化（F5，经确认不需要——F4 生效后首刷秒级完成，无需缓存）
- 不更换 watcher 后端（待 F1 诊断结论，另行立项）
