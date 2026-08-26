<!-- 本文件是 fork 自定义版（lzm04521/paseo），不是上游镜像。
     跟进上游新版本时必须保留本地版，不要被上游 README 覆盖：
       - merge 流程冲突：git checkout --theirs README.md && git add README.md
       - 策略 B 重做：    git checkout main -- README.md
     详见 paseo-version-follow skill D 类清单 D5。release-local workflow 有 guard 步骤校验本文件。 -->

<p align="center">
  <img src="packages/website/public/logo.svg" width="64" height="64" alt="Paseo logo">
</p>

<h1 align="center">Paseo · 个人 fork</h1>

<p align="center">
  Fork 自 <a href="https://github.com/getpaseo/paseo">getpaseo/paseo</a>。仅发布 Windows x64 桌面版，自用。
</p>

<p align="center">
  <a href="https://github.com/getpaseo/paseo">
    <img src="https://img.shields.io/badge/upstream-getpaseo/paseo-555?logo=github" alt="upstream">
  </a>
  <a href="https://github.com/lzm04521/paseo/releases">
    <img src="https://img.shields.io/github/v/release/lzm04521/paseo?style=flat&logo=github&include_prereleases" alt="release">
  </a>
</p>

## 这是什么

[Paseo](https://github.com/getpaseo/paseo) 是监控和操控本地 AI 编码 agent 的桌面 / 移动 / Web / CLI 应用。本仓库是个人 fork，只构建 **Windows x64 桌面版**，用来跟进上游 release、移植本地补丁、通过 GitHub Actions 自动发版到 [fork Release](https://github.com/lzm04521/paseo/releases)，配合 electron-updater 自动更新。

> 移动端 / Web / macOS / Linux / Docker / CLI / Hub 等所有其他能力与上游一致，完整功能介绍、安装、配置、CLI 参考请看 **[官方仓库 getpaseo/paseo](https://github.com/getpaseo/paseo)** 与 **[官方文档 paseo.sh](https://paseo.sh/docs)**。

## 下载安装

从 [Releases](https://github.com/lzm04521/paseo/releases/latest) 下载 `Paseo-Setup-<版本>-x64.exe`（如 `Paseo-Setup-0.5.1-local.5-x64.exe`）安装。**仅支持 Windows x64**。

已安装旧版时，应用启动后自动检查 fork Release 并升级（electron-updater）。

## 相对上游的改动

本地补丁跟随每个 `local/v{version}` 发版分支维护，以 `git log local/*` 为权威。清单见 `skills/paseo-version-follow` skill 与 `handoff/`。

### 桌面 / 文件操作

- **Directory Opus 兼容**：装了 Directory Opus 时，「在文件管理器中显示 / Reveal」优先复用已开 Opus lister，未装回退 Windows 资源管理器；上游 v0.4.0 的 Reveal in file manager 也走这条 Opus 路径。
- **「在 VSCode 打开」菜单**：workspace 三点菜单、project 三点菜单、文件浏览器右键菜单，均可在 VSCode 打开 workspace / project / 文件 / 文件夹。
- **@ 文件选择 gitignore 例外**：`doc` / `docs` / `handoff` 顶层目录即使被 .gitignore 排除，@ 提及时仍可见；可在 Settings → Host → Agents 配置。

### UI / 行为

- **文件 / 更改侧边栏（上游 v0.6.0 恢复）**：上游 v0.6.0 恢复了专用资源管理器侧边栏（文件 + 更改，默认常驻、可拖宽），并新增按操作细分的「打开位置」设置（设置 → 布局）；fork 此前自研的「文件导航」侧边栏面板与「侧边栏」外观设置（默认打开 / 占比 / 文件打开位置 / 自动打开）已于 0.6.0-local.1 起移除，直接采用上游实现。fork 另增设「打开工作区时自动展开」开关（设置 → 布局 → 资源管理器侧栏，默认关）：打开 workspace 时若侧栏处于关闭状态则自动展开，并定位到「文件」树（仅桌面宽布局生效，不覆盖紧凑窗口的悬浮侧栏）。
- **「新建 workspace」页文件导航**：新建 workspace 时，右侧显示当前所选项目的文件导航（文件树），切换项目自动刷新；点击文件在面板内预览（代码高亮 / Markdown / 图片，带返回按钮，可滚动、可选中复制，右键菜单仍可外部编辑器打开）。标题栏按钮 / Ctrl(Cmd)+E 开关，与工作区侧边栏同键位，开合状态跨会话记忆；拖动面板左缘调宽度（220–720px，同样记忆）。上游资源管理器只覆盖已创建的工作区，此页为 fork 独有。
- **终端菜单（打开cmd / 打开PowerShell）**：所有「打开终端」类菜单（标签页「+」菜单、Workspace 菜单、命令中心、/new 启动选择器）改名为「打开cmd」（行为不变，Windows 默认 shell 即 cmd.exe），并各新增「打开PowerShell」；PowerShell 按优先级自动解析：设置里配置的路径 → PATH 上的 pwsh → `C:\Program Files\PowerShell\7` → 系统 Windows PowerShell。可在 Settings → Host → 终端页配置「PowerShell 路径」，即改即生效。
- **文件链接错误提示增强**：对话中点击文件链接未找到文件时，错误提示附带尝试打开的完整路径，便于分析。
- **workspace tab 保护**：禁止关闭 workspace 内最后一个 agent（对话）tab，其他类型 tab 照常关闭。
- **metadata 生成默认值 daemon 级配置**：在 Settings → Host 的 metadata 生成页统一配默认指令（git 提交信息 / worktree 分支名等），新 agent 默认继承；与上游的模型选择页正交互补。
- **Claude 图片多模态降级开关**：给 Claude 的图片附件降级为 `图片：<路径>` 文本、不走多模态传输，在 Settings → Host → Agents 配置，无需手动编辑 JSON。
- **空闲自动重启（idle auto-restart）**：daemon「连续运行 ≥ 运行阈值 且 空闲 ≥ 空闲阈值」双条件同时满足时自动重启（默认 120 / 20 分钟），开关与阈值在 Settings → Host → Daemon 配置、即改即生效（watchdog 每 30s tick 动态读配置）；设置卡片显示「本次启动于 · 已运行 · 已空闲」，与触发判定同源，每次自动重启后如实归零。
- **schedules / add-project flow 中文化**。
- **全局禁止右键菜单**（desktop + web）。

### 发版

- **只构建 Windows x64 桌面版**：fork 版本号 = 上游版本 + `-local.N`（如 `0.4.0-local.4`），同名 tag（`*-local.*`）触发 `release-local` workflow，在 windows-latest 上 `electron-builder --win nsis --x64` 构建，发到 fork Release。
- **自动更新锁定 fork 渠道**：`auto-updater` channel 写死 `local`，查 fork Release 的 `local.yml`；`latest.yml` 同内容一并上传，兼容 0.4.0 及更早按 latest 渠道检查的旧客户端。跨上游版本升级链无缝（`0.4.0-local.N < 0.5.0-local.1`）。
- **CI guard**：release workflow 校验 README 是 fork 版，防止发版流程把 fork README 冲掉。
- 删除上游 11 个 CI / 部署 workflow（fork 不跑上游 CI / Android / Docker / 网站 / Nix）。

## 跟进上游

跟进上游新版本走 `paseo-version-follow` skill：优先 `git merge` 快速合并（小 / 中版本、改动正交），大版本用策略 B 逐个补丁重做。`main` = 最新稳定 tag 快照 + fork 运维 commit（release-local workflow），不是 `upstream/main` 镜像。

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

AGPL-3.0（继承上游）。
