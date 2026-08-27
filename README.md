<!-- 本文件是 fork 自定义版（lzm04521/paseo），不是上游镜像。
     跟进上游新版本时必须保留本地版，不要被上游 README 覆盖：
       - merge 流程冲突：git checkout --theirs README.md && git add README.md
       - 策略 B 重做：    git checkout main -- README.md
     详见 paseo-version-follow skill D 类清单 D5。release-local workflow 有 guard 步骤校验本文件（要求含 lzm04521）。 -->

<p align="center">
  <img src="packages/website/public/logo.svg" width="64" height="64" alt="Paseo logo">
</p>

<h1 align="center">Paseo Desktop</h1>

<p align="center">
  基于 <a href="https://github.com/getpaseo/paseo">getpaseo/paseo</a> 的 Windows x64 桌面构建，
  附带一组本地增强补丁，随上游版本持续跟进。
</p>

<p align="center">
  <a href="https://github.com/getpaseo/paseo">
    <img src="https://img.shields.io/badge/upstream-getpaseo/paseo-555?logo=github" alt="upstream">
  </a>
  <a href="https://github.com/lzm04521/paseo/releases">
    <img src="https://img.shields.io/github/v/release/lzm04521/paseo?style=flat&logo=github&include_prereleases" alt="release">
  </a>
  <img src="https://img.shields.io/badge/platform-Windows%20x64-0078D6?logo=windows11" alt="platform">
  <img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="license">
</p>

## 简介

