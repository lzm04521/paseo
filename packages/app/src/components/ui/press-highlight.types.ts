import type { PressableProps, StyleProp, ViewStyle } from "react-native";

export interface PressHighlightProps extends PressableProps {
  /** Native finger-down surface. Desktop hover remains owned by the caller. */
  highlightStyle?: StyleProp<ViewStyle>;
}
