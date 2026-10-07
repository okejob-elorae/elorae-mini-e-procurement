import { describe, expect, it } from "vitest";
import { tampilanLonceng, type Penerjemah } from "./tampilan-lonceng";

/*
 * Lonceng kantor: notifikasi yang ditulis dalam kalimat Inggris jadi
 * ("PO payment status updated", "(UNMAPPED_ROLE: AP)", "total 680000") tampil
 * dalam bahasa pembaca lewat i18n, dari metadata atau dari pola kalimat
 * tersimpan. Yang tidak dikenali tampil apa adanya.
 *
 * Penerjemah tiruan: kunci yang "ada" mengembalikan `kunci{json nilai}`, jadi
 * tes memeriksa KUNCI dan NILAINYA, bukan teks terjemahannya.
 */
const ADA = new Set([
  "notifications.jenis.PO_PAYMENT_TOGGLED.judul",
  "notifications.jenis.PO_PAYMENT_TOGGLED.isiLunas",
  "notifications.jenis.PO_PAYMENT_TOGGLED.isiBelumLunas",
  "notifications.jenis.PO_STATUS_UPDATED.judul",
  "notifications.jenis.PO_STATUS_UPDATED.isi",
  "notifications.jenis.WO_STATUS_UPDATED.judul",
  "notifications.jenis.WO_STATUS_UPDATED.isi",
  "notifications.jenis.VENDOR_RETURN_STATUS_UPDATED.judul",
  "notifications.jenis.VENDOR_RETURN_STATUS_UPDATED.isi",
  "notifications.jenis.WO_OVERDUE.judul",
  "notifications.jenis.WO_OVERDUE.isi",
  "notifications.jenis.PO_OVERDUE.judul",
  "notifications.jenis.PO_OVERDUE.isi",
  "notifications.jenis.SUPPLIER_APPROVED.judul",
  "notifications.jenis.SUPPLIER_APPROVED.isi",
  "notifications.jenis.WO_COMPLETED.judul",
  "notifications.jenis.WO_COMPLETED.isi",
  "notifications.jenis.WO_COMPLETED.isiOleh",
  "notifications.jenis.PENDING_ORDER_APPROVAL.judulPutus",
  "notifications.jenis.PENDING_ORDER_APPROVAL.judulKonsi",
  "notifications.jenis.PENDING_ORDER_APPROVAL.isiPutus",
  "notifications.jenis.PENDING_ORDER_APPROVAL.isiKonsi",
  "notifications.jenis.PENDING_ORDER_APPROVAL.kredit",
  "notifications.jenis.PENDING_ORDER_APPROVAL.jarakJauh",
  "notifications.jenis.STORE_CHANGE_REQUEST.judul",
  "notifications.jenis.STORE_CHANGE_REQUEST.isi",
  "notifications.jenis.JOURNAL_PENDING.judul",
  "notifications.jenis.JOURNAL_PENDING.isi",
  "notifications.jenis.JOURNAL_PENDING.isiNomor",
  "notifications.jenis.JOURNAL_PENDING.dokumen.supplier_payment",
  "notifications.jenis.JOURNAL_PENDING.dokumen.opname",
  "notifications.jenis.JOURNAL_PENDING.dokumen.sales_order",
  "notifications.jenis.JOURNAL_PENDING.dokumen.lain",
  "notifications.jenis.MATERIAL_ARRIVED.judul",
  "notifications.testTitle",
  "notifications.testBody",
  "financeJournals.tertunda.sebab.UNMAPPED_ROLE",
  "financeJournals.tertunda.sebab.UNMAPPED_ROLE_TANPA_PERAN",
  "financeJournals.tertunda.sebab.UNBALANCED",
  "financeJournals.tertunda.sebab.LAIN",
  "financeAccountMapping.role.AP",
  "statuses.poDraft",
  "statuses.poSubmitted",
  "statuses.woInProduction",
  "statuses.woPartial",
  "statuses.unknown",
  "vendorReturnsList.statusProcessed",
  "vendorReturnsList.statusCompleted",
]);

