import { isAbsolutePath } from "./path";

interface BuildAbsoluteExplorerPathInput {
  workspaceRoot: string;
  entryPath: string;
}

export function buildAbsoluteExplorerPath({
  workspaceRoot,
  entryPath,
}: BuildAbsoluteExplorerPathInput): string {
  const normalizedWorkspaceRoot = workspaceRoot.trim().replace(/[\\/]+$/, "");
  const normalizedEntryPath = entryPath.trim();

  if (!normalizedWorkspaceRoot) {
    return normalizedEntryPath;
  }

  if (!normalizedEntryPath || normalizedEntryPath === ".") {
    return normalizedWorkspaceRoot;
  }

  if (isAbsolutePath(normalizedEntryPath)) {
    return normalizedEntryPath;
  }

  const separator = pathSeparator(normalizedWorkspaceRoot);
  const segments = normalizedEntryPath.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0) {
    return normalizedWorkspaceRoot;
  }

  return `${normalizedWorkspaceRoot}${separator}${segments.join(separator)}`;
}

/**
 * Path of an explorer/diff entry relative to the workspace root, using the
 * root's own separator so the result pastes cleanly into a shell on that host.
 *
 * Entry paths already arrive workspace-relative; absolute ones are stripped back
 * down when they sit inside the root, and returned untouched when they don't
 * (no `../..` walking — an outside path is more useful verbatim).
 */
export function buildRelativeExplorerPath({
  workspaceRoot,
  entryPath,
}: BuildAbsoluteExplorerPathInput): string {
  const normalizedWorkspaceRoot = workspaceRoot.trim().replace(/[\\/]+$/, "");
  const normalizedEntryPath = entryPath.trim();
  const separator = pathSeparator(normalizedWorkspaceRoot);

  if (!normalizedEntryPath || normalizedEntryPath === ".") {
    return ".";
  }

  const segments = splitPathSegments(normalizedEntryPath);
  if (!isAbsolutePath(normalizedEntryPath)) {
    return segments.length === 0 ? "." : segments.join(separator);
  }

  const rootSegments = splitPathSegments(normalizedWorkspaceRoot);
  if (rootSegments.length === 0 || segments.length < rootSegments.length) {
    return normalizedEntryPath;
  }
  // Windows and macOS paths are case-insensitive in practice; comparing folded
  // segments keeps `C:\Repo` matching a `c:\repo\...` entry.
  const isInsideRoot = rootSegments.every(
    (segment, index) => segment.toLowerCase() === segments[index]?.toLowerCase(),
  );
  if (!isInsideRoot) {
    return normalizedEntryPath;
  }

  const relativeSegments = segments.slice(rootSegments.length);
  return relativeSegments.length === 0 ? "." : relativeSegments.join(separator);
}

function pathSeparator(workspaceRoot: string): string {
  return workspaceRoot.includes("\\") ? "\\" : "/";
}

function splitPathSegments(value: string): string[] {
  return value.split(/[\\/]+/).filter(Boolean);
}
