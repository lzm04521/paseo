# Claude 图片多模态降级 — 设置页开关 实施计划

> 创建日期：2026-08-12
> 状态：✅ 全部完成（6/6）
> 前置：`doc/20260811-claude-image-downgrade-plan.md`（已实施，feature 分支 `feat/claude-image-downgrade`）

## 一、需求概述

当前 Claude 图片降级开关通过手动编辑 `$PASEO_HOME/claude-image-downgrade.json`（`{ "mode": "on" }`）控制。用户要求改为在 app 设置页面中用开关配置，不再手动改 JSON。

实现方式：把开关折叠进 daemon 既有 `MutableDaemonConfig`（daemon 配置 store，已通过 `getDaemonConfig`/`patchDaemonConfig` RPC + `status:daemon_config_changed` push 暴露给 app），app 设置页用既有 `useDaemonConfig`/`patchConfig` 模式读写。Claude agent 每消息读取开关时从 daemon 配置 store 取值（注入 `getDaemonConfig` 访问器），保持「每次消息读、改动即时生效」的现有行为。

## 二、功能边界

### 包含范围

- 新增 `MutableDaemonConfig.claudeImageDowngrade: "off" | "on"`（默认 `"off"`），协议、持久化、RPC 全链路打通。
- app 设置页新增开关卡片：Host → Agents 页（与 `InjectPaseoToolsCard`、`AppendSystemPromptCard` 同组），用 `useDaemonConfig` 读写。
- Claude agent `shouldDowngradeImage()` 改为从 daemon 配置 store 读开关（注入 `getDaemonConfig` 访问器），保留每消息读取、即时生效。
- 旧 `$PASEO_HOME/claude-image-downgrade.json` 一次性迁移进配置 store 后删除（保护开发期手动配置）。
- i18n：9 个 locale 文件同步新增键（`resources.test.ts` 强制键 parity）。

### 不包含范围

- 不改降级本身的落盘逻辑（仍复用 `materializeProviderImage`）、不改 `图片：<路径>` 文本格式、不改 `toSdkUserMessage` 降级分支（仅改开关来源）。
- 不新增独立 RPC（复用 `getDaemonConfig`/`patchDaemonConfig`，无协议 RPC 表面新增）。
- 不把开关做成每 agent / 每 workspace 级 —— 保持 daemon 级全局开关。
- 不做 app 侧本地缓存开关 —— 开关属于 daemon 配置，远程 host 也能用。

## 三、核心实体定义

### 实体 1：`MutableDaemonConfig`（protocol，`packages/protocol/src/messages.ts`）

- **用途**：daemon 可变配置，`getDaemonConfig` RPC 响应 + `patchDaemonConfig` RPC 入参 + `status:daemon_config_changed` push 载荷。
- **新增属性**：
  - `claudeImageDowngrade: "off" | "on"`（schema 用 `z.enum(["off","on"]).default("off")`，保证 store 解析后恒存在）
  - patch schema 增加 `claudeImageDowngrade: z.enum(["off","on"]).optional()`（`.partial()` 兜底）
- **关联**：`PersistedConfig.daemon.claudeImageDowngrade`（持久化镜像）；`PaseoDaemonConfig.claudeImageDowngrade`（启动种子）。

### 实体 2：`PersistedConfig.daemon`（`packages/server/src/server/persisted-config.ts`）

- **用途**：`$PASEO_HOME/config.json` 的 schema，daemon 配置落盘格式。
- **新增属性**：`claudeImageDowngrade: z.enum(["off","on"]).optional()`。

### 实体 3：`getDaemonConfig` 访问器（server 内部注入）

- **类型**：`() => MutableDaemonConfig`
- **用途**：把 daemon 配置 store 的读取能力注入 Claude agent client，用于每消息读开关。
- **注入链**：`bootstrap`（`() => daemonConfigStore.get()`）→ `ProviderSnapshotManager` 构造 → `buildProviderRegistry` → `ClaudeAgentClient` 构造 → `ClaudeAgentSession` → `shouldDowngradeImage()`。

## 四、实施计划

### 需要修改的文件

