import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

/**
 * Segments the pill may show, in the order they are displayed.
 *
 * The display order is not the truncation priority: `AgentStatsPill` reorders by priority before
 * deciding how many segments fit.
 */
export const STATS_PILL_SEGMENT_IDS = [
  "contextPct",
  "cost",
  "contextAbs",
  "tokens",
  "tools",
  "speed",
] as const;

export type StatsPillSegmentId = (typeof STATS_PILL_SEGMENT_IDS)[number];

const STATS_PILL_PREFERENCES_STORAGE_KEY = "stats-pill-preferences";

const StatsPillPreferencesPersistedStateSchema = z.strictObject({
  hiddenSegments: z.array(z.enum(STATS_PILL_SEGMENT_IDS)),
});

interface StatsPillPreferencesState {
  /** Segments the user turned off. The detail panel always renders everything. */
  hiddenSegments: StatsPillSegmentId[];
  toggleSegment: (segment: StatsPillSegmentId) => void;
}

export const useStatsPillPreferences = create<StatsPillPreferencesState>()(
  persist(
    (set) => ({
      hiddenSegments: [],
      toggleSegment: (segment) =>
        set((state) => ({
          hiddenSegments: state.hiddenSegments.includes(segment)
            ? state.hiddenSegments.filter((entry) => entry !== segment)
            : [...state.hiddenSegments, segment],
        })),
    }),
    {
      name: STATS_PILL_PREFERENCES_STORAGE_KEY,
      storage: createValidatedPersistStorage(
        AsyncStorage,
        StatsPillPreferencesPersistedStateSchema,
      ),
      partialize: (state) => ({ hiddenSegments: state.hiddenSegments }),
    },
  ),
);
