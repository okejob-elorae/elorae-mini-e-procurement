import { describe, expect, it } from "vitest";
import { AMBANG_BAWAAN } from "./ambang";
import { lewatTenggat, selisihHari, tenggatKolaborasi, umurHari, type DataTenggat } from "./tenggat";

const dasar: DataTenggat = {
  tahap: "PROSPEK",
  tahapAt: "2026-10-01",
  dealAt: null,
  lastContactAt: null,
  liveAt: null,
  fee: 0,
  payStatus: "TIDAK_PERLU",
  pengiriman: [],
  konten: [],
};

const jenis = (d: DataTenggat, hariIni: string) => tenggatKolaborasi(d, AMBANG_BAWAAN, hariIni).map((t) => t.jenis);

describe("hitungan hari WIB", () => {
  it("lewat baru sesudah hari berganti, bukan di hari tenggatnya", () => {
    expect(lewatTenggat("2026-10-04", "2026-10-04")).toBe(false);
    expect(lewatTenggat("2026-10-04", "2026-10-05")).toBe(true);
  });

  it("selisih dan umur dalam hari kalender", () => {
    expect(selisihHari("2026-09-30", "2026-10-02")).toBe(2);
    expect(umurHari("2026-10-07", "2026-10-07")).toBe(0);
    expect(umurHari("2026-10-09", "2026-10-07")).toBe(-2);
  });
});

