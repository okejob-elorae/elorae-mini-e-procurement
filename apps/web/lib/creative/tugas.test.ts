import { describe, expect, it } from "vitest";
import { AMBANG_BAWAAN } from "./ambang";
import {
  JUDUL_TUGAS,
  jumlahTugas,
  kurangDataKirim,
  susunTugas,
  URUTAN_TUGAS,
  type AgendaTugas,
  type AnomaliTugas,
  type CampaignTugas,
  type KolaborasiTugas,
  type KunciTugas,
  type PerangkatTugas,
} from "./tugas";

const HARI_INI = "2026-10-20";

let urut = 0;
function kol(isi: Partial<KolaborasiTugas> = {}): KolaborasiTugas {
  urut++;
  return {
    id: `c${urut}`,
    docNo: `BRIEF/2026/${String(urut).padStart(4, "0")}`,
    kolId: `k${urut}`,
    kolNama: `KOL ${urut}`,
    kolHandle: `kol${urut}`,
    platform: "TIKTOK",
    waNormal: `62812000000${String(urut).padStart(2, "0")}`,
    alamat: "Jl. Mawar 1",
    ukuranAda: true,
    kolDiblokir: false,
    campaignId: "camp1",
    tahap: "PROSPEK",
    tahapAt: "2026-10-01",
    dealAt: null,
    lastContactAt: null,
    plannedLiveAt: null,
    liveAt: null,
    fee: 0,
    payStatus: "TIDAK_PERLU",
    pengiriman: [],
    konten: [],
    ...isi,
  };
}

const kosong = {
  kolaborasi: [] as KolaborasiTugas[],
  agenda: [] as AgendaTugas[],
  campaign: [] as CampaignTugas[],
  anomali: [] as AnomaliTugas[],
  perangkat: [] as PerangkatTugas[],
};

function kelompok(kunci: KunciTugas, isi: Partial<typeof kosong>) {
  return susunTugas({ ...kosong, ...isi, hariIni: HARI_INI, ambang: AMBANG_BAWAAN }).find((k) => k.kunci === kunci)!;
}

