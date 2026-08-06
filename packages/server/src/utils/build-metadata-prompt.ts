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
}

export async function buildMetadataPrompt(options: BuildMetadataPromptOptions): Promise<string> {
  const overrides = await readProjectMetadataOverrides(options);
  const styleBlocks = options.styles.map((section) =>
    renderStyleSection(section, overrides?.[section.configKey]?.instructions),
  );
  const head = [options.contract, ...styleBlocks, options.after].join("\n\n");
  return options.trailing ? `${head}\n\n${options.trailing}` : head;
}

function renderStyleSection(section: MetadataStyleSection, override: string | undefined): string {
  const body = isNonEmptyString(override) ? override.trim() : section.default;
  return section.label ? `${section.label}:\n${body}` : body;
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
