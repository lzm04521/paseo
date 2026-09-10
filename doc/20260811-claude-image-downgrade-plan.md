# Claude 图片多模态降级 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude Code agent 在开关 `$PASEO_HOME/claude-image-downgrade.json` 的 `mode:"on"` 时,把 user prompt 里的图片落盘到系统 tmpdir(复用 `materializeProviderImage`),改为发送 `图片：<绝对路径>` 文本,避免纯文本模型回吐 `[unsupported Image]`。

**Architecture:** daemon 侧纯手动开关(默认 `off`,不影响现状)。新增 `image-downgrade.ts` 读配置(zod + fail-open);`agent.ts` 加两个私有方法 `shouldDowngradeImage` / `saveImageToTemp` 并在 `toSdkUserMessage` 的 image 分支条件替换。落盘完全委托现有 `materializeProviderImage`(`provider-image-output.ts:87`,内部完成 os.tmpdir + sha256 + 0600 + 幂等)——落盘逻辑零新代码。

**Tech Stack:** TypeScript(strict)、Node `node:fs`/`os`/`path`、`zod`、`pino` Logger、vitest。

**Spec:** `doc/20260811-claude-image-multimodal-downgrade.md`(已复审通过,Approved)。

**Status:** 已实施(feature 分支 `feat/claude-image-downgrade`)。开关配置入口已从 JSON 文件改为 app 设置页 **Host → Agents**(见 `doc/20260812-claude-image-downgrade-settings-ui.md`),旧 `$PASEO_HOME/claude-image-downgrade.json` 一次性迁移进 daemon 配置 store 后删除。

## Global Constraints

- **Spec 一致:** 实现严格匹配 spec `doc/20260811-claude-image-multimodal-downgrade.md`。任何偏离须在该 plan 文件留注释说明原因。
- **协议不变:** 不碰 `packages/protocol`,不加/改 wire schema。本特性是 daemon 本地预处理,对 client 透明,无需 `server_info.features` gate。
- **surgical:** `provider-image-output.ts` **零改动**(仅被 agent.ts 复用 `materializeProviderImage`,该函数 agent.ts:84 **已导入**,无需新 import);不碰 `~/.claude/settings.json`、`.gitignore`、model-manifest、Pi/Codex/Copilot/OpenCode/OMP provider。
- **每次改动后跑:** `npm run typecheck` + `npm run lint`。提交前 `npm run format`。
- **测试规则(强制):** 只跑本特性新增/改动测试文件,**绝不** `npm run test` 跑全量(会冻机)。命令:`npx vitest run <相对路径> --reporter=verbose --bail=1`(在 `packages/server` 下执行)。
- **签入规则:** 代码修改后**不自动签入**;每个 Task 末尾给出建议 commit message,但实际 `git add`/`git commit` 须**人工确认**后执行。
- **TDD:** 每个 Task 先写失败测试 → 跑确认失败 → 实现 → 跑确认通过 → (人工确认)提交。
- **tmpdir 行为:** 落盘文件 mode 0600(`materializeProviderImage` 内含),Windows `%TEMP%` 由 OS 清理,不进 git。

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `packages/server/src/server/agent/providers/claude/image-downgrade.ts` | 纯函数 `readImageDowngradeConfig(logger)`:读 `$PASEO_HOME/claude-image-downgrade.json`,zod 校验,fail-open 返回 `{mode:"off"\|"on"} \| null` | 新建 |
| `packages/server/src/server/agent/providers/claude/image-downgrade.test.ts` | `readImageDowngradeConfig` 单元测试(off 默认/on/off/坏 JSON/非法 mode) | 新建 |
| `packages/server/src/server/agent/providers/claude/agent.ts` | 加两私有方法 + 改 `toSdkUserMessage` image 分支 + import `readImageDowngradeConfig` | 改动 |
| `packages/server/src/server/agent/providers/claude/agent.image-downgrade.test.ts` | `toSdkUserMessage` 集成测试(spec §7 矩阵) | 新建 |

**已存在、本特性直接复用(不改):**
- `materializeProviderImage` —— `provider-image-output.ts:87`,agent.ts:84 已导入。
- `resolvePaseoHome(env)` —— `paseo-home.ts:15`。
- `isImageMimeType` —— `agent.ts:256`。
- `createTestLogger` —— `src/test-utils/test-logger.ts`。

