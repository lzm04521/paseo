import { usePaneContext } from "@/panels/pane-context";
import { useEffect, useMemo, useState } from "react";
import type { PluginFile, PluginTab } from "@getpaseo/plugin/client";
import { useFileText } from "@getpaseo/plugin/client";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { isWeb } from "@/constants/platform";
import { useFileHandle, useFileHandleSnapshot } from "@/file-panels/file";
import { FilePanelLoading } from "@/file-panels/loading";
import { FilePanelPicker, FilePanelView, useFilePanelChoice, type FilePanel } from "@/file-panels";
import {
  selectSourcePresentation,
  type SourcePresentation,
} from "@/file-panels/source/readonly/presentation";
import { FileSourceView } from "@/file-panels/source/readonly/view";
import { resolveFilePreviewReadTarget } from "@/file-explorer/preview-target";
import { useAppActivelyVisible } from "@/hooks/use-app-visible";
import { usePublishPanelInstanceAttributes } from "@/panels/panel-instance-attributes";
import { useSessionStore } from "@/stores/session-store";
import { buildAbsoluteExplorerPath } from "@/utils/explorer-paths";
import { formatFileSize } from "@/utils/format-file-size";
import type { Theme } from "@/styles/theme";
import type { WorkspaceFileLocation } from "@/workspace/file-open";

// CodeMirror and native source rendering consume appearance as props. Subscribe at the
// rendering leaf so theme updates reconfigure it without replacing the editor/model.
const sourceAppearance = (theme: Theme) => ({
  theme: {
    colorScheme: theme.colorScheme,
    background: theme.colors.surface0,
    foreground: theme.colors.foreground,
    cursor: theme.colors.terminal.cursor,
    foregroundMuted: theme.colors.foregroundMuted,
    border: theme.colors.border,
    selection: theme.colors.terminal.selectionBackground,
    monoFont: theme.fontFamily.mono,
    codeFontSize: theme.fontSize.code,
    syntax: theme.colors.syntax,
  },
});
const ThemedFileSourceView = withUnistyles(FileSourceView, sourceAppearance);

/**
 * The file tab: stats the file, picks its panel and mounts it. The panel reads, saves and shows
 * its own loading; the tab only knows the file exists, its kind, and whether the panel has
 * unsaved changes.
 */
export function FilePane({
  serverId,
  workspaceRoot,
  location,
  navigationRevision,
  readOnly,
}: {
  serverId: string;
  workspaceRoot: string;
  location: WorkspaceFileLocation;
  navigationRevision: number;
  /** Skips the panel path entirely: hosts without a PaneProvider (the /new page file nav
   * preview) get a read-only source view instead of the editable panel system. */
  readOnly?: boolean;
}) {
  if (readOnly) {
    return (
      <ReadonlyFilePane
        serverId={serverId}
        workspaceRoot={workspaceRoot}
        location={location}
        navigationRevision={navigationRevision}
      />
    );
  }
  return (
    <PanelFilePane
      serverId={serverId}
      workspaceRoot={workspaceRoot}
      location={location}
      navigationRevision={navigationRevision}
    />
  );
}

/**
 * The fork's read-only body for hosts outside the workspace pane system. It shares the panel
 * system's file handle but renders only the static source view, so it needs no PaneContext.
 */
function ReadonlyFilePane({
  serverId,
  workspaceRoot,
  location,
  navigationRevision,
}: {
  serverId: string;
  workspaceRoot: string;
  location: WorkspaceFileLocation;
  navigationRevision: number;
}) {
  const { t } = useTranslation();
  const connected = useSessionStore((state) => Boolean(state.sessions[serverId]?.client));
  const root = workspaceRoot.trim();
  const path = location.path.trim();
  const target = useMemo(
    () => (path ? resolveFilePreviewReadTarget({ path, workspaceRoot: root }) : null),
    [path, root],
  );
  const absolutePath = useMemo(
    () => buildAbsoluteExplorerPath({ workspaceRoot: root, entryPath: path }),
    [path, root],
  );
  const isActive = useRetainedPanelActive();
  const isAppVisible = useAppActivelyVisible();
  const handle = useFileHandle({
    serverId,
    target,
    absolutePath,
    observing: isActive && isAppVisible,
  });
  const snapshot = useFileHandleSnapshot(handle);

  let body;
  if (!connected && target) {
    body = <Text style={styles.errorText}>{t("workspace.terminal.hostDisconnected")}</Text>;
  } else if (!handle || snapshot.status === "loading") {
    return (
      <View style={styles.container} testID="workspace-file-pane">
        <FilePanelLoading />
      </View>
    );
  } else if (snapshot.status === "missing" || snapshot.status === "error") {
    body = (
      <>
        <Text style={styles.errorText}>
          {snapshot.status === "error" ? snapshot.error : t("panels.file.notFound")}
        </Text>
        <Button variant="outline" size="sm" onPress={handle.retry}>
          {t("common.actions.retry")}
        </Button>
      </>
    );
  } else if (snapshot.kind !== "text") {
    body = (
      <>
        <Text style={styles.mutedText}>{t("panels.file.binaryPreviewUnavailable")}</Text>
        <Text style={styles.mutedText}>{formatFileSize(snapshot.size)}</Text>
      </>
    );
  } else {
    return (
      <ReadonlyTextFileBody
        file={handle.file}
        location={location}
        navigationRevision={navigationRevision}
        size={snapshot.size}
      />
    );
  }
  return (
    <View style={styles.container} testID="workspace-file-pane">
      <View style={styles.centerState}>{body}</View>
    </View>
  );
}

