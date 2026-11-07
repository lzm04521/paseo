# F5 连接风暴与 availability 饥饿修复 · 手工验收记录

> 状态：**Step 1/2 已完成（2026-08-27，F5d 诊断已采集并出结论）；Step 3（×3 重启验收）待执行**
> 日期：2026-08-26（脚手架）/ 2026-08-27（F5d 采集）
> 来源文档：实施计划 `doc/20260826-workspace-git-f5-implementation-plan.md`（Task 7）与诊断 `doc/20260826-workspace-git-f5-connect-burst-and-availability-starvation-diagnosis.md`（§4 验收指标）。
> 说明：本文件为待填写的验收记录骨架。构建安装、环境变量设置、daemon 重启与指标观测均由用户手工执行，完成后回填各表并在结论区逐项判定。

## 1. 前置条件

F5 修复已全部落地，包含以下提交（新构建须包含至 `4893f56ce` 或之后）：

| 提交        | 主题                                                                          | 修复项   |
| ----------- | ----------------------------------------------------------------------------- | -------- |
| `cd83e0db1` | fix(server): resolve PATH candidates via where.exe on Windows                 | F5a-2    |
| `0ac761d36` | fix(server): cache executable resolution with in-flight dedupe                | F5a-1    |
| `1613d08f3` | fix(server): fail fast when provider availability stalls via 10s sub-deadline | F5a-3    |
| `e82ba3db7` | fix(server): defer first workspace snapshot refresh into startup stagger      | F5b      |
| `ac57809fb` | fix(server): join getSnapshot with pending initial refresh during boot grace  | F5b      |
| `3e741ee11` | fix(server): raise degraded git polling to 60s base with 120s idle ramp       | F5c-1    |
| `4893f56ce` | test(server): realign grace/stagger tests with F5b deferred initial refresh   | F5b 测试 |

- [x] **Step 1: 编译安装新构建**（沿用现有打包流程）——已安装 `packages/desktop/release/Paseo-Setup-0.6.0-local.1-x64.exe`（2026-08-27 09:59 本地构建）。⚠️ 版本串未 bump（仍 `0.6.0-local.1`），已通过 asar 内容标记验证含 F5 代码（`PASEO_PROVIDER_AVAILABILITY_TIMEOUT_MS`、`pendingInitialRefresh` 均在）。⚠️ 另：GitHub 更新源上的 `0.6.1-local.2`（08-26 20:02 构建）**不含 F5**，已被更新器下载为 pending——若被安装会把 F5 覆盖回旧代码，需 bump 版本后重新发布覆盖。

## 2. F5d 诊断采集（Step 2）

操作步骤：

1. 设置用户级环境变量 `PASEO_WS_GIT_WATCH_DIAG=1`；
2. 重启 Paseo 一次；
3. 从 `~/.paseo/daemon.log` 提取 `watch_diag_subscribe_settled` / `watch_diag_canary_verified` / `watch_diag_subscribe_deadline` 三类日志；
4. 记录：settle 耗时是否远超 10s、canary 是否因拥堵超时。结论写入下表（决定是否另立 watcher 后端项目）。

执行记录：2026-08-27 11:04 重启（diag env 经启动 shell 注入，新 daemon pid 61924，日志偏移 1,706,654 之后共 95 行）。6 个 workspace，21 条 watch_diag 日志：

| workspace                         | 工作树 subscribe settle                  | .git 元数据 subscribe settle             | canary               |
| --------------------------------- | ---------------------------------------- | ---------------------------------------- | -------------------- |
| F:/Others/vision-mcp-server       | ✅ accepted 4ms                          | ✅ accepted 1ms                          | ✅ 22ms              |
| F:/GitHubs/keysqiu-publish-tools  | ✅ accepted 796ms                        | ✅ accepted 7ms                          | ✅ 13ms              |
| F:/GitHubs/dsh_desktop            | ✅ accepted 4,653ms                      | ✅ accepted 16ms                         | ✅ 15ms              |
| F:/GitHubs/paseo                  | ❌ deadline→expired，raw settle 34,805ms | ✅ accepted 7,096ms                      | ✅ 15ms（.git）      |
| F:/项目/光峰/SMOM.EIS.Appotronics | ❌ deadline→expired，raw settle 53,014ms | ✅ accepted 2,170ms                      | ✅ 17ms（.git）      |
| F:/GitHubs/deepseek-harness       | ❌ deadline→expired，raw settle 84,087ms | ❌ deadline→expired，raw settle 12,969ms | 未到达（订阅即超时） |

`watch_diag_subscribe_deadline` 共 4 次（+102.1s deepseek 工作树、+108.6s paseo 工作树、+112.5s deepseek .git、+140.7s SMOM 工作树）；随后 3 个 workspace 打出 `Failed to start working tree watcher; using degraded polling` 进入 F5c 降级轮询。同时段事件循环 p50 10.6~555.7ms（仅启动刷新风暴窗口 p99 达 3.4s）；到达 canary 阶段的 4 个订阅全部 13~22ms 秒级通过——**无一因拥堵超时**。

### 定性分析（依据源码 `file-observer/internal/native-recursive.ts` 的 `backend.start()`）

订阅 settle = ①建递归 fs.watch 句柄（`watchRoot()`，同步、瞬时）+ ②`await enqueueAudit()` **初始全树对账**（全量遍历建 files/directories 索引）。因此：

