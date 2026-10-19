import { parseChangelog, type ChangelogRelease } from "./parse-changelog";

/**
 * Release notes for this fork live on its GitHub Releases, not in CHANGELOG.md
 * (which only carries the upstream document merged in with each port). The
 * GitHub Releases API is the one place every `-local.N` version's notes are
 * actually authored.
 */
export const RELEASES_URL = "https://api.github.com/repos/lzm04521/paseo/releases?per_page=100";

interface GitHubRelease {
  tagName: string;
  publishedAt: string | null;
  body: string;
}

const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;
const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const ATX_CLOSING = /[ \t]+#+[ \t]*$/;

/**
 * Turns a GitHub Releases API response into the same ChangelogRelease[] shape
 * the CHANGELOG.md parser produces, by rendering each release as
 * `## <tag> - <date>` plus its notes and reusing parseChangelog.
 *
 * The notes are authored with `##`-level headings ("## 更新内容"), which would
 * be read as new release headings, so every heading inside the notes is demoted
 * one level. Older notes open with a `# <tag>` heading that would survive
 * demotion as a duplicate `## <tag>` release; a heading whose text is exactly
 * the tag carries no information the generated heading lacks, so it is dropped.
 */
export function parseGitHubReleases(responseText: string): ChangelogRelease[] {
  const data: unknown = JSON.parse(responseText);
  if (!Array.isArray(data)) throw new Error("GitHub releases response is not an array");

  const markdown = data
    .map(readRelease)
    .filter((release): release is GitHubRelease => release !== null)
    .map(renderReleaseMarkdown)
    .join("\n\n");

  const releases = parseChangelog(markdown);
  if (releases.length === 0) throw new Error("Changelog has no releases");
  return releases;
}

function readRelease(entry: unknown): GitHubRelease | null {
  if (typeof entry !== "object" || entry === null) return null;
  const record = entry as Record<string, unknown>;
  if (record.draft === true || record.prerelease === true) return null;

  const tagName = typeof record.tag_name === "string" ? record.tag_name.trim() : "";
  const body = typeof record.body === "string" ? record.body : "";
  if (tagName.length === 0 || body.trim().length === 0) return null;

  const publishedAt = typeof record.published_at === "string" ? record.published_at : null;
  return { tagName, publishedAt, body };
}

function renderReleaseMarkdown(release: GitHubRelease): string {
  const date = release.publishedAt?.slice(0, 10) ?? "";
  return [
    `## ${release.tagName}${date ? ` - ${date}` : ""}`,
    "",
    demoteHeadings(release.body, release.tagName),
  ].join("\n");
}

function demoteHeadings(body: string, tagName: string): string {
  const lines: string[] = [];
  let fence: string | null = null;

  for (const line of body.split(/\r?\n/)) {
    const fenceEdge = line.match(FENCE_OPEN)?.[1];
    if (fenceEdge) {
      if (!fence) {
        fence = fenceEdge;
      } else if (fenceEdge[0] === fence[0] && fenceEdge.length >= fence.length) {
        fence = null;
      }
    }

    if (fence) {
      lines.push(line);
      continue;
    }

    const heading = line.match(ATX_HEADING);
    if (heading) {
      const text = (heading[2] ?? "").replace(ATX_CLOSING, "").trim();
      if (text === tagName) continue;
      // Demote by one; `######` stays at six so the rewrite cannot produce an
      // invalid seven-level heading.
      lines.push(`#${line}`);
      continue;
    }

    lines.push(line);
  }

  return lines.join("\n");
}
