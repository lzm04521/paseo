import { beforeEach, describe, expect, it } from "vitest";
import { useStatsPillPreferences } from "./stats-pill-preferences";

describe("stats pill preferences", () => {
  beforeEach(() => {
    useStatsPillPreferences.setState({ hiddenSegments: [] });
  });

  it("shows every segment by default", () => {
    expect(useStatsPillPreferences.getState().hiddenSegments).toEqual([]);
  });

  it("hides a segment on toggle and shows it again on the next toggle", () => {
    useStatsPillPreferences.getState().toggleSegment("cost");
    expect(useStatsPillPreferences.getState().hiddenSegments).toEqual(["cost"]);

    useStatsPillPreferences.getState().toggleSegment("cost");
    expect(useStatsPillPreferences.getState().hiddenSegments).toEqual([]);
  });

  it("keeps independently toggled segments", () => {
    useStatsPillPreferences.getState().toggleSegment("cost");
    useStatsPillPreferences.getState().toggleSegment("speed");

    expect(useStatsPillPreferences.getState().hiddenSegments).toEqual(["cost", "speed"]);
  });
});
