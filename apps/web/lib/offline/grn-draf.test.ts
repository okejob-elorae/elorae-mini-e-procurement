import { describe, expect, it, vi } from "vitest";

import {
  alasanTidakBisaSimpanGrn,
  ambilDrafGrn,
  barisDariDraf,
  bacaDrafGrn,
  drafBermakna,
  drafDariGrnLama,
  drafDariIsian,
  fotoDariDataUrl,
  galatSambungan,
  hapusDrafGrn,
  kunciDrafLengket,
  segarkanAngkaPo,
  simpanDrafGrn,
  type BarisSimpananDrafGrn,
  type IsianGrn,
  type TabelDrafGrn,
} from "./grn-draf";

/*
 * GRN tidak lagi disimpan "untuk disinkronkan nanti" — antrean itu tidak pernah
 * dikirim. Yang menggantikannya: formulir butuh sinyal, dan isiannya disimpan
 * sebagai DRAF di perangkat supaya sinyal putus tidak menghapus apa pun.
 */

const KOSONG: IsianGrn = {
  poId: "",
  supplierId: "",
  categoryId: "",
  notes: "",
  pendingLamaId: null,
  lines: [
    {
      id: "0",
      itemId: "",
      itemType: "",
      sku: "",
      nameId: "",
      uomId: "",
      uomCode: "",
      variantSku: undefined,
      qty: 0,
      unitCost: 0,
      rollValues: [],
    },
  ],
};

const ISI: IsianGrn = {
  poId: "po-77",
  supplierId: "sup-12",
  categoryId: "cat-kain",
  notes: "Datang pukul 14.00, 2 karung basah",
  pendingLamaId: null,
  lines: [
    {
      id: "po-0",
      itemId: "kain-katun",
      itemType: "FABRIC",
      sku: "KTN-30S",
      nameId: "Katun 30s Hitam",
      uomId: "uom-m",
      uomCode: "M",
      variantSku: undefined,
      qty: 98.5,
      unitCost: 32500,
      rollValues: ["50.5", "48"],
      poOrderedQty: 200,
      poAlreadyReceivedQty: 0,
    },
    {
      id: "line-3",
      itemId: "kancing-12",
      itemType: "ACCESSORIES",
      sku: "KCG-12",
      nameId: "Kancing 12mm",
      uomId: "uom-pcs",
      uomCode: "PCS",
      variantSku: "KCG-12-PUTIH",
      qty: 1200,
      unitCost: 150,
      rollValues: [],
      poOrderedQty: null,
      poAlreadyReceivedQty: null,
    },
  ],
};

describe("drafBermakna", () => {
  it("formulir baru (satu baris kosong) bukan draf", () => {
    expect(drafBermakna(drafDariIsian(KOSONG, 1000), 0)).toBe(false);
  });

  it("saring kategori saja bukan isian; catatan spasi juga bukan", () => {
    const d = drafDariIsian({ ...KOSONG, categoryId: "cat-kain", notes: "   " }, 1000);
    expect(drafBermakna(d, 0)).toBe(false);
  });

  it("pemasok, PO, barang, catatan, atau foto masing-masing sudah isian", () => {
    expect(drafBermakna(drafDariIsian({ ...KOSONG, supplierId: "sup-12" }, 1), 0)).toBe(true);
    expect(drafBermakna(drafDariIsian({ ...KOSONG, poId: "po-77" }, 1), 0)).toBe(true);
    expect(drafBermakna(drafDariIsian({ ...KOSONG, notes: "rusak 2" }, 1), 0)).toBe(true);
    expect(drafBermakna(drafDariIsian(ISI, 1), 0)).toBe(true);
    expect(drafBermakna(drafDariIsian(KOSONG, 1), 2)).toBe(true);
  });
});

