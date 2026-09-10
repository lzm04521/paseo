import type { Logger } from "pino";
import { z } from "zod";

import type { AgentModelDefinition } from "../../agent-sdk-types.js";

const ANTHROPIC_MODELS_RESPONSE_SCHEMA = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1),
        display_name: z.string().optional(),
      }),
    )
    .optional(),
});

const FETCH_TIMEOUT_MS = 10_000;

function resolveModelsEndpoint(baseUrl: string | undefined): string {
  const trimmed = (baseUrl ?? "").trim().replace(/\/+$/, "");
  return `${trimmed || "https://api.anthropic.com"}/v1/models`;
}

function resolveAuthHeaders(env: NodeJS.ProcessEnv): Record<string, string> | null {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (apiKey) {
    return { "x-api-key": apiKey };
  }
  const authToken = env.ANTHROPIC_AUTH_TOKEN?.trim();
  if (authToken) {
    return { Authorization: `Bearer ${authToken}` };
  }
  return null;
}

/**
 * Fetch models from an Anthropic-compatible `/v1/models` endpoint.
 * Every failure path (missing credentials, HTTP error, malformed body,
 * network error, timeout) degrades to an empty list — the caller merges
 * the result into local catalog sources and must never fail a snapshot
 * refresh because of it. An aborted external `signal` is re-thrown so the
 * refresh framework's cancellation semantics stay intact.
 */
export async function fetchAnthropicCompatModels(
  env: NodeJS.ProcessEnv,
  logger: Logger,
  signal?: AbortSignal,
): Promise<AgentModelDefinition[]> {
  const authHeaders = resolveAuthHeaders(env);
  if (!authHeaders) {
    logger.debug(
      "Skipping remote Claude model fetch: no ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN configured",
    );
    return [];
  }

  const url = resolveModelsEndpoint(env.ANTHROPIC_BASE_URL);
  try {
    const response = await fetch(url, {
      headers: {
        ...authHeaders,
        "anthropic-version": "2023-06-01",
        Accept: "application/json",
      },
      // 外部 signal 优先（刷新框架已有 deadline 兜底）；无外部 signal 时用内层超时。
      // 组合两个 signal 的 AbortSignal.any 在仓库无先例，沿 quota-fetcher 的
      // `signal ?? AbortSignal.timeout(...)` 模式（services/quota-fetcher/usage.ts:29）。
      signal: signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn({ status: response.status, url }, "Claude remote model fetch failed");
      return [];
    }
    const parsed = ANTHROPIC_MODELS_RESPONSE_SCHEMA.safeParse(await response.json());
    if (!parsed.success) {
      logger.warn({ url }, "Claude remote model response failed schema validation");
      return [];
    }
    return (parsed.data.data ?? []).map((model) => ({
      provider: "claude" as const,
      id: model.id,
      label: model.display_name ?? model.id,
    }));
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    logger.warn({ err: error, url }, "Claude remote model fetch error");
    return [];
  }
}

/**
 * Merge remote models into the local catalog: local entries win on id
 * collisions, remote only contributes ids the local sources don't know.
 */
export function mergeClaudeRemoteModels(
  localModels: AgentModelDefinition[],
  remoteModels: AgentModelDefinition[],
): AgentModelDefinition[] {
  const models = [...localModels];
  for (const model of remoteModels) {
    if (!models.some((candidate) => candidate.id === model.id)) {
      models.push(model);
    }
  }
  return models;
}
