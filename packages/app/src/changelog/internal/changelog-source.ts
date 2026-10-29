import { useCallback, useEffect, useState } from "react";
import { parseGitHubReleases, RELEASES_URL } from "./github-releases";
import type { ChangelogRelease } from "./parse-changelog";

export type ChangelogState =
  | { status: "loading" }
  | { status: "ready"; releases: ChangelogRelease[] }
  | { status: "error" };

// Survives close/reopen so the second look paints without a spinner. The raw
// text is kept alongside the releases so an unchanged revalidation can be
// dropped: handing back an equal-but-new array would re-render every release.
let cached: { text: string; releases: ChangelogRelease[] } | null = null;

export interface Changelog {
  state: ChangelogState;
  reload: () => void;
}

/**
 * Reads the release notes from the repository the app was built from: this
 * fork's GitHub Releases, where every `-local.N` version's notes are authored.
 * The upstream CHANGELOG.md merged into the repo does not know about them.
 *
 * The daemon is not involved: the changelog describes the app, a phone reaching
 * a relay already has internet, and going through a host would make the notes
 * depend on which host happens to be connected.
 *
 * Every open refetches, because the whole point of opening it is a release that
 * shipped after this app started. A previous result stays on screen while that
 * happens, and survives a failed revalidation.
 */
export function useChangelog(enabled: boolean): Changelog {
  const [state, setState] = useState<ChangelogState>(readCache);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    setState(readCache());

    void (async () => {
      try {
        const response = await fetch(RELEASES_URL, { signal: controller.signal });
        if (!response.ok) throw new Error(`Changelog request failed: ${response.status}`);
        const text = await response.text();
        if (cached?.text === text) return;
        const releases = parseGitHubReleases(text);
        cached = { text, releases };
        setState({ status: "ready", releases });
      } catch {
        if (controller.signal.aborted) return;
        if (cached) return;
        setState({ status: "error" });
      }
    })();

    return () => controller.abort();
  }, [enabled, attempt]);

  const reload = useCallback(() => {
    cached = null;
    setAttempt((value) => value + 1);
  }, []);

  return { state, reload };
}

function readCache(): ChangelogState {
  return cached ? { status: "ready", releases: cached.releases } : { status: "loading" };
}
