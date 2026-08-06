import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getIsElectron } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import { openDesktopTarget, useDesktopOpenTargets } from "@/workspace/desktop-open-targets";

/**
 * Opens a directory in the host's file manager (Finder / Explorer / Files).
 *
 * Desktop only: the editor-target bridge runs in the Electron main process, so on
 * mobile / browser this hook reports `isAvailable: false` and `reveal` is a no-op.
 *
 * Uses the exact same launch path as the sidebar workspace "Open in file manager"
 * action — `openDesktopTarget({ editorId, workspacePath })` with no `filePath` — so
 * the file-manager target runs `runtime.openPath(dir)` (Windows: `cmd /c start`,
 * which honours Explorer replacements; other platforms: `shell.openPath`).
 */
export function useRevealInFileManager() {
  const { t } = useTranslation();
  const toast = useToast();
  const isElectron = getIsElectron();
  const { targets } = useDesktopOpenTargets({ isLocalExecution: isElectron });
  const fileManagerTarget = targets.find((target) => target.kind === "file-manager");

  const reveal = useCallback(
    (absoluteDirPath: string) => {
      if (!fileManagerTarget || !absoluteDirPath) return;
      void openDesktopTarget({
        editorId: fileManagerTarget.id,
        workspacePath: absoluteDirPath,
      }).catch((error) => {
        console.warn("[reveal-in-file-manager] failed", error);
        toast.error(t("sidebar.project.actions.openFolderFailed"));
      });
    },
    [fileManagerTarget, t, toast],
  );

  return {
    isAvailable: isElectron && fileManagerTarget !== undefined,
    reveal,
  };
}
