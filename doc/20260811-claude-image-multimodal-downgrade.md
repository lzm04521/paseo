# Claude Code 图片多模态降级实施文档

日期:2026-08-11
关联 PR/issue:#1960(v0.1.105,Pi only,本方案为 Claude 对等能力)
状态:已实施。开关入口改为 app 设置页 **Host → Agents**(配置方式见 `doc/20260812-claude-image-downgrade-settings-ui.md`),旧 JSON 文件一次性迁移。

## 1. 背景与问题

Paseo 连接 Claude Code 时,若底层模型不支持多模态(典型场景:用户用 cc-switch 把 Claude Code 切到纯文本模型,如 DeepSeek/GLM 系),发送图片会被 Claude Code 回吐 `[unsupported Image]`,图片信息丢失、会话可能受阻。

v0.1.105 的 PR #1960 已为 Pi 解决此问题(`packages/server/src/server/agent/providers/pi/agent.ts` 的 `piModelSupportsImageInput` + `renderTextOnlyImageHint`,把图片落盘并发 `[Image available at: <path>]`)。本方案为 Claude Code 实现对等能力。

### 为什么不能照搬 Pi 的 manifest 探测

- `packages/server/src/server/agent/providers/claude/model-manifest.ts` 只有 `supportsThinkingDisabled`/`supportsFastMode`,**无多模态能力位**;且只覆盖第一方 Claude 模型(全为 vision)。
- Paseo 运行时 `this.config.model`(`packages/server/src/server/agent/providers/claude/agent.ts:1655-1660` 的 `assertConfig`)来自 paseo UI 传入,**不读 `~/.claude/settings.json`**。cc-switch 在外部改 Claude Code 真实模型,paseo 看到的 `config.model` 仍是 "claude-opus-5" 之类 → paseo 不按模型 gate 图片输入,一律发 base64 → 永不降级。
- 结论:**有 cc-switch,paseo 无法可靠自动判定真实模型是否纯文本**。故本方案不尝试自动探测,采用**纯手动开关**:用户在用纯文本模型时自行开启。

## 2. 目标与范围

**目标**:Claude Code agent 在开关开启时,把用户 prompt 里的图片落盘到系统临时目录(`os.tmpdir()`),改为发送 `图片：<绝对路径>` 文本,与原文字一齐发给 Claude Code CLI。Windows 由 OS 自动清理 temp;纯文本模型仅取路径提示、不"看"图,临时性可接受(与 Pi 一致)。

**范围(做)**:
- `toSdkUserMessage`(`packages/server/src/server/agent/providers/claude/agent.ts:3206-3239`)的 user prompt image block。
- 新增 daemon 侧专用配置文件 + 判定/落盘/提示逻辑。

**范围(不做)**:
- history replay、subagent sidechain、tool_result 内的 image block(后者已由 `splitClaudeToolResultImages` `agent.ts:681` 处理)。
- Pi / Codex / Copilot / OpenCode / OMP provider。
- protocol 线协议、`ClaudeProviderOptionsSchema`、SDK settings、`.gitignore`、paseo `docs/`。
- 自动探测真实模型(已论证不可靠,见 §1)。

## 3. 配置

开关折叠进 daemon 可变配置 `MutableDaemonConfig.claudeImageDowngrade`(protocol,`packages/protocol/src/messages.ts`),持久化于 `$PASEO_HOME/config.json` 的 `daemon.claudeImageDowngrade`。app 设置页 **Host → Agents** 的开关卡片读写(经 `getDaemonConfig`/`patchDaemonConfig` RPC)。

| 取值 | 默认 | 语义 |
|---|---|---|
| `"off"` | `"off"` | 不降级,原样发 base64 image block |
| `"on"` | — | 无条件降级(每图落盘 + 发路径) |

