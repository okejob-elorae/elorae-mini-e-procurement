import { describe, it, expect } from "vitest";
import { parsePushPayload } from "./push-payload";

describe("parsePushPayload", () => {
  it("reads a full FCM web push for a field retur mismatch", () => {
    const parsed = parsePushPayload({
      from: "1234567890",
      priority: "high",
      fcmMessageId: "m-1",
      notification: { title: "Retur FRET/1: hitungan gudang berbeda", body: "1 baris retur tidak sesuai" },
      data: { type: "FIELD_RETURN_MISMATCH", returnId: "r1", docNo: "FRET/1", storeId: "s1" },
    });
    expect(parsed).toEqual({
      title: "Retur FRET/1: hitungan gudang berbeda",
      body: "1 baris retur tidak sesuai",
      url: "/pwa/stores/s1",
      tag: "m-1",
    });
  });

  it("opens the collection page for an overdue receivable", () => {
    const parsed = parsePushPayload({
      notification: { title: "Piutang jatuh tempo", body: "INV/1" },
      data: { type: "AR_OVERDUE", receivableId: "rcv-1" },
    });
    expect(parsed.url).toBe("/pwa/collections/rcv-1");
    expect(parsed.tag).toBeUndefined();
  });

  it("falls back to data.title/data.body on a data-only message", () => {
    const parsed = parsePushPayload({ data: { type: "AR_OVERDUE", title: "T", body: "B", receivableId: "x" } });
    expect(parsed).toMatchObject({ title: "T", body: "B", url: "/pwa/collections/x" });
  });

  it("falls back to a generic notice for null", () => {
    expect(parsePushPayload(null)).toEqual({ title: "Elorae", body: "", url: "/pwa/notifications" });
  });

  it("falls back to a generic notice for a bare string", () => {
    expect(parsePushPayload("hello")).toEqual({ title: "Elorae", body: "", url: "/pwa/notifications" });
  });

  it("opens the notification list for an unknown type or a missing type", () => {
    expect(parsePushPayload({ notification: { title: "X" }, data: { type: "SOMETHING_NEW" } }).url).toBe(
      "/pwa/notifications",
    );
    expect(parsePushPayload({ notification: { title: "X" }, data: {} }).url).toBe("/pwa/notifications");
  });

  it("never opens a protocol-relative href", () => {
    expect(parsePushPayload({ data: { type: "TEST", href: "//evil.example/x" } }).url).toBe("/pwa/notifications");
  });
});