| 文件 | 修改内容 | 涉及类/方法 |
|---|---|---|
| `packages/protocol/src/messages.ts` | `MutableDaemonConfigSchema` + `MutableDaemonConfigPatchSchema` 加字段 | schema 常量 |
| `packages/server/src/server/persisted-config.ts` | `PersistedConfigSchema.daemon` 加可选字段 | schema 常量 |
| `packages/server/src/server/bootstrap.ts` | `PaseoDaemonConfig` 接口加字段；`createInitialMutableDaemonConfig` 种子；`ProviderSnapshotManager` 注入 `getDaemonConfig`；legacy 迁移 | `createInitialMutableDaemonConfig` |
| `packages/server/src/server/config.ts` | `resolveStaticLoadConfigSettings` 加 `claudeImageDowngrade`（读 `persisted.daemon`）；`loadConfig` 组装 | `resolveStaticLoadConfigSettings` |
| `packages/server/src/server/daemon-config-store.ts` | `mergeMutableConfigIntoPersistedConfig` 持久化新字段 | 该函数 |
| `packages/server/src/server/agent/provider-snapshot-manager.ts` | 构造选项加 `getDaemonConfig?`，透传给 `buildProviderRegistry` | `ProviderSnapshotManager` |
| `packages/server/src/server/agent/provider-registry.ts` | 加 `MutableDaemonConfig` type import；`BuildProviderRegistryOptions`/`ProviderClientFactoryOptions`/`buildResolvedBuiltinProviders` 参数各加 `getDaemonConfig?`；`buildProviderRegistry`→`buildResolvedBuiltinProviders`→`resolveProvider.createBaseClient` 与 `addDerivedProviders`→`baseFactory` 逐层透传；claude factory 透传 | `buildProviderRegistry`、`buildResolvedBuiltinProviders`、`addDerivedProviders` |
| `packages/server/src/server/agent/providers/claude/agent.ts` | 加 `MutableDaemonConfig` type import；`ClaudeAgentClientOptions`/`ClaudeAgentSessionOptions` 加 `getDaemonConfig?`；`shouldDowngradeImage` 改用访问器；删 `readImageDowngradeConfig` import | `shouldDowngradeImage` |
| `packages/app/src/screens/settings/host-page.tsx` | 渲染 `ClaudeImageDowngradeCard` 进 `HostAgentsPage`（卡片本体在独立文件，见下） | `HostAgentsPage` |
| `packages/app/src/i18n/resources/{en,ar,es,fr,ja,ko,pt-BR,ru,zh-CN}.ts` | `settings.host.orchestration.imageDowngrade.*` 键（9 文件） | i18n 资源 |

### 需要重写/删除的文件

| 文件 | 动作 |
|---|---|
| `packages/server/src/server/agent/providers/claude/image-downgrade.ts` | 改造：`readImageDowngradeConfig` → `migrateLegacyImageDowngrade(paseoHome, logger)`（读旧文件、删除、返回 mode 或 null） |
| `packages/server/src/server/agent/providers/claude/image-downgrade.test.ts` | 重写为迁移函数测试 |
| `packages/server/src/server/agent/providers/claude/agent.image-downgrade.test.ts` | 重写：测试注入 `getDaemonConfig` 返回 `{ claudeImageDowngrade: "on" }` |

### 需要新增的文件

| 文件 | 用途 | 主要内容 |
|---|---|---|
| `packages/app/src/screens/settings/claude-image-downgrade-card.tsx` | 设置开关卡片组件（独立文件，同 `browser-tools-card.tsx` 先例） | `ClaudeImageDowngradeCard`：`useDaemonConfig` 读写，Switch 切换 |
| `packages/app/src/screens/settings/claude-image-downgrade-card.test.tsx` | 设置卡片组件测试（仿 `providers-section.test.tsx` jsdom 模式） | mock `useDaemonConfig`/`Switch`，断言开关初值绑定 + 切换调用 `patchConfig` |

## 五、实施步骤

> 每个 Task 末尾给出建议 commit message；`git add`/`git commit` 须人工确认后执行（项目规则）。
> 每次改动后：`npm run typecheck` + `npm run lint`。提交前 `npm run format`。
> 测试只跑改动文件：`cd packages/server && npx vitest run <相对路径> --reporter=verbose --bail=1`。

### Task 1：协议 schema 加字段  ✅ 已完成

