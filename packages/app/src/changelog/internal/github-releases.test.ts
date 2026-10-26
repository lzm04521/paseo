import { describe, expect, it } from "vitest";
import { parseGitHubReleases } from "./github-releases";
import type { ChangelogRelease } from "./parse-changelog";

function releaseJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    tag_name: "0.9.0-local.1",
    published_at: "2026-09-22T13:18:15Z",
    draft: false,
    prerelease: false,
    body: "## 更新内容（相对 0.8.0-local.1）\n\n- 跟进上游 v0.9.0 稳定版\n\n### 上游主要更新\n\n- 全局查找\n",
    ...overrides,
  });
}

function response(...releases: string[]): string {
  return `[${releases.join(",")}]`;
}

function firstRelease(markdown: string): ChangelogRelease {
  return parseGitHubReleases(markdown)[0];
}

describe("parseGitHubReleases", () => {
  it("reads a release the notes are authored in today", () => {
    const release = firstRelease(response(releaseJson()));

    expect(release.version).toBe("0.9.0-local.1");
    expect(release.date).toBe("2026-09-22");
    // `## 更新内容` is demoted to a section; `### 上游主要更新` is demoted to
    // `####`, which is not a section heading, so it rides along in the body.
    expect(release.sections[0].title).toBe("更新内容（相对 0.8.0-local.1）");
    expect(release.sections[0].body).toContain("跟进上游 v0.9.0 稳定版");
    expect(release.sections[0].body).toContain("#### 上游主要更新");
    expect(release.sections[0].body).toContain("全局查找");
  });

  it("drops a notes heading that repeats the tag instead of splicing a duplicate release", () => {
    const releases = parseGitHubReleases(
      response(
        releaseJson({
          body: "# 0.9.0-local.1\n\nfork 自用版本。\n\n## fork 侧变更\n\n- 移除上一版特性\n",
        }),
      ),
    );

    expect(releases).toHaveLength(1);
    const [release] = releases;
    expect(release.sections[0].body).toContain("fork 自用版本。");
    expect(release.sections[1].title).toBe("fork 侧变更");
  });

  it("keeps the newest release first and carries each release's own date", () => {
    const releases = parseGitHubReleases(
      response(
        releaseJson(),
        releaseJson({ tag_name: "0.8.0-local.1", published_at: "2026-09-10T16:35:34Z" }),
      ),
    );

    expect(releases.map((release) => release.version)).toEqual(["0.9.0-local.1", "0.8.0-local.1"]);
    expect(releases[1].date).toBe("2026-09-10");
  });

  it("skips drafts, prereleases and releases without notes", () => {
    const releases = parseGitHubReleases(
      response(
        releaseJson({ draft: true }),
        releaseJson({ prerelease: true }),
        releaseJson({ body: "" }),
        releaseJson({ body: null }),
        releaseJson(),
      ),
    );

    expect(releases).toHaveLength(1);
  });

  it("keeps heading-looking lines inside fenced code blocks verbatim", () => {
    const release = firstRelease(
      response(
        releaseJson({
          body: "```sh\n# 0.9.0-local.1 comment\n## not a heading\n```\n",
        }),
      ),
    );

    expect(release.sections[0].body).toContain("# 0.9.0-local.1 comment");
    expect(release.sections[0].body).toContain("## not a heading");
  });

  it("falls back to an empty date when the publish time is missing", () => {
    const release = firstRelease(response(releaseJson({ published_at: null })));

    expect(release.date).toBe("");
  });

  it("rejects non-array responses", () => {
    expect(() => parseGitHubReleases('{"message":"Not Found"}')).toThrow(
      "GitHub releases response is not an array",
    );
  });

  it("rejects a response where no release has notes", () => {
    expect(() => parseGitHubReleases(response(releaseJson({ body: "" })))).toThrow(
      "Changelog has no releases",
    );
  });
});
