import { existsSync, rmSync } from "node:fs";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, test, vi } from "vitest";

import type { MutableDaemonConfig } from "@getpaseo/protocol/messages";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import type { AgentPromptInput } from "../../agent-sdk-types.js";
import { ClaudeAgentClient } from "./agent.js";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X1r0AAAAASUVORK5CYII=";

interface ClaudeImageDowngradeTestSession {
  toSdkUserMessage(prompt: AgentPromptInput): SDKUserMessage;
}

async function createSession(downgrade?: "off" | "on"): Promise<ClaudeImageDowngradeTestSession> {
  const client = new ClaudeAgentClient({
    logger: createTestLogger(),
    resolveBinary: async () => "/test/claude/bin",
    // Omit the accessor entirely to exercise the "no injection → default off" path.
    ...(downgrade !== undefined
      ? { getDaemonConfig: () => ({ claudeImageDowngrade: downgrade }) as MutableDaemonConfig }
      : {}),
  });
  const session = await client.createSession({ provider: "claude", cwd: process.cwd() });
  return session as unknown as ClaudeImageDowngradeTestSession;
}

interface ContentBlock {
  type: string;
  text?: string;
  source?: { data?: string };
}

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
  test("no accessor injected (default off): keeps base64 image block", async () => {
    const session = await createSession();
    const msg = session.toSdkUserMessage(imagePrompt());
    const blocks = contentsOf(msg);
    expect(blocks.some((b) => b.type === "image" && b.source?.data === PNG_BASE64)).toBe(true);
    expect(blocks.some((b) => b.type === "text" && b.text?.startsWith("图片："))).toBe(false);
  });

  test("mode off: keeps base64 image block", async () => {
    const session = await createSession("off");
    const msg = session.toSdkUserMessage(imagePrompt());
    const blocks = contentsOf(msg);
    expect(blocks.some((b) => b.type === "image" && b.source?.data === PNG_BASE64)).toBe(true);
    expect(blocks.some((b) => b.type === "text" && b.text?.startsWith("图片："))).toBe(false);
  });

  test("mode on: replaces image with 图片：<abs path> text and materializes file", async () => {
    const session = await createSession("on");
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
    const providerImageOutput = await import("../provider-image-output.js");
    const spy = vi.spyOn(providerImageOutput, "materializeProviderImage").mockImplementation(() => {
      throw new Error("disk full");
    });
    try {
      const session = await createSession("on");
      const msg = session.toSdkUserMessage(imagePrompt());
      const blocks = contentsOf(msg);
      const textBlock = blocks.find((b) => b.type === "text" && b.text === "图片：<保存失败>");
      expect(textBlock).toBeDefined();
      expect(blocks.some((b) => b.type === "image")).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  test("mode on + multi-image with interleaved text: order preserved, one text block per image", async () => {
    const session = await createSession("on");
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
    const session = await createSession("on");
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
