import type { StyleProp, TextStyle } from "react-native";
import { useMemo, useRef } from "react";
import { TextInput, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { useImeCompositionGuard } from "@/hooks/use-ime-composition-guard";
import { settingsStyles } from "@/styles/settings";

interface SettingsTextAreaProps {
  accessibilityLabel: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  testID?: string;
  style?: StyleProp<TextStyle>;
}

export function SettingsTextArea({
  accessibilityLabel,
  value,
  onChangeText,
  placeholder,
  testID,
  style,
}: SettingsTextAreaProps) {
  const { theme } = useUnistyles();
  const inputStyle = useMemo(() => [styles.input, style], [style]);
  const ref = useRef<TextInput>(null);
  // Web IME guard: textarea 的打断是 ReactDOM updateTextarea 写 defaultValue
  // 文本子节点，机制跟 input 同源（拦 input event 阻止 React restore）。本组件
  // 无 onContentSizeChange，不会自动长高，拦 input event 无副作用。
  // 见 use-ime-composition-guard。
  const setRef = useImeCompositionGuard<TextInput>(ref, isWeb);

  return (
    <TextInput
      ref={setRef}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      multiline
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.colors.foregroundMuted}
      style={inputStyle}
    />
  );
}

export function SettingsTextAreaCard(props: SettingsTextAreaProps) {
  return (
    <View style={settingsStyles.card}>
      <SettingsTextArea {...props} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  input: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    minHeight: 96,
    textAlignVertical: "top",
  },
}));
