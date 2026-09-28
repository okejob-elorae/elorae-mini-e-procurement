import { describe, expect, it } from "vitest";
import { currentClipRecording } from "./clip-recording";

describe("currentClipRecording", () => {
  const recordedAt = new Date("2026-09-01T03:00:00.000Z");
  const replacedAt = new Date("2026-09-02T04:30:00.000Z");

  it("reports the first recording when the clip was never replaced", () => {
    expect(
      currentClipRecording({
        recordedAt,
        replacedAt: null,
        recordedByName: "Packer A",
        updatedByName: null,
      }),
    ).toEqual({ at: recordedAt, byName: "Packer A", isRerecord: false });
  });

  it("reports the re-recording time and author once the clip was replaced", () => {
    expect(
      currentClipRecording({
        recordedAt,
        replacedAt,
        recordedByName: "Packer A",
        updatedByName: "Packer B",
      }),
    ).toEqual({ at: replacedAt, byName: "Packer B", isRerecord: true });
  });

  it("leaves the author unknown on a replaced clip with no updater, never the original recorder", () => {
    expect(
      currentClipRecording({
        recordedAt,
        replacedAt,
        recordedByName: "Packer A",
        updatedByName: null,
      }),
    ).toEqual({ at: replacedAt, byName: null, isRerecord: true });
  });

  it("accepts serialized ISO strings and returns a Date", () => {
    const result = currentClipRecording({
      recordedAt: recordedAt.toISOString(),
      replacedAt: null,
      recordedByName: null,
      updatedByName: null,
    });
    expect(result.at).toEqual(recordedAt);
  });
});
