# F5 连接风暴与 availability 饥饿修复 · 手工验收记录

> 状态：**待执行（脚手架，由用户执行）**
> 日期：2026-08-26
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

- [ ] **Step 1: 编译安装新构建**（沿用现有打包流程）

## 2. F5d 诊断采集（Step 2）

操作步骤：

1. 设置用户级环境变量 `PASEO_WS_GIT_WATCH_DIAG=1`；
2. 重启 Paseo 一次；
3. 从 `~/.paseo/daemon.log` 提取 `watch_diag_subscribe_settled` / `watch_diag_canary_verified` / `watch_diag_subscribe_deadline` 三类日志；
4. 记录：settle 耗时是否远超 10s、canary 是否因拥堵超时。结论写入下表（决定是否另立 watcher 后端项目）。

| 日志行摘录 | settle 耗时 | canary 结果 | 结论 |
| ---------- | ----------- | ----------- | ---- |
|            |             |             |      |
|            |             |             |      |
|            |             |             |      |

是否需要另立 watcher 后端项目：待定。

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

```
（待粘贴：首次选模型超时相关、watch_diag_*、指标窗口、慢请求等关键日志行）
```

## 5. 结论

- 首次选模型 ≤10s：待执行
- `daemon.get_status` <2s：待执行
- 首窗 `git.commands.submitted` <20：待执行
- 稳态 `eventLoopDelay.p50Ms` <50ms 且 git 提交速率 <1 条/s：待执行
- `list_provider_features` 无 >30s 慢请求：待执行
- F5d 结论（是否另立 watcher 后端项目）：待执行
