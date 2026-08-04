import { forwardRef, useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import type { PressHighlightProps } from "./press-highlight.types";

export const PressHighlight = forwardRef<View, PressHighlightProps>(function PressHighlight(
  { children, disabled, highlightStyle, ...props },
  ref,
) {
  const highlighted = useSharedValue(0);
  const animatedHighlightStyle = useAnimatedStyle(() => ({ opacity: highlighted.value }));
  // This gesture owns visual acknowledgement only. Pressable remains the sole owner of
  // activation, cancellation, accessibility, and the caller's drag/long-press callbacks.
  const pressGesture = useMemo(
    () =>
      Gesture.Tap()
        .enabled(disabled !== true && highlightStyle != null)
        .maxDistance(8)
        .shouldCancelWhenOutside(true)
        .onBegin(() => {
          highlighted.value = 1;
        })
        .onFinalize(() => {
          highlighted.value = 0;
        }),
    [disabled, highlightStyle, highlighted],
  );

  const highlight = highlightStyle ? (
    <Animated.View pointerEvents="none" style={[styles.highlight, animatedHighlightStyle]}>
      {/* Keep the themed Unistyles node separate from the node Reanimated patches. */}
      <View style={[styles.highlightFill, highlightStyle]} />
    </Animated.View>
  ) : null;
  const renderedChildren =
    typeof children === "function" ? (
      (state: Parameters<typeof children>[0]) => (
        <>
          {highlight}
          {children(state)}
        </>
      )
    ) : (
      <>
        {highlight}
        {children}
      </>
    );

  const pressable = (
    <Pressable ref={ref} {...props} collapsable={false} disabled={disabled}>
      {renderedChildren}
    </Pressable>
  );

  if (!highlightStyle) {
    return pressable;
  }

  return <GestureDetector gesture={pressGesture}>{pressable}</GestureDetector>;
});

const styles = StyleSheet.create({
  highlight: {
    ...StyleSheet.absoluteFillObject,
  },
  highlightFill: {
    ...StyleSheet.absoluteFillObject,
  },
});
