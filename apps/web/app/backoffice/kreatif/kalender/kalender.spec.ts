import { describe, expect, it } from "vitest";
import type { AgendaKalender, HariKalender } from "@/lib/creative/agenda-queries";
import {
  agendaTerbuka,
  alamatKalender,
  bacaParamKalender,
  barisSel,
  rentangKisi,
  saringHari,
  tampilAgenda,
  tampilKejadian,
  tampilTenggat,
} from "./kalender";

const HARI_INI = "2026-10-07";

function agenda(isi: Partial<AgendaKalender> = {}): AgendaKalender {
  return {
    id: "a",
    judul: "Meeting",
    tanggal: HARI_INI,
    jam: null,
    jenis: "MEETING",
    checklist: [],
    catatan: null,
    campaignId: null,
    campaignNama: null,
    kolId: null,
    kolNama: null,
    kolaborasiId: null,
    kolaborasiDocNo: null,
    ingatHari: 0,
    selesai: false,
    ...isi,
  };
}

const grup = <J extends string>(jenis: J, jumlah = 1) => ({ jenis, jumlah, nilai: null, baris: [] });

describe("preset saringan", () => {
  it("logistik = kirim/terima, konten = draf/tayang/angka, pembayaran = jatuh tempo/dibayar", () => {
    expect(tampilTenggat("logistik", "RESI_NYANGKUT")).toBe(true);
    expect(tampilTenggat("logistik", "REVIEW_DRAF")).toBe(false);
    expect(tampilTenggat("konten", "ANGKA_H3")).toBe(true);
    expect(tampilTenggat("pembayaran", "JATUH_TEMPO_BAYAR")).toBe(true);
    expect(tampilTenggat("agenda", "FOLLOW_UP")).toBe(false);
    expect(tampilKejadian("tenggat", "TAYANG")).toBe(false);
    expect(tampilKejadian("konten", "RENCANA_TAYANG")).toBe(true);
    expect(tampilKejadian("pembayaran", "DIBAYAR")).toBe(true);
    expect(tampilKejadian("semua", "CAMPAIGN_MULAI")).toBe(true);
    expect(tampilAgenda("agenda", "LAINNYA")).toBe(true);
    expect(tampilAgenda("logistik", "KIRIM")).toBe(true);
    expect(tampilAgenda("logistik", "MEETING")).toBe(false);
    expect(tampilAgenda("tenggat", "DEADLINE")).toBe(false);
  });

  it("saringHari membuang yang tidak lolos, hari kosong aman", () => {
    const h: HariKalender = { tenggat: [grup("FOLLOW_UP")], kejadian: [grup("TAYANG")], agenda: [agenda()] };
    expect(saringHari(h, "agenda")).toEqual({ tenggat: [], kejadian: [], agenda: h.agenda });
    expect(saringHari(undefined, "semua")).toEqual({ tenggat: [], kejadian: [], agenda: [] });
  });
});

describe("baris sel", () => {
  it("tenggat dulu, agenda paling banyak dua, lalu kejadian; maks 4 lalu +N", () => {
    const h: HariKalender = {
      tenggat: [grup("FOLLOW_UP", 3)],
      kejadian: [grup("KIRIM", 2), grup("TAYANG", 5)],
      agenda: [agenda({ id: "a1" }), agenda({ id: "a2" }), agenda({ id: "a3", selesai: true })],
    };
    const r = barisSel(h);
    expect(r.tampil.map((b) => (b.macam === "agenda" ? b.agenda.id : `${b.macam}:${b.grup.jenis}`))).toEqual([
      "tenggat:FOLLOW_UP",
      "a1",
      "a2",
      "kejadian:KIRIM",
    ]);
    expect(r.sisa).toBe(2);
    expect(agendaTerbuka(h)).toBe(2);
  });
});

describe("alamat kalender", () => {
  it("bawaan bulan & tanggal hari ini; tanggal di luar bulan diganti", () => {
    expect(bacaParamKalender({}, HARI_INI)).toEqual({ bulan: "2026-10", tanggal: HARI_INI, jenis: null, agenda: null });
    expect(bacaParamKalender({ bulan: "2026-11" }, HARI_INI).tanggal).toBe("2026-11-01");
    expect(bacaParamKalender({ bulan: "2026-11", tanggal: "2026-10-05" }, HARI_INI).tanggal).toBe("2026-11-01");
    expect(bacaParamKalender({ tanggal: "2026-12-24" }, HARI_INI)).toMatchObject({ bulan: "2026-12", tanggal: "2026-12-24" });
    expect(bacaParamKalender({ jenis: "konten", agenda: "a1" }, HARI_INI)).toMatchObject({ jenis: "konten", agenda: "a1" });
    expect(bacaParamKalender({ jenis: "ngawur" }, HARI_INI).jenis).toBeNull();
  });

  it("menulis bulan, tanggal, dan preset selain semua", () => {
    expect(alamatKalender({ bulan: "2026-10", tanggal: "2026-10-07", jenis: "semua" })).toBe("/backoffice/kreatif/kalender?bulan=2026-10&tanggal=2026-10-07");
    expect(alamatKalender({ bulan: "2026-10", tanggal: "2026-10-07", jenis: "logistik" })).toBe(
      "/backoffice/kreatif/kalender?bulan=2026-10&tanggal=2026-10-07&jenis=logistik",
    );
  });

  it("rentang kisi Senin-di-depan termasuk hari tetangga", () => {
    // 1 Okt 2026 = Kamis → kisi mulai Senin 28 Sep, berakhir Minggu 1 Nov.
    expect(rentangKisi("2026-10")).toEqual({ dari: "2026-09-28", sampai: "2026-11-01" });
    expect(rentangKisi("bukan")).toBeNull();
  });
});
