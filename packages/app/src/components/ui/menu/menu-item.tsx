import {
  useCallback,
  useMemo,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Pressable,
  Text,
  View,
  type PressableStateCallbackType,
  type ViewStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Check, CheckCircle } from "lucide-react-native";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Theme } from "@/styles/theme";
import { useMenuContext } from "./menu-context";

const ThemedCheck = withUnistyles(Check);
const ThemedCheckCircle = withUnistyles(CheckCircle);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

const foregroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const successMapping = (theme: Theme) => ({ color: theme.colors.palette.green[500] });

/**
 * Height of the filled part of a row, which together with the uniform inset puts the row pitch
 * back at the 36pt it was before the fill was inset at all — the space is redistributed, not
 * added.
 *
 * It only holds if the label's line box is pinned: 18 line + 8 padding + 2 border is exactly
 * this. Leave the text's `lineHeight` to the platform and the content outgrows `minHeight`,
 * which then does nothing and the rows drift taller again.
 */
const MENU_ITEM_HEIGHT = 28;
const MENU_ITEM_LINE_HEIGHT = 18;

/** Action status for menu items with loading/success feedback. */
export type ActionStatus = "idle" | "pending" | "success";

export function MenuLabel({
  children,
  style,
  testID,
}: PropsWithChildren<{ style?: ViewStyle | ViewStyle[]; testID?: string }>): ReactElement {
  const labelContainerStyle = useMemo(() => [styles.labelContainer, style], [style]);
  return (
    <View style={labelContainerStyle} testID={testID}>
      <Text style={styles.labelText}>{children}</Text>
    </View>
  );
}

export function MenuSeparator({
  style,
  testID,
}: {
  style?: ViewStyle;
  testID?: string;
}): ReactElement {
  const separatorStyle = useMemo(() => [styles.separator, style], [style]);
  return <View style={separatorStyle} testID={testID} />;
}

export function MenuHint({
  children,
  style,
  testID,
}: PropsWithChildren<{ style?: ViewStyle | ViewStyle[]; testID?: string }>): ReactElement {
  const hintContainerStyle = useMemo(() => [styles.hintContainer, style], [style]);
  return (
    <View style={hintContainerStyle} testID={testID}>
      <Text style={styles.hintText}>{children}</Text>
    </View>
  );
}

function resolveLeadingContent(input: {
  isPending: boolean | undefined;
  isSuccess: boolean;
  leading: ReactElement | null;
}): ReactElement | null {
  const { isPending, isSuccess, leading } = input;
  if (isPending) {
    return <ThemedLoadingSpinner size={16} uniProps={mutedMapping} />;
  }
  if (isSuccess) {
    return <ThemedCheckCircle size={16} uniProps={successMapping} />;
  }
  return leading;
}

function resolveItemLabel(input: {
  children: ReactNode;
  isPending: boolean | undefined;
  isSuccess: boolean;
  pendingLabel?: string;
  successLabel?: string;
}): ReactNode {
  const { children, isPending, isSuccess, pendingLabel, successLabel } = input;
  if (isPending && pendingLabel) return pendingLabel;
  if (isSuccess && successLabel) return successLabel;
  return children;
}

export interface MenuItemProps {
  description?: string;
  onSelect?: () => void;
  disabled?: boolean;
  muted?: boolean;
  destructive?: boolean;
  /**
   * This row's value is the chosen one. Draws a check and nothing else — a checked row that is
   * also filled in reads as two different claims about the same state.
   */
  selected?: boolean;
  /** Reserves a leading check column so a group of items stays aligned whether ticked or not. */
  showSelectedCheck?: boolean;
  /**
   * This row's submenu is open. Distinct from `selected`: it is about where you are, not what
   * you picked, so it takes the background that `selected` gives up.
   */
  active?: boolean;
  leading?: ReactElement | null;
  trailing?: ReactElement | null;
  /** @deprecated Use `status` instead */
  loading?: boolean;
  status?: ActionStatus;
  /** Label to show while pending (e.g. "Pushing…") */
  pendingLabel?: string;
  /** Label to show on success (e.g. "Pushed") */
  successLabel?: string;
  closeOnSelect?: boolean;
  testID?: string;
  tooltip?: string;
}

