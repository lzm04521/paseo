import { useCallback, type Ref } from "react";

// Native has no DOM composition events — the platform IME commits into the
// TextInput directly. The guard is a web-only concern; on native this is a
// pass-through ref merger so callers can use the same hook unconditionally.
// See the `.web.ts` sibling for the rationale.
export function useImeCompositionGuard<T>(externalRef: Ref<T> | undefined, _enabled: boolean) {
  const setRef = useCallback(
    (node: T | null) => {
      if (typeof externalRef === "function") {
        externalRef(node);
      } else if (externalRef) {
        (externalRef as { current: T | null }).current = node;
      }
    },
    [externalRef],
  );
  return setRef;
}
