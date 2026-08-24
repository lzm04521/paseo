import { describe, expect, it } from "vitest";
import { getBuiltInLaunchOrder } from "./catalog";

describe("getBuiltInLaunchOrder", () => {
  it("leads with creating work in a primary pane", () => {
    expect(getBuiltInLaunchOrder("primary")).toEqual([
      "agent",
      "terminal",
      "changes",
      "files",
      "browser",
      "pullRequest",
    ]);
  });

  it("offers the Side panel the file navigation pane after files", () => {
    expect(getBuiltInLaunchOrder("supporting")).toEqual([
      "changes",
      "files",
      "fileNav",
      "terminal",
      "agent",
      "browser",
      "pullRequest",
    ]);
    expect(getBuiltInLaunchOrder("primary")).not.toContain("fileNav");
  });
});