> **偏离注记**：`.default("off")` 使 `MutableDaemonConfig` 推断类型中 `claudeImageDowngrade` 成为**必填**字段 → 现有对象字面量 fixture 在 typecheck 时断裂（`daemon-config-store.test.ts`、`bootstrap.ts createInitialMutableDaemonConfig`、app 侧 `push-router.test.ts`/`browser-tools-config.test.ts`/`providers-section.test.tsx`）。属机械修复，随各任务所属文件一并更新（Task 2 修 server 侧、Task 5 修 app 侧）。

**Files:** `packages/protocol/src/messages.ts`

- `MutableDaemonConfigSchema`（line 147-164），在 `enableTerminalAgentHooks` 之后加：

```ts
claudeImageDowngrade: z.enum(["off", "on"]).default("off"),
```

- `MutableDaemonConfigPatchSchema`（line 166-182），在 `enableTerminalAgentHooks: z.boolean().optional(),` 之后加：

```ts
claudeImageDowngrade: z.enum(["off", "on"]).optional(),
```

- 协议向后兼容性检查：新字段 optional + schema `.passthrough()` → 旧 client 解析新 daemon 配置不报错；旧 daemon 忽略新 patch 字段。符合 `docs/protocol-compatibility.md` 协议契约。
- zod-aot：protocol 的 `prebuild`/`pretypecheck`/`pretest` 自动跑 `generate:validators`，无需手动。

**验证：**
```
npm run build:client        # 重建 protocol + client，让 app/daemon 拿到新类型
cd packages/protocol && npx vitest run src/messages.test.ts --reporter=verbose --bail=1
```

建议 commit：`feat(protocol): add claudeImageDowngrade to daemon config`

### Task 2：daemon 配置持久化 + 启动种子  ✅ 已完成

**Files:** `persisted-config.ts`、`config.ts`、`bootstrap.ts`、`daemon-config-store.ts`

- `persisted-config.ts`：`PersistedConfigSchema.daemon`（line 232-296）在 `appendSystemPrompt: z.string().optional(),` 后加：

```ts
claudeImageDowngrade: z.enum(["off", "on"]).optional(),
```

- `bootstrap.ts` `PaseoDaemonConfig` 接口（line 381-441），`appendSystemPrompt?: string;` 后加：

```ts
claudeImageDowngrade?: "off" | "on";
```

- `config.ts` `resolveStaticLoadConfigSettings`（line 441-462），`appendSystemPrompt: resolveAppendSystemPrompt(persisted),` 后加：

```ts
claudeImageDowngrade: persisted.daemon?.claudeImageDowngrade ?? "off",
```

  并在 `loadConfig` 组装（line 475-521 区域）解构 + 透传进返回的 `PaseoDaemonConfig`。

- `bootstrap.ts` `createInitialMutableDaemonConfig`（line 510-542），`appendSystemPrompt: config.appendSystemPrompt ?? "",` 后加：

```ts
claudeImageDowngrade: config.claudeImageDowngrade ?? "off",
```

- `daemon-config-store.ts` `mergeMutableConfigIntoPersistedConfig`（line 336-365），`appendSystemPrompt: mutable.appendSystemPrompt,` 后加：

```ts
claudeImageDowngrade: mutable.claudeImageDowngrade,
```

**验证（先写测试 → 跑失败 → 实现 → 跑通过）：**
- `daemon-config-store.test.ts` 加用例：`patch({ claudeImageDowngrade: "on" })` 后 `get().claudeImageDowngrade === "on"`，且持久化写入 `daemon.claudeImageDowngrade`；默认缺省为 `"off"`。
- 跑：`npx vitest run src/server/daemon-config-store.test.ts --reporter=verbose --bail=1`

建议 commit：`feat(server): persist claudeImageDowngrade in daemon config`

### Task 3：Claude agent 改从 config store 读开关（注入 getDaemonConfig）  ✅ 已完成

> **偏离注记**：Task 3 文件清单遗漏 `bootstrap.ts`，但注入链起点在 bootstrap（`() => daemonConfigStore.get()` → `ProviderSnapshotManager`）。若不做，生产 daemon 的 Claude agent 拿不到访问器 → 开关恒为 off → 设置页切换无效。已在 Task 3 补上 `new ProviderSnapshotManager({ ..., getDaemonConfig: () => daemonConfigStore.get() })`（bootstrap.ts:824 区域）。

**Files:** `provider-snapshot-manager.ts`、`provider-registry.ts`、`agent.ts`

