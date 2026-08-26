import { useCallback } from "react";
import { Alert, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";

export function ClaudeImageDowngradeCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);

  const handleValueChange = useCallback(
    (next: boolean) => {
      void patchConfig({ claudeImageDowngrade: next ? "on" : "off" }).catch((error) => {
        console.error("[HostPage] Failed to update Claude image downgrade", error);
        Alert.alert(
          t("settings.host.orchestration.imageDowngrade.errorTitle"),
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [patchConfig, t],
  );

  if (!isConnected) return null;

  return (
    <View style={settingsStyles.card} testID="host-page-claude-image-downgrade-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>
            {t("settings.host.orchestration.imageDowngrade.title")}
          </Text>
          <Text style={settingsStyles.rowHint}>
            {t("settings.host.orchestration.imageDowngrade.hint")}
          </Text>
        </View>
        <Switch
          value={config?.claudeImageDowngrade === "on"}
          onValueChange={handleValueChange}
          accessibilityLabel={t("settings.host.orchestration.imageDowngrade.accessibilityLabel")}
          testID="host-page-claude-image-downgrade-switch"
        />
      </View>
    </View>
  );
}