const p: Penerjemah = {
  has: (k) => ADA.has(k),
  t: (k, nilai) => (nilai ? `${k}${JSON.stringify(nilai)}` : k),
  rupiah: (n) => `Rp ${n}`,
};

const butir = (type: string, title: string, body: string, data: unknown = {}) => ({ type, title, body, data });

describe("tampilanLonceng", () => {
  it("pembayaran PO: kalimat Inggris jadi kunci dengan nomor dan pelakunya", () => {
    const h = tampilanLonceng(
      butir("PO_PAYMENT_TOGGLED", "PO payment status updated", "PO PO/2026/0003 marked unpaid by Administrator", {
        poId: "x",
        docNumber: "PO/2026/0003",
      }),
      p,
    );
    expect(h.judul).toBe("notifications.jenis.PO_PAYMENT_TOGGLED.judul");
    expect(h.isi).toBe('notifications.jenis.PO_PAYMENT_TOGGLED.isiBelumLunas{"dokumen":"PO/2026/0003","oleh":"Administrator"}');
  });

  it("perubahan status PO memakai label status, bukan kode mentah", () => {
    const h = tampilanLonceng(
      butir("PO_STATUS_UPDATED", "PO status updated", "PO PO/2026/0004 status changed from DRAFT to SUBMITTED by Budi Santoso"),
      p,
    );
    expect(h.isi).toBe(
      'notifications.jenis.PO_STATUS_UPDATED.isi{"dokumen":"PO/2026/0004","dari":"statuses.poDraft","ke":"statuses.poSubmitted","oleh":"Budi Santoso"}',
    );
  });

  it("perubahan status SPK dan retur pemasok juga berlabel", () => {
    expect(
      tampilanLonceng(butir("WO_STATUS_UPDATED", "Work Order status updated", "WO WO/2026/0001 status changed from IN_PRODUCTION to PARTIAL by Ani"), p).isi,
    ).toBe('notifications.jenis.WO_STATUS_UPDATED.isi{"dokumen":"WO/2026/0001","dari":"statuses.woInProduction","ke":"statuses.woPartial","oleh":"Ani"}');
    expect(
      tampilanLonceng(
        butir("VENDOR_RETURN_STATUS_UPDATED", "Vendor return status updated", "Vendor return VR/1 status changed from PROCESSED to COMPLETED by Ani"),
        p,
      ).isi,
    ).toBe(
      'notifications.jenis.VENDOR_RETURN_STATUS_UPDATED.isi{"dokumen":"VR/1","dari":"vendorReturnsList.statusProcessed","ke":"vendorReturnsList.statusCompleted","oleh":"Ani"}',
    );
  });

  it("status yang tidak dikenal tidak tampil sebagai kode", () => {
    const h = tampilanLonceng(butir("PO_STATUS_UPDATED", "x", "PO A status changed from DRAFT to WEIRD by B"), p);
    expect(h.isi).toContain('"ke":"statuses.unknown"');
  });

  it("SPK dan PO terlambat", () => {
    expect(tampilanLonceng(butir("WO_OVERDUE", "WO Overdue", "WO/2026/0002 (CMT Maju) – target date has passed"), p)).toEqual({
      judul: "notifications.jenis.WO_OVERDUE.judul",
      isi: 'notifications.jenis.WO_OVERDUE.isi{"dokumen":"WO/2026/0002","vendor":"CMT Maju"}',
    });
    expect(tampilanLonceng(butir("PO_OVERDUE", "PO Overdue", "PO/2026/0001 (Kain Jaya) – ETA has passed"), p).isi).toBe(
      'notifications.jenis.PO_OVERDUE.isi{"dokumen":"PO/2026/0001","pemasok":"Kain Jaya"}',
    );
    // Kalimat yang sudah berbahasa Indonesia tetap, judulnya diterjemahkan.
    const id = tampilanLonceng(butir("PO_OVERDUE", "PO Overdue", "PO PO/2026/0001 terlambat — menghambat produksi WO/1."), p);
    expect(id).toEqual({ judul: "notifications.jenis.PO_OVERDUE.judul", isi: "PO PO/2026/0001 terlambat — menghambat produksi WO/1." });
  });

  it("SPK selesai, dengan dan tanpa pelaku", () => {
    expect(tampilanLonceng(butir("WO_COMPLETED", "Work Order Completed", "WO/1 – Kaos Polos completed by Ani"), p).isi).toBe(
      'notifications.jenis.WO_COMPLETED.isiOleh{"dokumen":"WO/1","barang":"Kaos Polos","oleh":"Ani"}',
    );
    expect(tampilanLonceng(butir("WO_COMPLETED", "Work Order Completed", "WO/1 – Kaos Polos completed"), p).isi).toBe(
      'notifications.jenis.WO_COMPLETED.isi{"dokumen":"WO/1","barang":"Kaos Polos"}',
    );
  });

  it("pesanan putus menunggu persetujuan: total berformat rupiah, tanda kredit dan jarak jauh ikut", () => {
    const h = tampilanLonceng(
      butir(
        "PENDING_ORDER_APPROVAL",
        "Putus order PUTUS/2026/2979 awaiting approval",
        "New putus order PUTUS/2026/2979 (total 680000) is pending approval. Credit on hold: check the store's bills before approving. Remote order (WA), taken without a store visit.",
        { orderId: "o1", orderNo: "PUTUS/2026/2979", orderType: "PUTUS", total: "680000", kreditDitahan: "true", remoteChannel: "WA" },
      ),
      p,
    );
    expect(h.judul).toBe('notifications.jenis.PENDING_ORDER_APPROVAL.judulPutus{"nomor":"PUTUS/2026/2979"}');
    expect(h.isi).toBe(
      'notifications.jenis.PENDING_ORDER_APPROVAL.isiPutus{"nomor":"PUTUS/2026/2979","total":"Rp 680000"} notifications.jenis.PENDING_ORDER_APPROVAL.kredit notifications.jenis.PENDING_ORDER_APPROVAL.jarakJauh{"saluran":"WA"}',
    );
  });

  it("pesanan dari baris lama tanpa metadata: nomor dan total dibaca dari kalimatnya", () => {
    const h = tampilanLonceng(
      butir("PENDING_ORDER_APPROVAL", "Putus order PUTUS/1 awaiting approval", "New putus order PUTUS/1 (total 1250000.5) is pending approval."),
      p,
    );
    expect(h.isi).toBe('notifications.jenis.PENDING_ORDER_APPROVAL.isiPutus{"nomor":"PUTUS/1","total":"Rp 1250000.5"}');
  });

  it("transfer konsinyasi tidak pernah menyebut rupiah", () => {
    const h = tampilanLonceng(
      butir("PENDING_ORDER_APPROVAL", "Konsi transfer KONSI/1 awaiting approval", "New konsi transfer request KONSI/1 is pending approval.", {
        orderNo: "KONSI/1",
        orderType: "KONSI",
      }),
      p,
    );
    expect(h.judul).toBe('notifications.jenis.PENDING_ORDER_APPROVAL.judulKonsi{"nomor":"KONSI/1"}');
    expect(h.isi).toBe('notifications.jenis.PENDING_ORDER_APPROVAL.isiKonsi{"nomor":"KONSI/1"}');
    expect(h.isi).not.toContain("Rp");
  });

  it("jurnal gagal: dokumen dan sebab dalam bahasa pembaca, peran akun berlabel", () => {
    const h = tampilanLonceng(
      butir(
        "JOURNAL_PENDING",
        "Supplier payment journal not posted",
        "Supplier payment journal could not be posted (UNMAPPED_ROLE: AP). Map the account, then unmark payment on the PO and mark it paid again.",
        { docId: "po1", kind: "supplier_payment", reason: "UNMAPPED_ROLE", role: "AP" },
      ),
      p,
    );
    expect(h.judul).toBe("notifications.jenis.JOURNAL_PENDING.judul");
    expect(h.isi).toBe(
      'notifications.jenis.JOURNAL_PENDING.isi{"dokumen":"notifications.jenis.JOURNAL_PENDING.dokumen.supplier_payment","sebab":"financeJournals.tertunda.sebab.UNMAPPED_ROLE{\\"peran\\":\\"financeAccountMapping.role.AP\\"}"}',
    );
  });

  it("jurnal gagal dengan nomor dokumen dari judul opname atau kalimat penjualan", () => {
    const opname = tampilanLonceng(
      butir("JOURNAL_PENDING", "Opname OPN/2026/0001: journal not posted", "x", { opnameId: "o", reason: "UNBALANCED" }),
      p,
    );
    expect(opname.isi).toBe(
      'notifications.jenis.JOURNAL_PENDING.isiNomor{"dokumen":"notifications.jenis.JOURNAL_PENDING.dokumen.opname","nomor":"OPN/2026/0001","sebab":"financeJournals.tertunda.sebab.UNBALANCED"}',
    );
    const jual = tampilanLonceng(
      butir("JOURNAL_PENDING", "Sales journal not posted", "Sales revenue journal for SO-123 could not be posted (UNMAPPED_ROLE: XYZ). Map the account.", {
        orderId: "s",
        kind: "revenue",
        reason: "UNMAPPED_ROLE",
        role: "XYZ",
      }),
      p,
    );
    // Peran yang tidak dikenal tidak ditulis sebagai kode.
    expect(jual.isi).toBe(
      'notifications.jenis.JOURNAL_PENDING.isiNomor{"dokumen":"notifications.jenis.JOURNAL_PENDING.dokumen.sales_order","nomor":"SO-123","sebab":"financeJournals.tertunda.sebab.UNMAPPED_ROLE_TANPA_PERAN"}',
    );
  });

  it("sebab yang tidak dikenal = LAIN, data JSON berbentuk teks tetap dibaca", () => {
    const h = tampilanLonceng(
      butir("JOURNAL_PENDING", "x", "y", JSON.stringify({ docId: "d", kind: "aneh", reason: "SOMETHING_NEW" })),
      p,
    );
    expect(h.isi).toBe(
      'notifications.jenis.JOURNAL_PENDING.isi{"dokumen":"notifications.jenis.JOURNAL_PENDING.dokumen.lain","sebab":"financeJournals.tertunda.sebab.LAIN"}',
    );
  });

  it("notifikasi uji memakai kalimat i18n yang sudah ada", () => {
    expect(tampilanLonceng(butir("TEST", "Test notification", "This is a test notification from the app."), p)).toEqual({
      judul: "notifications.testTitle",
      isi: "notifications.testBody",
    });
  });

  it("isi yang sudah Indonesia dipertahankan, judulnya diterjemahkan", () => {
    expect(tampilanLonceng(butir("MATERIAL_ARRIVED", "Material arrived", "Kain untuk WO/1 sudah tiba (GRN G/1) — siap di-issue."), p)).toEqual({
      judul: "notifications.jenis.MATERIAL_ARRIVED.judul",
      isi: "Kain untuk WO/1 sudah tiba (GRN G/1) — siap di-issue.",
    });
  });

  it("jenis tidak dikenal, atau kalimat yang tidak cocok polanya: teks tersimpan", () => {
    expect(tampilanLonceng(butir("BARANG_HILANG", "Barang hilang: 1 potong", "Toko A"), p)).toEqual({
      judul: "Barang hilang: 1 potong",
      isi: "Toko A",
    });
    expect(tampilanLonceng(butir("SUPPLIER_APPROVED", "Supplier approved", "kalimat lain"), p)).toEqual({
      judul: "notifications.jenis.SUPPLIER_APPROVED.judul",
      isi: "kalimat lain",
    });
  });

  it("kunci yang belum ada di berkas bahasa: teks tersimpan, bukan nama kunci", () => {
    const kosong: Penerjemah = { has: () => false, t: (k) => k, rupiah: (n) => String(n) };
    expect(tampilanLonceng(butir("SUPPLIER_APPROVED", "Supplier approved", "A approved by B"), kosong)).toEqual({
      judul: "Supplier approved",
      isi: "A approved by B",
    });
  });
});
