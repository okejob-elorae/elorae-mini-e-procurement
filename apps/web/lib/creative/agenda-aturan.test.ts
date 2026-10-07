import { describe, expect, it } from "vitest";
import {
  BATAS_AGENDA,
  bacaChecklist,
  centangButir,
  checklistKeTeks,
  jumlahBelum,
  rapikanJam,
  teksKeChecklist,
  tulisChecklist,
  validasiAgenda,
} from "./agenda-aturan";

describe("daftar persiapan", () => {
  it("satu baris satu butir; [x], [v], - [x] berarti selesai; baris kosong dibuang", () => {
    const b = teksKeChecklist("Siapkan brief\n[x] Kirim rate card\n\n- [v] Konfirmasi alamat\n- [ ] Cek stok\n- Foto produk\n   ");
    expect(b).toEqual([
      { teks: "Siapkan brief", selesai: false },
      { teks: "Kirim rate card", selesai: true },
      { teks: "Konfirmasi alamat", selesai: true },
      { teks: "Cek stok", selesai: false },
      { teks: "Foto produk", selesai: false },
    ]);
    expect(jumlahBelum(b)).toBe(3);
  });

  it("bolak-balik teks ↔ butir ↔ JSON tidak kehilangan apa pun", () => {
    const b = teksKeChecklist("A\n[x] B");
    expect(checklistKeTeks(b)).toBe("A\n[x] B");
    expect(bacaChecklist(tulisChecklist(b))).toEqual(b);
    expect(tulisChecklist([])).toBeNull();
  });

  it("kolom rusak dibaca sebagai tanpa butir, bukan galat", () => {
    expect(bacaChecklist("bukan json")).toEqual([]);
    expect(bacaChecklist('{"teks":"x"}')).toEqual([]);
    expect(bacaChecklist('[{"teks":""},{"teks":"ok","selesai":true},3]')).toEqual([{ teks: "ok", selesai: true }]);
    expect(bacaChecklist(null)).toEqual([]);
  });

  it("centang menetapkan satu butir; indeks di luar daftar ditolak", () => {
    const b = teksKeChecklist("A\nB");
    expect(centangButir(b, 1, true)).toEqual([
      { teks: "A", selesai: false },
      { teks: "B", selesai: true },
    ]);
    expect(centangButir(b, 2, true)).toBeNull();
    expect(centangButir(b, -1, true)).toBeNull();
    expect(centangButir(b, 0.5, true)).toBeNull();
  });
});

describe("rapikanJam", () => {
  it("menerima beberapa bentuk jam, menolak yang bukan jam", () => {
    expect(rapikanJam("9:30")).toBe("09:30");
    expect(rapikanJam("09.05")).toBe("09:05");
    expect(rapikanJam("2359")).toBe("23:59");
    expect(rapikanJam("24:00")).toBeNull();
    expect(rapikanJam("9:7")).toBeNull();
    expect(rapikanJam("pagi")).toBeNull();
  });
});

describe("validasiAgenda", () => {
  const sah = { judul: "Meeting brand", tanggal: "2026-10-20", jam: "09:30", jenis: "MEETING", checklist: "Deck\n[x] Undangan", ingatHari: 2 };

  it("isian sah dirapikan", () => {
    const r = validasiAgenda({ ...sah, judul: "  Meeting brand  ", catatan: "  ", campaignId: "c1", kolaborasiId: "" });
    expect(r).toEqual({
      ok: true,
      agenda: {
        judul: "Meeting brand",
        tanggal: "2026-10-20",
        jam: "09:30",
        jenis: "MEETING",
        checklist: [
          { teks: "Deck", selesai: false },
          { teks: "Undangan", selesai: true },
        ],
        catatan: null,
        campaignId: "c1",
        kolId: null,
        kolaborasiId: null,
        ingatHari: 2,
      },
    });
  });

  it("jam kosong dan ingat kosong boleh; jenis kosong = Tugas", () => {
    const r = validasiAgenda({ judul: "X", tanggal: "2026-10-20", jam: "", ingatHari: "" });
    expect(r.ok && r.agenda).toMatchObject({ jam: null, ingatHari: 0, jenis: "TUGAS" });
  });

  it("jam salah dan ingat H-n di luar 0–30 DITOLAK dengan galat per isian, tidak dikosongkan diam-diam", () => {
    const r = validasiAgenda({ ...sah, jam: "jam 9", ingatHari: 31 });
    expect(r).toEqual({
      ok: false,
      galat: [
        { kolom: "jam", kode: "JAM_TIDAK_VALID" },
        { kolom: "ingatHari", kode: "INGAT_TIDAK_VALID" },
      ],
    });
    expect(validasiAgenda({ ...sah, ingatHari: -1 }).ok).toBe(false);
    expect(validasiAgenda({ ...sah, ingatHari: 1.5 }).ok).toBe(false);
    expect(validasiAgenda({ ...sah, ingatHari: "dua" }).ok).toBe(false);
  });

  it("judul wajib dan dibatasi; tanggal harus tanggal; jenis harus dikenal", () => {
    const r = validasiAgenda({ judul: " ", tanggal: "2026-02-30", jenis: "RAPAT" });
    expect(r.ok ? [] : r.galat.map((g) => g.kode)).toEqual(["JUDUL_WAJIB", "TANGGAL_TIDAK_VALID", "JENIS_TIDAK_VALID"]);
    const panjang = validasiAgenda({ ...sah, judul: "a".repeat(BATAS_AGENDA.judul + 1) });
    expect(panjang.ok ? [] : panjang.galat).toEqual([{ kolom: "judul", kode: "JUDUL_TERLALU_PANJANG" }]);
  });

  it("daftar persiapan terlalu banyak atau butir terlalu panjang ditolak", () => {
    const banyak = Array.from({ length: BATAS_AGENDA.butir + 1 }, (_, i) => `B${i}`).join("\n");
    const r1 = validasiAgenda({ ...sah, checklist: banyak });
    expect(r1.ok ? [] : r1.galat).toEqual([{ kolom: "checklist", kode: "BUTIR_TERLALU_BANYAK" }]);
    const r2 = validasiAgenda({ ...sah, checklist: "x".repeat(BATAS_AGENDA.teksButir + 1) });
    expect(r2.ok ? [] : r2.galat).toEqual([{ kolom: "checklist", kode: "BUTIR_TERLALU_PANJANG" }]);
  });

  it("checklist boleh dikirim sebagai larik butir", () => {
    const r = validasiAgenda({ ...sah, checklist: [{ teks: "A", selesai: true }, { teks: "" }] });
    expect(r.ok && r.agenda.checklist).toEqual([{ teks: "A", selesai: true }]);
  });
});
