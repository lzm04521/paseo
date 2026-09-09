import { describe, expect, it } from "vitest";
import { ProviderOverridesSchema } from "./provider-config.js";

describe("ProviderOverridesSchema fetchModels", () => {
  it("accepts a claude-derived provider with fetchModels", () => {
    const result = ProviderOverridesSchema.safeParse({
      "my-relay": {
        extends: "claude",
        label: "My Relay",
        env: { ANTHROPIC_BASE_URL: "https://example.com" },
        fetchModels: true,
      },
    });
    expect(result.success).toBe(true);
  });

  it("keeps existing configs valid (fetchModels optional)", () => {
    const result = ProviderOverridesSchema.safeParse({
      "my-relay": { extends: "claude", label: "My Relay" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects fetchModels combined with static models", () => {
    const result = ProviderOverridesSchema.safeParse({
      "my-relay": {
        extends: "claude",
        label: "My Relay",
        fetchModels: true,
        models: [{ id: "m1", label: "M1" }],
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("fetchModels"))).toBe(true);
    }
  });

  it("rejects fetchModels combined with additionalModels", () => {
    const result = ProviderOverridesSchema.safeParse({
      "my-relay": {
        extends: "claude",
        label: "My Relay",
        fetchModels: true,
        additionalModels: [{ id: "m1", label: "M1" }],
      },
    });
    expect(result.success).toBe(false);
  });

  it("allows fetchModels: false alongside static models", () => {
    const result = ProviderOverridesSchema.safeParse({
      "my-relay": {
        extends: "claude",
        label: "My Relay",
        fetchModels: false,
        models: [{ id: "m1", label: "M1" }],
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("ProviderOverridesSchema defaultModelId", () => {
  it("accepts defaultModelId alongside fetchModels", () => {
    const result = ProviderOverridesSchema.safeParse({
      "my-relay": {
        extends: "claude",
        label: "My Relay",
        fetchModels: true,
        defaultModelId: "glm-4.7",
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data["my-relay"]?.defaultModelId).toBe("glm-4.7");
    }
  });

  it("accepts defaultModelId alongside static models", () => {
    const result = ProviderOverridesSchema.safeParse({
      "my-relay": {
        extends: "claude",
        label: "My Relay",
        models: [{ id: "m1", label: "M1" }],
        defaultModelId: "m1",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty string defaultModelId (patch clear sentinel)", () => {
    const result = ProviderOverridesSchema.safeParse({
      "my-relay": { extends: "claude", label: "My Relay", defaultModelId: "" },
    });
    expect(result.success).toBe(true);
  });
});
