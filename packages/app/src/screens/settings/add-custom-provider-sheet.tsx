import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { isWeb } from "@/constants/platform";

const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export interface AddCustomProviderSheetProps {
  serverId: string;
  visible: boolean;
  onClose: () => void;
  existingProviderIds: string[];
  onAdded: (providerId: string) => void;
}

export function AddCustomProviderSheet({
  serverId,
  visible,
  onClose,
  existingProviderIds,
  onAdded,
}: AddCustomProviderSheetProps) {
  const { t } = useTranslation();
  const { patchConfig } = useDaemonConfig(serverId);
  const [providerId, setProviderId] = useState("");
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [fetchModels, setFetchModels] = useState(true);
  const [defaultModelId, setDefaultModelId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) {
      setProviderId("");
      setLabel("");
      setBaseUrl("");
      setAuthToken("");
      setApiKey("");
      setFetchModels(true);
      setDefaultModelId("");
      setError(null);
    }
  }, [visible]);

  const trimmedId = providerId.trim();
  const trimmedLabel = label.trim();

  const handleAdd = useCallback(() => {
    if (!PROVIDER_ID_PATTERN.test(trimmedId)) {
      setError(t("settings.providers.addCustom.providerIdInvalid"));
      return;
    }
    if (existingProviderIds.includes(trimmedId)) {
      setError(t("settings.providers.addCustom.providerIdExists"));
      return;
    }
    if (trimmedLabel.length === 0) {
      setError(t("settings.providers.addCustom.label"));
      return;
    }
    setError(null);
    setSaving(true);
    const env: Record<string, string> = {};
    const trimmedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    if (trimmedBaseUrl) env.ANTHROPIC_BASE_URL = trimmedBaseUrl;
    const trimmedToken = authToken.trim();
    if (trimmedToken) env.ANTHROPIC_AUTH_TOKEN = trimmedToken;
    const trimmedApiKey = apiKey.trim();
    if (trimmedApiKey) env.ANTHROPIC_API_KEY = trimmedApiKey;
    const trimmedDefaultModelId = defaultModelId.trim();
    void patchConfig({
      providers: {
        [trimmedId]: {
          extends: "claude",
          label: trimmedLabel,
          env,
          fetchModels,
          // 留空不设默认模型（新建会话落到列表第一个）；空串在 patch 语义里表示清除。
          ...(trimmedDefaultModelId ? { defaultModelId: trimmedDefaultModelId } : {}),
        },
      },
    })
      .then(() => onAdded(trimmedId))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setSaving(false));
  }, [
    apiKey,
    authToken,
    baseUrl,
    defaultModelId,
    existingProviderIds,
    fetchModels,
    onAdded,
    patchConfig,
    t,
    trimmedId,
    trimmedLabel,
  ]);

  const header = useMemo<SheetHeader>(
    () => ({ title: t("settings.providers.addCustom.title") }),
    [t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      desktopMaxWidth={480}
      testID="add-custom-provider-sheet"
    >
      <View style={styles.formGroup}>
        <Text style={styles.formLabel}>{t("settings.providers.addCustom.providerId")}</Text>
        <AdaptiveTextInput
          initialValue={providerId}
          resetKey={`add-provider-${visible}`}
          onChangeText={setProviderId}
          placeholder={t("settings.providers.addCustom.providerIdPlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
          testID="add-provider-id"
          // @ts-expect-error - outlineStyle is web-only
          style={[styles.formInput, isWeb && { outlineStyle: "none" }]}
        />
        <Text style={styles.formLabel}>{t("settings.providers.addCustom.label")}</Text>
        <AdaptiveTextInput
          initialValue={label}
          resetKey={`add-provider-label-${visible}`}
          onChangeText={setLabel}
          placeholder={t("settings.providers.addCustom.labelPlaceholder")}
          testID="add-provider-label"
          // @ts-expect-error - outlineStyle is web-only
          style={[styles.formInput, isWeb && { outlineStyle: "none" }]}
        />
        <Text style={styles.formLabel}>{t("settings.providers.addCustom.extendsLabel")}</Text>
        <Text style={styles.formValue} testID="add-provider-extends">
          {t("settings.providers.addCustom.extendsValue")}
        </Text>
        <Text style={styles.formLabel}>{t("settings.providers.addCustom.baseUrl")}</Text>
        <AdaptiveTextInput
          initialValue={baseUrl}
          resetKey={`add-provider-url-${visible}`}
          onChangeText={setBaseUrl}
          placeholder={t("settings.providers.addCustom.baseUrlPlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
          testID="add-provider-base-url"
          // @ts-expect-error - outlineStyle is web-only
          style={[styles.formInput, isWeb && { outlineStyle: "none" }]}
        />
        <Text style={styles.formLabel}>{t("settings.providers.addCustom.authToken")}</Text>
        <AdaptiveTextInput
          initialValue={authToken}
          resetKey={`add-provider-token-${visible}`}
          onChangeText={setAuthToken}
          autoCapitalize="none"
          autoCorrect={false}
          testID="add-provider-auth-token"
          // @ts-expect-error - outlineStyle is web-only
          style={[styles.formInput, isWeb && { outlineStyle: "none" }]}
        />
        <Text style={styles.formLabel}>{t("settings.providers.addCustom.apiKey")}</Text>
        <AdaptiveTextInput
          initialValue={apiKey}
          resetKey={`add-provider-apikey-${visible}`}
          onChangeText={setApiKey}
          autoCapitalize="none"
          autoCorrect={false}
          testID="add-provider-api-key"
          // @ts-expect-error - outlineStyle is web-only
          style={[styles.formInput, isWeb && { outlineStyle: "none" }]}
        />
        <View style={styles.switchRow}>
          <Text style={styles.formLabel}>{t("settings.providers.addCustom.fetchModels")}</Text>
          <Switch value={fetchModels} onValueChange={setFetchModels} />
        </View>
        <Text style={styles.formLabel}>{t("settings.providers.addCustom.defaultModel")}</Text>
        <AdaptiveTextInput
          initialValue={defaultModelId}
          resetKey={`add-provider-default-model-${visible}`}
          onChangeText={setDefaultModelId}
          placeholder={t("settings.providers.addCustom.defaultModelPlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
          testID="add-provider-default-model"
          // @ts-expect-error - outlineStyle is web-only
          style={[styles.formInput, isWeb && { outlineStyle: "none" }]}
        />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <View style={styles.formActions}>
          <Button variant="secondary" size="sm" onPress={onClose} disabled={saving}>
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="default"
            size="sm"
            onPress={handleAdd}
            disabled={saving || trimmedId.length === 0 || trimmedLabel.length === 0}
          >
            {saving
              ? t("settings.providers.addCustom.saving")
              : t("settings.providers.addCustom.save")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  formGroup: { padding: theme.spacing[4], gap: theme.spacing[2] },
  formLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  formValue: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  formInput: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[2],
    color: theme.colors.foreground,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[2],
  },
  errorText: { color: theme.colors.statusDanger, fontSize: theme.fontSize.sm },
  formActions: { flexDirection: "row", gap: theme.spacing[2], marginTop: theme.spacing[2] },
}));
