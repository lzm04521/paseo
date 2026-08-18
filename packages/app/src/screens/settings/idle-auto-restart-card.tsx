import { useCallback, useMemo, useState } from "react";
import { Alert, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";

const UPTIME_MIN = 1;
const UPTIME_MAX = 10080;
const IDLE_MIN = 1;
const IDLE_MAX = 1440;
const DEFAULT_UPTIME_MINUTES = 240;
const DEFAULT_IDLE_MINUTES = 10;

function validateMinutes(
  raw: string,
  min: number,
  max: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): { value?: number; error: string | null } {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || !/^\d+$/.test(trimmed)) {
    return { error: t("settings.host.daemon.idleAutoRestart.invalidInteger") };
  }
  const value = Number(trimmed);
  if (value < min || value > max) {
    return { error: t("settings.host.daemon.idleAutoRestart.invalidRange", { min, max }) };
  }
  return { value, error: null };
}

export function IdleAutoRestartCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const idleAutoRestart = config?.idleAutoRestart;
  const persistedUptime = idleAutoRestart?.uptimeThresholdMinutes ?? DEFAULT_UPTIME_MINUTES;
  const persistedIdle = idleAutoRestart?.idleThresholdMinutes ?? DEFAULT_IDLE_MINUTES;
  const [uptimeDraft, setUptimeDraft] = useState(String(persistedUptime));
  const [idleDraft, setIdleDraft] = useState(String(persistedIdle));
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // AdaptiveTextInput 是非受控组件（value prop 会被丢弃），回显靠 initialValue + resetKey
  // 重挂载；sheetSession 在每次打开时递增（先例：project-edit-sheet 的 urlResetKey）。
  const [sheetSession, setSheetSession] = useState(0);
  const header = useMemo<SheetHeader>(
    () => ({ title: t("settings.host.daemon.idleAutoRestart.sheetTitle") }),
    [t],
  );

  const uptimeValidation = useMemo(
    () => validateMinutes(uptimeDraft, UPTIME_MIN, UPTIME_MAX, t),
    [uptimeDraft, t],
  );
  const idleValidation = useMemo(
    () => validateMinutes(idleDraft, IDLE_MIN, IDLE_MAX, t),
    [idleDraft, t],
  );
  const canSave =
    uptimeValidation.value !== undefined && idleValidation.value !== undefined && !isSaving;

  const handleEnabledChange = useCallback(
    (next: boolean) => {
      void patchConfig({ idleAutoRestart: { enabled: next } }).catch((error) => {
        console.error("[HostPage] Failed to update idle auto-restart", error);
        Alert.alert(
          t("settings.host.daemon.idleAutoRestart.errorTitle"),
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [patchConfig, t],
  );

  const handleOpen = useCallback(() => {
    setUptimeDraft(String(persistedUptime));
    setIdleDraft(String(persistedIdle));
    setSheetSession((n) => n + 1);
    setIsEditing(true);
  }, [persistedUptime, persistedIdle]);

  const handleClose = useCallback(() => {
    if (isSaving) return;
    setIsEditing(false);
  }, [isSaving]);

  const handleSave = useCallback(() => {
    if (!canSave) return;
    const uptimeThresholdMinutes = uptimeValidation.value;
    const idleThresholdMinutes = idleValidation.value;
    if (uptimeThresholdMinutes === undefined || idleThresholdMinutes === undefined) return;
    setIsSaving(true);
    void patchConfig({
      idleAutoRestart: {
        enabled: idleAutoRestart?.enabled ?? false,
        uptimeThresholdMinutes,
        idleThresholdMinutes,
      },
    })
      .then(() => {
        setIsEditing(false);
        return;
      })
      .catch((error) => {
        console.error("[HostPage] Failed to save idle auto-restart thresholds", error);
        Alert.alert(
          t("settings.host.daemon.idleAutoRestart.errorTitle"),
          error instanceof Error ? error.message : String(error),
        );
      })
      .finally(() => setIsSaving(false));
  }, [canSave, uptimeValidation, idleValidation, idleAutoRestart, patchConfig, t]);

  if (!isConnected) return null;

  return (
    <>
      <View style={settingsStyles.card} testID="host-page-idle-auto-restart-card">
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.host.daemon.idleAutoRestart.title")}
            </Text>
            <Text style={settingsStyles.rowHint}>
              {t("settings.host.daemon.idleAutoRestart.hint")}
            </Text>
          </View>
          <Switch
            value={idleAutoRestart?.enabled === true}
            onValueChange={handleEnabledChange}
            accessibilityLabel={t("settings.host.daemon.idleAutoRestart.title")}
            testID="host-page-idle-auto-restart-switch"
          />
          <Button
            variant="outline"
            size="sm"
            onPress={handleOpen}
            testID="host-page-idle-auto-restart-edit"
          >
            {t("settings.host.daemon.idleAutoRestart.settings")}
          </Button>
        </View>
      </View>

      {isEditing ? (
        <AdaptiveModalSheet
          header={header}
          visible
          onClose={handleClose}
          testID="host-page-idle-auto-restart-sheet"
          desktopMaxWidth={560}
        >
          <Field
            label={t("settings.host.daemon.idleAutoRestart.uptimeLabel")}
            hint={t("settings.host.daemon.idleAutoRestart.uptimeHint")}
            error={uptimeValidation.error}
            testID="host-page-idle-auto-restart-uptime-field"
          >
            <FormTextInput
              initialValue={String(persistedUptime)}
              resetKey={`uptime-${sheetSession}`}
              onChangeText={setUptimeDraft}
              inputMode="numeric"
              testID="host-page-idle-auto-restart-uptime-input"
            />
          </Field>
          <Field
            label={t("settings.host.daemon.idleAutoRestart.idleLabel")}
            hint={t("settings.host.daemon.idleAutoRestart.idleHint")}
            error={idleValidation.error}
            testID="host-page-idle-auto-restart-idle-field"
          >
            <FormTextInput
              initialValue={String(persistedIdle)}
              resetKey={`idle-${sheetSession}`}
              onChangeText={setIdleDraft}
              inputMode="numeric"
              testID="host-page-idle-auto-restart-idle-input"
            />
          </Field>
          <View style={styles.sheetActions}>
            <Button
              variant="ghost"
              size="sm"
              onPress={handleClose}
              disabled={isSaving}
              testID="host-page-idle-auto-restart-cancel"
            >
              {t("settings.host.daemon.idleAutoRestart.cancel")}
            </Button>
            <Button
              variant="default"
              size="sm"
              onPress={handleSave}
              disabled={!canSave}
              testID="host-page-idle-auto-restart-save"
            >
              {t("settings.host.daemon.idleAutoRestart.save")}
            </Button>
          </View>
        </AdaptiveModalSheet>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  sheetActions: {
    flexDirection: "row",
    gap: theme.spacing[3],
    justifyContent: "flex-end",
  },
}));
