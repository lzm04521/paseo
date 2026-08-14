---
name: paseo-version-follow
description: 跟进 paseo 官方新版本（fork 自 getpaseo，自用 exe 工作流）。官方发新 tag 时，**合并前先审视上一版本本地签入记录逐个核对**（上游已实现→丢弃 / 本地独有→保留）——skill 清单仅供参考、以 git log 为唯一权威；优先 git merge 快速合并（小/中版本、改动正交），大版本用策略 B 选择性重做；过验证门禁后 push 到 fork（origin=lzm04521/paseo）+ 更新 main + 打 local-v* tag 触发 CI 自动构建发 Release（win x64 exe + latest.yml，electron-updater 查 fork release 自动更新）+ 输出 handoff。触发词：paseo 发版、paseo 升级、paseo 版本跟进、paseo 新版本、跟进上游、port local patches、选择性重做、策略 B、rebase onto、官方 tag、version follow、发版跟进。
---

# Paseo 版本跟进（fork 自用，双策略：merge 优先 / 策略 B 兜底）

## 适用场景

仓库 `D:\GitHub\paseo.me`：**fork 自 getpaseo/paseo**。

- `origin` = `lzm04521/paseo`（自己 fork，push 目标）
- `upstream` = `getpaseo/paseo`（官方上游，只 fetch 同步）
- `main` = 最新稳定 tag 快照 + fork 运维 commit（release-local workflow + 删上游 workflow；非 upstream/main 镜像）
- `local/v{version}` = 发版分支，本地补丁 + fork 运维补丁在此，push 到 fork
- 浅克隆起家（v0.2.5），fetch 上游 tag 用 `--depth 1`
- **CI 自动发版**：push `local-v*` tag → `release-local` workflow 在 windows-latest 构建 win x64 exe + latest.yml 挂到 fork Release；electron-updater 查 fork release 自动更新

拓扑见 memory `paseo-fork-git-topology`，CI 发版见 `paseo-fork-ci-release`。官方发新版本 tag 时，移植本地补丁到新版本，验证后打 `local-v*` tag 让 CI 发版。

## 核心思路：双策略（不要 rebase --onto）

`git rebase --onto` 会卡在"本地旧实现 vs 上游新实现"的假冲突——大版本动辄 1000+ 文件、+10 万行，冲突无法手解。改用 checkout 新 tag 起新分支重做。

**merge 前提是 merge-base 存在**：上游 rebase/amend 式发布会让"官方 vX tag commit"与"fork 曾用的 base commit"内容相同但 SHA 不同（v0.3.1 实例：官方 `bfec7ac3a` vs fork base `84ad901a1`，`git diff` 全空但 `git merge-base local/旧 v新` 无输出）。此时直接 merge 会把整个上游历史当作新增。解法：`git diff <a> <b> --stat` 验证 tree 等价 → `git replace --graft <官方 tag commit> <fork base commit>` 缝合 → 正常 merge → 拍平后 `git replace -d <官方 tag commit>` 清理（graft 对象只在本地，不影响 push）。**注意 annotated tag 对象（`git rev-parse vX` 解出 tag 对象）不是 commit，graft 必须用 commit SHA（`git rev-parse vX^{commit}`）。**

**按版本规模选策略**：

- **小/中版本 + 改动正交** → **优先 `git merge local/旧 --no-commit --no-ff`** 快速合并，git 三方合并自动处理正交改动，零手解（v0.3.0→v0.3.1 实战：交集 14 文件全 auto-merge）。拍平成单 commit：**先** `git commit --no-verify -m tmp` 完成 merge（`git reset --soft` 在 merge 进行中报 `fatal: Cannot do soft reset in the middle of a merge`，必须先 commit），再 `git reset --soft v<新版本>` 清 MERGE_HEAD，重新 commit。详见 memory `paseo-local-build-workflow`「git merge 快速合并」段。
- **大版本 / 冲突多** → **策略 B：逐个功能评估保留/丢弃，保留项重新应用**（本 skill 下文主线）。

两策略都要先做下文「盘点上一工作线补丁 + 逐个评估」——评估结论决定 merge 是否够用 / 哪些要重做。

## 前置（每次会话必做）