describe("susunTugas — 15 kelompok Hari ini", () => {
  it("selalu mengembalikan 15 kelompok dalam urutan tetap, berjudul bahasa Indonesia", () => {
    const k = susunTugas({ ...kosong, hariIni: HARI_INI, ambang: AMBANG_BAWAAN });
    expect(k.map((x) => x.kunci)).toEqual(URUTAN_TUGAS);
    expect(URUTAN_TUGAS).toHaveLength(15);
    for (const x of URUTAN_TUGAS) expect(JUDUL_TUGAS[x].length).toBeGreaterThan(0);
    expect(jumlahTugas(k)).toBe(0);
  });

  it("agenda hari ini, yang terlewat, dan yang masuk masa ingat H-n; yang selesai tidak", () => {
    const agenda: AgendaTugas[] = [
      { id: "a1", title: "Meeting", date: "2026-10-20", time: "09:30", remindDaysBefore: 0, doneAt: null, checklistBelum: 0 },
      { id: "a2", title: "Terlewat", date: "2026-10-15", time: null, remindDaysBefore: 0, doneAt: null, checklistBelum: 2 },
      { id: "a3", title: "Lusa, ingat H-2", date: "2026-10-22", time: null, remindDaysBefore: 2, doneAt: null, checklistBelum: 0 },
      { id: "a4", title: "Lusa, tanpa ingat", date: "2026-10-22", time: null, remindDaysBefore: 0, doneAt: null, checklistBelum: 0 },
      { id: "a5", title: "Sudah", date: "2026-10-19", time: null, remindDaysBefore: 0, doneAt: "2026-10-19", checklistBelum: 0 },
    ];
    const k = kelompok("AGENDA", { agenda });
    expect(k.baris.map((b) => [b.id, b.umurHari])).toEqual([
      ["a2", 5],
      ["a1", 0],
      ["a3", -2],
    ]);
    expect(k.baris[0].info.adaPersiapanBelum).toBe(true);
  });

  it("deal belum kirim sampel lebih dari N hari", () => {
    const lama = kol({ tahap: "DEAL", dealAt: "2026-10-10" });
    const baru = kol({ tahap: "DEAL", dealAt: "2026-10-18" });
    const sudahKirim = kol({ tahap: "DEAL", dealAt: "2026-10-01", pengiriman: [{ id: "p", sentAt: "2026-10-02", receivedAt: null, trackingNo: "A" }] });
    const k = kelompok("DEAL_BELUM_KIRIM", { kolaborasi: [baru, lama, sudahKirim] });
    expect(k.baris.map((b) => b.id)).toEqual([lama.id]);
    expect(k.baris[0].umurHari).toBe(10);
  });

  it("resi nyangkut membawa kurir dan resinya", () => {
    const c = kol({
      tahap: "SAMPEL_DIKIRIM",
      pengiriman: [{ id: "p1", sentAt: "2026-10-05", receivedAt: null, trackingNo: "JNE77", courier: "JNE" }],
    });
    const k = kelompok("RESI_NYANGKUT", { kolaborasi: [c] });
    expect(k.jumlah).toBe(1);
    expect(k.baris[0].info).toMatchObject({ resi: "JNE77", kurir: "JNE", refId: "p1" });
  });

  it("diterima tapi belum tayang, draf menunggu review, dan jadwal tayang lewat", () => {
    const terima = kol({
      tahap: "SAMPEL_DITERIMA",
      pengiriman: [{ id: "p", sentAt: "2026-10-01", receivedAt: "2026-10-10", trackingNo: "A" }],
    });
    const draf = kol({
      tahap: "DRAF",
      konten: [{ id: "k", link: null, liveAt: null, plannedAt: null, draftStatus: "MENUNGGU", draftAt: "2026-10-15", draftLink: "https://d", angkaTerakhirHari: null }],
    });
    const jadwal = kol({
      tahap: "DRAF_DISETUJUI",
      konten: [{ id: "k2", link: null, liveAt: null, plannedAt: "2026-10-18", draftStatus: "DISETUJUI", draftAt: "2026-10-12", draftLink: null, angkaTerakhirHari: null }],
    });
    const rencanaKolaborasi = kol({ tahap: "SAMPEL_DITERIMA", plannedLiveAt: "2026-10-19" });
    const semua = [terima, draf, jadwal, rencanaKolaborasi];
    expect(kelompok("DITERIMA_BELUM_TAYANG", { kolaborasi: semua }).baris.map((b) => b.id)).toEqual([terima.id]);
    expect(kelompok("DRAF_MENUNGGU", { kolaborasi: semua }).baris.map((b) => b.id)).toEqual([draf.id]);
    expect(kelompok("JADWAL_TAYANG_LEWAT", { kolaborasi: semua }).baris.map((b) => b.id)).toEqual([jadwal.id, rencanaKolaborasi.id]);
  });

  it("belum dibalas lebih dari N hari, dengan saran ghosting sesudah 14 hari", () => {
    const tiga = kol({ tahap: "DIHUBUNGI", tahapAt: "2026-10-17" });
    const lima = kol({ tahap: "NEGO", tahapAt: "2026-10-01", lastContactAt: "2026-10-15" });
    const lama = kol({ tahap: "DIHUBUNGI", tahapAt: "2026-09-30" });
    const k = kelompok("BELUM_DIBALAS", { kolaborasi: [tiga, lima, lama] });
    expect(k.baris.map((b) => [b.id, b.saranGhosting])).toEqual([
      [lama.id, true],
      [lima.id, false],
    ]);
  });

  it("tayang tanpa angka H+3/H+7, dan tayang belum dibayar lewat jatuh tempo", () => {
    const tanpaAngka = kol({
      tahap: "TAYANG",
      konten: [{ id: "k", link: "https://x", liveAt: "2026-10-15", plannedAt: null, draftStatus: null, draftAt: null, draftLink: null, angkaTerakhirHari: null }],
    });
    const belumBayar = kol({
      tahap: "ANGKA_MASUK",
      fee: 2_000_000,
      payStatus: "BELUM",
      konten: [{ id: "k", link: "https://y", liveAt: "2026-10-01", plannedAt: null, draftStatus: null, draftAt: null, draftLink: null, angkaTerakhirHari: "2026-10-10" }],
    });
    expect(kelompok("ANGKA_BELUM_ADA", { kolaborasi: [tanpaAngka, belumBayar] }).baris.map((b) => [b.id, b.info.titik])).toEqual([
      [tanpaAngka.id, "ANGKA_H3"],
    ]);
    expect(kelompok("BELUM_DIBAYAR", { kolaborasi: [tanpaAngka, belumBayar] }).baris.map((b) => b.id)).toEqual([belumBayar.id]);
  });

  it("kirim dobel: nomor WA sama dengan KOL lain yang sudah dikirimi, atau KOL yang sama di campaign yang sama", () => {
    const sudah = kol({ tahap: "SAMPEL_DITERIMA", waNormal: "6281111111111", pengiriman: [{ id: "p", sentAt: "2026-10-01", receivedAt: "2026-10-03", trackingNo: "A" }] });
    const nomorSama = kol({ tahap: "DEAL", dealAt: "2026-10-19", waNormal: "6281111111111" });
    const orangSama = kol({ tahap: "DEAL", dealAt: "2026-10-19", kolId: sudah.kolId, waNormal: null });
    const campaignLain = kol({ tahap: "DEAL", dealAt: "2026-10-19", kolId: sudah.kolId, campaignId: "camp2" });
    const k = kelompok("KIRIM_DOBEL", { kolaborasi: [sudah, nomorSama, orangSama, campaignLain] });
    expect(k.baris.map((b) => b.id).sort()).toEqual([nomorSama.id, orangSama.id].sort());
    expect(k.baris.find((b) => b.id === nomorSama.id)!.info.dobelDengan).toEqual([{ id: sudah.id, kolNama: sudah.kolNama, docNo: sudah.docNo }]);
  });

  it("kurangDataKirim menyebut tepat kolom yang kosong (dipakai juga kartu alamat rincian kolaborasi)", () => {
    expect(kurangDataKirim({ alamat: " ", waNormal: "6281234", ukuranAda: false })).toEqual(["ALAMAT", "UKURAN"]);
    expect(kurangDataKirim({ alamat: "Jl. Mawar 1", waNormal: null, ukuranAda: true })).toEqual(["HP"]);
    expect(kurangDataKirim({ alamat: "Jl. Mawar 1", waNormal: "6281234", ukuranAda: true })).toEqual([]);
  });

  it("data kirim kurang hanya untuk yang belum berangkat, dan menyebut yang kurang", () => {
    const c = kol({ tahap: "DEAL", dealAt: "2026-10-19", alamat: "  ", waNormal: null, ukuranAda: false });
    const k = kelompok("DATA_KIRIM_KURANG", { kolaborasi: [c, kol({ tahap: "DEAL", dealAt: "2026-10-19" })] });
    expect(k.baris.map((b) => [b.id, b.info.kurang])).toEqual([[c.id, ["ALAMAT", "HP", "UKURAN"]]]);
  });

  it("KOL diblokir dengan kolaborasi yang masih berjalan", () => {
    const jalan = kol({ tahap: "NEGO", kolDiblokir: true });
    const tutup = kol({ tahap: "BATAL", kolDiblokir: true });
    expect(kelompok("KOL_DIBLOKIR", { kolaborasi: [jalan, tutup] }).baris.map((b) => b.id)).toEqual([jalan.id]);
  });

  it("budget campaign ≥ 80% atau lewat; arsip dan tanpa budget tidak", () => {
    const campaign: CampaignTugas[] = [
      { id: "a", name: "Aman", budget: 1_000_000, terpakai: 500_000, archivedAt: null },
      { id: "b", name: "Hampir", budget: 1_000_000, terpakai: 850_000, archivedAt: null },
      { id: "c", name: "Lewat", budget: 1_000_000, terpakai: 1_200_000, archivedAt: null },
      { id: "d", name: "Arsip", budget: 1_000_000, terpakai: 2_000_000, archivedAt: "2026-10-01" },
      { id: "e", name: "Tanpa", budget: null, terpakai: 2_000_000, archivedAt: null },
    ];
    const k = kelompok("BUDGET_CAMPAIGN", { campaign });
    expect(k.baris.map((b) => [b.id, b.info.persen, b.info.lewatBudget])).toEqual([
      ["c", 120, true],
      ["b", 85, false],
    ]);
  });

  it("kolaborasi di jalur keluar tidak memunculkan tugas lapangan", () => {
    const c = kol({ tahap: "GHOSTING", tahapAt: "2026-09-01", lastContactAt: "2026-09-01", dealAt: "2026-09-01" });
    const semua = susunTugas({ ...kosong, kolaborasi: [c], hariIni: HARI_INI, ambang: AMBANG_BAWAAN });
    expect(jumlahTugas(semua)).toBe(0);
  });

  it("jumlah = banyak baris; total untuk lencana menjumlahkan semua kelompok", () => {
    const a = kol({ tahap: "DIHUBUNGI", tahapAt: "2026-10-01" });
    const b = kol({ tahap: "DIHUBUNGI", tahapAt: "2026-10-02" });
    const semua = susunTugas({ ...kosong, kolaborasi: [a, b], hariIni: HARI_INI, ambang: AMBANG_BAWAAN });
    expect(semua.find((k) => k.kunci === "BELUM_DIBALAS")!.jumlah).toBe(2);
    expect(jumlahTugas(semua)).toBe(2);
  });
});