- `provider-snapshot-manager.ts`：
  - 构造选项接口加 `getDaemonConfig?: () => MutableDaemonConfig`（从 `@getpaseo/protocol/messages` 导类型）。
  - 构造函数存 `this.getDaemonConfig`。
  - `buildRegistry()` 的 `buildProviderRegistry(this.logger, { ... })` 透传 `getDaemonConfig: this.getDaemonConfig`。
- `provider-registry.ts`（注意：factory 的 options 类型是 `ProviderClientFactoryOptions extends Pick<BuildProviderRegistryOptions, "workspaceGitService"|"managedProcesses"|"ompRuntime">`，加进 `BuildProviderRegistryOptions` 的字段不会自动流入 factory，须逐层显式透传）：
  - 顶部加 `import type { MutableDaemonConfig } from "@getpaseo/protocol/messages";`。
  - `BuildProviderRegistryOptions`（line 98-105）加 `getDaemonConfig?: () => MutableDaemonConfig`。
  - `ProviderClientFactoryOptions`（line 107-117）`extends Pick<...>` 列表补 `"getDaemonConfig"`。
  - `buildProviderRegistry`（line 844-853）调用 `buildResolvedBuiltinProviders` 时传 `getDaemonConfig: options?.getDaemonConfig`。
  - `buildResolvedBuiltinProviders`（line 681-689）的 options `Pick<...>` 列表补 `"getDaemonConfig"`；其 `resolveProvider.createBaseClient`（line 713-719）factory 调用加 `getDaemonConfig: options.getDaemonConfig`。
  - `addDerivedProviders`（line 727-730）`Pick<...>` 补 `"getDaemonConfig"`；`baseFactory` 调用（line 823-832）加 `getDaemonConfig: options.getDaemonConfig`（自定义 `extends: claude` 的 provider 与 builtin claude 行为一致）。
  - claude factory（line 185-189）：

```ts
claude: (logger, runtimeSettings, options) =>
  new ClaudeAgentClient({
    logger,
    runtimeSettings,
    getDaemonConfig: options?.getDaemonConfig,
  }),
```

- `agent.ts`：
  - 顶部加 `import type { MutableDaemonConfig } from "@getpaseo/protocol/messages";`。
  - `ClaudeAgentClientOptions`（line 389-397）加 `getDaemonConfig?: () => MutableDaemonConfig`；构造函数存。
  - `createSession`/`resumeSession`（line 1497/1515）session options 透传。
  - `ClaudeAgentSessionOptions`（line 399-409）加同字段；构造函数存。
  - `shouldDowngradeImage()`（line 3207-3209）改为：

```ts
private shouldDowngradeImage(): boolean {
  return this.getDaemonConfig?.().claudeImageDowngrade === "on";
}
```

  - 删 `import { readImageDowngradeConfig } from "./image-downgrade.js";`（line 81）。

**验证：**
- 重写 `agent.image-downgrade.test.ts`：`createSession` 时注入 `getDaemonConfig: () => ({ claudeImageDowngrade: "on" } as MutableDaemonConfig)`；其余断言不变（mode on → `图片：<路径>`；off/缺省 → base64；materialize 失败 → `图片：<保存失败>`；多图+夹文本；幂等）。新增一例：不注入访问器（默认 off）→ 不降级。
- 跑：`npx vitest run src/server/agent/providers/claude/agent.image-downgrade.test.ts --reporter=verbose --bail=1`
- 回归：`npx vitest run src/server/agent/providers/claude/agent.image-rendering.test.ts --reporter=verbose --bail=1`

建议 commit：`refactor(claude): read image-downgrade flag from daemon config`

### Task 4：legacy JSON 文件迁移  ✅ 已完成

**Files:** `image-downgrade.ts`、`image-downgrade.test.ts`、`bootstrap.ts`

- `image-downgrade.ts` 改造为：

