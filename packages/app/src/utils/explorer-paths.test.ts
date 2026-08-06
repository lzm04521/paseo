import { describe, expect, it } from "vitest";
import { buildAbsoluteExplorerPath, buildRelativeExplorerPath } from "./explorer-paths";

describe("buildAbsoluteExplorerPath", () => {
  it("builds a POSIX absolute path from a relative explorer path", () => {
    expect(
      buildAbsoluteExplorerPath({
        workspaceRoot: "/workspaces/paseo",
        entryPath: "packages/app/src/components/file-explorer-pane.tsx",
      }),
    ).toBe("/workspaces/paseo/packages/app/src/components/file-explorer-pane.tsx");
  });

  it("returns workspace root when entry path points to explorer root", () => {
    expect(
      buildAbsoluteExplorerPath({
        workspaceRoot: "/workspaces/paseo",
        entryPath: ".",
      }),
    ).toBe("/workspaces/paseo");
  });

  it("trims trailing separators from workspace root before joining", () => {
    expect(
      buildAbsoluteExplorerPath({
        workspaceRoot: "/workspaces/paseo/",
        entryPath: "README.md",
      }),
    ).toBe("/workspaces/paseo/README.md");
  });

  it("builds a Windows absolute path with backslash separators", () => {
    expect(
      buildAbsoluteExplorerPath({
        workspaceRoot: "C:\\repo\\paseo",
        entryPath: "packages/app/src/components/file-explorer-pane.tsx",
      }),
    ).toBe("C:\\repo\\paseo\\packages\\app\\src\\components\\file-explorer-pane.tsx");
  });

  it("passes through an already-absolute entry path", () => {
    expect(
      buildAbsoluteExplorerPath({
        workspaceRoot: "/workspaces/paseo",
        entryPath: "/tmp/another/location.txt",
      }),
    ).toBe("/tmp/another/location.txt");
  });
});

describe("buildRelativeExplorerPath", () => {
  it("keeps an already-relative entry path as-is", () => {
    expect(
      buildRelativeExplorerPath({
        workspaceRoot: "/workspaces/paseo",
        entryPath: "packages/app/src/components/file-explorer-pane.tsx",
      }),
    ).toBe("packages/app/src/components/file-explorer-pane.tsx");
  });

  it("rewrites separators to match a Windows workspace root", () => {
    expect(
      buildRelativeExplorerPath({
        workspaceRoot: "C:\\repo\\paseo",
        entryPath: "packages/app/src/index.ts",
      }),
    ).toBe("packages\\app\\src\\index.ts");
  });

  it("strips the workspace root from an absolute entry path", () => {
    expect(
      buildRelativeExplorerPath({
        workspaceRoot: "/workspaces/paseo/",
        entryPath: "/workspaces/paseo/packages/server/src/index.ts",
      }),
    ).toBe("packages/server/src/index.ts");
  });

  it("strips a Windows workspace root regardless of drive letter case", () => {
    expect(
      buildRelativeExplorerPath({
        workspaceRoot: "C:\\Repo\\Paseo",
        entryPath: "c:\\repo\\paseo\\packages\\cli\\package.json",
      }),
    ).toBe("packages\\cli\\package.json");
  });

  it("returns the absolute path when the entry lives outside the workspace", () => {
    expect(
      buildRelativeExplorerPath({
        workspaceRoot: "/workspaces/paseo",
        entryPath: "/tmp/another/location.txt",
      }),
    ).toBe("/tmp/another/location.txt");
  });

  it("returns a dot for the workspace root itself", () => {
    expect(buildRelativeExplorerPath({ workspaceRoot: "/workspaces/paseo", entryPath: "." })).toBe(
      ".",
    );
    expect(
      buildRelativeExplorerPath({
        workspaceRoot: "/workspaces/paseo",
        entryPath: "/workspaces/paseo",
      }),
    ).toBe(".");
  });

  it("falls back to the entry path when no workspace root is known", () => {
    expect(
      buildRelativeExplorerPath({ workspaceRoot: "  ", entryPath: "/tmp/loose/file.txt" }),
    ).toBe("/tmp/loose/file.txt");
  });
});