1. **PATH 前置**（缺 System32 + fnm 子 bash 无 node）：
   ```bash
   export PATH="/c/Users/lzm04/AppData/Roaming/fnm/aliases/default:/c/Windows/System32:/c/Windows:$PATH"
   ```
2. **行尾符**：`git config core.autocrlf false`（仓库级已设）。假脏复发时 `git add -u && git reset` 刷 stat。
3. **读现状**：`handoff/` 最新文档 + memory（`~/.claude/projects/D--GitHub-paseo-me/memory/`）：
   - `paseo-fork-git-topology` — git 拓扑约定（origin/upstream/main/local）+ force-push main 单独授权 + 浅克隆 refspec
   - `paseo-fork-ci-release` — CI 自动发版（release-local workflow、local-v\* tag 触发、publish 改 fork、两个 CI 坑）
   - `paseo-local-build-workflow` — 工作流总览 + 行尾符陷阱 + 双策略（merge 快速合并 / 策略 B）+ 四个坑
   - `paseo-dev-npm-run-workaround` — PATH 修复
   - `handoff-output-location` — handoff 放项目 `handoff/`

## 流程

### 1. 起新分支（从官方 tag 起点，不带历史本地补丁）

```bash
# 从 upstream（getpaseo）拉新 tag，浅克隆用 --depth 1
git fetch upstream refs/tags/v<新版本>:refs/tags/v<新版本> --depth 1
git checkout -b local/v<新版本> v<新版本>
git push -u origin local/v<新版本>   # 推到自己 fork（origin=lzm04521/paseo），早推早备份
```

浅克隆图可能不连通：先 `git fetch upstream +refs/heads/main:refs/remotes/upstream/main --deepen=30` 加深，再查 `git merge-base local/v<旧版本> v<新版本>`；仍为空则按上文「核心思路」graft 缝合（deepen 用 `+` force refspec，浅克隆下普通 fetch 会 non-fast-forward reject）。

### 2. 盘点上一工作线的本地补丁（**以 git log 为唯一权威，skill 清单仅供参考**）

> ⚠️ 下方「当前已知清单」是历史快照，**不是最终实施清单**。跟进新版本时必须用 git 重新核对，不能照抄。

```bash
# 上一工作线相对其 base tag 的所有本地 commit
git log --oneline local/v<旧版本> --not v<旧版本 tag>
# 若上一工作线是拍平单 commit，看它整体改了什么（v0.3.1 工作线为多 commit，例：port commit `2bbb44f20`）
git show <旧 commit> --stat
git diff v<旧版本 tag>..local/v<旧版本> --name-only   # 改了哪些文件
```

**逐个核对**（清单每项 ↔ 实际 commit ↔ 上游新版本）：

1. 拿 git log / diff 的实际改动，**逐个**对照下方清单的功能项，确认清单是否完整、是否仍准确。
2. 每个功能项再判断上游新版本是否已实现（grep 新代码 + release notes）。
3. **有疑问就提出来**（例：上游疑似实现了但实现方式不同、本地某项是否还需保留、清单里某项似乎已被上游重命名/拆分）——不擅自决定丢弃，先问。

得到「本地独有功能清单」的**当前真相**（以本次 git 核对为准，不是 skill 清单）。

### 3. 逐个评估保留 / 丢弃

对清单每个功能，判断上游新版本是否已实现：

- 看 upstream CHANGELOG / release notes / commit history
- grep 新代码找对应实现
- **上游已实现** → 丢弃本地版，不重做
- **上游没有** → 保留，重新应用

> handoff 经验：v0.2.5→v0.3.0 升级时，file-manager action / open-in-vscode / editor-targets 小改 / diff-pane 增强等被误判为"上游已实现"而丢弃，事后发现没实现要回补。评估要落到代码证据，不能只看 release notes 标题。

### 4. 重新应用保留项

