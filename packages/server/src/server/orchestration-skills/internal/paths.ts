import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { SkillTargets } from "./operations.js";

export function resolveBundledSkillsDir(moduleUrl: string | URL = import.meta.url): string {
  const moduleDir = path.dirname(fileURLToPath(moduleUrl));
  const candidates = [
    path.resolve(moduleDir, "..", "..", "..", "skills"),
    path.resolve(moduleDir, "..", "..", "..", "..", "..", "..", "skills"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

/**
 * Where the daemon installs its bundled orchestration skills.
 *
 * The daemon user's home is the intended default: the agents Paseo spawns read skills from their
 * own provider home, so that is the only place the install is useful. `PASEO_SKILLS_HOME` exists so
 * a run that must not touch it — the test suite, above all — can send the install elsewhere. The
 * tests set it once in `test-utils/vitest-setup.ts`, because not every harness that boots a daemon
 * names `skillsHome` on the config it builds by hand.
 */
export function resolveSkillsHome(
  configuredHome: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return configuredHome ?? env.PASEO_SKILLS_HOME ?? os.homedir();
}

export function resolveSkillTargets(home: string = os.homedir()): SkillTargets {
  return {
    sourceDir: resolveBundledSkillsDir(),
    agentsDir: path.join(home, ".agents", "skills"),
    claudeDir: path.join(home, ".claude", "skills"),
    codexDir: path.join(home, ".codex", "skills"),
  };
}