- **settle 远超 10s 的原因不是拥堵，而是大仓初始对账本身耗时**：34.8s / 53s / 84s 与目录规模正相关（历史 `maxReconciliationDurationMs` 115s 佐证）；同期小仓 4ms~7s 即通过，10s 限期对大仓是结构性不可能。
- **canary 拥堵超时为零**：F1~F4 时代"6 canary 全失败"的拥堵因素已被 F5 消除（本 轮 p50 基线 15ms，canary 全过）。
- 递归 fs.watch 句柄建立瞬时、事件流正常（nativeEventCount 持续增长）——watcher 后端本身没有问题。

是否需要另立 watcher 后端项目：**否**。剩余问题是**订阅限期与初始全树对账耦合**的设计问题：句柄就绪即可返回订阅、canary 先行验证，初始对账改为后台补齐（或增量/惰性）。属小改动任务，不需要替换 watcher 后端。

## 3. 重启验收 ×3（Step 3）

> 注意：本节各轮验收前必须**移除**诊断环境变量 `PASEO_WS_GIT_WATCH_DIAG`，恢复常态运行。

每轮对照诊断文档 §4 指标逐项实测：

1. 重启 daemon → 打开 Paseo 首次选模型：≤10s 出模型列表，daemon 日志无 `Timed out refreshing`；
2. `daemon.get_status` 响应 <2s（连接后 3 分钟内）；
3. 首个 30s 指标窗口 `git.commands.submitted` <20（旧值 229）；
4. 稳态（启动 5 分钟后）事件循环 `eventLoopDelay.p50Ms` <50ms、git 提交速率 <1 条/s；
5. `list_provider_features` 无 >30s 慢请求。

| 验收轮次 | 各指标实测值 | 通过与否 |
| -------- | ------------ | -------- |
| 第 1 轮  |              |          |
| 第 2 轮  |              |          |
| 第 3 轮  |              |          |

## 4. daemon 日志关键行摘录

F5d 轮（2026-08-27 11:04，diag env 开启）watch_diag 全量与指标窗口：

```
+73.9s  watch_diag_subscribe_settled  F:/Others/vision-mcp-server        durationMs=4     accepted
+73.9s  watch_diag_subscribe_settled  …\.git                             durationMs=1     accepted
+73.9s  watch_diag_canary_verified    …\vision-mcp-server\.git           durationMs=22
+91.6s  watch_diag_subscribe_settled  F:/GitHubs/keysqiu-publish-tools   durationMs=796   accepted
+91.6s  watch_diag_canary_verified    …\keysqiu-publish-tools\.git       durationMs=13
+102.1s watch_diag_subscribe_deadline F:/GitHubs/deepseek-harness        （10s 限期到）
+108.6s watch_diag_subscribe_deadline F:/GitHubs/paseo
+112.5s watch_diag_subscribe_deadline …\deepseek-harness\.git
+115.1s watch_diag_subscribe_settled  …\deepseek-harness\.git            durationMs=12969  expired
+115.7s watch_diag_subscribe_settled  …\paseo\.git                       durationMs=7096   accepted
+115.7s watch_diag_canary_verified    …\paseo\.git                       durationMs=15
+130.0s watch_diag_subscribe_settled  F:/GitHubs/paseo                   durationMs=34805  expired
+130.2s watch_diag_subscribe_settled  F:/GitHubs/dsh_desktop             durationMs=4653   accepted
+142.8s watch_diag_subscribe_settled  …\SMOM.EIS.Appotronics\.git        durationMs=2170   accepted
+140.7s watch_diag_subscribe_deadline F:/项目/光峰/SMOM.EIS.Appotronics
+175.3s watch_diag_subscribe_settled  F:/GitHubs/deepseek-harness        durationMs=84087  expired
+183.0s watch_diag_subscribe_settled  F:/项目/光峰/SMOM.EIS.Appotronics  durationMs=53014  expired

指标窗口（30s）：git submitted = 131 / 236 / 207 / 325 / 234 / 5；eventLoop p50 = 15.1 / 15.1 / 555.7 / 53.7 / 10.6 / 15.1 ms
稳态末窗：git 5 条/30s（≈0.17 条/s，目标 <1/s ✓），p50 10.6~15.1ms（目标 <50ms ✓）
```

## 5. 结论

- 首次选模型 ≤10s：待执行
- `daemon.get_status` <2s：待执行
- 首窗 `git.commands.submitted` <20：待执行（F5d 轮首窗实测 131，需在 Step 3 判定——见下方注意事项）
- 稳态 `eventLoopDelay.p50Ms` <50ms 且 git 提交速率 <1 条/s：F5d 轮已达标（p50 10.6~15.1ms、0.17 条/s），Step 3 复验
- `list_provider_features` 无 >30s 慢请求：待执行
- F5d 结论（是否另立 watcher 后端项目）：**否**——canary 拥堵超时为零，剩余失败是大仓初始全树对账耗时（34.8~84s）与 10s 订阅限期的结构性冲突；建议小任务"订阅限期与初始对账解耦"，不需更换 watcher 后端

### Step 3 注意事项（来自 F5d 轮的观察）

1. 首个指标窗口 git submitted=131（目标 <20）：该窗口覆盖 daemon 自身 bootstrap（16 个 workspace 记录恢复）与 F5b 错峰后的集中刷新（6 仓 × ~25-40 条落在 30s 宽限后的窗口），需在 ×3 验收中区分"连接批次外仍有启动 git 工作"还是"错峰集中但未削减总量"。
2. F5d 轮 3 个大仓 watcher 失败后按 F5c 60s 基线降级轮询，稳态仍达标——若 Step 3 复验同样达标，说明降级路径负载可控。
3. 版本管理：本地安装包版本串未 bump + GitHub feed 存在不含 F5 的 `0.6.1-local.2` pending 更新——Step 3 前建议先 bump 版本重发布，避免更新器回滚 F5 代码。