---

## Task 1: 配置读取模块 `image-downgrade.ts`

**Files:**
- Create: `packages/server/src/server/agent/providers/claude/image-downgrade.ts`
- Test: `packages/server/src/server/agent/providers/claude/image-downgrade.test.ts`

**Interfaces:**
- Consumes: `resolvePaseoHome` from `../../paseo-home.js`(返回 PASEO_HOME 绝对路径,已建私目录);`z` from `"zod"`;`Logger` from `"pino"`;`fs from "node:fs"`、`path from "node:path"`。
- Produces: `readImageDowngradeConfig(logger: Logger): { mode: "off" | "on" } | null`。null = 视为 off(默认状态/失败兜底)。`ImageDowngradeConfig` 类型 = `{ mode: "off" | "on" }`。

- [ ] **Step 1: 写失败测试**

Create `packages/server/src/server/agent/providers/claude/image-downgrade.test.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { readImageDowngradeConfig } from "./image-downgrade.js";

describe("readImageDowngradeConfig", () => {
  let tmpHome: string;
  let previousPaseoHome: string | undefined;

  beforeEach(() => {
    tmpHome = mkdtempSync(path.join(os.tmpdir(), "paseo-img-dg-"));
    previousPaseoHome = process.env.PASEO_HOME;
    process.env.PASEO_HOME = tmpHome;
  });

  afterEach(() => {
    if (previousPaseoHome === undefined) {
      delete process.env.PASEO_HOME;
    } else {
      process.env.PASEO_HOME = previousPaseoHome;
    }
    rmSync(tmpHome, { recursive: true, force: true });
  });

  function writeConfig(json: string): void {
    writeFileSync(path.join(tmpHome, "claude-image-downgrade.json"), json, "utf8");
  }

  test("returns null when config absent (default off, silent)", () => {
    expect(readImageDowngradeConfig(createTestLogger())).toBeNull();
  });

  test("returns { mode: 'on' } when configured on", () => {
    writeConfig(JSON.stringify({ mode: "on" }));
    expect(readImageDowngradeConfig(createTestLogger())).toEqual({ mode: "on" });
  });

  test("returns { mode: 'off' } when configured off", () => {
    writeConfig(JSON.stringify({ mode: "off" }));
    expect(readImageDowngradeConfig(createTestLogger())).toEqual({ mode: "off" });
  });

  test("returns null on corrupt JSON (fail-open)", () => {
    writeConfig("{ not valid json");
    expect(readImageDowngradeConfig(createTestLogger())).toBeNull();
  });

  test("returns null on invalid mode value (fail-open)", () => {
    writeConfig(JSON.stringify({ mode: "auto" }));
    expect(readImageDowngradeConfig(createTestLogger())).toBeNull();
  });
});
```

环境变量清理说明:`previousPaseoHome === undefined` 表示测试前 `PASEO_HOME` 未设,`afterEach` 用 `delete` 还原未设状态;否则恢复原值。`tmpHome` 总是递归删除。

- [ ] **Step 2: 跑测试确认失败**

```
cd packages/server
npx vitest run src/server/agent/providers/claude/image-downgrade.test.ts --reporter=verbose --bail=1
```
Expected: FAIL —— `Cannot find module './image-downgrade.js'`(文件未建)。

- [ ] **Step 3: 写最小实现**

Create `packages/server/src/server/agent/providers/claude/image-downgrade.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import type { Logger } from "pino";
import { z } from "zod";

import { resolvePaseoHome } from "../../../paseo-home.js";

// NOTE (deviation, 2026-08-11): brief 原写 `../../paseo-home.js`,从 providers/claude/ 解析到不存在的
// server/agent/paseo-home.js;正确为 `../../../paseo-home.js`(server/paseo-home.ts,同 opencode/paths.ts:3)。

const CONFIG_FILENAME = "claude-image-downgrade.json";

const ImageDowngradeConfigSchema = z.object({
  mode: z.enum(["off", "on"]),
});

export type ImageDowngradeConfig = z.infer<typeof ImageDowngradeConfigSchema>;

/**
 * Read the daemon-side image-downgrade switch at $PASEO_HOME/claude-image-downgrade.json.
 *
 * fail-open: absent file = default state (null, treated as "off", silent);
 * corrupt JSON or invalid shape = warn + null (treated as "off"). Never throws.
 */
export function readImageDowngradeConfig(logger: Logger): ImageDowngradeConfig | null {
  const file = path.join(resolvePaseoHome(), CONFIG_FILENAME);

  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    // Absent config = default "off". Not an error; stay silent to avoid per-message log spam.
    return null;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    logger.warn({ file, err: error }, "claude-image-downgrade.json is not valid JSON; ignoring");
    return null;
  }

  const result = ImageDowngradeConfigSchema.safeParse(parsedJson);
  if (!result.success) {
    logger.warn(
      { file, issues: result.error.issues },
      "claude-image-downgrade.json has invalid shape (expected { mode: 'off' | 'on' }); ignoring",
    );
    return null;
  }

  return result.data;
}
```