```ts
/**
 * One-time migration of the pre-UI switch file $PASEO_HOME/claude-image-downgrade.json.
 * Reads it, deletes it, returns the mode ("on") or null (absent/invalid → keep default "off").
 * Never throws on read/parse failures.
 */
export function migrateLegacyImageDowngrade(
  paseoHome: string,
  logger: Logger,
): "on" | null {
  const file = path.join(paseoHome, CONFIG_FILENAME);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  try {
    fs.unlinkSync(file);
  } catch (error) {
    logger.warn({ file, err: error }, "Failed to remove legacy claude-image-downgrade.json");
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    logger.warn({ file, err: error }, "Legacy image-downgrade config is not valid JSON; ignoring");
    return null;
  }
  const result = ImageDowngradeConfigSchema.safeParse(parsedJson);
  if (!result.success) {
    logger.warn({ file, issues: result.error.issues }, "Legacy image-downgrade config invalid; ignoring");
    return null;
  }
  return result.data.mode === "on" ? "on" : null;
}
```

  `JSON.parse` 单独 try 包住，坏 JSON → warn + null（fail-open 不抛），照抄原 `image-downgrade.ts` 嵌套 try 结构。

- `bootstrap.ts`：在 `daemonConfigStore` 创建后（line 554 之后）立即执行：

```ts
const legacyDowngradeMode = migrateLegacyImageDowngrade(config.paseoHome, logger);
if (legacyDowngradeMode === "on") {
  daemonConfigStore.patch({ claudeImageDowngrade: "on" });
}
```

  （此时 field-change handler 尚未注册，patch 安全；persist 写盘同步完成。）

- `image-downgrade.test.ts` 重写为 `migrateLegacyImageDowngrade` 测试：文件缺失 → null；`{mode:"on"}` → "on" 且文件被删；`{mode:"off"}` → null 且文件被删；坏 JSON → null 不抛。

**验证：**
```
npx vitest run src/server/agent/providers/claude/image-downgrade.test.ts --reporter=verbose --bail=1
```

建议 commit：`feat(server): migrate legacy image-downgrade file into daemon config`

### Task 5：app 设置页开关卡片 + i18n  ✅ 已完成

> **偏离注记 1**：卡片组件未按计划内联在 `host-page.tsx`，而是抽取到独立文件 `claude-image-downgrade-card.tsx`（同 `browser-tools-card.tsx` 先例）。原因：`host-page.tsx` 依赖 ~28 个模块，测试若 import 它需海量 mock；独立文件使 `claude-image-downgrade-card.test.tsx` 只需 mock 轻量依赖。渲染位置不变（HostAgentsPage 内 AppendSystemPromptCard 之后）。
> **偏离注记 2**：app 包 typecheck 在 HEAD 即存在 1 处无关错误（`draggable-list.native.tsx:122` `dragGestureHostPresented` 类型不匹配，依赖版本错位）。本特性所有改动文件 typecheck 干净。未修复（超范围，Task 6 报告）。

**Files:** `host-page.tsx`、9 个 i18n 资源、新测试文件

- `host-page.tsx` 新增组件（仿 `AutoArchiveMergedWorkspacesCard`，line 1014）：

```tsx
function ClaudeImageDowngradeCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);

  const handleValueChange = useCallback(
    (next: boolean) => {
      void patchConfig({ claudeImageDowngrade: next ? "on" : "off" }).catch((error) => {
        console.error("[HostPage] Failed to update Claude image downgrade", error);
        Alert.alert(
          t("settings.host.orchestration.imageDowngrade.errorTitle"),
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [patchConfig, t],
  );

  if (!isConnected) return null;

  return (
    <View style={settingsStyles.card} testID="host-page-claude-image-downgrade-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>
            {t("settings.host.orchestration.imageDowngrade.title")}
          </Text>
          <Text style={settingsStyles.rowHint}>
            {t("settings.host.orchestration.imageDowngrade.hint")}
          </Text>
        </View>
        <Switch
          value={config?.claudeImageDowngrade === "on"}
          onValueChange={handleValueChange}
          accessibilityLabel={t("settings.host.orchestration.imageDowngrade.accessibilityLabel")}
          testID="host-page-claude-image-downgrade-switch"
        />
      </View>
    </View>
  );
}
```

- `HostAgentsPage`（line 269-293）在 `AppendSystemPromptCard` 后渲染 `<ClaudeImageDowngradeCard serverId={serverId} />`。
- i18n：9 个资源文件的 `settings.host.orchestration` 下加（en 基准，其余 8 语言键一致、文案翻译）：

```ts
imageDowngrade: {
  title: "Claude image downgrade",
  hint: "Send prompt images as file paths instead of base64 for text-only Claude models",
  accessibilityLabel: "Claude image downgrade",
  errorTitle: "Unable to update Claude image downgrade",
},
```

