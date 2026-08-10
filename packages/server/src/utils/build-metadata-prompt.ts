import { readPaseoConfigJson } from "./paseo-config-file.js";
import {
  PaseoConfigSchema,
  type PaseoMetadataGeneration,
} from "@getpaseo/protocol/paseo-config-schema";

export type MetadataConfigKey = "title" | "branchName" | "commitMessage" | "pullRequest";

export interface RepoRootResolver {
  resolveRepoRoot: (cwd: string) => Promise<string>;
}

// A style section carries the default guidance for one artifact. The project
// owner replaces it wholesale via paseo.json metadataGeneration.<configKey>.instructions
// — their text is used instead of the default, never appended alongside it, so the
// two never conflict. The contract block (what to produce, the JSON shape, and any
// correctness/safety rules) lives outside the sections and is never overridable.
export interface MetadataStyleSection {
  configKey: MetadataConfigKey;
  default: string;
  label?: string;
}

export interface BuildMetadataPromptOptions {
  cwd: string;
  contract: string;
  styles: MetadataStyleSection[];
  after: string;
  trailing?: string;
  workspaceGitService?: RepoRootResolver;
  // Daemon-level (global default) instructions per key. Used only when the
  // project's paseo.json does not override the same key. See renderStyleSection.
  daemonInstructions?: Partial<Record<MetadataConfigKey, string>>;
}

export async function buildMetadataPrompt(options: BuildMetadataPromptOptions): Promise<string> {
  const overrides = await readProjectMetadataOverrides(options);
  const styleBlocks = options.styles.map((section) =>
    renderStyleSection(section, {
      projectOverride: overrides?.[section.configKey]?.instructions,
      daemonInstruction: options.daemonInstructions?.[section.configKey],
    }),
  );
  const head = [options.contract, ...styleBlocks, options.after].join("\n\n");
  return options.trailing ? `${head}\n\n${options.trailing}` : head;
}

function renderStyleSection(
  section: MetadataStyleSection,
  layers: { projectOverride: string | undefined; daemonInstruction: string | undefined },
): string {
  const body = pickStyleBody(section, layers);
  return section.label ? `${section.label}:\n${body}` : body;
}

// Three-tier fallback: project paseo.json → daemon global default → code default.
// Each tier fully replaces the one below it, matching the override contract in
// MetadataStyleSection's doc comment.
function pickStyleBody(
  section: MetadataStyleSection,
  layers: { projectOverride: string | undefined; daemonInstruction: string | undefined },
): string {
  if (isNonEmptyString(layers.projectOverride)) {
    return layers.projectOverride.trim();
  }
  if (isNonEmptyString(layers.daemonInstruction)) {
    return layers.daemonInstruction.trim();
  }
  return section.default;
}

async function readProjectMetadataOverrides(
  options: Pick<BuildMetadataPromptOptions, "cwd" | "workspaceGitService">,
): Promise<PaseoMetadataGeneration | undefined> {
  try {
    const repoRoot = await resolveMetadataConfigRoot(options);
    const json = readPaseoConfigJson(repoRoot);
    return PaseoConfigSchema.parse(json).metadataGeneration;
  } catch {
    return undefined;
  }
}

// paseo.json lives at the project root. For git projects resolveRepoRoot finds
// the repository root (the main repo root under a worktree). Non-git projects
// (directory workspaces) have no repository root — resolveRepoRoot rejects on a
// non-git cwd — so fall back to cwd there, keeping metadataGeneration overrides
// effective for non-git projects too.
async function resolveMetadataConfigRoot(
  options: Pick<BuildMetadataPromptOptions, "cwd" | "workspaceGitService">,
): Promise<string> {
  if (!options.workspaceGitService) {
    return options.cwd;
  }
  try {
    return await options.workspaceGitService.resolveRepoRoot(options.cwd);
  } catch {
    return options.cwd;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const METADATA_CONFIG_KEYS = [
  "title",
  "branchName",
  "commitMessage",
  "pullRequest",
] as const satisfies readonly MetadataConfigKey[];

// Extracts the daemon-level (global default) metadataGeneration instructions
// from a structured-generation daemon config. Returns only non-empty entries.
// Accepts the config structurally so this util does not depend on the agent
// layer's config type; StructuredGenerationDaemonConfig satisfies the parameter.
export function readDaemonMetadataGenerationInstructions(
  config: { metadataGeneration?: Record<string, unknown> } | null | undefined,
): Partial<Record<MetadataConfigKey, string>> {
  const metadataGeneration = config?.metadataGeneration;
  if (!isRecord(metadataGeneration)) {
    return {};
  }
  const result: Partial<Record<MetadataConfigKey, string>> = {};
  for (const key of METADATA_CONFIG_KEYS) {
    const entry = metadataGeneration[key];
    if (!isRecord(entry)) {
      continue;
    }
    const instructions = entry.instructions;
    if (isNonEmptyString(instructions)) {
      result[key] = instructions;
    }
  }
  return result;
}