**旧配置迁移**:实现前的 `$PASEO_HOME/claude-image-downgrade.json`(手编 `{ "mode": "on" }`)在 daemon 启动时一次性迁移进配置 store(`migrateLegacyImageDowngrade`,读后删除文件),`mode:"on"` 写入 `daemon.claudeImageDowngrade:"on"`;文件缺失/坏 JSON/`mode:"off"` → 保持默认 `"off"`(fail-open,不抛)。

**读取频率**:每次 `toSdkUserMessage` 调用经注入的 `getDaemonConfig()` 读一次(活的 store 闭包,设置页切换后下条消息生效,不重启 session)。

## 4. 判定逻辑

新增私有方法 `shouldDowngradeImage(): boolean`(实例方法):

```
return this.getDaemonConfig?.().claudeImageDowngrade === "on"
```

`getDaemonConfig` 是 daemon 配置 store 的读取访问器,由 bootstrap 注入(`() => daemonConfigStore.get()`),经 `ProviderSnapshotManager` → `buildProviderRegistry` → claude factory → `ClaudeAgentClient` → `ClaudeAgentSession` 逐层透传。未注入(测试/无 store)→ 返回 false(默认 off)。

无模型探测、无 settings.json 读取、无关键字匹配。纯开关。

## 5. 落盘与提示

仅当 `shouldDowngradeImage()` 为 true 时,对每个 image block 执行:

1. `const { path: absPath } = materializeProviderImage({ data: chunk.data, mimeType: chunk.mimeType })`。
   - 复用 `packages/server/src/server/agent/providers/provider-image-output.ts:87` 的 `materializeProviderImage`:内部完成 `os.tmpdir()` 下建私目录(0700)、sha256 哈希命名、`writeFileSync` 0600、同内容幂等去重。**落盘逻辑零新代码**。
2. **失败兜底**:`materializeProviderImage` 抛错(mkdtemp/write 失败)→ catch → 提示串改为 `图片：<保存失败>` + warn(`$PASEO_HOME/daemon.log`),**不中断发送**。

`materializeProviderImage` 同步签名 → `toSdkUserMessage` 保持同步不变。无需 `config.cwd`(tmpdir 恒存在,无 null 特判)、无需 `getImageExtension`(已内含)、无需自建目录。

**提示串格式**(inline 替换,保留图片在消息中的位置,多图各占一行):
```
图片：/tmp/paseo-attachments-XXX/3f9a1b....png
```

content 数组里,该 image block 替换为 `{ type: "text", text: "图片：" + absPath }`。其余 text block / 附件 block 原样保留,顺序不变。绝对路径 → Claude Code(任意 cwd)可直接读。

## 6. 调用点改动

`packages/server/src/server/agent/providers/claude/agent.ts:3222-3232`(`toSdkUserMessage` 的 image 分支):

现状:
```ts
} else if (chunk.type === "image") {
  if (isImageMimeType(chunk.mimeType)) {
    content.push({ type: "image", source: { type: "base64", media_type: chunk.mimeType, data: chunk.data } });
  }
}
```

改为:
```ts
} else if (chunk.type === "image") {
  if (!isImageMimeType(chunk.mimeType)) continue;          // 非法 mime 跳过(现状行为)
  if (this.shouldDowngradeImage()) {
    const absPath = this.saveImageToTemp(chunk);      // 返回绝对路径或 "<保存失败>"
    content.push({ type: "text", text: `图片：${absPath}` });
  } else {
    content.push({ type: "image", source: { type: "base64", media_type: chunk.mimeType, data: chunk.data } });
  }
}
```

`toSdkUserMessage` 保持同步(落盘委托 `materializeProviderImage`,见 §5)。

新增私有方法:
- `private shouldDowngradeImage(): boolean`
- `private saveImageToTemp(chunk: { data: string; mimeType: string }): string`(try `materializeProviderImage` → 返回绝对路径;catch → 返回 `"<保存失败>"`;同步)

(注：materializeProviderImage 已在 agent.ts:85 导入,无需新 import;开关读取改用注入的 `getDaemonConfig` 访问器,不再 import `readImageDowngradeConfig`。)

