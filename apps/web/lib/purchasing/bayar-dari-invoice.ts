import type { DataBayarInvoice } from "@/lib/vendor-billing/invoice-bayar-queries";

/*
 * "Bayar per invoice" di Pembayaran pemasok → Bayar — aturan MURNI (hanya `import type`), diuji di
 * `bayar-dari-invoice.test.ts`. Keputusan pemilik: Q19 (pembayaran memilih invoice), P20 ("baris diisi
 * sebesar utang tercatat dari penerimaan (bukan angka invoice)"), Q16 + P29 (invoice tertua dulu, menurut
 * tanggal di kertas invoice).
 *
 * Mencentang invoice mengisi setiap penerimaan yang disebutnya: baris-baris tagihan penerimaan itu urut
 * tanggal invoice; ℓ* = baris terakhir milik invoice yang dicentang; perlu = Σ utang tercatat baris
 * sampai ℓ*; isi = perlu − yang sudah lunas, dibatasi sisa dokumennya. Pcs yang tidak disebut invoice
 * tidak pernah diisi. Invoice lebih tua yang belum lunas di penerimaan yang sama ikut terbayar dan
 * disebut ("ikut melunasi"). Penulis pembayaran tetap memeriksa ulang semuanya.
 */

export type TerhalangInvoice = null | "KOREKSI_MENUNGGU" | "PO_DITANDAI_LUNAS" | "LUNAS" | "BELUM_JADI_HUTANG" | "DIBATASI_SISA";

export type IsiInvoice = { isiSen: number; ikutInvoiceLebihDulu: string[]; terhalang: TerhalangInvoice };

export function isiDariInvoice(d: DataBayarInvoice, dipilih: ReadonlySet<string>): Map<string, IsiInvoice> {
  const hasil = new Map<string, IsiInvoice>();
  if (dipilih.size === 0) return hasil;
  const disebut = new Set(d.invoice.filter((i) => dipilih.has(i.id)).flatMap((i) => i.penerimaan));
  for (const p of d.penerimaan) {
    if (!disebut.has(p.kunci)) continue;
    const baris = [...p.baris].sort((a, b) => a.urutan - b.urutan);
    let akhir = -1;
    baris.forEach((b, i) => {
      if (dipilih.has(b.billId)) akhir = i;
    });
    if (akhir < 0) continue;
    let perlu = 0;
    const ikut: string[] = [];
    for (let i = 0; i <= akhir; i++) {
      const sebelum = perlu;
      perlu += Math.max(0, baris[i].tercatatSen);
      // Baris tagihan yang TIDAK dicentang dan belum tertutup lunas penerimaannya ikut dibayar.
      if (!dipilih.has(baris[i].billId) && perlu > p.lunasSen && sebelum < perlu) {
        const no = d.nomorInvoice[baris[i].billId];
        if (no && !ikut.includes(no)) ikut.push(no);
      }
    }
    const kurang = perlu - p.lunasSen;
    let terhalang: TerhalangInvoice = null;
    let isi = 0;
    if (p.koreksiMenunggu.length > 0) terhalang = "KOREKSI_MENUNGGU";
    else if (p.poDitandaiLunas) terhalang = "PO_DITANDAI_LUNAS";
    else if (!p.adaHutang) terhalang = "BELUM_JADI_HUTANG";
    else if (kurang <= 0) terhalang = "LUNAS";
    else {
      isi = Math.max(0, Math.min(kurang, p.sisaSen));
      if (isi < kurang) terhalang = "DIBATASI_SISA";
    }
    hasil.set(p.kunci, { isiSen: isi, ikutInvoiceLebihDulu: terhalang && terhalang !== "DIBATASI_SISA" ? [] : ikut, terhalang });
  }
  return hasil;
}

const teksRupiah = (sen: number) => String(sen / 100);

/**
 * Terapkan isian pemilih ke kolom bayar: baris yang masih kosong atau masih berisi persis yang ditulis
 * pemilih sebelumnya diganti; yang sudah diketik orang lain dibiarkan. Hapus centang hanya mengosongkan
 * baris yang masih sama dengan tulisan pemilih.
 */
export function terapkanPilihanInvoice(a: {
  bayar: Record<string, string>;
  isiSebelum: Record<string, string>;
  isiBaru: ReadonlyMap<string, number>;
}): { bayar: Record<string, string>; isi: Record<string, string> } {
  const bayar = { ...a.bayar };
  const isi: Record<string, string> = {};
  for (const [k, lama] of Object.entries(a.isiSebelum)) {
    if (a.isiBaru.has(k)) continue;
    if ((bayar[k] ?? "") === lama) bayar[k] = "";
  }
  for (const [k, sen] of a.isiBaru) {
    const sekarang = (bayar[k] ?? "").trim();
    const milikPemilih = sekarang === "" || sekarang === (a.isiSebelum[k] ?? "");
    if (!milikPemilih) continue;
    const teks = sen > 0 ? teksRupiah(sen) : "";
    bayar[k] = teks;
    if (teks) isi[k] = teks;
  }
  return { bayar, isi };
}

const bacaSen = (v: string | undefined): number => {
  const n = Number((v ?? "").trim().replace(/\s/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/** Ringkasan kartu: semua angka dalam sen, dasar utang dengan PPN. */
export function ringkasInvoiceTerpilih(
  d: DataBayarInvoice,
  dipilih: ReadonlySet<string>,
  bayar: Record<string, string>,
): {
  totalInvoiceDicatatSen: number;
  utangTercatatSen: number;
  selisihMenungguSen: number;
  selisihDiterimaSen: number;
  selisihInvoiceDikoreksiSen: number;
  dibayarSen: number;
  diisiSen: number;
} {
  const inv = d.invoice.filter((i) => dipilih.has(i.id));
  const totalInvoiceDicatatSen = inv.reduce((s, i) => s + Math.round(i.total * 100), 0);
  const dibayarSen = inv.reduce((s, i) => s + Math.round(i.paidAmount * 100), 0);
  const jumlahKoreksi = (status: string) => inv.reduce((s, i) => s + i.koreksi.filter((k) => k.status === status).reduce((t, k) => t + k.jumlahSen, 0), 0);
  let utangTercatatSen = 0;
  const kunci = new Set(inv.flatMap((i) => i.penerimaan));
  for (const p of d.penerimaan) {
    if (!kunci.has(p.kunci)) continue;
    utangTercatatSen += p.baris.filter((b) => dipilih.has(b.billId)).reduce((s, b) => s + Math.max(0, b.tercatatSen), 0);
  }
  const diisiSen = [...kunci].reduce((s, k) => s + bacaSen(bayar[k]), 0);
  return {
    totalInvoiceDicatatSen,
    utangTercatatSen,
    selisihMenungguSen: jumlahKoreksi("MENUNGGU"),
    selisihDiterimaSen: jumlahKoreksi("DITERIMA"),
    selisihInvoiceDikoreksiSen: jumlahKoreksi("INVOICE_DIKOREKSI"),
    dibayarSen,
    diisiSen,
  };
}

/** Catatan bawaan: "Pembayaran invoice INV-1, INV-2". */
export function catatanDariInvoice(d: DataBayarInvoice, dipilih: ReadonlySet<string>): string {
  const no = d.invoice.filter((i) => dipilih.has(i.id)).map((i) => i.vendorInvoiceNo);
  return no.length > 0 ? `Pembayaran invoice ${no.join(", ")}` : "";
}