describe("susunTugas — pantau KOL", () => {
  it("anomali akun: satu baris per akun, judul nama KOL, sub handle, info perubahan; urut paling lama dulu", () => {
    const anomali: AnomaliTugas[] = [
      { akunId: "a1", kolId: "k1", kolNama: "Rina", handle: "rina", hari: "2026-10-19", pengikut: { dari: 1000, ke: 1500, persen: 50 }, er: null },
      { akunId: "a2", kolId: "k2", kolNama: "Budi", handle: "budi", hari: "2026-10-17", pengikut: null, er: { dari: 6, ke: 3, persen: 50 } },
    ];
    const k = kelompok("ANOMALI_AKUN", { anomali });
    expect(k.jumlah).toBe(2);
    expect(k.baris.map((b) => [b.jenis, b.id, b.judul, b.sub, b.kolId, b.umurHari])).toEqual([
      ["AKUN", "a2", "Budi", "budi", "k2", 3],
      ["AKUN", "a1", "Rina", "rina", "k1", 1],
    ]);
    expect(k.baris[1].info.anomali).toEqual({ pengikut: { dari: 1000, ke: 1500, persen: 50 }, er: null });
  });

  it("perangkat pemantau berhenti: alasan dan batas jedanya ikut", () => {
    const perangkat: PerangkatTugas[] = [{ id: "p1", nama: "Laptop kantor", sejak: "2026-10-20", alasan: "CAPTCHA", sampai: "2026-10-20T05:00:00.000Z" }];
    const k = kelompok("PERANGKAT_BERHENTI", { perangkat });
    expect(k.baris).toHaveLength(1);
    expect(k.baris[0]).toMatchObject({ jenis: "PERANGKAT", id: "p1", judul: "Laptop kantor", umurHari: 0, info: { alasanJeda: "CAPTCHA", sampai: "2026-10-20T05:00:00.000Z" } });
  });

  it("tanpa data pantau kedua kelompok ada tapi kosong", () => {
    const semua = susunTugas({ ...kosong, hariIni: HARI_INI, ambang: AMBANG_BAWAAN });
    expect(semua.find((k) => k.kunci === "ANOMALI_AKUN")!.jumlah).toBe(0);
    expect(semua.find((k) => k.kunci === "PERANGKAT_BERHENTI")!.jumlah).toBe(0);
  });
});