- [ ] **Step 4: 跑测试确认通过**

```
cd packages/server
npx vitest run src/server/agent/providers/claude/image-downgrade.test.ts --reporter=verbose --bail=1
```
Expected: PASS(5 用例全绿)。

- [ ] **Step 5: typecheck + lint**

```
npm run typecheck
npm run lint -- packages/server/src/server/agent/providers/claude/image-downgrade.ts packages/server/src/server/agent/providers/claude/image-downgrade.test.ts
```
Expected: 无错。

- [ ] **Step 6: 人工确认后提交**

```
git add packages/server/src/server/agent/providers/claude/image-downgrade.ts packages/server/src/server/agent/providers/claude/image-downgrade.test.ts
git commit -m "feat(claude): add image-downgrade config reader"
```
（须人工确认签入）

---

## Task 2: 接入 agent.ts(toSdkUserMessage image 分支)

**Files:**
- Modify: `packages/server/src/server/agent/providers/claude/agent.ts`
  - 加 import `readImageDowngradeConfig`(line 80 附近,`./` 本地 import 组)
  - 加两私有方法(`shouldDowngradeImage`、`saveImageToTemp`),放在 `toSdkUserMessage` 之前(line 3206 前)
  - 改 `toSdkUserMessage` image 分支(line 3222-3232)
- Test: `packages/server/src/server/agent/providers/claude/agent.image-downgrade.test.ts`(新建)

**Interfaces:**
- Consumes(Task 1 产出):`readImageDowngradeConfig(logger: Logger): { mode: "off"|"on" } | null`。
- Consumes(已存在):`materializeProviderImage(image: { data: string; mimeType: string | null }): { path: string }`(已导入 agent.ts:84);`this.logger`(pino Logger,agent.ts:2075 赋值)。
- Produces: agent.ts 内两私有方法,签名固定如下,Task 内自洽、无外部消费者。

私有方法签名(后续不得改名):

```ts
private shouldDowngradeImage(): boolean
private saveImageToTemp(chunk: { data: string; mimeType: string }): string
// 返回值:成功 = tmpdir 绝对路径;失败 = 字面量 "<保存失败>"
```

- [ ] **Step 1: 写失败测试**

Create `packages/server/src/server/agent/providers/claude/agent.image-downgrade.test.ts`:

```ts
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import type { AgentPromptInput } from "../../agent-sdk-types.js";
import { ClaudeAgentClient } from "./agent.js";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X1r0AAAAASUVORK5CYII=";

interface ClaudeImageDowngradeTestSession {
  toSdkUserMessage(prompt: AgentPromptInput): SDKUserMessage;
}

async function createSession(): Promise<ClaudeImageDowngradeTestSession> {
  const client = new ClaudeAgentClient({
    logger: createTestLogger(),
    resolveBinary: async () => "/test/claude/bin",
  });
  const session = await client.createSession({ provider: "claude", cwd: process.cwd() });
  return session as unknown as ClaudeImageDowngradeTestSession;
}

type ContentBlock = { type: string; text?: string; source?: { data?: string } };

function contentsOf(msg: SDKUserMessage): ContentBlock[] {
  return (msg.message as { content: ContentBlock[] }).content;
}

function imagePrompt(): AgentPromptInput {
  return [
    { type: "text", text: "look at this" },
    { type: "image", data: PNG_BASE64, mimeType: "image/png" },
  ] as unknown as AgentPromptInput;
}

describe("Claude image downgrade (toSdkUserMessage)", () => {
  let tmpHome: string;
  let previousPaseoHome: string | undefined;

  beforeEach(() => {
    tmpHome = mkdtempSync(path.join(os.tmpdir(), "paseo-dg-"));
    previousPaseoHome = process.env.PASEO_HOME;
    process.env.PASEO_HOME = tmpHome;
  });

  afterEach(() => {
    if (previousPaseoHome === undefined) {
      delete process.env.PASEO_HOME;
    } else {
      process.env.PASEO_HOME = previousPaseoHome;
    }
    rmSync(tmpHome, { recursive: true, force: true });
  });

  function writeConfig(mode: "off" | "on"): void {
    writeFileSync(
      path.join(tmpHome, "claude-image-downgrade.json"),
      JSON.stringify({ mode }),
      "utf8",
    );
  }

  test("default (no config): keeps base64 image block", async () => {
    const session = await createSession();
    const msg = session.toSdkUserMessage(imagePrompt());
    const blocks = contentsOf(msg);
    expect(blocks.some((b) => b.type === "image" && b.source?.data === PNG_BASE64)).toBe(true);
    expect(blocks.some((b) => b.type === "text" && b.text?.startsWith("图片："))).toBe(false);
  });

  test("mode on: replaces image with 图片：<abs path> text and materializes file", async () => {
    writeConfig("on");
    const session = await createSession();
    const msg = session.toSdkUserMessage(imagePrompt());
    const blocks = contentsOf(msg);
    expect(blocks.some((b) => b.type === "image")).toBe(false);
    const textBlock = blocks.find((b) => b.type === "text" && b.text?.startsWith("图片："));
    expect(textBlock).toBeDefined();
    const absPath = textBlock!.text!.slice("图片：".length);
    expect(absPath).toMatch(/paseo-attachments/);
    expect(existsSync(absPath)).toBe(true);
    rmSync(absPath, { force: true });
  });

  test("mode on + materialize failure: emits 图片：<保存失败>, does not throw", async () => {
    writeConfig("on");
    const providerImageOutput = await import("../provider-image-output.js");
    const spy = vi
      .spyOn(providerImageOutput, "materializeProviderImage")
      .mockImplementation(() => {
        throw new Error("disk full");
      });
    try {
      const session = await createSession();
      const msg = session.toSdkUserMessage(imagePrompt());
      const blocks = contentsOf(msg);
      const textBlock = blocks.find(
        (b) => b.type === "text" && b.text === "图片：<保存失败>",
      );
      expect(textBlock).toBeDefined();
      expect(blocks.some((b) => b.type === "image")).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  test("mode on + multi-image with interleaved text: order preserved, one text block per image", async () => {
    writeConfig("on");
    const session = await createSession();
    const prompt = [
      { type: "text", text: "first" },
      { type: "image", data: PNG_BASE64, mimeType: "image/png" },
      { type: "text", text: "middle" },
      { type: "image", data: PNG_BASE64, mimeType: "image/png" },
    ] as unknown as AgentPromptInput;
    const blocks = contentsOf(session.toSdkUserMessage(prompt));
    expect(blocks.map((b) => b.type)).toEqual(["text", "text", "text", "text"]);
    const imageTexts = blocks.filter((b) => b.text?.startsWith("图片："));
    expect(imageTexts).toHaveLength(2);
    // cleanup materialized file (idempotent → same path)
    if (imageTexts[0]?.text) {
      rmSync(imageTexts[0].text.slice("图片：".length), { force: true });
    }
  });

  test("mode on + same image twice: same tmpdir path reused (idempotent)", async () => {
    writeConfig("on");
    const session = await createSession();
    const prompt = [
      { type: "image", data: PNG_BASE64, mimeType: "image/png" },
      { type: "image", data: PNG_BASE64, mimeType: "image/png" },
    ] as unknown as AgentPromptInput;
    const blocks = contentsOf(session.toSdkUserMessage(prompt));
    const paths = blocks
      .filter((b) => b.text?.startsWith("图片："))
      .map((b) => b.text!.slice("图片：".length));
    expect(paths).toHaveLength(2);
    expect(new Set(paths).size).toBe(1);
    expect(existsSync(paths[0])).toBe(true);
    rmSync(paths[0], { force: true });
  });
});
```

