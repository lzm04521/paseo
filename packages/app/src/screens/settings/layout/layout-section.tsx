import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsSection,
  SettingsCard,
  SettingsSelect,
  SettingsSwitch,
} from "@/components/settings";
import {
  useAppSettings,
  type ExplorerFileOpenMode,
  type ExplorerSidebarViewPreference,
  type OpenInSidePanePreferences,
  type PullRequestOpenLocation,
} from "@/hooks/use-settings";

const SOURCES = [
  "explorerFiles",
  "diffs",
  "chatFiles",
  "diffFiles",
  "subagents",
] as const satisfies readonly (keyof OpenInSidePanePreferences)[];

type LayoutPreferenceSource = keyof OpenInSidePanePreferences | "pullRequests";

const AUTO_OPEN_VIEW_OPTIONS = [
  "files",
  "changes",
] as const satisfies readonly ExplorerSidebarViewPreference[];

const FILE_OPEN_MODE_OPTIONS = [
  "preview",
  "tab",
] as const satisfies readonly ExplorerFileOpenMode[];

const WIDTH_PERCENT_OPTIONS = [10, 15, 20, 25, 30, 35, 40, 45, 50];

function LayoutPreferenceRow({
  source,
  destination,
  allowExplorer,
  onDestinationChange,
}: {
  source: LayoutPreferenceSource;
  destination: PullRequestOpenLocation;
  allowExplorer?: boolean;
  onDestinationChange(source: LayoutPreferenceSource, destination: PullRequestOpenLocation): void;
}) {
  const { t } = useTranslation();
  const options = useMemo(() => {
    const destinations = allowExplorer
      ? (["main", "side", "explorer"] as const)
      : (["main", "side"] as const);
    return destinations.map((value) => ({
      value,
      label: t(`settings.layout.openInSidePane.destinations.${value}`),
    }));
  }, [allowExplorer, t]);
  const change = useCallback(
    (value: PullRequestOpenLocation) => onDestinationChange(source, value),
    [source, onDestinationChange],
  );
  return (
    <SettingsSelect
      label={t(`settings.layout.openInSidePane.sources.${source}.label}`)}
      value={destination}
      options={options}
      onValueChange={change}
    />
  );
}

export function LayoutSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const handleDestinationChange = useCallback(
    (source: LayoutPreferenceSource, destination: PullRequestOpenLocation) => {
      if (source === "pullRequests") {
        void updateSettings({ pullRequestOpenLocation: destination });
        return;
      }
      void updateSettings({
        openInSidePane: { ...settings.openInSidePane, [source]: destination === "side" },
      });
    },
    [settings.openInSidePane, updateSettings],
  );
  const handleAutoOpenExplorerSidebarChange = useCallback(
    (autoOpenExplorerSidebar: boolean) => void updateSettings({ autoOpenExplorerSidebar }),
    [updateSettings],
  );
  const handleAutoOpenExplorerSidebarViewChange = useCallback(
    (autoOpenExplorerSidebarView: ExplorerSidebarViewPreference) =>
      void updateSettings({ autoOpenExplorerSidebarView }),
    [updateSettings],
  );
  const handleExplorerFileOpenModeChange = useCallback(
    (explorerFileOpenMode: ExplorerFileOpenMode) => void updateSettings({ explorerFileOpenMode }),
    [updateSettings],
  );
  const handleExplorerSidebarWidthPercentChange = useCallback(
    (explorerSidebarWidthPercent: number) => void updateSettings({ explorerSidebarWidthPercent }),
    [updateSettings],
  );
  const handleExplorerSidebarWidthPercentSelect = useCallback(
    (value: string) => handleExplorerSidebarWidthPercentChange(Number(value)),
    [handleExplorerSidebarWidthPercentChange],
  );
  return (
    <>
      <SettingsSection title={t("settings.layout.openInSidePane.title")}>
        <SettingsCard>
          {SOURCES.map((source) => (
            <LayoutPreferenceRow
              key={source}
              source={source}
              destination={settings.openInSidePane[source] ? "side" : "main"}
              onDestinationChange={handleDestinationChange}
            />
          ))}
          <LayoutPreferenceRow
            source="pullRequests"
            destination={settings.pullRequestOpenLocation}
            allowExplorer
            onDestinationChange={handleDestinationChange}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={t("settings.layout.explorerSidebar.title")}>
        <SettingsCard>
          <SettingsSwitch
            label={t("settings.layout.explorerSidebar.autoOpen")}
            hint={t("settings.layout.explorerSidebar.autoOpenHint")}
            testID="auto-open-explorer-sidebar-toggle"
            value={settings.autoOpenExplorerSidebar}
            onValueChange={handleAutoOpenExplorerSidebarChange}
          />
          <SettingsSelect<ExplorerSidebarViewPreference>
            label={t("settings.layout.explorerSidebar.defaultView")}
            hint={t("settings.layout.explorerSidebar.defaultViewHint")}
            testID="auto-open-explorer-sidebar-view"
            options={AUTO_OPEN_VIEW_OPTIONS.map((view) => ({
              value: view,
              label: t(`settings.layout.explorerSidebar.views.${view}`),
            }))}
            value={settings.autoOpenExplorerSidebarView}
            onValueChange={handleAutoOpenExplorerSidebarViewChange}
          />
          <SettingsSelect<ExplorerFileOpenMode>
            label={t("settings.layout.explorerSidebar.fileOpenMode")}
            hint={t("settings.layout.explorerSidebar.fileOpenModeHint")}
            testID="explorer-file-open-mode"
            options={FILE_OPEN_MODE_OPTIONS.map((mode) => ({
              value: mode,
              label: t(`settings.layout.explorerSidebar.fileOpenModes.${mode}`),
            }))}
            value={settings.explorerFileOpenMode}
            onValueChange={handleExplorerFileOpenModeChange}
          />
          <SettingsSelect<string>
            label={t("settings.layout.explorerSidebar.defaultWidth")}
            hint={t("settings.layout.explorerSidebar.defaultWidthHint")}
            testID="explorer-sidebar-width-percent"
            options={WIDTH_PERCENT_OPTIONS.map((percent) => ({
              value: String(percent),
              label: t("settings.layout.explorerSidebar.widthPercent", { percent }),
            }))}
            value={String(settings.explorerSidebarWidthPercent)}
            onValueChange={handleExplorerSidebarWidthPercentSelect}
          />
        </SettingsCard>
      </SettingsSection>
    </>
  );
}
