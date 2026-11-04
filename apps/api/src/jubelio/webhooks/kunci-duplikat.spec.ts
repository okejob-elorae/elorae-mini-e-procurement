import { payloadHash } from "./signature";
import { JENDELA_DUPLIKAT_MS, kunciDuplikatWebhook } from "./kunci-duplikat";

const badanStok = JSON.stringify({ action: "update", item_group_id: 77, item_ids: [1, 2], location_id: -1 });
const t0 = new Date("2026-10-06T03:00:10.000Z");

describe("kunciDuplikatWebhook", () => {
  it("perubahan stok kedua untuk grup yang sama TIDAK dianggap duplikat", () => {
    const pertama = kunciDuplikatWebhook({ event: "stock", rawBody: badanStok, diterimaPada: t0 });
    const kedua = kunciDuplikatWebhook({
      event: "stock",
      rawBody: badanStok,
      diterimaPada: new Date(t0.getTime() + 5 * JENDELA_DUPLIKAT_MS),
    });
    expect(kedua).not.toBe(pertama);
  });

  it("kiriman ulang badan yang sama dalam menit yang sama tetap tersaring", () => {
    const a = kunciDuplikatWebhook({ event: "stock", rawBody: badanStok, diterimaPada: t0 });
    const b = kunciDuplikatWebhook({ event: "stock", rawBody: badanStok, diterimaPada: new Date(t0.getTime() + 20_000) });
    expect(b).toBe(a);
  });

  it("webhook produk diperlakukan sama dengan stok", () => {
    const badan = JSON.stringify({ action: "update", item_group_id: 9, item_group_name: "Blus" });
    const a = kunciDuplikatWebhook({ event: "product", rawBody: badan, diterimaPada: t0 });
    const b = kunciDuplikatWebhook({ event: "product", rawBody: badan, diterimaPada: new Date(t0.getTime() + 2 * JENDELA_DUPLIKAT_MS) });
    expect(b).not.toBe(a);
  });

  it("id peristiwa dari Jubelio menentukan duplikat, tidak peduli waktunya", () => {
    const a = kunciDuplikatWebhook({ event: "stock", rawBody: badanStok, eventId: "evt-1", diterimaPada: t0 });
    const b = kunciDuplikatWebhook({ event: "stock", rawBody: badanStok, eventId: "evt-1", diterimaPada: new Date(t0.getTime() + 3_600_000) });
    const c = kunciDuplikatWebhook({ event: "stock", rawBody: badanStok, eventId: "evt-2", diterimaPada: t0 });
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });

  it("webhook pesanan tetap memakai hash badan (badannya sudah unik per perubahan)", () => {
    const badan = JSON.stringify({ salesorder_id: 5, last_modified: "2026-10-06T03:00:00Z" });
    const a = kunciDuplikatWebhook({ event: "salesorder", rawBody: badan, diterimaPada: t0 });
    const b = kunciDuplikatWebhook({ event: "salesorder", rawBody: badan, diterimaPada: new Date(t0.getTime() + 10 * JENDELA_DUPLIKAT_MS) });
    expect(a).toBe(payloadHash(badan));
    expect(b).toBe(a);
  });
});
