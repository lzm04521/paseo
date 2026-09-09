import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { MutableDaemonConfig } from "@getpaseo/protocol/messages";

import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { isWeb } from "@/constants/platform";

function readProviderOverride(
  config: MutableDaemonConfig | null | undefined,
  provider: string,
): Record<string, unknown> | undefined {
  const entry = config?.providers?.[provider] as Record<string, unknown> | undefined;
  return entry && typeof entry === "object" ? entry : undefined;
}

function readStringField(source: Record<string, unknown> | undefined, key: string): string {
  const value = source?.[key];
  return typeof value === "string" ? value : "";
}

function readEnvString(source: Record<string, unknown> | undefined, key: string): string {
  const env = source?.env;
  if (env === undefined || env === null || typeof env !== "object" || Array.isArray(env)) {
    return "";
  }
  const value = (env as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

// 服务端按 provider 浅合并，patch env 会整体替换落盘 env，
// 保存前先把现有 env（含用户手写的非托管键）拷出来做基底，避免整包替换丢键。
function readEnvRecord(source: Record<string, unknown> | undefined): Record<string, string> {
  const env = source?.env;
  if (env === undefined || env === null || typeof env !== "object" || Array.isArray(env)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

export interface ProviderConnectionEditSheetProps {
  provider: string;
  serverId: string;
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}

interface DefaultModelOptionRowProps {
  optionId: string;
  label: string;
  selected: boolean;
  onSelect: (modelId: string) => void;
}

function DefaultModelOptionRow({
  optionId,
  label,
  selected,
  onSelect,
}: DefaultModelOptionRowProps) {
  const handleSelect = useCallback(() => onSelect(optionId), [onSelect, optionId]);
  return (
    <Pressable
      onPress={handleSelect}
      style={[styles.optionRow, selected && styles.optionRowSelected]}
      testID={`connection-default-model-${optionId}`}
    >
      <Text style={styles.optionLabel}>{label}</Text>
      {optionId && optionId !== label ? <Text style={styles.optionHint}>{optionId}</Text> : null}
    </Pressable>
  );
}

export function ProviderConnectionEditSheet({
  provider,
  serverId,
  visible,
  onClose,
  onSaved,
}: ProviderConnectionEditSheetProps) {
  const { t } = useTranslation();
  const { config, patchConfig } = useDaemonConfig(serverId);
  const { entries } = useProvidersSnapshot(serverId);
  const override = useMemo(() => readProviderOverride(config, provider), [config, provider]);

  const [label, setLabel] = useState(() => readStringField(override, "label"));
  const [baseUrl, setBaseUrl] = useState(() => readEnvString(override, "ANTHROPIC_BASE_URL"));
  const [authToken, setAuthToken] = useState(() => readEnvString(override, "ANTHROPIC_AUTH_TOKEN"));
  const [apiKey, setApiKey] = useState(() => readEnvString(override, "ANTHROPIC_API_KEY"));
  const [fetchModels, setFetchModels] = useState(() => override?.fetchModels === true);
  const [defaultModelId, setDefaultModelId] = useState(() =>
    readStringField(override, "defaultModelId").trim(),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 选项来自该供应商的快照模型列表；已配置的默认模型若不在列表里（远端列表变化）
  // 仍保留为独立选项，避免"看不见就被悄悄清除"。
  const modelOptions = useMemo(() => {
    const models = entries?.find((entry) => entry.provider === provider)?.models ?? [];
    const options = models.map((model) => ({ id: model.id, label: model.label }));
    if (defaultModelId && !options.some((option) => option.id === defaultModelId)) {
      options.unshift({ id: defaultModelId, label: defaultModelId });
    }
    return options;
  }, [defaultModelId, entries, provider]);

  const handleSelectDefaultModel = useCallback((modelId: string) => {
    setDefaultModelId(modelId);
  }, []);
  const handleSelectNoDefault = useCallback(() => setDefaultModelId(""), []);

  useEffect(() => {
    if (!visible) {
      setError(null);
    }
  }, [visible]);

  const trimmedLabel = label.trim();
  const canSave = trimmedLabel.length > 0 && !saving;

  const handleSave = useCallback(() => {
    if (!canSave) return;
    setError(null);
    setSaving(true);
    // 托管键（三个 ANTHROPIC_*）先删后写：清空的托管键做属性删除（不写空串），其余非托管键原样保留。
    const env = readEnvRecord(override);
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.ANTHROPIC_API_KEY;
    const trimmedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    if (trimmedBaseUrl) env.ANTHROPIC_BASE_URL = trimmedBaseUrl;
    const trimmedToken = authToken.trim();
    if (trimmedToken) env.ANTHROPIC_AUTH_TOKEN = trimmedToken;
    const trimmedApiKey = apiKey.trim();
    if (trimmedApiKey) env.ANTHROPIC_API_KEY = trimmedApiKey;
    const trimmedDefaultModelId = defaultModelId.trim();
    void patchConfig({
      providers: {
        [provider]: {
          label: trimmedLabel,
          env,
          fetchModels,
          // 空串 = 清除默认模型（服务端 patch 语义：defaultModelId === "" 删键）。
          defaultModelId: trimmedDefaultModelId,
        },
      },
    })
      .then(() => onSaved())
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setSaving(false));
  }, [
    apiKey,
    authToken,
    baseUrl,
    canSave,
    defaultModelId,
    fetchModels,
    onSaved,
    override,
    patchConfig,
    provider,
    trimmedLabel,
  ]);

  const header = useMemo<SheetHeader>(
    () => ({ title: t("settings.providers.connection.title") }),
    [t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      desktopMaxWidth={480}
      testID="provider-connection-edit-sheet"
    >
      <View style={styles.formGroup}>
        <Text style={styles.formLabel}>{t("settings.providers.connection.label")}</Text>
        <AdaptiveTextInput
          initialValue={label}
          resetKey={`connection-label-${visible}`}
          onChangeText={setLabel}
          testID="connection-label"
          // @ts-expect-error - outlineStyle is web-only
          style={[styles.formInput, isWeb && { outlineStyle: "none" }]}
        />
        <Text style={styles.formLabel}>{t("settings.providers.connection.baseUrl")}</Text>
        <AdaptiveTextInput
          initialValue={baseUrl}
          resetKey={`connection-url-${visible}`}
          onChangeText={setBaseUrl}
          placeholder={t("settings.providers.connection.baseUrlPlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
          testID="connection-base-url"
          // @ts-expect-error - outlineStyle is web-only
          style={[styles.formInput, isWeb && { outlineStyle: "none" }]}
        />
        <Text style={styles.formLabel}>{t("settings.providers.connection.authToken")}</Text>
        <AdaptiveTextInput
          initialValue={authToken}
          resetKey={`connection-token-${visible}`}
          onChangeText={setAuthToken}
          autoCapitalize="none"
          autoCorrect={false}
          testID="connection-auth-token"
          // @ts-expect-error - outlineStyle is web-only
          style={[styles.formInput, isWeb && { outlineStyle: "none" }]}
        />
        <Text style={styles.formLabel}>{t("settings.providers.connection.apiKey")}</Text>
        <AdaptiveTextInput
          initialValue={apiKey}
          resetKey={`connection-apikey-${visible}`}
          onChangeText={setApiKey}
          autoCapitalize="none"
          autoCorrect={false}
          testID="connection-api-key"
          // @ts-expect-error - outlineStyle is web-only
          style={[styles.formInput, isWeb && { outlineStyle: "none" }]}
        />
        <View style={styles.switchRow}>
          <Text style={styles.formLabel}>{t("settings.providers.connection.fetchModels")}</Text>
          <Switch
            value={fetchModels}
            onValueChange={setFetchModels}
            testID="connection-fetch-models"
          />
        </View>
        <Text style={styles.formLabel}>{t("settings.providers.connection.defaultModel")}</Text>
        <View style={styles.optionList}>
          <Pressable
            onPress={handleSelectNoDefault}
            style={[styles.optionRow, defaultModelId === "" && styles.optionRowSelected]}
            testID="connection-default-model-unset"
          >
            <Text style={styles.optionLabel}>
              {t("settings.providers.connection.defaultModelUnset")}
            </Text>
          </Pressable>
          {modelOptions.map((option) => (
            <DefaultModelOptionRow
              key={option.id}
              optionId={option.id}
              label={option.label}
              selected={defaultModelId === option.id}
              onSelect={handleSelectDefaultModel}
            />
          ))}
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <View style={styles.formActions}>
          <Button variant="secondary" size="sm" onPress={onClose} disabled={saving}>
            {t("common.actions.cancel")}
          </Button>
          <Button variant="default" size="sm" onPress={handleSave} disabled={!canSave}>
            {saving
              ? t("settings.providers.connection.saving")
              : t("settings.providers.connection.save")}
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
  optionList: { gap: theme.spacing[1] },
  optionRow: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[2],
  },
  optionRowSelected: { borderColor: theme.colors.primary },
  optionLabel: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  optionHint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  errorText: { color: theme.colors.statusDanger, fontSize: theme.fontSize.sm },
  formActions: { flexDirection: "row", gap: theme.spacing[2], marginTop: theme.spacing[2] },
}));