- **代码**：`git merge-file` 三方合并（base=旧 tag 文件，ours=新 tag 工作区，theirs=旧本地版）。冲突手解，保留上游结构调整 + 本地逻辑。
- **i18n**：tsx 脚本读旧版 key，补到新 9 语种文件（`ar/en/es/fr/ja/ko/pt-BR/ru/zh-CN`）。无翻译语种（ko 等）用英文 fallback，改完跑 `resources.test.ts`（强制全语种 key 同步 + 非英文语种翻译比例 <25%）。**批量补译 zh-CN 英文残留**（v0.3.1 实战：上游新功能 zh-CN 有 160 条英文残留，test 因 <25% 阈值不报但实际未本地化；参照 ja 翻译筛出 146 条补译，残留降到 15）：写临时 tsx 脚本 `import { zhCN }` + 翻译映射 → 深度 set → 自定义序列化器（2 空格缩进 / 双引号 / 尾逗号）重写文件 → `npm run format:files` 规范化，比逐个 Edit 高效。zh-CN.ts 无注释，重写不丢内容。
- **新依赖**：checkout 新 tag 后 node_modules 是旧版的，Metro bundle 报 `Unable to resolve module` → `npm install` 补。

### 5. 验证门禁（全过才算完成）

```bash
# i18n（packages/app 下）——最易因 key 不同步失败，先跑
npx vitest run src/i18n/resources.test.ts --bail=1

# 改动的 test 文件（绝不跑全量，会冻机）
npx vitest run <改动文件> --bail=1

# typecheck（各 workspace）
npm run typecheck

# lint + format（根目录，只传改动文件；不要直接调 npx eslint/oxfmt）
npm run lint -- <改动文件>
npm run format:files -- <改动文件>

# 本地 build exe（可选；CI 会构建，本地 build 主要用于发版前预检）
bash scripts/build-local.sh --x64
```

- 跨包 type 错误先 build 依赖包刷 declarations（`npm run build:server` / `build:client`），不要为消错改业务代码。
- pre-existing type 错误（非本次引入）用 `git stash` 对比确认后忽略。
- full suite 验证推 CI，不本地跑。

### 6. 发版收尾：打 tag 触发 CI + 更新 main

发版分支验证通过 + 已 push。两步收尾：

**① 打 `local-v<版本>` tag 触发 CI 自动构建发 Release**：

```bash
git tag local-v<新版本>          # 打在 local/v<新版本> HEAD（该 commit 须含 release-local workflow，见踩坑6）
git push origin local-v<新版本>  # 触发 release-local：windows-latest 构建 win x64 exe + latest.yml 挂到 fork Release
```

- CI 跑约 15-25 分钟。查进度：`"/c/Program Files/GitHub CLI/gh" run list --repo lzm04521/paseo`。
- 成功后 fork Release `local-v<新版本>` 里有 `Paseo-Setup-<版本>-x64.exe` + `latest.yml`。

**② 更新 main 到新 tag + 重加 fork 运维 commit**：

```bash
git checkout main
git reset --hard v<新版本>
git cherry-pick <上次 fork-mgmt commit>   # 重新应用 release-local.yml + 删上游 workflow（main 必须有 workflow 才能注册）
git push --force-with-lease=main:<旧 main sha> origin main
```

- `--force-with-lease` 锁基准 sha（fetch 后 `git rev-parse origin/main`），fork 只有自己一人，lease 安全。
- **force-push main 会被 Claude Code auto classifier 单独拦截（git destructive）——即使已授权本次发版，force-push main 仍需用户专门确认**，不绕过。

### 7. handoff 文档

输出到项目 `handoff/handoff-YYYY-MM-DD-<topic>.md`（已被 gitignore）。
必含：一句话、状态快照（分支/commit/exe 产物）、保留 vs 丢弃决策表、验证状态表、已知项/下一步、必读（memory + `git show` + 旧 handoff）、四个坑、验证命令速查、关键文件表、suggested skills、不适用 skill。

## 四个必踩的坑

1. **PATH 残缺**：缺 System32 + fnm 子 bash 无 node → 会话开始前置 PATH。
2. **行尾符假脏**：CRLF blob + system `autocrlf=true` → 3000+ 假脏 → `git config core.autocrlf false` 根治；升级/rebase 前必查。
3. **lefthook pre-commit**：跑全项目 typecheck+format 阻塞 commit → `git commit --no-verify`。
4. **升级后依赖缺失**：checkout 新 tag 后 node_modules 是旧版 → Metro bundle 报 resolve 失败 → `npm install` 补。

## 当前已知本地独有功能清单（**参考起点，非最终方案**——以 `git log local/*` + git diff 为唯一权威）