describe("tenggatKolaborasi", () => {
  it("follow-up dihitung dari kontak terakhir atau perpindahan tahap, mana yang lebih baru", () => {
    const d = { ...dasar, tahap: "DIHUBUNGI" as const, tahapAt: "2026-10-01", lastContactAt: "2026-10-03" };
    const [t] = tenggatKolaborasi(d, AMBANG_BAWAAN, "2026-10-06");
    expect(t).toMatchObject({ jenis: "FOLLOW_UP", sejak: "2026-10-03", tanggal: "2026-10-06", lewat: false, lewatHari: 0 });
    const [t2] = tenggatKolaborasi(d, AMBANG_BAWAAN, "2026-10-08");
    expect(t2).toMatchObject({ lewat: true, lewatHari: 2 });
  });

  it("prospek yang belum dihubungi tidak punya tenggat apa pun", () => {
    expect(jenis(dasar, "2026-12-01")).toEqual([]);
  });

  it("deal tanpa pengiriman berangkat → tenggat kirim sampel dari tanggal deal", () => {
    const d = { ...dasar, tahap: "DEAL" as const, dealAt: "2026-10-02", tahapAt: "2026-10-05" };
    const [t] = tenggatKolaborasi(d, AMBANG_BAWAAN, "2026-10-05");
    expect(t).toMatchObject({ jenis: "KIRIM_SAMPEL", sejak: "2026-10-02", tanggal: "2026-10-05" });
    // Begitu ada pengiriman yang berangkat, tenggatnya hilang.
    expect(
      jenis({ ...d, pengiriman: [{ id: "p1", sentAt: "2026-10-04", receivedAt: null, trackingNo: "JNE1" }] }, "2026-10-05"),
    ).toEqual(["RESI_NYANGKUT"]);
  });

  it("resi nyangkut per pengiriman, dan hilang begitu kontennya tayang", () => {
    const d: DataTenggat = {
      ...dasar,
      tahap: "SAMPEL_DIKIRIM",
      pengiriman: [{ id: "p1", sentAt: "2026-10-01", receivedAt: null, trackingNo: "JNE1" }],
    };
    const [t] = tenggatKolaborasi(d, AMBANG_BAWAAN, "2026-10-09");
    expect(t).toMatchObject({ jenis: "RESI_NYANGKUT", tanggal: "2026-10-08", lewat: true, refId: "p1" });
    expect(jenis({ ...d, tahap: "TAYANG" }, "2026-10-09")).not.toContain("RESI_NYANGKUT");
  });

  it("batas tayang dari tanggal terima terakhir selama belum ada link konten", () => {
    const d: DataTenggat = {
      ...dasar,
      tahap: "SAMPEL_DITERIMA",
      pengiriman: [
        { id: "p1", sentAt: "2026-09-20", receivedAt: "2026-09-22", trackingNo: "A" },
        { id: "p2", sentAt: "2026-10-01", receivedAt: "2026-10-03", trackingNo: "B" },
      ],
    };
    const [t] = tenggatKolaborasi(d, AMBANG_BAWAAN, "2026-10-04");
    expect(t).toMatchObject({ jenis: "BATAS_TAYANG", sejak: "2026-10-03", tanggal: "2026-10-08" });
  });

  it("review draf hanya untuk draf yang MENUNGGU dan belum tayang", () => {
    const d: DataTenggat = {
      ...dasar,
      tahap: "DRAF",
      konten: [
        { id: "k1", link: null, liveAt: null, draftStatus: "MENUNGGU", draftAt: "2026-10-05", angkaTerakhirHari: null },
        { id: "k2", link: null, liveAt: null, draftStatus: "REVISI", draftAt: "2026-10-05", angkaTerakhirHari: null },
      ],
    };
    const t = tenggatKolaborasi(d, AMBANG_BAWAAN, "2026-10-06").filter((x) => x.jenis === "REVIEW_DRAF");
    expect(t).toEqual([expect.objectContaining({ refId: "k1", tanggal: "2026-10-07" })]);
  });

  it("jatuh tempo bayar = tayang terakhir + 14, selama belum lunas — juga sesudah SELESAI", () => {
    const d: DataTenggat = {
      ...dasar,
      tahap: "SELESAI",
      fee: 1_000_000,
      payStatus: "SEBAGIAN",
      konten: [
        { id: "k1", link: "https://x", liveAt: "2026-09-01", draftStatus: null, draftAt: null, angkaTerakhirHari: "2026-09-20" },
        { id: "k2", link: "https://y", liveAt: "2026-09-05", draftStatus: null, draftAt: null, angkaTerakhirHari: "2026-09-20" },
      ],
    };
    expect(tenggatKolaborasi(d, AMBANG_BAWAAN, "2026-09-25")).toEqual([
      expect.objectContaining({ jenis: "JATUH_TEMPO_BAYAR", sejak: "2026-09-05", tanggal: "2026-09-19", lewat: true }),
    ]);
    expect(tenggatKolaborasi({ ...d, payStatus: "LUNAS" }, AMBANG_BAWAAN, "2026-09-25")).toEqual([]);
  });

  it("dengan termin: satu jatuh tempo per termin yang belum dibayar, dihitung dari pemicunya — bukan tayang + 14", () => {
    const d: DataTenggat = {
      ...dasar,
      tahap: "DEAL",
      dealAt: "2026-09-01",
      liveAt: null,
      fee: 1_000_000,
      payStatus: "BELUM",
      termin: [
        { id: "dp", status: "BELUM", pemicu: "DEAL", hariSesudah: 3, tanggal: null },
        { id: "lunas", status: "BELUM", pemicu: "TAYANG", hariSesudah: 14, tanggal: null },
        { id: "tgl", status: "BELUM", pemicu: "TANGGAL", hariSesudah: 0, tanggal: "2026-09-20" },
        { id: "sudah", status: "DIBAYAR", pemicu: "DEAL", hariSesudah: 0, tanggal: null },
        { id: "batal", status: "BATAL", pemicu: "DEAL", hariSesudah: 0, tanggal: null },
      ],
    };
    const bayar = tenggatKolaborasi(d, AMBANG_BAWAAN, "2026-09-10").filter((t) => t.jenis === "JATUH_TEMPO_BAYAR");
    // Termin pelunasan belum punya tanggal (belum tayang); urut menurut tanggal.
    expect(bayar.map((t) => [t.refId, t.tanggal, t.lewat])).toEqual([
      ["dp", "2026-09-04", true],
      ["tgl", "2026-09-20", false],
    ]);
    // Sesudah tayang, termin pelunasan ikut punya tanggal (KolBrief.liveAt + 14).
    const tayang = tenggatKolaborasi({ ...d, tahap: "TAYANG", liveAt: "2026-09-12" }, AMBANG_BAWAAN, "2026-09-10").filter(
      (t) => t.jenis === "JATUH_TEMPO_BAYAR",
    );
    expect(tayang.map((t) => t.refId)).toEqual(["dp", "tgl", "lunas"]);
    // Semua termin dibayar/batal: tidak ada tenggat bayar, walau payStatus lama masih BELUM.
    const lunas = { ...d, termin: d.termin!.map((t) => (t.status === "BELUM" ? { ...t, status: "DIBAYAR" as const } : t)) };
    expect(jenis(lunas, "2026-09-10")).not.toContain("JATUH_TEMPO_BAYAR");
  });

  it("angka konten: tanggal H+1/H+3/H+7 yang akan datang, tapi hanya SATU yang terlewat", () => {
    const k = { id: "k1", link: "https://x", liveAt: "2026-10-01", draftStatus: null, draftAt: null, angkaTerakhirHari: null };
    const d: DataTenggat = { ...dasar, tahap: "TAYANG", konten: [k] };
    expect(tenggatKolaborasi(d, AMBANG_BAWAAN, "2026-10-01").map((t) => [t.jenis, t.tanggal])).toEqual([
      ["ANGKA_H1", "2026-10-02"],
      ["ANGKA_H3", "2026-10-04"],
      ["ANGKA_H7", "2026-10-08"],
    ]);
    // H+5 tanpa angka: H+1 dan H+3 sama-sama lewat — yang muncul hanya H+3, ditambah H+7 yang akan datang.
    expect(tenggatKolaborasi(d, AMBANG_BAWAAN, "2026-10-06").map((t) => [t.jenis, t.lewat])).toEqual([
      ["ANGKA_H3", true],
      ["ANGKA_H7", false],
    ]);
    // Angka yang dicatat pada H+3 memenuhi H+1 dan H+3.
    const sudah = { ...d, konten: [{ ...k, angkaTerakhirHari: "2026-10-04" }] };
    expect(jenis(sudah, "2026-10-06")).toEqual(["ANGKA_H7"]);
  });

  it("kolaborasi di jalur keluar atau SELESAI tidak menagih pekerjaan lapangan", () => {
    const d: DataTenggat = {
      ...dasar,
      tahap: "GHOSTING",
      lastContactAt: "2026-09-01",
      pengiriman: [{ id: "p1", sentAt: "2026-09-01", receivedAt: null, trackingNo: "A" }],
    };
    expect(jenis(d, "2026-10-07")).toEqual([]);
  });

  it("hasil diurut dari tanggal tenggat paling awal", () => {
    const d: DataTenggat = {
      ...dasar,
      tahap: "DRAF",
      fee: 500_000,
      payStatus: "BELUM",
      pengiriman: [{ id: "p1", sentAt: "2026-09-20", receivedAt: "2026-09-22", trackingNo: "A" }],
      konten: [{ id: "k1", link: null, liveAt: null, draftStatus: "MENUNGGU", draftAt: "2026-09-25", angkaTerakhirHari: null }],
    };
    const t = tenggatKolaborasi(d, AMBANG_BAWAAN, "2026-10-07");
    expect(t.map((x) => x.tanggal)).toEqual([...t.map((x) => x.tanggal)].sort());
  });
});
