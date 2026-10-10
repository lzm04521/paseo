import path from "node:path";
import os from "node:os";
import { mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Load package-local .env.test first for integration/E2E credentials, then repo-root .env fallback.
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.resolve(serverRoot, ".env.test"), override: true });
dotenv.config({ path: path.resolve(serverRoot, "../.env") });

// Daemon startup installs the bundled orchestration skills under the user's home
// (~/.claude/skills, ~/.codex/skills, ~/.agents/skills). Tests that boot a daemon with a
// hand-built config do not all name `skillsHome`, and the ones that forget would write into the
// developer's own home. Anchoring it here covers every test in the project at once.
// `??=`: an explicitly exported value (a debugging run, a CI sandbox) wins over the default.
process.env.PASEO_SKILLS_HOME ??= mkdtempSync(path.join(os.tmpdir(), "paseo-skills-home-"));

process.env.PASEO_SUPERVISED = "0";
process.env.GIT_TERMINAL_PROMPT = "0";
process.env.GIT_SSH_COMMAND = "ssh -oBatchMode=yes";
process.env.SSH_ASKPASS = "/usr/bin/false";
process.env.SSH_ASKPASS_REQUIRE = "force";
process.env.DISPLAY = process.env.DISPLAY ?? "1";