说明:`materializeProviderImage` 失败注入用 `vi.spyOn` 命名空间导入。vitest 拦截 ESM 命名导出,agent.ts:84 的解构导入在 vitest 下会被 spy 命中。**若 Step 4 跑该用例发现 spy 未拦截(spy 不生效)**,改用 `vi.mock("../provider-image-output.js", async (orig) => ({ ...await orig, materializeProviderImage: vi.fn(...) }))` 全模块 mock(注:这会文件级 mock,需把该失败用例拆到单独 `agent.image-downgrade-failure.test.ts`)。优先按上面 spyOn 跑通。

- [ ] **Step 2: 跑测试确认失败**

```
cd packages/server
npx vitest run src/server/agent/providers/claude/agent.image-downgrade.test.ts --reporter=verbose --bail=1
```
Expected: FAIL —— `mode on: ...` 期望出现 `图片：` 文本块,实际仍是 `image` block(`shouldDowngradeImage`/分支未实现)。

- [ ] **Step 3: 加 import**

Modify `packages/server/src/server/agent/providers/claude/agent.ts`,在 `import { claudeProjectDirSync } from "./project-dir.js";`(line 80)之后新增一行:

```ts
import { readImageDowngradeConfig } from "./image-downgrade.js";
```

- [ ] **Step 4: 加两私有方法**

在 `private toSdkUserMessage(prompt: AgentPromptInput): SDKUserMessage {`(line 3206)之前插入:

```ts
private shouldDowngradeImage(): boolean {
  return readImageDowngradeConfig(this.logger)?.mode === "on";
}

private saveImageToTemp(chunk: { data: string; mimeType: string }): string {
  try {
    return materializeProviderImage({ data: chunk.data, mimeType: chunk.mimeType }).path;
  } catch (error) {
    this.logger.warn(
      { err: error },
      "Failed to materialize image for downgrade; sending placeholder path",
    );
    return "<保存失败>";
  }
}
```

- [ ] **Step 5: 改 toSdkUserMessage image 分支**

Modify `packages/server/src/server/agent/providers/claude/agent.ts`(原 line 3222-3232)。

现状:
```ts
} else if (chunk.type === "image") {
  if (isImageMimeType(chunk.mimeType)) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: chunk.mimeType,
        data: chunk.data,
      },
    });
  }
}
```

替换为:
```ts
} else if (chunk.type === "image") {
  if (!isImageMimeType(chunk.mimeType)) {
    continue;
  }
  if (this.shouldDowngradeImage()) {
    const absPath = this.saveImageToTemp(chunk);
    content.push({ type: "text", text: `图片：${absPath}` });
  } else {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: chunk.mimeType,
        data: chunk.data,
      },
    });
  }
}
```

- [ ] **Step 6: 跑测试确认通过**

```
cd packages/server
npx vitest run src/server/agent/providers/claude/agent.image-downgrade.test.ts --reporter=verbose --bail=1
```
Expected: PASS(5 用例全绿)。

**回归保险:** 再跑既有 image 渲染测试,确认未破坏 tool_result 图片路径:
```
npx vitest run src/server/agent/providers/claude/agent.image-rendering.test.ts --reporter=verbose --bail=1
```
Expected: PASS(4 用例全绿,与本特性无交集)。

- [ ] **Step 7: typecheck + lint + format**

```
npm run typecheck
npm run lint -- packages/server/src/server/agent/providers/claude/agent.ts packages/server/src/server/agent/providers/claude/agent.image-downgrade.test.ts
npm run format
```
Expected:typecheck/lint 无错;format 完成。

- [ ] **Step 8: 人工确认后提交**

```
git add packages/server/src/server/agent/providers/claude/agent.ts packages/server/src/server/agent/providers/claude/agent.image-downgrade.test.ts
git commit -m "feat(claude): downgrade prompt images to tmpdir paths on text-only models"
```
（须人工确认签入）

---

## Task 3: 收尾验证 + 文档同步

**Files:**
- 无代码改动;仅全量验证 + 更新 spec 状态。

**Interfaces:**
- Consumes:Task 1、Task 2 产出。

- [ ] **Step 1: 全量 typecheck + lint**

```
npm run typecheck
npm run lint
```
Expected:无错(`npm run lint` 跑全仓库 lint,本特性文件应无新警告)。

- [ ] **Step 2: 跑本特性全部测试文件一次**

