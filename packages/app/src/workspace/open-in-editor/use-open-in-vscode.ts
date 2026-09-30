import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getIsElectron } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import { openDesktopTarget, useDesktopOpenTargets } from "@/workspace/desktop-open-targets";

interface OpenInVSCodeInput {
  workspacePath: string;
  filePath?: string;
  line?: number;
  column?: number;
}

/**
 * Opens a file or directory in VS Code on the host.
 *
 * Desktop only: the editor-target bridge runs in the Electron main process, so on
 * mobile / browser this hook reports `isAvailable: false` and `open` is a no-op.
 *
 * Files open with the workspace as the working directory and the file as an
 * argument (VS Code's `code <workspace> <file>` form); directories open as the
 * workspace root. A `line`/`column`, when known, jumps the cursor via VS Code's
 * `--goto` flag — see the vscode editor target's `launchArgs`.
 */
export function useOpenInVSCode() {
  const { t } = useTranslation();
  const toast = useToast();
  const isElectron = getIsElectron();
  const { targets } = useDesktopOpenTargets({ isLocalExecution: isElectron });
  const vscodeTarget = targets.find((target) => target.kind === "editor" && target.id === "vscode");

  const open = useCallback(
    (input: OpenInVSCodeInput) => {
      if (!vscodeTarget || !input.workspacePath) return;
      void openDesktopTarget({
        editorId: vscodeTarget.id,
        workspacePath: input.workspacePath,
        ...(input.filePath ? { filePath: input.filePath } : {}),
        ...(input.line ? { line: input.line } : {}),
        ...(input.column ? { column: input.column } : {}),
      }).catch((error) => {
        console.warn("[open-in-vscode] failed", error);
        toast.error(t("workspace.fileActions.openInVSCodeFailed"));
      });
    },
    [vscodeTarget, t, toast],
  );

  return {
    isAvailable: isElectron && vscodeTarget !== undefined,
    open,
  };
}