> **已核对 local/v0.4.0（截至 2026-08-14，HEAD `c5c813d62` = port `ac23bc870` + 清理 commit，base = v0.4.0 `b44bb63cf`）**：A/C/D/E/F 全保留；A1 与上游 #3215（metadata **模型**选择页）正交共存于同一 schema；B1/B2 零冲突；B3 **部分丢弃**（copyRelativePath + reveal 上游 #3027 已实现，revealIn 走 desktopOpenTargets→editor-targets bridge，Opus 兼容自动生效；「在 VSCode 打开」保留并按上游新菜单结构重插）；F 适配上游抽 helper 模式。冲突 15 文件（9 语种 + 6 代码），详见 `handoff/20260814-handoff-port-to-v0.4.0.md`。
> 跟进新版本时**仍必须按步骤 2 重新核对**（git log/diff 为准），**有疑问提出**，不照抄此清单。
>
> **2026-08-12 历史重写**：fork 全部签入身份统一为 `lzm04521 <lzm04521@126.com>`（filter-branch 改写原 `SIE-李兆满 <lizhaoman@chinasie.com>` 的 24 个提交，author+committer），四个分支 24 个提交 SHA 全变、内容逐字节不变，上游提交与上游 tag 未动。本 skill 引用的均为重写后新 SHA；旧 SHA（含 handoff 文档里的）仅本地 `backup/pre-rewrite-*` tag 可解析。

### A. 已 commit（v0.3.1 工作线；下列功能 v0.3.0 起有，v0.3.1 全保留）

1. **metadata generation daemon 级默认值**（三层 fallback：project → daemon → code default；管的是**指令文本**，与上游 #3215 的模型选择正交）
   - protocol `messages.ts`（本地 instructions 四 key 与上游 `providers` 合并于同一 `MutableMetadataGenerationConfigSchema`）
   - server `utils/build-metadata-prompt.ts`（**注意路径在 `src/utils/` 不在 `src/server/`**）/ `daemon-config-store.ts` / `persisted-config.ts` / `bootstrap.ts` / `session.ts` / `structured-generation-providers.ts` / `session/checkout/git-metadata-generator.ts` / `worktree-branch-name-generator.ts`（含 test）
   - app `screens/settings/host-page.tsx` 的 `MetadataGenerationDefaultsCard`（与上游 `MetadataGenerationPage` 独立并存）
2. **schedules + add-project flow 中文化**：`add-project-flow/options.ts` + `components/add-project-flow.tsx`、`components/schedules/*`（cadence-editor/schedule-form-sheet/schedule-row/schedules-table）、`screens/schedules-screen.tsx`、`screens/project-settings-screen.tsx`、`utils/project-config-form.ts`（+test）
3. **全局禁止右键菜单**（desktop + web）：`desktop/src/main.ts`、`desktop/src/window/window-manager.ts`、`app/public/index.html`
4. **i18n 9 语种 key 树**：ko 等缺翻译语种用英文 fallback

### B. 文件操作增强（v0.3.1 工作线；v0.3.0 起有，v0.3.1 持续演进——Opus 已合并进 Explorer entry、gitignore 例外已配置化）

1. **Directory Opus 文件管理器兼容**（v0.3.1 重构，commit `7d641d0b7`）：`desktop/src/features/editor-targets/targets/opus.ts` 导出 `tryLaunchOpus`，由 `explorerTarget`（`desktop/src/features/editor-targets/targets/file-manager.ts`）调用——单一 "Reveal in file manager" 菜单项，底层 win32 装了 Opus 优先用 Opus、未装回退 Windows 资源管理器。v0.3.0 是独立 `opusTarget` 注册在 `explorerTarget` 前，v0.3.1 合并进 Explorer entry（不再有独立 Opus 菜单项）。
   - launch：`dopusrt.exe /cmd Go <dir>` 复用已开 lister，fallback `dopus.exe <dir>` 开新 lister
   - 文件 reveal 退化为打开父目录（`path.dirname`），因为 Opus 命令行无可靠单命令 reveal+select（见「实现踩坑」）
2. **「在 VSCode 打开」菜单**：`workspace/open-in-editor/menu-item.tsx`（`OpenInVSCodeMenuItem`，含 `surface` 双模式）+ `use-open-in-vscode.ts`
   - **必须接入两处 sidebar 菜单**：`sidebar-workspace-menu.tsx`（workspace 级三点+右键）**和** `sidebar-workspace-list.tsx`（project 级 `ProjectMenuItem` + `projectPath`）。漏一处左侧 project 菜单就没该项。