describe("drafDariIsian → bacaDrafGrn → barisDariDraf", () => {
  it("bolak-balik lewat JSON tidak kehilangan satu angka pun", () => {
    const draf = drafDariIsian(ISI, 1_759_730_000_000);
    const dibaca = bacaDrafGrn(JSON.parse(JSON.stringify(draf)));
    expect(dibaca).toEqual(draf);
    expect(dibaca!.disimpanPada).toBe(1_759_730_000_000);
    expect(dibaca!.lines).toHaveLength(2);
    expect(dibaca!.lines[0]).toMatchObject({ itemId: "kain-katun", qty: 98.5, unitCost: 32500, rollValues: ["50.5", "48"] });
    expect(dibaca!.lines[1]).toMatchObject({ variantSku: "KCG-12-PUTIH", qty: 1200, unitCost: 150 });

    const baris = barisDariDraf(dibaca!);
    expect(baris.map((b) => b.id)).toEqual(["draf-0", "draf-1"]);
    expect(baris[0]).toMatchObject({ itemType: "FABRIC", poOrderedQty: 200, poAlreadyReceivedQty: 0 });
    // Total berjalan sama dengan sebelum disimpan: 98,5 × 32.500 + 1.200 × 150.
    const total = baris.reduce((s, b) => s + b.qty * b.unitCost, 0);
    expect(total).toBe(3_381_250);
  });

  it("roll kain dari impor Excel ikut draf: panjang, nomor roll, dan catatannya kembali utuh", () => {
    const rolls = [
      { length: 50.5, ref: "R-001", notes: "ujung kotor" },
      { length: 48, ref: null, notes: null },
    ];
    const isian: IsianGrn = { ...ISI, lines: [{ ...ISI.lines[0], rollValues: [], importedRolls: rolls }, ISI.lines[1]] };
    const dibaca = bacaDrafGrn(JSON.parse(JSON.stringify(drafDariIsian(isian, 9))));
    expect(dibaca!.lines[0].importedRolls).toEqual(rolls);
    expect(dibaca!.lines[1].importedRolls).toBeUndefined();

    const baris = barisDariDraf(dibaca!);
    expect(baris[0].importedRolls).toEqual(rolls);
    expect(baris[0].importedRolls).not.toBe(dibaca!.lines[0].importedRolls);
    expect("importedRolls" in baris[1]).toBe(false);
  });

  it("baris dengan roll impor yang rusak dibuang, bukan dipulihkan tanpa rollnya", () => {
    const d = JSON.parse(JSON.stringify(drafDariIsian(ISI, 1)));
    d.lines[0].importedRolls = [{ length: "50", ref: null, notes: null }];
    d.lines[1].importedRolls = [{ length: 1, ref: 7, notes: null }];
    expect(bacaDrafGrn(d)!.lines).toEqual([]);
    d.lines[0].importedRolls = "R-001";
    expect(bacaDrafGrn(d)!.lines).toEqual([]);
  });

  it("draf tanpa baris tetap memberi satu baris kosong untuk diisi", () => {
    const d = drafDariIsian({ ...ISI, lines: [] }, 5);
    const baris = barisDariDraf(d);
    expect(baris).toHaveLength(1);
    expect(baris[0]).toMatchObject({ itemId: "", qty: 0, unitCost: 0 });
  });

  it("menolak simpanan yang rusak atau dari versi lain", () => {
    expect(bacaDrafGrn(null)).toBeNull();
    expect(bacaDrafGrn("draf")).toBeNull();
    expect(bacaDrafGrn({ ...drafDariIsian(ISI, 1), versi: 2 })).toBeNull();
    expect(bacaDrafGrn({ ...drafDariIsian(ISI, 1), lines: "x" })).toBeNull();
    expect(bacaDrafGrn({ ...drafDariIsian(ISI, 1), supplierId: 12 })).toBeNull();
  });

  it("baris rusak dibuang, baris sah tetap", () => {
    const d = JSON.parse(JSON.stringify(drafDariIsian(ISI, 1)));
    d.lines.push({ itemId: 5 }, null, { ...d.lines[1], qty: "banyak" });
    const dibaca = bacaDrafGrn(d);
    expect(dibaca!.lines.map((l) => l.itemId)).toEqual(["kain-katun", "kancing-12"]);
  });
});

