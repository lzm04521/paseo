import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";

import { fetchAnthropicCompatModels, mergeClaudeRemoteModels } from "./fetch-models.js";

const logger = {
  debug: vi.fn(),
  warn: vi.fn(),
} as unknown as Logger;

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchAnthropicCompatModels", () => {
  it("maps models with display_name fallback to id", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce(200, {
        data: [{ id: "glm-4.7", display_name: "GLM 4.7" }, { id: "kimi-k2" }],
      }),
    );
    const models = await fetchAnthropicCompatModels(
      { ANTHROPIC_AUTH_TOKEN: "tok" } as NodeJS.ProcessEnv,
      logger,
    );
    expect(models).toEqual([
      { provider: "claude", id: "glm-4.7", label: "GLM 4.7" },
      { provider: "claude", id: "kimi-k2", label: "kimi-k2" },
    ]);
  });

  it("uses x-api-key header when ANTHROPIC_API_KEY is set", async () => {
    const fetchMock = mockFetchOnce(200, { data: [] });
    vi.stubGlobal("fetch", fetchMock);
    await fetchAnthropicCompatModels({ ANTHROPIC_API_KEY: "key" } as NodeJS.ProcessEnv, logger);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("key");
    expect((init.headers as Record<string, string>)["anthropic-version"]).toBe("2023-06-01");
  });

  it("targets base URL with trailing slash trimmed, defaulting to api.anthropic.com", async () => {
    const fetchMock = mockFetchOnce(200, { data: [] });
    vi.stubGlobal("fetch", fetchMock);
    await fetchAnthropicCompatModels({ ANTHROPIC_AUTH_TOKEN: "t" } as NodeJS.ProcessEnv, logger);
    await fetchAnthropicCompatModels(
      {
        ANTHROPIC_BASE_URL: "https://relay.example.com///",
        ANTHROPIC_AUTH_TOKEN: "t",
      } as NodeJS.ProcessEnv,
      logger,
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/models");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://relay.example.com/v1/models");
  });

  it("returns empty without any auth env", async () => {
    const fetchMock = mockFetchOnce(200, { data: [{ id: "x" }] });
    vi.stubGlobal("fetch", fetchMock);
    const models = await fetchAnthropicCompatModels({} as NodeJS.ProcessEnv, logger);
    expect(models).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns empty on 404 (gateway without /v1/models)", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(404, { error: "not found" }));
    const models = await fetchAnthropicCompatModels(
      { ANTHROPIC_AUTH_TOKEN: "t" } as NodeJS.ProcessEnv,
      logger,
    );
    expect(models).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("returns empty on malformed response body", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(200, { unexpected: true }));
    const models = await fetchAnthropicCompatModels(
      { ANTHROPIC_AUTH_TOKEN: "t" } as NodeJS.ProcessEnv,
      logger,
    );
    expect(models).toEqual([]);
  });

  it("returns empty on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const models = await fetchAnthropicCompatModels(
      { ANTHROPIC_AUTH_TOKEN: "t" } as NodeJS.ProcessEnv,
      logger,
    );
    expect(models).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe("mergeClaudeRemoteModels", () => {
  it("appends only new ids, keeps local entries untouched", () => {
    const local = [{ provider: "claude" as const, id: "claude-sonnet-4-5", label: "Sonnet" }];
    const remote = [
      { provider: "claude" as const, id: "claude-sonnet-4-5", label: "Remote Sonnet" },
      { provider: "claude" as const, id: "glm-4.7", label: "GLM 4.7" },
    ];
    expect(mergeClaudeRemoteModels(local, remote)).toEqual([
      { provider: "claude", id: "claude-sonnet-4-5", label: "Sonnet" },
      { provider: "claude", id: "glm-4.7", label: "GLM 4.7" },
    ]);
  });
});
