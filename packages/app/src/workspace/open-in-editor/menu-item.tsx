import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Code } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { getIsElectron } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import type { Theme } from "@/styles/theme";
import { openDesktopTarget, useDesktopOpenTargets } from "@/workspace/desktop-open-targets";

interface OpenInVSCodeMenuItemProps {
  path?: string | null;
  testID: string;
  surface?: "context" | "dropdown";
}

const ThemedCode = withUnistyles(Code);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const leadingIcon = <ThemedCode size={14} uniProps={foregroundMutedColorMapping} />;

/**
 * Sidebar/project-menu entry that opens the workspace directory in VS Code.
 *
 * Mirrors `OpenInFileManagerMenuItem` — desktop only, hidden when VS Code isn't
 * among the detected editor targets or no path is given. Opens the workspace as
 * the VS Code workspace root (no `filePath`).
 */
export function OpenInVSCodeMenuItem({
  path,
  testID,
  surface = "dropdown",
}: OpenInVSCodeMenuItemProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const isElectron = getIsElectron();
  const workspacePath = path?.trim() ?? "";
  const { targets } = useDesktopOpenTargets({
    isLocalExecution: isElectron && workspacePath.length > 0,
  });
  const vscodeTarget = targets.find((target) => target.kind === "editor" && target.id === "vscode");

  const openInVSCode = useCallback(() => {
    if (!vscodeTarget || workspacePath.length === 0) return;
    void openDesktopTarget({
      editorId: vscodeTarget.id,
      workspacePath,
    }).catch((error) => {
      console.warn("[open-in-vscode] open failed", error);
      toast.error(t("sidebar.project.actions.openInVSCodeFailed"));
    });
  }, [vscodeTarget, t, toast, workspacePath]);

  if (!isElectron || !vscodeTarget || workspacePath.length === 0) {
    return null;
  }

  const label = t("sidebar.project.actions.openInVSCode");
  if (surface === "context") {
    return (
      <ContextMenuItem testID={testID} leading={leadingIcon} onSelect={openInVSCode}>
        {label}
      </ContextMenuItem>
    );
  }
  return (
    <DropdownMenuItem testID={testID} leading={leadingIcon} onSelect={openInVSCode}>
      {label}
    </DropdownMenuItem>
  );
}