3. **右侧文件浏览器菜单增强**（`file-actions-menu.tsx` + `file-explorer-pane.tsx`；**v0.4.0 起部分由上游实现，见下**）：
   - ~~复制虚拟路径~~ / ~~在文件管理器中打开~~：**v0.4.0 上游 #3027 已实现**（`copyRelativePath` + `revealIn {{target}}`，后者走 `desktopOpenTargets.find(kind==="file-manager")` → editor-targets bridge——**我们 Opus 合并进 file-manager target 的逻辑自动生效，无需本地代码**）
   - **在 VSCode 打开（文件/文件夹）**：本地独有保留。v0.4.0 上游重写了菜单结构（props 链四层：`renderTreeRow` → `TreeRowDispatcher` → `TreeRowItem` → `FileActionsContextMenuContent`），重插点：menu 加 `onOpenInVSCode` prop + spec（排 `reveal` 之后）+ deps；pane 每层加 `onOpenInVSCodeEntry` prop、`TreeRowItem` 加 `handleOpenInVSCode`、主组件 `useOpenInVSCode()` + `handleOpenInVSCodeEntry`（目录→自身作 workspace root，文件→workspace root + filePath）+ renderTreeRow deps
   - 上游重写区冲突取 `--ours`（上游版）后手工重插，**不要**保留旧版文件布局
4. **@ 文件选择 gitignore 例外（v0.3.1 已配置化，commit `f081a3e48`）**：`server/utils/directory-suggestions.ts` 默认列表 `DEFAULT_GIT_IGNORE_PATH_OVERRIDES = ["doc","docs","handoff"]`（原 `GIT_IGNORE_PATH_OVERRIDES` 改名）——这三个顶层目录即使被 .gitignore 排除，@ 提及文件时仍可见（仅顶层，嵌套同名不绕过）。**现已 daemon 全局可配置**：protocol `MutableFileSearchConfigSchema`（`fileSearch.gitIgnoreOverrides`，`packages/protocol/src/messages.ts`）+ daemon 接入（`packages/server/src/server/session.ts handleDirectorySuggestionsRequest` 读 `daemonConfigStore.get().fileSearch?.gitIgnoreOverrides` 注入 `searchDirectoryEntries` 的 `gitIgnorePathOverrides` option）+ 设置页 UI `FileSearchDefaultsCard`（`packages/app/src/screens/settings/host-page.tsx`，Host → Agents → "File search overrides"，textarea 每行一个目录名）+ 9 语种 i18n `settings.host.fileSearch.defaults.*`。**语义**：字段缺省→内置默认；非空数组→全量替换默认；`[]`→关闭所有豁免，完全信 gitignore。未做（留待后续）：project 级覆盖（`paseo.json`）+ 三层 fallback（project > daemon > code default，照搬 `build-metadata-prompt.ts:59-70`）。
5. **i18n**：~~9 语种补 `workspace.fileActions.openInFileManagerFailed`~~（v0.4.0 起该 key 已删，reveal 失败用上游 `fileExplorer.errors.revealFailed`）；保留 `openInVSCode`/`openInVSCodeFailed` 9 语种 key

### C. workspace tab 保护（v0.3.1 工作线，commit `f5ceeec28`）

禁止关闭 workspace 内最后一个 agent（对话）tab——其他类型 tab（file / terminal / browser / draft / subagent）照常关闭。保护按 workspace 全局算（`uiTabs` 跨 split pane 合计）。