function ReadonlyTextFileBody({
  file,
  location,
  navigationRevision,
  size,
}: {
  file: PluginFile;
  location: WorkspaceFileLocation;
  navigationRevision: number;
  size: number;
}) {
  const { t } = useTranslation();
  const presentation: SourcePresentation = selectSourcePresentation({
    size,
    platform: isWeb ? "web" : "native",
  });
  const text = useFileText(file);
  if (text.status === "loading") {
    return (
      <View style={styles.container} testID="workspace-file-pane">
        <FilePanelLoading />
      </View>
    );
  }
  if (text.status === "error") {
    return (
      <View style={styles.container} testID="workspace-file-pane">
        <View style={styles.centerState}>
          <Text style={styles.errorText}>
            {text.error.message || t("panels.file.failedToLoad")}
          </Text>
        </View>
      </View>
    );
  }
  if (presentation === "unsupported") {
    return (
      <View style={styles.container} testID="workspace-file-pane">
        <View style={styles.centerState}>
          <Text style={styles.mutedText}>{t("panels.file.tooLargeToDisplay")}</Text>
          <Text style={styles.mutedText}>{formatFileSize(size)}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.container} testID="workspace-file-pane">
      <ThemedFileSourceView
        content={text.text}
        filename={location.path}
        location={location}
        navigationRevision={navigationRevision}
        presentation={presentation}
      />
    </View>
  );
}

function PanelFilePane({
  serverId,
  workspaceRoot,
  location,
  navigationRevision,
}: {
  serverId: string;
  workspaceRoot: string;
  location: WorkspaceFileLocation;
  navigationRevision: number;
}) {
  const { t } = useTranslation();
  const connected = useSessionStore((state) => Boolean(state.sessions[serverId]?.client));
  const root = workspaceRoot.trim();
  const path = location.path.trim();
  const target = useMemo(
    () => (path ? resolveFilePreviewReadTarget({ path, workspaceRoot: root }) : null),
    [path, root],
  );
  const absolutePath = useMemo(
    () => buildAbsoluteExplorerPath({ workspaceRoot: root, entryPath: path }),
    [path, root],
  );
  // A hidden tab or a backgrounded app stops observing; observing again reports what changed.
  const isActive = useRetainedPanelActive();
  const isAppVisible = useAppActivelyVisible();
  const handle = useFileHandle({
    serverId,
    target,
    absolutePath,
    observing: isActive && isAppVisible,
  });
  const snapshot = useFileHandleSnapshot(handle);
  const targetKey = target ? `${target.cwd}:${target.path}` : null;
  const { panel, choice } = useFilePanelChoice({
    serverId,
    targetKey,
    path,
    fileKind: snapshot.status === "ready" ? snapshot.kind : null,
    presentable: isActive,
    lineNavigation: location.lineStart ? navigationRevision : null,
  });
  const [modified, setModified] = useState(false);
  usePublishPanelInstanceAttributes({ modified, suspendPendingSave: handle?.holdWrites });
  const panelLocation = useMemo(
    () => ({
      lineStart: location.lineStart,
      lineEnd: location.lineEnd,
      path,
    }),
    [location.lineEnd, location.lineStart, path],
  );

  let body;
  if (!connected && target) {
    body = <Text style={styles.errorText}>{t("workspace.terminal.hostDisconnected")}</Text>;
  } else if (!handle || snapshot.status === "loading") {
    return (
      <View style={styles.container} testID="workspace-file-pane">
        <FilePanelLoading />
      </View>
    );
  } else if (snapshot.status === "missing" || snapshot.status === "error") {
    body = (
      <>
        <Text style={styles.errorText}>
          {snapshot.status === "error" ? snapshot.error : t("panels.file.notFound")}
        </Text>
        <Button variant="outline" size="sm" onPress={handle.retry}>
          {t("common.actions.retry")}
        </Button>
      </>
    );
  } else if (!panel) {
    body = (
      <>
        <Text style={styles.mutedText}>{t("panels.file.binaryPreviewUnavailable")}</Text>
        <Text style={styles.mutedText}>{formatFileSize(snapshot.size)}</Text>
      </>
    );
  } else {
    return (
      <View style={styles.container} testID="workspace-file-pane">
        <FilePanelPicker choice={choice} />
        <MountedFilePanel
          key={`${panel.id}:${targetKey}`}
          panel={panel}
          file={handle.file}
          params={panelLocation}
          revision={navigationRevision}
          onModifiedChange={setModified}
        />
      </View>
    );
  }
  return (
    <View style={styles.container} testID="workspace-file-pane">
      <View style={styles.centerState}>{body}</View>
    </View>
  );
}

/** One panel mount. Its tab reports unsaved changes until the panel unmounts. */
function MountedFilePanel({
  panel,
  file,
  params,
  revision,
  onModifiedChange,
}: {
  panel: FilePanel;
  file: PluginFile;
  params: { path: string; lineStart?: number; lineEnd?: number };
  revision: number;
  onModifiedChange: (modified: boolean) => void;
}) {
  const { state, setCurrentTabState } = usePaneContext();
  const tab = useMemo<PluginTab>(
    () => ({
      setModified: onModifiedChange,
      state,
      setState: setCurrentTabState,
    }),
    [onModifiedChange, state, setCurrentTabState],
  );
  useEffect(() => () => onModifiedChange(false), [onModifiedChange]);
  return <FilePanelView panel={panel} file={file} tab={tab} params={params} revision={revision} />;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  mutedText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
}));