```
cd packages/server
npx vitest run src/server/agent/providers/claude/image-downgrade.test.ts src/server/agent/providers/claude/agent.image-downgrade.test.ts --reporter=verbose --bail=1
```
Expected:PASS(10 用例全绿)。

- [ ] **Step 3: format 最终校验**

```
npm run format:check
```
Expected:无 diff。若有 diff,跑 `npm run format` 再校验。

- [ ] **Step 4: 更新 spec 状态行**

Modify `doc/20260811-claude-image-multimodal-downgrade.md` line 5:

现状:`状态:待用户复审 → writing-plans`
改为:`状态:已出实施计划 → 待实施(doc/20260811-claude-image-downgrade-plan.md)`

同时修正 spec §6 line 113 的事实错误(“agent.ts 新增 import：materializeProviderImage” —— 实际 line 84 已导入,无需新 import):

现状:`agent.ts 新增 import：materializeProviderImage（@server/server/agent/providers/provider-image-output.js）。`
改为:`(注：materializeProviderImage 已在 agent.ts:84 导入,无需新 import;本特性仅新增 import readImageDowngradeConfig from "./image-downgrade.js"。)`

- [ ] **Step 5: 人工确认后提交**

```
git add doc/20260811-claude-image-multimodal-downgrade.md doc/20260811-claude-image-downgrade-plan.md
git commit -m "docs(claude): mark image-downgrade spec implemented; fix import note"
```
（须人工确认签入）

---

## Self-Review

**1. Spec 覆盖(spec §1-§11 → task 映射):**
- §3 配置(`off`/`on`/fail-open/每次读)→ Task 1 `readImageDowngradeConfig` 实现完全匹配(absent 静默 null、坏 JSON warn null、非法 mode warn null)。**偏离记录:** spec §3 说「文件缺失 → warn」,实现为「absent 静默」(避免每条消息刷 warn 日志,默认状态非错误)。已在 Task 1 代码注释说明。
- §4 判定逻辑(纯开关)→ Task 2 `shouldDowngradeImage`(`?.mode === "on"`)。
- §5 落盘(委托 `materializeProviderImage` + 失败兜底 `<保存失败>`)→ Task 2 `saveImageToTemp`。
- §6 调用点改动 → Task 2 Step 3-5,逐行匹配 spec 现状/改为代码块。
- §7 测试矩阵 6 行 → Task 2 测试覆盖:default off ✓、on ✓、materialize 失败 ✓、多图+夹文本 ✓、幂等 ✓;另 Task 1 覆盖坏 JSON / 非法 mode(fail-open)✓。**无遗漏。**
- §8 边界(tmpdir / 临时性 / 不读 settings.json)→ 由 `materializeProviderImage` + `shouldDowngradeImage` 天然满足,无额外代码。
- §9 不改动项 → Global Constraints + File Structure 显式声明 `provider-image-output.ts` 零改动、settings.json 不碰。
- §10 文件清单 → File Structure 表一一对应。
- §11 后续 → 超范围,正确未纳入 task。

**2. 占位符扫描:** 无 TBD/TODO/“类似 Task N”/“适当错误处理”。所有代码块完整可贴。失败注入 spy 提供 fallback(vi.mock 拆文件)。

**3. 类型一致性:**
- `readImageDowngradeConfig(logger: Logger): ImageDowngradeConfig | null` —— Task 1 定义,Task 2 `shouldDowngradeImage` 消费,签名一致。
- `ImageDowngradeConfig = { mode: "off" | "on" }` —— Task 1 zod 推断,Task 2 用 `?.mode === "on"`,类型匹配。
- `saveImageToTemp(chunk: { data: string; mimeType: string }): string` —— Task 2 Step 4 定义,Step 5 调用 `this.saveImageToTemp(chunk)`,签名一致(chunk 来自 `AgentPromptContentBlock` image 变体,有 `data`/`mimeType`)。
- `materializeProviderImage` 入参 `{ data: string; mimeType: string | null }`,`saveImageToTemp` 传 `{ data: chunk.data, mimeType: chunk.mimeType }`(string 赋给 string|null ✓)。

**4. spec 事实修正:** Task 3 Step 4 修正 spec §6 line 113 的 import 误述(`materializeProviderImage` 已在 agent.ts:84 导入,本特性仅新增 `readImageDowngradeConfig`)。

无未决问题。Plan 可执行。