- `packages/app/src/screens/workspace/workspace-bulk-close.ts`（新）：纯函数 `protectLastAgentTab(allTabs, tabsToClose)`——当一次关闭会清空 workspace 全部 agent tab 时，按关闭顺序保留最后一个 agent，其余照常返回关闭；返回 `{ protectedAgentTabId, remainingTabsToClose }`。泛型 `<Tab extends { tabId; target: { kind } }>`。含 test（无 agent / 多 agent 不保护 / 唯一 agent 保护 / 多 agent 批量保留最后 / 混合 tab 保护 agent 仍关非 agent）。
- `packages/app/src/screens/workspace/workspace-screen.tsx`：单 tab 关闭入口 `handleCloseAgentTab` + 批量入口 `handleBulkCloseTabs`（close left/right/others）开头都调 `protectLastAgentTab` 拦截，被保护则弹 warning toast 并 return。覆盖所有关闭入口（X 按钮、右键菜单 close/closeOthers/closeLeft/closeRight、中键、mobile ⋯ 菜单、快捷键）。
- i18n 9 语种 `workspace.tabs.toasts.cannotCloseLastAgent`。
- 若想改成「每个 pane 各留一个 agent」：把 `handleBulkCloseTabs` 里的 `uiTabs` 换成对应 pane 的 `paneTabs`、单 tab 路径同样按 pane 算。
- 顺手 fix（commit `040b343d5`）：`packages/app/src/components/draggable-list.native.tsx:122` 的 `dragGestureHostPresented` 加 `// @ts-ignore`，消除上游预存 typecheck 错误（见踩坑 #4）。

### D. fork 运维补丁（v0.3.1 起有，跟随每个 local/v{version} 分支 + main）

1. **electron-builder publish 改 fork**：`packages/desktop/electron-builder.yml` 的 `publish.owner` getpaseo → lzm04521（repo 仍是 paseo）。让 electron-updater 查 fork release 自动更新。
2. **`.github/workflows/release-local.yml`**：CI 发版 workflow（on push tag `local-v*` + workflow_dispatch；windows-latest；`npx electron-builder --win nsis --x64 --publish never`；softprops/action-gh-release 上传 exe + latest.yml）。**必须在 main + local/v{version} 两处**（main 注册 + tag commit 触发，见踩坑6）。
3. **删除上游 11 个 workflow**（`.github/workflows/` 的 ci/android-apk-release/deploy-_/desktop-_/docker/nix* 等）：fork 不跑上游 CI/部署。上游 tag glob 是 `v*`，我们的 `local-v\*`以`l` 开头不匹配，互不干扰。

### E. Web IME 候选词中断修复（v0.3.1 工作线，2026-08-12 会话签入）

web/Electron 端 RNW `TextInput`（含 `AdaptiveTextInput` → `FormTextInput` 链路 + 独立 `SettingsTextArea`）在 IME composition 期间，每次 `input` event 触发 React 19 change-event restore 路径（`restoreStateOfTarget` → `updateInput`/`updateTextarea`），无条件重写 `element.type` / `defaultValue`。**Chromium 对 input `type` 属性的任何写入（set 跟 removeAttribute 一样）都取消 composition** —— 反直觉，set 同值也打断。

修法：`packages/app/src/hooks/use-ime-composition-guard.{web,native,d.ts}` —— target 挂 capture 阶段 `input` listener，`isComposing` 时 `stopImmediatePropagation`（不 preventDefault，IME 文本照常写 DOM），阻止 event 到 React root（onChange 委托在 root 冒泡）。compositionend 后 Chromium 补发的非 composing input event 放行，RNW handleChange 自然提交。

接入点：

- `AdaptiveTextInput`（`packages/app/src/components/adaptive-modal-sheet.tsx`）：`useImeCompositionGuard(ref, isWeb && !multiline)`，单行 input（含 project-edit-name）
- `SettingsTextArea`（`packages/app/src/components/settings-textarea.tsx`）：独立 RN `TextInput` multiline + 受控，单独接入 `useImeCompositionGuard(ref, isWeb)`（host-page-file-search-defaults-input + project-settings 等）

关键（跟进新版时复查）：

- `.d.ts` 从 `.native` re-export，tsc 用它解析 import（参照 `use-audio-recorder.d.ts` 模式）；Metro 运行时选 `.web.ts`/`.native.ts`
- React Compiler 已启用，`cleanupRef` 在 callback ref 里写（commit 期，非渲染期）
- AdaptiveTextInput 保留 `inputMode="text"` 默认（方案 A 遗留：set 不解决问题但 DOM `type="text"` 语义正确，方案 B 下 type 只在挂载时设一次、不再被 restore 动）
- AdaptiveTextInput 的 `!multiline` 限制保留（避免影响可能有 onContentSizeChange 自动长高的 textarea 调用点）；SettingsTextArea 无 onContentSizeChange 不受影响