- 新测试 `claude-image-downgrade-card.test.tsx`（仿 `browser-tools-config.test.ts` 模式）：mock `useDaemonConfig`，断言开关初值绑定 `config.claudeImageDowngrade === "on"`、切换调用 `patchConfig({ claudeImageDowngrade: "on" | "off" })`。

**验证：**
```
npx vitest run src/screens/settings/claude-image-downgrade-card.test.tsx --reporter=verbose --bail=1
cd packages/app && npx vitest run src/i18n/resources.test.ts --reporter=verbose --bail=1
```

建议 commit：`feat(app): add Claude image downgrade toggle to host agents settings`

### Task 6：收尾验证 + 文档同步  ✅ 已完成

> **验证结果**：`build:client` ✓、`build:server`(直接 workspace build)✓、server typecheck ✓、app typecheck 仅有 1 处 HEAD 既有无关错误(`draggable-list.native.tsx`)、lint 6 处 error 全为 HEAD 既有(测试文件 mock 组件缺 display name,均非本特性文件)、`oxfmt --check` 全仓 3551 文件未格式化(oxfmt 迁移遗留,非本特性引入,未运行全局 format 以免产生 3551 文件无关 diff)。本特性全部测试 105 例通过(protocol 20 + server 31 + app 54)。文档已同步。

- 全量 `npm run typecheck` + `npm run lint`（跨包类型：先 `npm run build:client` 再 `npm run build:server` 让 dist 声明最新）。
- 跑本特性全部测试一次（protocol messages + daemon-config-store + image-downgrade + agent.image-downgrade + app card）。
- `npm run format:check`，有 diff 则 `npm run format`。
- 更新 `doc/20260811-claude-image-multimodal-downgrade.md` spec：配置方式从「手动 JSON 文件」改为「设置页开关（Host → Agents）」；更新 `doc/20260811-claude-image-downgrade-plan.md` 状态行。

建议 commit：`docs(claude): switch image-downgrade config to settings UI`

## 六、注意事项

- **协议契约**：新字段 optional + `.passthrough()`，不 narrow/remove 任何现有字段；zod-aot 自动再生成，wire schema 保持纯（`z.enum`/`.default` 现有 schema 已用，合规）。
- **`getDaemonConfig` 注入链全 optional**：所有新增构造选项均 optional，不破坏既有测试/调用点（不传 = 不降级，默认 off）。
- **每消息读取语义保留**：`getDaemonConfig` 是活的闭包（`() => daemonConfigStore.get()`），设置页切换后下一消息即生效，不重启 session。
- **双写风险规避**：本方案单数据源（config store），无镜像文件；legacy 文件仅一次性迁移后删除。
- **远程 host**：开关走 daemon RPC（`patchDaemonConfig`），app 连远程 daemon 同样可配，开关作用在 daemon 侧。
- **测试规则**：只跑改动文件，绝不 `npm run test` 全量（冻机）。跨包类型错先重建 dist。
- **签入**：代码修改后不自动签入，每 Task 结束人工确认后执行建议 commit。

## 七、Self-Review

1. **单一数据源**：开关只在 `MutableDaemonConfig`（→ `PersistedConfig.daemon`），agent 经 `getDaemonConfig` 读同一 store。无第二份运行时配置。
2. **向后兼容**：协议新增可选字段；旧 client/daemon 互操作不受影响。
3. **行为保持**：降级分支逻辑（`图片：<路径>`、`<保存失败>`、幂等落盘）零改动，仅开关来源变更。
4. **测试覆盖**：store 持久化、agent 降级矩阵（注入访问器）、legacy 迁移、app 卡片、i18n parity。
5. **范围克制**：不新增 RPC、不碰协议 RPC 命名、不碰 `materializeProviderImage`、不做每 agent 级开关。
6. **注入链完整**：`getDaemonConfig` 从 bootstrap → `ProviderSnapshotManagerOptions` → `BuildProviderRegistryOptions`/`ProviderClientFactoryOptions` → claude factory → `ClaudeAgentClientOptions` → `ClaudeAgentSessionOptions` 全链路逐层显式透传（含 `buildResolvedBuiltinProviders`、`resolveProvider.createBaseClient`、`addDerivedProviders`/`baseFactory`），无 Pick 漏层，typecheck 可过。