describe("drafDariGrnLama — GRN yang dulu 'disimpan di perangkat'", () => {
  it("menjadi isian formulir lengkap: roll kain, varian, catatan, PO, dan asalnya", () => {
    const lama = {
      localId: 4,
      poId: "po-77",
      supplierId: "sup-12",
      items: [
        {
          itemId: "kain-katun",
          sku: "KTN-30S",
          name: "Katun 30s Hitam",
          qty: 98.5,
          unitCost: 32500,
          uomId: "uom-m",
          rolls: [
            { rollRef: "KTN-30S-1", length: 50.5 },
            { rollRef: "KTN-30S-2", length: 48 },
          ],
        },
        { itemId: "kancing-12", sku: "KCG-12", name: "Kancing 12mm", variantSku: "KCG-12-PUTIH", qty: 1200, unitCost: 150, uomId: "uom-pcs" },
      ],
      notes: "Datang pukul 14.00",
      totalAmount: 3_381_250,
      status: "PENDING" as const,
      createdAt: new Date("2026-09-20T03:00:00Z"),
    };
    const barang = new Map([
      ["kain-katun", { type: "FABRIC", uomCode: "M" }],
      ["kancing-12", { type: "ACCESSORIES", uomCode: "PCS" }],
    ]);
    const d = drafDariGrnLama(lama, barang, 99);
    expect(d).toMatchObject({ poId: "po-77", supplierId: "sup-12", notes: "Datang pukul 14.00", pendingLamaId: 4, disimpanPada: 99 });
    expect(d.lines[0]).toMatchObject({ itemType: "FABRIC", uomCode: "M", qty: 98.5, rollValues: ["50.5", "48"] });
    expect(d.lines[1]).toMatchObject({ itemType: "ACCESSORIES", uomCode: "PCS", variantSku: "KCG-12-PUTIH", qty: 1200, rollValues: [] });
    expect(d.lines.reduce((s, l) => s + l.qty * l.unitCost, 0)).toBe(3_381_250);
  });

  it("barang yang tidak dikenal katalog: baris ber-roll tetap dianggap kain", () => {
    const d = drafDariGrnLama(
      {
        localId: 7,
        supplierId: "sup-1",
        items: [{ itemId: "x", qty: 30, unitCost: 1000, uomId: "u", rolls: [{ rollRef: "R1", length: 30 }] }],
        totalAmount: 30000,
        status: "PENDING",
        createdAt: new Date(0),
      },
      new Map(),
      1,
    );
    expect(d.poId).toBe("");
    expect(d.notes).toBe("");
    expect(d.lines[0]).toMatchObject({ itemType: "FABRIC", rollValues: ["30"], uomCode: "" });
  });
});

describe("fotoDariDataUrl", () => {
  it("data URL base64 menjadi berkas dengan isi dan jenis yang sama", async () => {
    const isi = "foto-gudang";
    const url = `data:image/jpeg;base64,${Buffer.from(isi).toString("base64")}`;
    const berkas = fotoDariDataUrl(url, "grn-1.jpg");
    expect(berkas).not.toBeNull();
    expect(berkas!.name).toBe("grn-1.jpg");
    expect(berkas!.type).toBe("image/jpeg");
    expect(berkas!.size).toBe(isi.length);
    expect(Buffer.from(await berkas!.arrayBuffer()).toString()).toBe(isi);
  });

  it("bukan data URL base64 → null, tidak melempar", () => {
    expect(fotoDariDataUrl("", "a.jpg")).toBeNull();
    expect(fotoDariDataUrl("https://contoh/a.jpg", "a.jpg")).toBeNull();
    expect(fotoDariDataUrl("data:image/png;base64,%%%", "a.png")).toBeNull();
  });
});