诊断陷阱：exe 的 web bundle 在 `packages/desktop/release/win-unpacked/resources/app-dist/_expo/static/js/web/index-*.js`，**不在 app.asar**（asar 只含 server/desktop 代码）。验证 exe 含改动要 grep app-dist。

完整诊断链（含方案 A 证伪过程）见 `handoff/20260811-handoff-IME候选词中断诊断.md` + memory `paseo-web-ime-composition-break`。

### F. Claude 图片多模态降级设置页开关（v0.3.1 工作线，CJ5035 签入 2026-08-12，commit `de4b5f9d8`）

Claude 图片降级（给 Claude 的图片附件降级为 `图片：<路径>` 文本，不走多模态传输）的开关，从手动编辑 `$PASEO_HOME/claude-image-downgrade.json` 迁入 daemon 配置 store，Settings → Host → Agents 页开关配置。

- protocol：`MutableDaemonConfig.claudeImageDowngrade: "off" | "on"`（默认 `"off"`，`packages/protocol/src/messages.ts`）。无新增 RPC——复用 `getDaemonConfig` / `patchDaemonConfig` / `status:daemon_config_changed`。
- daemon：`PersistedConfig.daemon.claudeImageDowngrade` 持久化到 config.json；`loadConfig` / `createInitialMutableDaemonConfig` 种子。
- 开关读取走注入链：`bootstrap`（`() => daemonConfigStore.get()`）→ `ProviderSnapshotManager` → `buildProviderRegistry` → `ClaudeAgentClient` / `ClaudeAgentSession` → `shouldDowngradeImage()` 用注入的 `getDaemonConfig` 访问器**每消息读取**，保持改动即时生效语义。
- legacy 迁移：`migrateLegacyImageDowngrade()`（`providers/claude/image-downgrade.ts`，替代原 `readImageDowngradeConfig`）启动时读旧 JSON 折进 store 后删除文件。
- app：`ClaudeImageDowngradeCard`（`screens/settings/claude-image-downgrade-card.tsx`，`useDaemonConfig` 读写）挂 `host-page.tsx` Host → Agents + 9 语种 i18n `settings.host.orchestration.imageDowngrade.*`。
- 设计文档：`doc/20260811-claude-image-downgrade-plan.md`（降级功能首版）+ `doc/20260812-claude-image-downgrade-settings-ui.md`（设置页迁移，含全链路文件清单）。

跟进新版时复查：上游若出原生图片处理开关则评估丢弃；`getDaemonConfig` 注入链跨 5 层，上游重构 provider-registry / bootstrap 参数时逐层跟改。

## 实现踩坑（v0.3.0 补丁实测得出，跟进新版时复查）

