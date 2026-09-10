import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { MutableDaemonConfig } from "@getpaseo/protocol/messages";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { SettingsTextAreaCard } from "@/components/settings-textarea";
import { Button } from "@/components/ui/button";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";

const METADATA_DEFAULTS_FIELDS = [
  {
    key: "title",
    titleKey: "settings.project.metadata.titleGeneration",
    placeholderKey: "settings.project.metadata.titleGenerationPlaceholder",
    inputTestID: "host-metadata-defaults-title-input",
  },
  {
    key: "branchName",
    titleKey: "settings.project.metadata.branchName",
    placeholderKey: "settings.project.metadata.branchNamePlaceholder",
    inputTestID: "host-metadata-defaults-branch-name-input",
  },
  {
    key: "commitMessage",
    titleKey: "settings.project.metadata.commitMessage",
    placeholderKey: "settings.project.metadata.commitMessagePlaceholder",
    inputTestID: "host-metadata-defaults-commit-message-input",
  },
  {
    key: "pullRequest",
    titleKey: "settings.project.metadata.pullRequest",
    placeholderKey: "settings.project.metadata.pullRequestPlaceholder",
    inputTestID: "host-metadata-defaults-pull-request-input",
  },
] as const;

type MetadataDefaultsKey = (typeof METADATA_DEFAULTS_FIELDS)[number]["key"];

function readMetadataDefaultsInstructions(
  metadataGeneration: MutableDaemonConfig["metadataGeneration"] | undefined,
): Record<MetadataDefaultsKey, string> {
  return {
    title: metadataGeneration?.title?.instructions ?? "",
    branchName: metadataGeneration?.branchName?.instructions ?? "",
    commitMessage: metadataGeneration?.commitMessage?.instructions ?? "",
    pullRequest: metadataGeneration?.pullRequest?.instructions ?? "",
  };
}

// Daemon-level (global default) metadataGeneration instructions. A project's
// paseo.json overrides these per key; the three-tier fallback lives server-side
// in buildMetadataPrompt (project → daemon → code default).
function MetadataDefaultsField({
  field,
  value,
  accessibilityLabel,
  placeholder,
  onValueChange,
}: {
  field: (typeof METADATA_DEFAULTS_FIELDS)[number];
  value: string;
  accessibilityLabel: string;
  placeholder: string;
  onValueChange: (key: MetadataDefaultsKey, text: string) => void;
}) {
  const handleChange = useCallback(
    (text: string) => onValueChange(field.key, text),
    [field.key, onValueChange],
  );
  return (
    <SettingsTextAreaCard
      testID={field.inputTestID}
      accessibilityLabel={accessibilityLabel}
      value={value}
      onChangeText={handleChange}
      placeholder={placeholder}
    />
  );
}

export function MetadataGenerationDefaultsCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const persisted = useMemo(
    () => readMetadataDefaultsInstructions(config?.metadataGeneration),
    [config],
  );
  const [draft, setDraft] = useState<Record<MetadataDefaultsKey, string>>(persisted);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const header = useMemo<SheetHeader>(
    () => ({ title: t("settings.host.metadata.defaults.sheetTitle") }),
    [t],
  );

  useEffect(() => {
    setDraft(persisted);
  }, [persisted]);

  const hasChanges = METADATA_DEFAULTS_FIELDS.some(
    (field) => draft[field.key] !== persisted[field.key],
  );

  const handleFieldChange = useCallback(
    (key: MetadataDefaultsKey, text: string) =>
      setDraft((prev) => {
        const next = { ...prev };
        next[key] = text;
        return next;
      }),
    [],
  );

  const handleOpen = useCallback(() => {
    setDraft(persisted);
    setIsEditing(true);
  }, [persisted]);

  const handleClose = useCallback(() => {
    if (isSaving) return;
    setDraft(persisted);
    setIsEditing(false);
  }, [isSaving, persisted]);

  const handleSave = useCallback(() => {
    setIsSaving(true);
    const metadataGeneration: Record<MetadataDefaultsKey, { instructions: string }> = {
      title: { instructions: draft.title },
      branchName: { instructions: draft.branchName },
      commitMessage: { instructions: draft.commitMessage },
      pullRequest: { instructions: draft.pullRequest },
    };
    void patchConfig({ metadataGeneration })
      .then(() => {
        setIsEditing(false);
        return;
      })
      .catch((error) => {
        console.error("[HostPage] Failed to save metadata generation defaults", error);
      })
      .finally(() => setIsSaving(false));
  }, [draft, patchConfig]);

  const handleReset = useCallback(() => {
    setDraft(persisted);
  }, [persisted]);

  if (!isConnected) return null;

  return (
    <>
      <View style={settingsStyles.card} testID="host-metadata-defaults-card">
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.host.metadata.defaults.title")}
            </Text>
            <Text style={settingsStyles.rowHint}>{t("settings.host.metadata.defaults.hint")}</Text>
          </View>
          <Button
            variant="outline"
            size="sm"
            onPress={handleOpen}
            testID="host-metadata-defaults-edit"
          >
            {t("settings.host.metadata.defaults.edit")}
          </Button>
        </View>
      </View>

      {isEditing ? (
        <AdaptiveModalSheet
          header={header}
          visible
          onClose={handleClose}
          testID="host-metadata-defaults-sheet"
          desktopMaxWidth={560}
        >
          {METADATA_DEFAULTS_FIELDS.map((field) => (
            <MetadataDefaultsField
              key={field.key}
              field={field}
              value={draft[field.key]}
              accessibilityLabel={t(field.titleKey)}
              placeholder={t(field.placeholderKey)}
              onValueChange={handleFieldChange}
            />
          ))}
          <View style={styles.appendPromptActions}>
            <Button
              variant="ghost"
              size="sm"
              onPress={handleReset}
              disabled={!hasChanges || isSaving}
              testID="host-metadata-defaults-reset"
            >
              {t("settings.host.metadata.defaults.reset")}
            </Button>
            <Button
              variant="default"
              size="sm"
              onPress={handleSave}
              disabled={!hasChanges || isSaving}
              testID="host-metadata-defaults-save"
            >
              {isSaving
                ? t("settings.host.metadata.defaults.saving")
                : t("settings.host.metadata.defaults.save")}
            </Button>
          </View>
        </AdaptiveModalSheet>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  appendPromptActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