describe("alasanTidakBisaSimpanGrn & galatSambungan", () => {
  it("tanpa sinyal: tombol simpan mati dengan alasan BUTUH_SINYAL", () => {
    expect(alasanTidakBisaSimpanGrn({ daring: false })).toBe("BUTUH_SINYAL");
    expect(alasanTidakBisaSimpanGrn({ daring: true })).toBeNull();
  });

  it("hanya kegagalan jaringan yang dianggap sambungan putus", () => {
    expect(galatSambungan(new TypeError("Failed to fetch"))).toBe(true);
    expect(galatSambungan(new TypeError("Load failed"))).toBe(true);
    expect(galatSambungan(new TypeError("NetworkError when attempting to fetch resource."))).toBe(true);
    expect(galatSambungan(new Error("Unauthorized"))).toBe(false);
    expect(galatSambungan(new TypeError("x is not a function"))).toBe(false);
    expect(galatSambungan("Failed to fetch")).toBe(false);
  });
});

/** Tabel tiruan berbentuk Dexie Table (get/put/delete) di memori. */
function tabelMemori() {
  const isi = new Map<string, BarisSimpananDrafGrn>();
  const tabel: TabelDrafGrn = {
    get: vi.fn(async (k: string) => isi.get(k)),
    put: vi.fn(async (b: BarisSimpananDrafGrn) => {
      isi.set(b.kunci, b);
      return b.kunci;
    }),
    delete: vi.fn(async (k: string) => {
      isi.delete(k);
    }),
  };
  return { isi, tabel };
}

describe("simpan/ambil/hapus draf di perangkat", () => {
  it("menyimpan per pengguna dan mengembalikan isian + foto", async () => {
    const { isi, tabel } = tabelMemori();
    const foto = [new Blob(["a"], { type: "image/jpeg" })];
    const ok = await simpanDrafGrn(tabel, "user-ana", drafDariIsian(ISI, 10), foto);
    expect(ok).toBe(true);
    expect([...isi.keys()]).toEqual(["user-ana"]);

    const hasil = await ambilDrafGrn(tabel, "user-ana");
    expect(hasil!.draf.lines[0].rollValues).toEqual(["50.5", "48"]);
    expect(hasil!.foto).toHaveLength(1);
    // Pengguna lain di komputer yang sama tidak melihat draf ini.
    expect(await ambilDrafGrn(tabel, "user-budi")).toBeNull();
  });

  it("isian kosong menghapus draf, bukan menyimpan formulir kosong", async () => {
    const { isi, tabel } = tabelMemori();
    await simpanDrafGrn(tabel, "user-ana", drafDariIsian(ISI, 10), []);
    await simpanDrafGrn(tabel, "user-ana", drafDariIsian(KOSONG, 11), []);
    expect(isi.size).toBe(0);
    expect(tabel.put).toHaveBeenCalledTimes(1);
  });

  it("simpanan rusak dibuang dan dibaca sebagai tidak ada", async () => {
    const { isi, tabel } = tabelMemori();
    isi.set("user-ana", { kunci: "user-ana", draf: { versi: 9 } as never, foto: [], diperbarui: 1 });
    expect(await ambilDrafGrn(tabel, "user-ana")).toBeNull();
    expect(isi.size).toBe(0);
  });

  it("IndexedDB diblokir: tidak melempar, melaporkan gagal", async () => {
    const tabel: TabelDrafGrn = {
      get: async () => {
        throw new Error("blocked");
      },
      put: async () => {
        throw new Error("QuotaExceededError");
      },
      delete: async () => {
        throw new Error("blocked");
      },
    };
    expect(await ambilDrafGrn(tabel, "u")).toBeNull();
    expect(await simpanDrafGrn(tabel, "u", drafDariIsian(ISI, 1), [])).toBe(false);
    await expect(hapusDrafGrn(tabel, "u")).resolves.toBeUndefined();
  });

  it("tanpa kunci pengguna tidak ada yang dibaca atau ditulis", async () => {
    const { tabel } = tabelMemori();
    expect(await simpanDrafGrn(tabel, "", drafDariIsian(ISI, 1), [])).toBe(false);
    expect(await ambilDrafGrn(tabel, "")).toBeNull();
    expect(tabel.put).not.toHaveBeenCalled();
    expect(tabel.get).not.toHaveBeenCalled();
  });
});

