import { Text, View } from "react-native";
import { FolderOpen } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { FileExplorerPane } from "@/components/file-explorer-pane";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelRegistration } from "@/panels/panel-registry";
import { useAddFileToChat } from "@/panels/use-add-file-to-chat";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";

const ThemedFolderOpen = withUnistyles(FolderOpen);

function useFileNavPanelDescriptor() {
  const { t } = useTranslation();
  return {
    label: t("panels.fileNav.label"),
    subtitle: t("panels.fileNav.subtitle"),
    tooltip: t("panels.fileNav.tooltip"),
    titleState: "ready" as const,
    icon: ThemedFolderOpen,
    statusBucket: null,
  };
}

/**
 * Navigation-only explorer for the Side panel: the tree fills the panel and
 * clicking a file opens it as a "file" tab in the main window, never inside
 * this tab. The opened tab keeps the default file state, so its folder tree
 * starts hidden.
 */
function FileNavPanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, target, openFileInMainPane } = usePaneContext();
  const workspaceRoot = useWorkspaceDirectory(serverId, workspaceId);
  const { addFile, canAddToChat } = useAddFileToChat({ serverId, workspaceId });
  invariant(target.kind === "file_nav", "FileNavPanel requires file_nav target");
  if (!workspaceRoot) {
    return (
      <View style={styles.centerState}>
        <Text>{t("panels.file.directoryMissing")}</Text>
      </View>
    );
  }
  return (
    <FileExplorerPane
      serverId={serverId}
      workspaceId={workspaceId}
      workspaceRoot={workspaceRoot}
      onOpenFile={openFileInMainPane}
      onAddToChat={canAddToChat ? addFile : undefined}
    />
  );
}

export const fileNavPanelRegistration: PanelRegistration<"file_nav"> = {
  kind: "file_nav",
  resourceKey: () => "file_nav",
  component: FileNavPanel,
  useDescriptor: useFileNavPanelDescriptor,
};

const styles = StyleSheet.create((theme) => ({
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
}));
