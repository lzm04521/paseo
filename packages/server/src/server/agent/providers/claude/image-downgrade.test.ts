import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { migrateLegacyImageDowngrade } from "./image-downgrade.js";

describe("migrateLegacyImageDowngrade", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(path.join(os.tmpdir(), "paseo-img-dg-"));
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  const configFile = (): string => path.join(tmpHome, "claude-image-downgrade.json");

  function writeConfig(json: string): void {
    writeFileSync(configFile(), json, "utf8");
  }

  test("returns null when config absent (default off, silent)", () => {
    expect(migrateLegacyImageDowngrade(tmpHome, createTestLogger())).toBeNull();
  });

  test("returns 'on' and deletes the file when configured on", () => {
    writeConfig(JSON.stringify({ mode: "on" }));
    expect(migrateLegacyImageDowngrade(tmpHome, createTestLogger())).toBe("on");
    expect(existsSync(configFile())).toBe(false);
  });

  test("returns null and deletes the file when configured off", () => {
    writeConfig(JSON.stringify({ mode: "off" }));
    expect(migrateLegacyImageDowngrade(tmpHome, createTestLogger())).toBeNull();
    expect(existsSync(configFile())).toBe(false);
  });

  test("returns null on corrupt JSON (fail-open, file removed)", () => {
    writeConfig("{ not valid json");
    expect(migrateLegacyImageDowngrade(tmpHome, createTestLogger())).toBeNull();
    expect(existsSync(configFile())).toBe(false);
  });

  test("returns null on invalid mode value (fail-open, file removed)", () => {
    writeConfig(JSON.stringify({ mode: "auto" }));
    expect(migrateLegacyImageDowngrade(tmpHome, createTestLogger())).toBeNull();
    expect(existsSync(configFile())).toBe(false);
  });
});