新增模块级纯函数(`image-downgrade.ts`):
- `migrateLegacyImageDowngrade(paseoHome, logger): "on" | null`(一次性迁移旧 `$PASEO_HOME/claude-image-downgrade.json`:读后删除文件,`mode:"on"` 返回 `"on"`,缺失/坏 JSON/`mode:"off"` 返回 null;fail-open 不抛。daemon 启动时由 bootstrap 调用并 `patch({ claudeImageDowngrade: "on" })`)

## 7. 测试

新建 `packages/server/src/server/agent/providers/claude/agent.image-downgrade.test.ts`(与 `agent.image-rendering.test.ts` 同目录,沿用其 harness):

| 用例 | 期望 |
|---|---|
| 不注入访问器(默认 off)/ 注入返回 `"off"` | content 含原 base64 image block |
| 注入返回 `"on"` | content 含 `图片：<tmpdir>/...<hash>.<ext>` 文本块,无 image block,文件落盘内容等于原 bytes |
| `"on"` + `materializeProviderImage` 抛错(注入失败实现) | content 含 `图片：<保存失败>`,不抛,发送继续 |
| 多图 + 中间夹文本 | 顺序保留,每图独立文本块 |
| `"on"` + 同图发两次 | 同 hash 文件复用(幂等) |

按项目规则只跑单文件:`npx vitest run src/server/agent/providers/claude/agent.image-downgrade.test.ts --bail=1`。

## 8. 边界

- **落盘位置 = `os.tmpdir()`**:系统临时目录,Windows 由 OS 自动清理,Linux/macOS 重启或 tmpwatch 清。绝对路径 → Claude Code 任意 cwd 可读。**不进用户 git 仓库,无隐私外溢**。
- **临时性**:temp 清理后历史 `图片：<abs path>` 文本仍在但文件失效。纯文本模型仅取路径提示、不"看"图,可接受(与 Pi 一致)。
- **不与 `[image]` 占位混淆**:`agent.ts:693` 的 `[image]` 是 tool_result 图片占位,本方案的 `图片：...` 仅出现在 user message,无冲突。
- **不读 cc-switch / settings.json / `lastRuntimeModel`**:开关由用户全权控制,不做任何隐式判定。

## 9. 不改动项

- `packages/protocol`(线消息不新增 RPC、无 breaking change;仅 `MutableDaemonConfig` 加可选字段 `claudeImageDowngrade`)
- `ClaudeProviderOptionsSchema`(`packages/server/src/server/agent/providers/claude/options.ts`)
- SDK settings(`buildSettingsOptions`)
- Pi / Codex / Copilot / OpenCode / OMP provider
- model-manifest
- `provider-image-output.ts`(**仅复用 `materializeProviderImage`,零改动**,无需 export `getImageExtension`)
- `~/.claude/settings.json`(本方案完全不碰)
- `.gitignore`、paseo `docs/`

## 10. 文件清单(实施时预计触及)

新增:
- `packages/server/src/server/agent/providers/claude/image-downgrade.ts`(`migrateLegacyImageDowngrade` 迁移函数 + zod schema)
- `packages/server/src/server/agent/providers/claude/agent.image-downgrade.test.ts`

改动:
- `packages/server/src/server/agent/providers/claude/agent.ts`(`toSdkUserMessage` image 分支 + 两私有方法 + `getDaemonConfig` 访问器注入)

设置页开关(protocol schema / 持久化 / app 卡片 / i18n / legacy 迁移)见 `doc/20260812-claude-image-downgrade-settings-ui.md`。

`provider-image-output.ts` **不改**(仅被 agent.ts import 复用)。

## 11. 后续(超出本次范围,仅备忘)

- 若未来需要自动探测:读 `~/.claude/settings.json` 真实模型 + 关键字模糊匹配,或反应式捕获 `[unsupported Image]` 自动开启。当前不做(已论证 cc-switch 场景下不可靠/首图必失败)。
