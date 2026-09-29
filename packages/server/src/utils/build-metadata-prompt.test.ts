import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildMetadataPrompt,
  readDaemonMetadataGenerationInstructions,
} from "./build-metadata-prompt.js";

describe("readDaemonMetadataGenerationInstructions", () => {
  it("returns empty when metadataGeneration is absent", () => {
    expect(readDaemonMetadataGenerationInstructions({})).toEqual({});
    expect(readDaemonMetadataGenerationInstructions(null)).toEqual({});
    expect(readDaemonMetadataGenerationInstructions(undefined)).toEqual({});
    expect(readDaemonMetadataGenerationInstructions({ metadataGeneration: {} })).toEqual({});
  });

  it("extracts non-empty instructions per key, dropping blank/whitespace entries", () => {
    const result = readDaemonMetadataGenerationInstructions({
      metadataGeneration: {
        title: { instructions: "用中文生成标题" },
        branchName: { instructions: "   " },
        commitMessage: { instructions: "Use Conventional Commits" },
        pullRequest: {},
      },
    });
    expect(result).toEqual({
      title: "用中文生成标题",
      commitMessage: "Use Conventional Commits",
    });
  });

  it("ignores non-object entries and non-string instructions", () => {
    const result = readDaemonMetadataGenerationInstructions({
      metadataGeneration: {
        title: "not-an-object" as unknown as Record<string, unknown>,
        branchName: { instructions: 42 as unknown as string },
      },
    });
    expect(result).toEqual({});
  });
});

describe("buildMetadataPrompt", () => {
  // A cwd with no paseo.json: readProjectMetadataOverrides returns undefined, so
  // only the daemon-instruction vs code-default tiers are exercised here.
  const NO_PASEO_JSON_CWD = "/__no_paseo_json__/";

  it("uses the code default when neither project nor daemon overrides the key", async () => {
    const prompt = await buildMetadataPrompt({
      cwd: NO_PASEO_JSON_CWD,
      contract: "CONTRACT",
      styles: [{ configKey: "title", default: "CODE_DEFAULT", label: "Title" }],
      after: "AFTER",
    });
    expect(prompt).toContain("CODE_DEFAULT");
  });

  it("uses the daemon instruction when no project override is present", async () => {
    const prompt = await buildMetadataPrompt({
      cwd: NO_PASEO_JSON_CWD,
      contract: "CONTRACT",
      styles: [{ configKey: "title", default: "CODE_DEFAULT", label: "Title" }],
      after: "AFTER",
      daemonInstructions: { title: "DAEMON_TEXT" },
    });
    expect(prompt).toContain("DAEMON_TEXT");
    expect(prompt).not.toContain("CODE_DEFAULT");
  });

  it("project paseo.json override wins over the daemon instruction", async () => {
    const dir = mkdtempSync(join(tmpdir(), "paseo-metadata-"));
    try {
      writeFileSync(
        join(dir, "paseo.json"),
        JSON.stringify({
          metadataGeneration: { title: { instructions: "PROJECT_TEXT" } },
        }),
      );
      const prompt = await buildMetadataPrompt({
        cwd: dir,
        contract: "CONTRACT",
        styles: [{ configKey: "title", default: "CODE_DEFAULT", label: "Title" }],
        after: "AFTER",
        daemonInstructions: { title: "DAEMON_TEXT" },
      });
      expect(prompt).toContain("PROJECT_TEXT");
      expect(prompt).not.toContain("DAEMON_TEXT");
      expect(prompt).not.toContain("CODE_DEFAULT");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to daemon instruction only for keys the project did not override", async () => {
    const dir = mkdtempSync(join(tmpdir(), "paseo-metadata-"));
    try {
      writeFileSync(
        join(dir, "paseo.json"),
        JSON.stringify({
          metadataGeneration: { title: { instructions: "PROJECT_TITLE" } },
        }),
      );
      const prompt = await buildMetadataPrompt({
        cwd: dir,
        contract: "CONTRACT",
        styles: [
          { configKey: "title", default: "TITLE_DEFAULT", label: "Title" },
          { configKey: "branchName", default: "BRANCH_DEFAULT", label: "Branch" },
        ],
        after: "AFTER",
        daemonInstructions: {
          title: "DAEMON_TITLE",
          branchName: "DAEMON_BRANCH",
        },
      });
      // title: project wins
      expect(prompt).toContain("PROJECT_TITLE");
      expect(prompt).not.toContain("DAEMON_TITLE");
      // branchName: no project override → daemon wins
      expect(prompt).toContain("DAEMON_BRANCH");
      expect(prompt).not.toContain("BRANCH_DEFAULT");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
