import { Fragment, useCallback } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { Switch } from "@/components/ui/switch";
import {
  useAppSettings,
  type ExplorerFileOpenMode,
  type ExplorerSidebarViewPreference,
  type OpenInSidePanePreferences,
  type PullRequestOpenLocation,
} from "@/hooks/use-settings";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";

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

function destinationTriggerStyle({
  pressed,
  open,
}: PressableStateCallbackType & { open?: boolean }) {
  return [styles.destinationTrigger, (pressed || open) && styles.destinationTriggerActive];
}

function SettingsOptionRow<T>({
  label,
  hint,
  testID,
  options,
  value,
  first,
  menuWidth = 180,
  onSelect,
}: {
  label: string;
  hint?: string;
  testID: string;
  options: readonly { value: T; label: string }[];
  value: T;
  first: boolean;
  menuWidth?: number;
  onSelect: (value: T) => void;
}) {
  const selectedLabel = options.find((option) => option.value === value)?.label ?? "";
  return (
    <View style={[settingsStyles.row, first ? null : settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{label}</Text>
        {hint ? <Text style={settingsStyles.rowHint}>{hint}</Text> : null}
      </View>
      <DropdownMenu>
        <DropdownTrigger
          style={destinationTriggerStyle}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${selectedLabel}`}
          testID={testID}
        >
          <Text style={styles.destinationLabel}>{selectedLabel}</Text>
        </DropdownTrigger>
        <DropdownMenuContent side="bottom" align="end" width={menuWidth}>
          {options.map((option) => (
            <DropdownMenuItem
              key={String(option.value)}
              selected={option.value === value}
              onSelect={() => onSelect(option.value)}
            >
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

function LayoutPreferenceRow({
  source,
  destination,
  first,
  allowExplorer,
  onDestinationChange,
}: {
  source: LayoutPreferenceSource;
  destination: PullRequestOpenLocation;
  first: boolean;
  allowExplorer?: boolean;
  onDestinationChange: (
    source: LayoutPreferenceSource,
    destination: PullRequestOpenLocation,
  ) => void;
}) {
  const { t } = useTranslation();
  const destinationLabel = t(`settings.layout.openInSidePane.destinations.${destination}`);
  const selectMain = useCallback(
    () => onDestinationChange(source, "main"),
    [onDestinationChange, source],
  );
  const selectSide = useCallback(
    () => onDestinationChange(source, "side"),
    [onDestinationChange, source],
  );
  const selectExplorer = useCallback(
    () => onDestinationChange(source, "explorer"),
    [onDestinationChange, source],
  );
  const label = t(`settings.layout.openInSidePane.sources.${source}.label`);
  return (
    <View style={[settingsStyles.row, first ? null : settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{label}</Text>
      </View>
      <DropdownMenu>
        <DropdownTrigger
          style={destinationTriggerStyle}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${destinationLabel}`}
        >
          <Text style={styles.destinationLabel}>{destinationLabel}</Text>
        </DropdownTrigger>
        <DropdownMenuContent side="bottom" align="end" width={180}>
          <DropdownMenuItem selected={destination === "main"} onSelect={selectMain}>
            {t("settings.layout.openInSidePane.destinations.main")}
          </DropdownMenuItem>
          <DropdownMenuItem selected={destination === "side"} onSelect={selectSide}>
            {t("settings.layout.openInSidePane.destinations.side")}
          </DropdownMenuItem>
          {allowExplorer ? (
            <DropdownMenuItem selected={destination === "explorer"} onSelect={selectExplorer}>
              {t("settings.layout.openInSidePane.destinations.explorer")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
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
    (explorerFileOpenMode: ExplorerFileOpenMode) =>
      void updateSettings({ explorerFileOpenMode }),
    [updateSettings],
  );
  const handleExplorerSidebarWidthPercentChange = useCallback(
    (explorerSidebarWidthPercent: number) => void updateSettings({ explorerSidebarWidthPercent }),
    [updateSettings],
  );
  return (
    <>
      <SettingsSection title={t("settings.layout.openInSidePane.title")}>
        <View style={settingsStyles.card}>
          {SOURCES.map((source, index) => (
            <Fragment key={source}>
              <LayoutPreferenceRow
                source={source}
                destination={settings.openInSidePane[source] ? "side" : "main"}
                first={index === 0}
                onDestinationChange={handleDestinationChange}
              />
            </Fragment>
          ))}
          <LayoutPreferenceRow
            source="pullRequests"
            destination={settings.pullRequestOpenLocation}
            first={false}
            allowExplorer
            onDestinationChange={handleDestinationChange}
          />
        </View>
      </SettingsSection>
      <SettingsSection title={t("settings.layout.explorerSidebar.title")}>
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>
                {t("settings.layout.explorerSidebar.autoOpen")}
              </Text>
              <Text style={settingsStyles.rowHint}>
                {t("settings.layout.explorerSidebar.autoOpenHint")}
              </Text>
            </View>
            <Switch
              value={settings.autoOpenExplorerSidebar}
              onValueChange={handleAutoOpenExplorerSidebarChange}
              accessibilityLabel={t("settings.layout.explorerSidebar.autoOpen")}
              testID="auto-open-explorer-sidebar-toggle"
            />
          </View>
          <SettingsOptionRow<ExplorerSidebarViewPreference>
            label={t("settings.layout.explorerSidebar.defaultView")}
            hint={t("settings.layout.explorerSidebar.defaultViewHint")}
            testID="auto-open-explorer-sidebar-view"
            options={AUTO_OPEN_VIEW_OPTIONS.map((view) => ({
              value: view,
              label: t(`settings.layout.explorerSidebar.views.${view}`),
            }))}
            value={settings.autoOpenExplorerSidebarView}
            first={false}
            onSelect={handleAutoOpenExplorerSidebarViewChange}
          />
          <SettingsOptionRow<ExplorerFileOpenMode>
            label={t("settings.layout.explorerSidebar.fileOpenMode")}
            hint={t("settings.layout.explorerSidebar.fileOpenModeHint")}
            testID="explorer-file-open-mode"
            options={FILE_OPEN_MODE_OPTIONS.map((mode) => ({
              value: mode,
              label: t(`settings.layout.explorerSidebar.fileOpenModes.${mode}`),
            }))}
            value={settings.explorerFileOpenMode}
            first={false}
            onSelect={handleExplorerFileOpenModeChange}
          />
          <SettingsOptionRow<number>
            label={t("settings.layout.explorerSidebar.defaultWidth")}
            hint={t("settings.layout.explorerSidebar.defaultWidthHint")}
            testID="explorer-sidebar-width-percent"
            options={WIDTH_PERCENT_OPTIONS.map((percent) => ({
              value: percent,
              label: t("settings.layout.explorerSidebar.widthPercent", { percent }),
            }))}
            value={settings.explorerSidebarWidthPercent}
            first={false}
            menuWidth={120}
            onSelect={handleExplorerSidebarWidthPercentChange}
          />
        </View>
      </SettingsSection>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  destinationTrigger: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  destinationTriggerActive: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  destinationLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
}));
