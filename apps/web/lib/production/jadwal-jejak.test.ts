import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/messages/en.json";
import id from "@/lib/i18n/messages/id.json";
import { JEJAK_JADWAL, KODE_GALAT_JADWAL } from "./jadwal-jejak";

/*
 * Setiap kode penolakan jadwal produksi punya teks di kedua bahasa, dan setiap
 * nama tindakan jejaknya punya label — layar memetakan kode lewat
 * `jadwalProduksi.server.err<KODE>`, dan jejak tanpa label tampil sebagai kode mentah.
 */

type Pesan = Record<string, unknown>;
const ambil = (pesan: Pesan, jalur: string): unknown =>
  jalur.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Pesan)[k] : undefined), pesan);

describe.each([
  ["id", id as Pesan],
  ["en", en as Pesan],
])("i18n jadwal produksi (%s)", (_bahasa, pesan) => {
  it("setiap kode penolakan punya teks", () => {
    for (const kode of KODE_GALAT_JADWAL) {
      expect(typeof ambil(pesan, `jadwalProduksi.server.err${kode}`), kode).toBe("string");
    }
  });

  it("setiap nama tindakan jejak punya label, begitu pula entitas langkah", () => {
    for (const aksi of Object.values(JEJAK_JADWAL)) {
      expect(typeof ambil(pesan, `auditActions.actions.${aksi}`), aksi).toBe("string");
    }
    expect(typeof ambil(pesan, "auditActions.entities.PlanStageStep")).toBe("string");
  });

  it("dua baris antrean Beranda punya label", () => {
    expect(typeof ambil(pesan, "dashboardActions.productionStepsOverdue")).toBe("string");
    expect(typeof ambil(pesan, "dashboardActions.productionStepsDueToday")).toBe("string");
  });
});