[Paseo](https://github.com/getpaseo/paseo) 是监控和操控本地 AI 编码 agent 的桌面 / 移动 / Web / CLI 应用。本仓库维护其 **Windows x64 桌面版**：跟随上游发布节奏，在合并上游每个版本的同时携带若干本地增强补丁（见下文），通过 GitHub Actions 自动构建发布到 [Releases](https://github.com/lzm04521/paseo/releases)，并由应用内 electron-updater 自动更新。

> 移动端 / Web / macOS / Linux / Docker / CLI / Hub 等能力与上游一致，完整功能介绍、安装、配置、CLI 参考请看 **[官方仓库 getpaseo/paseo](https://github.com/getpaseo/paseo)** 与 **[官方文档 paseo.sh](https://paseo.sh/docs)**。

## 下载安装

从 [Releases](https://github.com/lzm04521/paseo/releases/latest) 下载 `Paseo-Setup-<版本>-x64.exe`（如 `Paseo-Setup-0.6.1-local.3-x64.exe`）安装。仅支持 Windows x64。

已安装旧版时，应用启动后自动检查新版本并升级，无需手动重装。

## 增强功能

以下补丁叠加在上游功能之上，均随上游版本合并保留。

### 桌面 / 文件操作

- **Directory Opus 兼容**：安装了 Directory Opus 时，「在文件管理器中显示 / Reveal」优先复用已打开的 Opus lister，未安装则回退 Windows 资源管理器。
- **「在 VSCode 打开」菜单**：workspace 三点菜单、project 三点菜单、文件浏览器右键菜单，均可在 VSCode 打开 workspace / project / 文件 / 文件夹。
- **@ 文件选择 gitignore 例外**：workspace 根下的 `doc` / `docs` / `handoff` 目录即使被 .gitignore 排除，@ 提及时仍可见；例外清单可在 Settings → Host → Agents 配置。

### 后台稳定性

- **git 观测启动错峰与失败退避**：daemon 启动 / 重连风暴时，各 workspace 的首次 git 刷新按 30s 启动宽限 + 每仓 2s 间隔错峰执行，避免集中刷新形成 git 命令风暴拖慢冷启动；后台 git fetch 连续失败按指数间隔退避；forge（GitHub 等）PR 轮询对认证 / 环境类失败停止轮询、瞬时失败指数退避（上限 15 分钟），手动刷新工作区可恢复已降级的 PR 轮询。
- **文件 watcher 降级轮询放宽**：大仓 watcher 订阅超时进入降级轮询时，基线放宽到 60s（空闲爬升至 120s），显著降低大仓的 CPU / IO 后台负载。
- **Windows 冷启动提速**：PATH 上的可执行文件改用 `where.exe` 解析并缓存结果（并发去重），provider 可用性探测卡住时 10 秒快速失败，缓解启动后选模型 / 连 workspace 卡顿。
- **watch 订阅诊断开关**：设置环境变量 `PASEO_WS_GIT_WATCH_DIAG=1` 并重启后，daemon 日志输出各 workspace watcher 订阅 settle / canary 耗时，用于排查大仓 watcher 问题。

### 界面 / 行为

- **资源管理器侧栏增强设置**：上游 v0.6.0 起提供文件 + 更改双树、可拖宽的资源管理器侧栏（设置 → 布局）。本仓库在「设置 → 布局 → 资源管理器侧栏」增设三个选项：
  - **打开工作区时自动展开**（默认关）：打开 workspace 时若侧栏处于关闭状态则自动展开；
  - **自动展开定位标签**（文件 / 变更，默认文件）：自动展开时定位到的树；
  - **默认打开宽度**（10%–50%，默认 25%）：侧栏无记忆宽度时占工作区宽度的比例，拖动调整后按工作区记忆。
  - 以上仅桌面宽布局生效，不覆盖紧凑窗口的悬浮侧栏。
- **「新建 workspace」页文件导航**：新建 workspace 时，右侧显示当前所选项目的文件树，切换项目自动刷新；点击文件在面板内预览（代码高亮 / Markdown / 图片，带返回按钮，可滚动、可选中复制，右键菜单仍可外部编辑器打开）。标题栏按钮 / Ctrl(Cmd)+E 开关，开合状态与宽度（220–720px）跨会话记忆。上游资源管理器仅覆盖已创建的工作区，本页补足新建流程中的文件浏览。
- **终端菜单（打开cmd / 打开PowerShell）**：所有「打开终端」类菜单（标签页「+」菜单、Workspace 菜单、命令中心、/new 启动选择器）提供「打开cmd」与「打开PowerShell」两项；PowerShell 按优先级自动解析：设置里配置的路径 → PATH 上的 pwsh → `C:\Program Files\PowerShell\7` → 系统 Windows PowerShell。可在 Settings → Host → 终端页配置「PowerShell 路径」，即改即生效。
- **文件链接错误提示增强**：对话中点击文件链接未找到文件时，错误提示附带尝试打开的完整路径，便于分析。
- **workspace tab 保护**：禁止关闭 workspace 内最后一个 agent（对话）tab，其他类型 tab 照常关闭。
- **metadata 生成默认值 daemon 级配置**：在 Settings → Host 的 metadata 生成页统一配默认指令（git 提交信息 / worktree 分支名等），新 agent 默认继承；与上游的模型选择页正交互补。
- **Claude 图片多模态降级开关**：给 Claude 的图片附件降级为 `图片：<路径>` 文本、不走多模态传输，在 Settings → Host → Agents 配置，无需手动编辑 JSON。
- **空闲自动重启（idle auto-restart）**：daemon「连续运行 ≥ 运行阈值 且 空闲 ≥ 空闲阈值」双条件同时满足时自动重启（默认 120 / 20 分钟），开关与阈值在 Settings → Host → Daemon 配置、即改即生效（watchdog 每 30s tick 动态读配置）；设置卡片显示「本次启动于 · 已运行 · 已空闲」，与触发判定同源，每次自动重启后如实归零。
- **schedules / add-project flow 中文化**。
- **全局禁止右键菜单**（desktop + web）。

## 版本与更新

- 版本号 = 对应上游版本 + `-local.N`（如 `0.6.1-local.3`），同名 tag 触发 GitHub Actions 在 windows-latest 上构建 NSIS 安装包并发布。
- 应用内自动更新指向本仓库 Release；跨上游版本的升级链无缝（如 `0.5.x-local.N → 0.6.x-local.1`）。
- 不运行上游的 CI / Android / Docker / 网站等构建流程，仅构建 Windows x64 桌面版。

## 分支模型

- `main`：最新上游稳定版快照 + 本仓库运维提交（发布 workflow 等），非 `upstream/main` 镜像。
- `local/v{version}`：对应上游版本的补丁维护与发版分支，完整改动以 `git log local/*` 为准。

## 开发

```bash
npm install
npm run dev:desktop      # Electron 桌面 dev
npm run typecheck
npm run lint
```

构建本地 exe（可选，CI 会构建）：

```bash
bash scripts/build-local.sh --x64
```

完整开发流程、调试、CLI 见 [官方开发文档](https://github.com/getpaseo/paseo) 与 [docs/development.md](docs/development.md)。

## License

AGPL-3.0，继承上游。
