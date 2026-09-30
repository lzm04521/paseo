import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { ClaudeSidechainTracker } from "./sidechain-tracker.js";

describe("ClaudeSidechainTracker", () => {
  it("uses Claude's native agent name for the provider subagent title", () => {
    const tracker = new ClaudeSidechainTracker({
      getToolInput: () => ({
        name: "repo_researcher",
        subagent_type: "Explore",
        description: "Inspect the repository",
      }),
    });

    const events = tracker.handleMessage(
      {
        type: "assistant",
        parent_tool_use_id: "task-1",
        message: { content: [] },
      } as unknown as SDKMessage,
      "task-1",
    );

    expect(events[0]).toEqual({
      type: "provider_subagent",
      provider: "claude",
      event: {
        type: "upsert",
        id: "task-1",
        title: "repo_researcher",
        description: "Inspect the repository",
        status: "running",
        toolCallId: "task-1",
      },
    });
  });

  it("does not create a tool call for heartbeat progress on an unknown tool id", () => {
    const tracker = new ClaudeSidechainTracker({
      getToolInput: () => null,
    });

    tracker.handleMessage(
      {
        type: "assistant",
        parent_tool_use_id: "task-1",
        message: {
          content: [
            {
              type: "tool_use",
              id: "call-1",
              name: "mcp__ssh__exec",
              input: { command: "uptime" },
            },
          ],
        },
      } as unknown as SDKMessage,
      "task-1",
    );

    const events = tracker.handleMessage(
      {
        type: "tool_progress",
        parent_tool_use_id: "task-1",
        tool_use_id: "task-1-heartbeat-0",
        tool_name: "mcp__ssh__exec",
      } as unknown as SDKMessage,
      "task-1",
    );

    expect(JSON.stringify(events)).not.toContain("heartbeat");
  });

  it("does not materialize a subagent from a bare heartbeat progress frame", () => {
    // A long-running main-agent tool call reports progress with the call's own id
    // as parent_tool_use_id. The first such frame must not fabricate a subagent
    // descriptor — there is no subagent behind it.
    const tracker = new ClaudeSidechainTracker({
      getToolInput: () => null,
    });

    const events = tracker.handleMessage(
      {
        type: "tool_progress",
        parent_tool_use_id: "call_01_long",
        tool_use_id: "call_01_long-heartbeat-0",
        tool_name: "mcp__ssh__exec",
      } as unknown as SDKMessage,
      "call_01_long",
    );

    expect(events).toEqual([]);
  });

  it("keeps updating a known action from tool_progress", () => {
    const tracker = new ClaudeSidechainTracker({
      getToolInput: () => null,
    });

    tracker.handleMessage(
      {
        type: "assistant",
        parent_tool_use_id: "task-1",
        message: {
          content: [
            {
              type: "tool_use",
              id: "call-1",
              name: "mcp__ssh__exec",
              input: { command: "uptime" },
            },
          ],
        },
      } as unknown as SDKMessage,
      "task-1",
    );

    const events = tracker.handleMessage(
      {
        type: "tool_progress",
        parent_tool_use_id: "task-1",
        tool_use_id: "call-1",
        tool_name: "mcp__ssh__exec",
      } as unknown as SDKMessage,
      "task-1",
    );

    // Progress on a known id may only re-emit that same call, never a new key.
    const toolCallItems = events.filter(
      (event) => event.type === "provider_subagent" && event.event.type === "timeline",
    );
    const callIds = toolCallItems.map((event) => {
      const item = event.event.type === "timeline" ? event.event.item : null;
      return item?.type === "tool_call" ? item.callId : null;
    });
    expect(callIds.every((id) => id === "call-1")).toBe(true);
  });
});
