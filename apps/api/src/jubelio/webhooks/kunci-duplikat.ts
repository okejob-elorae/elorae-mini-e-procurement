import { payloadHash } from "./signature";

/**
 * Webhook Jubelio yang hanya MEMBERI TAHU ada perubahan, tanpa membawa
 * keadaannya: badan `stock` = { action, item_group_id, item_ids, location_id },
 * badan `product` = { action, item_group_id, item_group_name }. Perubahan kedua
 * untuk grup yang sama mengirim badan yang PERSIS sama dengan yang pertama.
 */
const WEBHOOK_PEMBERITAHUAN: ReadonlySet<string> = new Set(["stock", "product"]);

/** Kiriman ulang badan yang sama dalam rentang ini dianggap satu peristiwa. */
export const JENDELA_DUPLIKAT_MS = 60_000;

/**
 * Kunci penyaring duplikat (`JubelioWebhookEvent @@unique([event, payloadHash])`).
 *
 * Dulu kuncinya hash badan saja. Untuk webhook pemberitahuan itu berarti
 * perubahan stok/produk KEDUA untuk grup yang sama dibuang selamanya sebagai
 * "duplikat" — ERP berhenti mengikuti Jubelio untuk barang itu sesudah webhook
 * pertamanya (ditemukan 2026-10-06).
 *
 * - Ada `webhook-event-id`: itulah identitas peristiwanya, sama di setiap
 *   kiriman ulang — kunci = id itu.
 * - Webhook pemberitahuan tanpa id: badan + menit penerimaan. Kiriman ulang
 *   dalam menit yang sama tersaring; perubahan berikutnya diproses. Memproses
 *   ulang aman: penangannya selalu mengambil keadaan terbaru dari Jubelio.
 * - Webhook lain (pesanan, retur) membawa keadaannya (`last_modified`, status),
 *   jadi badannya sendiri sudah unik per perubahan — tetap hash badan.
 */
export function kunciDuplikatWebhook(input: {
  event: string;
  rawBody: string;
  eventId?: string;
  diterimaPada: Date;
}): string {
  if (input.eventId) return payloadHash(`id:${input.eventId}`);
  if (WEBHOOK_PEMBERITAHUAN.has(input.event)) {
    const ember = Math.floor(input.diterimaPada.getTime() / JENDELA_DUPLIKAT_MS);
    return payloadHash(`${input.rawBody}\u0000menit:${ember}`);
  }
  return payloadHash(input.rawBody);
}