1. **sidebar 文件操作菜单有两处**：`sidebar-workspace-menu.tsx`（workspace 级）和 `sidebar-workspace-list.tsx`（project 级，`ProjectMenuItem` + `projectPath`）。加菜单项（如「在 VSCode 打开」）必须两处都加，否则左侧 project 菜单漏项——实测漏过一次（`cf1fa30a2` 修复）。grep `OpenInFileManagerMenuItem` 可定位所有需同步的菜单位置。
2. **Directory Opus 命令行**：
   - `Go` 命令只接**目录**参数；`SELECT` 是 Opus 独立命令，**不是** `Go` 的参数。`Go <file> SELECT` 命令格式错，Opus 不动（实测「点击无反应」）。
   - 文件 reveal 退化为 `Go <path.dirname(file)>`（打开父目录，不选中）——Opus 命令行无可靠单命令 reveal+select。
   - `dopusrt.exe /cmd Go <dir>`：复用已开 lister（Opus 未运行时命令可能丢失）；`dopus.exe <dir>`：开新 lister（可靠）。`opus.ts` 优先 dopusrt，fallback dopus。
   - 检测：`dopusrt.exe`/`dopus.exe` 在 `%ProgramFiles%/GPSoftware/Directory Opus/`；绝对路径用 `/` 拼 env（如 `${ProgramFiles}/GPSoftware/...`），Node `existsSync` 在 win32 能处理混合 `\` `/` 分隔符。
3. **build 前确认分支**：`build-local.sh` 本身不切分支，但 IDE/并发终端可能切走。build 失败先查 `git rev-parse --abbrev-ref HEAD`——曾在 `local/v0.2.5`（旧回退分支）上 build，因其引用 v0.3.0 才有的 `open-in-editor/` 而 Metro resolve 失败，误判为代码问题。
4. **app typecheck pre-existing 错误**（已在 local/v0.3.1 本地修复，commit `040b343d5`）：`draggable-list.native.tsx:122` 的 `dragGestureHostPresented`（react-native-draggable-flatlist 库类型不匹配）原是上游预存错误，本地照同文件 `waitFor` 同样模式加 `// @ts-ignore` 消除。跟进新版本时：若上游已修则丢弃本地 `@ts-ignore`，若上游仍报该错则重应用。判断 pre-existing 的方法不变——`git stash` 对比，tsgo 一次报全量错误，只要错误文件不在本次改动里就是 pre-existing。
5. **主进程 editor-targets 检测可独立验证**：`listAvailableEditorTargets` 不依赖 electron API（只 `isInstalled` 用 `resolveCommand`/`hasMacApplication`，`describe` 用 `loadIcon`）。写临时 tsx 脚本 mock runtime（`platform`/`env`/`pathExists`/`resolveCommand` 复制 `resolveExecutable`，`loadIcon` 返回 symbol）即可离线跑出 win32 实际检测到的 vscode/opus/explorer，无需启动 electron。
6. **release-local workflow 必须在 tag commit 上**（v0.3.1 实测）：GitHub 对 tag push 触发时查的是 **tag commit 上的 workflow 文件**，只放 main（默认分支注册）不够——tag 打在 local/v{version} 的 commit，该 commit 必须含 release-local.yml 才触发。所以 workflow 文件随 fork 运维补丁进每个 local/v{version} 分支（main 也留一份注册）。
7. **CI bash 步骤调本地 CLI 要用 `npx`**（v0.3.1 实测）：GitHub Actions 的 bash 步骤不把 `node_modules/.bin` 加 PATH（不像本地 `build-local.sh` 前置 PATH）。`electron-builder` 直接调报 `command not found`（exit 127）；`npx electron-builder` 能找本地依赖。`npm run xxx` 自带 PATH 注入不受影响。
8. **i18n 批量解冲突后查重复 key**（v0.4.0 实测）：ko 等英文 fallback 语种的 theirs 侧带旧 key（如 `copyRelativePath`），上游若同期新增同名 key 的真翻译 → 重复 key TS1117（typecheck 才报，i18n 测试不报）。merge 解完 i18n 后 `grep -c` 每语种重点 key 或直接靠 typecheck 抓。
9. **merge 残留行会爆 complexity lint**（v0.4.0 实测）：上游把 `??` 链抽成 `resolveXxx(persisted)` helper 降 `resolveStaticLoadConfigSettings` 复杂度；merge 两边全留（独立 `terminalProfiles` 行 + 我们 `claudeImageDowngrade` 的 `??`）→ complexity 22>20 爆 `eslint(complexity)`。修法照上游模式：删 helper 已覆盖的冗余行 + 本地字段也抽 helper（`config.ts` 的 `resolveClaudeImageDowngrade`）。**上游有抽 helper 模式的文件，本地新增字段一律跟该模式，不写裸 `??` 行。**
10. **server 测试 `undefined._zod` = protocol dist 陈旧**（v0.4.0 实测）：checkout 新 tag 后跑 server 测试，`z.array(AgentProfileSchema)` 类报 `Cannot read properties of undefined (reading '_zod')`——import 的 protocol dist 里没有新导出。先 `npm run build:server` 重建 declarations 再重测，不要改业务代码。
11. **bash cwd 跨调用漂移**：连续 Bash 调用的 cwd 会延续（曾停在 `packages/app` 导致 `cd packages/app` 失败短路、后续命令在错误目录跑）。多步命令用绝对路径 `/d/GitHub/paseo.me` 起手，或每条命令自带 `cd` 并校验。
12. **tag push 可能被 auto classifier 拦**（v0.4.0 实测）：`git push origin local-v*` 触发发版，Stage 2 classifier 瞬时故障会连续拦截（分支 push 正常）。重试数分钟内可过；用户明确授权后继续重试即可。

## 不适用本项目（避免误触发）

smom、sie-smom、tfs、tfs-tools、itsm、itsm-service-report、officecli 等 SIE 内部业务 skill——paseo 是开源项目，无关。
