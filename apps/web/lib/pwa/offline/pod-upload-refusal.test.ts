import { describe, it, expect } from "vitest";
import { PodUploadRefusedError, throwIfPodUploadRefused } from "./pod-upload-refusal";

describe("throwIfPodUploadRefused", () => {
  it("maps 404 to a NOT_FOUND refusal", () => {
    expect(() => throwIfPodUploadRefused({ status: 404 })).toThrow(PodUploadRefusedError);
    try {
      throwIfPodUploadRefused({ status: 404 });
    } catch (e) {
      expect((e as PodUploadRefusedError).reason).toBe("NOT_FOUND");
    }
  });

  it("maps 409 to an INVALID_STATE refusal", () => {
    try {
      throwIfPodUploadRefused({ status: 409 });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PodUploadRefusedError);
      expect((e as PodUploadRefusedError).reason).toBe("INVALID_STATE");
    }
  });

  it.each([200, 400, 401, 403, 500, 503])("leaves %i to the caller", (status) => {
    expect(() => throwIfPodUploadRefused({ status })).not.toThrow();
  });
});