export function MenuItem({
  children,
  description,
  onSelect,
  disabled,
  muted = false,
  destructive,
  selected,
  showSelectedCheck = false,
  active = false,
  leading,
  trailing,
  loading,
  status,
  pendingLabel,
  successLabel,
  closeOnSelect = true,
  testID,
  tooltip,
}: PropsWithChildren<MenuItemProps>): ReactElement {
  const { selectItem } = useMenuContext("MenuItem");

  const isPending = status === "pending" || loading;
  const isSuccess = status === "success";
  const isDisabled = disabled || isPending || isSuccess;

  const leadingContent = resolveLeadingContent({
    isPending,
    isSuccess,
    leading: leading ?? null,
  });

  const label = resolveItemLabel({ children, isPending, isSuccess, pendingLabel, successLabel });

  const trailingContent =
    trailing ??
    (!showSelectedCheck && selected ? <ThemedCheck size={16} uniProps={mutedMapping} /> : null);

  const handleItemPress = useCallback(() => {
    if (isDisabled) return;
    selectItem(onSelect, closeOnSelect);
  }, [isDisabled, selectItem, onSelect, closeOnSelect]);

  const itemPressableStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.item,
      active ? styles.itemActive : null,
      isDisabled ? styles.itemDisabled : null,
      muted && !isDisabled ? styles.itemMuted : null,
      hovered && !pressed && !isDisabled ? styles.itemHovered : null,
      pressed && !isDisabled ? styles.itemPressed : null,
    ],
    [active, isDisabled, muted],
  );

  const itemTextStyle = useMemo(
    () => [
      styles.itemText,
      destructive && !isSuccess ? styles.itemTextDestructive : null,
      isSuccess ? styles.itemTextSuccess : null,
      muted && !isDisabled ? styles.itemTextMuted : null,
    ],
    [destructive, isSuccess, muted, isDisabled],
  );

  const content = (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={handleItemPress}
      style={itemPressableStyle}
    >
      {showSelectedCheck ? (
        <View style={styles.checkSlot}>
          {selected ? <ThemedCheck size={16} uniProps={foregroundMapping} /> : null}
        </View>
      ) : null}
      {leadingContent ? <View style={styles.leadingSlot}>{leadingContent}</View> : null}
      <View style={styles.itemContent}>
        <Text numberOfLines={1} style={itemTextStyle}>
          {label}
        </Text>
        {description && !isPending && !isSuccess ? (
          <Text numberOfLines={2} style={styles.itemDescription}>
            {description}
          </Text>
        ) : null}
      </View>
      {trailingContent ? <View style={styles.trailingSlot}>{trailingContent}</View> : null}
    </Pressable>
  );

  if (!tooltip) {
    return content;
  }

  return (
    <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="right" align="center" offset={10}>
        <Text style={styles.tooltipText}>{tooltip}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  labelContainer: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  labelText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  // `border` sits between surface1 and surface2, which put it within a hair of the hover fill and
  // made separators vanish against a hovered row. `borderAccent` is the colour the menu surface
  // already outlines itself with, so the divider reads as part of the same frame.
  //
  // No margin of its own: the items above and below already hold themselves off it. Giving the
  // rule its own spacing on top of theirs is how you end up tuning two numbers to control one gap.
  separator: {
    height: 1,
    backgroundColor: theme.colors.borderAccent,
  },
  hintContainer: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  hintText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  // The fill is inset by the same amount on every side and rounded, so a hovered row reads as a
  // chip sitting inside the menu. That inset is the only thing that spaces this menu: rows sit
  // apart because each holds itself in, and a separator gets clearance from its neighbours for
  // free instead of carrying its own margin.
  //
  // The inset is taken out of the row, not added to it. Horizontally that means padding gives up
  // what margin takes — margin 4 + padding 8 + border 1 lands the label at the same 13pt it
  // always sat at. Vertically the fill itself is shorter by the same 8, so the pitch is unchanged
  // and the menu did not grow; it just stopped filling every row edge to edge.
  item: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: MENU_ITEM_HEIGHT,
    gap: theme.spacing[2],
    margin: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderWidth: theme.borderWidth[1],
    borderColor: "transparent",
    borderRadius: theme.borderRadius.md,
  },
  itemHovered: {
    backgroundColor: theme.colors.surface2,
  },
  itemPressed: {
    backgroundColor: theme.colors.surface2,
  },
  // The row you are inside, not the value you chose. A chosen value is marked by its check.
  itemActive: {
    backgroundColor: theme.colors.surface2,
  },
  itemDisabled: {
    opacity: 0.5,
  },
  itemMuted: {
    opacity: 0.72,
  },
  itemText: {
    fontSize: theme.fontSize.sm,
    lineHeight: MENU_ITEM_LINE_HEIGHT,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.normal,
  },
  itemTextMuted: {
    color: theme.colors.foregroundMuted,
  },
  itemTextDestructive: {
    color: theme.colors.destructive,
  },
  itemTextSuccess: {
    color: theme.colors.palette.green[500],
  },
  itemDescription: {
    marginTop: 2,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  checkSlot: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  leadingSlot: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  trailingSlot: {
    marginLeft: "auto",
    alignItems: "center",
    justifyContent: "center",
  },
  itemContent: {
    flexShrink: 1,
    minWidth: 0,
  },
}));