describe("kunciDrafLengket — sesi hilang saat tab dibuka lagi tanpa sinyal", () => {
  /*
   * next-auth mengambil ulang sesi saat tab terlihat lagi; tanpa sinyal hasilnya
   * null dan TETAP null sampai halaman dimuat ulang. Kalau kunci draf ikut
   * kosong, draf berhenti tersimpan dan — setelah GRN tersimpan — draf lama
   * pengguna tidak terhapus, lalu dipulihkan lagi besok: GRN ganda.
   */
  it("sesi yang hilang tidak mengosongkan kunci pengguna yang sudah dikenal", () => {
    expect(kunciDrafLengket("user-gudang", "")).toBe("user-gudang");
  });

  it("sesi yang baru dikenal dipakai; pergantian pengguna ikut", () => {
    expect(kunciDrafLengket("", "user-gudang")).toBe("user-gudang");
    expect(kunciDrafLengket("user-gudang", "user-gudang")).toBe("user-gudang");
    expect(kunciDrafLengket("user-gudang", "user-admin")).toBe("user-admin");
  });

  it("belum pernah ada sesi: tetap kosong (tidak ada draf yang ditulis)", () => {
    expect(kunciDrafLengket("", "")).toBe("");
  });
});

describe("segarkanAngkaPo — draf dipulihkan, angka PO dari PO terbaru", () => {
  /*
   * Draf menyimpan "dipesan / sudah diterima" saat ditulis. Kalau sejak itu ada
   * GRN lain (atau GRN draf ini sendiri sudah tercatat saat sambungan putus),
   * angka lama berkata "sudah diterima 0" dan barang diterima dua kali tanpa
   * peringatan. Isian pengguna (qty, harga, roll) tidak disentuh.
   */
  const baris = [
    { id: "draf-0", itemId: "kain-katun", variantSku: undefined, qty: 98.5, unitCost: 32500, poOrderedQty: 200, poAlreadyReceivedQty: 0 },
    { id: "draf-1", itemId: "kancing", variantSku: "KCG-HTM", qty: 1200, unitCost: 150, poOrderedQty: 1200, poAlreadyReceivedQty: null },
    { id: "draf-2", itemId: "benang", variantSku: undefined, qty: 10, unitCost: 9000, poOrderedQty: 50, poAlreadyReceivedQty: 5 },
    { id: "draf-3", itemId: "", variantSku: undefined, qty: 0, unitCost: 0, poOrderedQty: null, poAlreadyReceivedQty: null },
  ];
  const po = [
    { itemId: "kain-katun", variantSku: "", dipesan: 200, diterima: 98.5 },
    { itemId: "kancing", variantSku: "KCG-HTM", dipesan: 1200, diterima: 1200 },
  ];

  it("angka PO diganti dengan yang terbaru; qty, harga, dan id baris tetap", () => {
    const hasil = segarkanAngkaPo(baris, po);
    expect(hasil[0]).toEqual({ ...baris[0], poOrderedQty: 200, poAlreadyReceivedQty: 98.5 });
    expect(hasil[1]).toEqual({ ...baris[1], poOrderedQty: 1200, poAlreadyReceivedQty: 1200 });
    expect(hasil[0].qty * hasil[0].unitCost + hasil[1].qty * hasil[1].unitCost).toBe(3_381_250);
  });

  it("baris yang tidak ada di PO kehilangan angka lamanya, bukan menampilkan yang usang", () => {
    const hasil = segarkanAngkaPo(baris, po);
    expect(hasil[2]).toEqual({ ...baris[2], poOrderedQty: null, poAlreadyReceivedQty: null });
    expect(hasil[3]).toEqual(baris[3]);
  });

  it("varian harus sama; barang yang sama dua kali di PO dipasangkan berurutan", () => {
    const dua = [
      { id: "c", itemId: "kaos", variantSku: "KAOS-M", poOrderedQty: 1, poAlreadyReceivedQty: 1 },
      { id: "a", itemId: "kaos", variantSku: "KAOS-S", poOrderedQty: 1, poAlreadyReceivedQty: 1 },
      { id: "b", itemId: "kaos", variantSku: "KAOS-S", poOrderedQty: 1, poAlreadyReceivedQty: 1 },
    ];
    const hasil = segarkanAngkaPo(dua, [
      { itemId: "kaos", variantSku: "KAOS-S", dipesan: 24, diterima: 12 },
      { itemId: "kaos", variantSku: "KAOS-S", dipesan: 36, diterima: 0 },
    ]);
    expect(hasil.map((h) => [h.id, h.poOrderedQty, h.poAlreadyReceivedQty])).toEqual([
      ["c", null, null],
      ["a", 24, 12],
      ["b", 36, 0],
    ]);
  });
});

