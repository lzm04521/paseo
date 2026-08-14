import { useCallback, useRef, useEffect, type Ref } from "react";

// Web-only IME composition guard for RNW TextInputs.
//
// RNW always registers onChange, so every keystroke fires an `input` event
// that reaches React's root listener, which enqueues the node for state
// restore (createAndAccumulateChangeEvent). On commit, ReactDOM's updateInput
// rewrites element.type — set when type is a string, removeAttribute when
// undefined — and Chromium cancels an in-flight IME composition the moment
// the type attribute is touched. Set and remove both break composition, so
// defaulting inputMode to "text" (turning remove into set) is not enough.
//
// Stopping `input` events from reaching React's root listener while
// isComposing skips the enqueue entirely, so updateInput never runs and type
// is left alone. After compositionend, Chromium fires one more `input` event
// with isComposing=false — we let it through so RNW's handleChange commits
// the final value. Do not commit manually here (double-fire).
//
// Capture phase on the target: capture runs before bubble, and React 19
// delegates onChange on the root container's bubble phase, so
// stopImmediatePropagation here keeps the event off React's root listener.
export function useImeCompositionGuard<T>(externalRef: Ref<T> | undefined, enabled: boolean) {
  // cleanupRef holds the previous node's remove-listener so a ref swap
  // (resetKey remount) tears down the old listener before attaching the new.
  // Kept in a ref so the callback identity stays stable across renders.
  const cleanupRef = useRef<(() => void) | null>(null);

  const setRef = useCallback(
    (node: T | null) => {
      cleanupRef.current?.();
      cleanupRef.current = null;

      if (typeof externalRef === "function") {
        externalRef(node);
      } else if (externalRef) {
        (externalRef as { current: T | null }).current = node;
      }

      if (node && enabled) {
        const el = node as unknown as HTMLElement;
        const onInputCapture = (event: Event) => {
          if ((event as InputEvent).isComposing) {
            event.stopImmediatePropagation();
          }
        };
        el.addEventListener("input", onInputCapture, true);
        cleanupRef.current = () => el.removeEventListener("input", onInputCapture, true);
      }
    },
    [enabled, externalRef],
  );

  // Tear down on unmount as a safety net (ref callback already cleans up on swap).
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  return setRef;
}