describe("kunci kiriman GRN ikut draf", () => {
  const KUNCI = "3f1c9a52-7d0e-4b8a-9c11-5e2f60a7b8d4";

  it("bolak-balik lewat JSON membawa kunci yang sama — simpan ulang sesudah muat ulang memakai kunci itu", () => {
    const draf = drafDariIsian({ ...ISI, kunciKirim: KUNCI }, 7);
    expect(draf.kunciKirim).toBe(KUNCI);
    const dibaca = bacaDrafGrn(JSON.parse(JSON.stringify(draf)));
    expect(dibaca).toEqual(draf);
    expect(dibaca!.kunciKirim).toBe(KUNCI);
  });

  it("draf yang ditulis sebelum kunci ada tetap terbaca utuh; kuncinya kosong (formulir membuatkan)", () => {
    const lama = JSON.parse(JSON.stringify(drafDariIsian(ISI, 7))) as Record<string, unknown>;
    delete lama.kunciKirim;
    const dibaca = bacaDrafGrn(lama);
    expect(dibaca).not.toBeNull();
    expect(dibaca!.kunciKirim).toBe("");
    expect(dibaca!.lines.map((l) => l.itemId)).toEqual(["kain-katun", "kancing-12"]);
  });

  it("kunci bukan teks diabaikan tanpa membuang drafnya; spasi di tepi dirapikan", () => {
    const d = JSON.parse(JSON.stringify(drafDariIsian({ ...ISI, kunciKirim: KUNCI }, 7)));
    expect(bacaDrafGrn({ ...d, kunciKirim: 42 })!.kunciKirim).toBe("");
    expect(bacaDrafGrn({ ...d, kunciKirim: `  ${KUNCI} ` })!.kunciKirim).toBe(KUNCI);
    // Kunci yang akan ditolak server (terlalu pendek / panjang) diganti formulir.
    expect(bacaDrafGrn({ ...d, kunciKirim: "pendek" })!.kunciKirim).toBe("");
    expect(bacaDrafGrn({ ...d, kunciKirim: "x".repeat(101) })!.kunciKirim).toBe("");
  });

  it("isian tanpa kunci → draf berkunci kosong", () => {
    expect(drafDariIsian(ISI, 1).kunciKirim).toBe("");
  });

  it("GRN lama dari antrean perangkat tidak pernah sampai ke server: kuncinya kosong (isian baru)", () => {
    const d = drafDariGrnLama(
      {
        localId: 9,
        supplierId: "sup-12",
        items: [{ itemId: "kancing-12", qty: 10, unitCost: 150, uomId: "uom-pcs" }],
        totalAmount: 1_500,
        status: "PENDING" as const,
        createdAt: new Date("2026-09-20T03:00:00Z"),
      },
      new Map(),
      1,
    );
    expect(d.kunciKirim).toBe("");
  });

  it("kunci saja bukan isian yang layak disimpan", () => {
    expect(drafBermakna(drafDariIsian({ ...KOSONG, kunciKirim: KUNCI }, 1), 0)).toBe(false);
  });
});
