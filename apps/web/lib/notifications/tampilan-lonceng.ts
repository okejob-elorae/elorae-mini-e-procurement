import { getStatusMeta, type StatusDomain } from "@/lib/ui/status-map";
import { kunciSebab } from "@/app/backoffice/finance/journals/_tertunda/sebab";
import { bacaDataNotifikasi } from "./navigation";

/*
 * Judul dan isi notifikasi di lonceng kantor, dalam bahasa pembaca.
 *
 * Sebagian penulis notifikasi menyimpan kalimat Inggris jadi ("PO payment
 * status updated", "(UNMAPPED_ROLE: AP)", "total 680000"). Di sini kalimat itu
 * diganti terjemahan i18n per jenis (`notifications.jenis.<JENIS>.*`), dengan
 * bahan dari metadata (`data`) atau dari pola kalimat tersimpan untuk baris
 * lama. Jenis yang tidak dikenal, kalimat yang tidak cocok polanya, atau kunci
 * yang belum ada di berkas bahasa: teks tersimpan apa adanya — tidak pernah
 * nama kunci.
 *
 * Murni (tanpa React/Prisma): diuji di `tampilan-lonceng.test.ts`.
 */

export type Penerjemah = {
  /** Penerjemah akar (`useTranslations()`): kunci lengkap. */
  t: (kunci: string, nilai?: Record<string, string | number>) => string;
  has: (kunci: string) => boolean;
  rupiah: (n: number) => string;
};

export type ButirLonceng = { type: string; title: string; body: string; data: unknown };

type Hasil = { judul: string; isi: string };

const AKAR = "notifications.jenis";

/** `has` + `t`, atau `null` bila kuncinya belum ada. */
function coba(p: Penerjemah, kunci: string, nilai?: Record<string, string | number>): string | null {
  return p.has(kunci) ? p.t(kunci, nilai) : null;
}

function teks(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

const LABEL_RETUR_PEMASOK: Record<string, string> = {
  DRAFT: "vendorReturnsList.statusDraft",
  PROCESSED: "vendorReturnsList.statusProcessed",
  COMPLETED: "vendorReturnsList.statusCompleted",
};

/** Label status untuk pembaca; status tak dikenal = "tidak diketahui", bukan kodenya. */
function labelStatus(p: Penerjemah, domain: StatusDomain | "vendorReturn", kode: string): string {
  const kunci =
    domain === "vendorReturn"
      ? (LABEL_RETUR_PEMASOK[kode] ?? "statuses.unknown")
      : `statuses.${getStatusMeta(domain, kode).labelKey}`;
  return coba(p, kunci) ?? coba(p, "statuses.unknown") ?? kode;
}

/** Judul tetap per jenis, isi dari `isi(…)` (null = pakai isi tersimpan). */
function jenisTetap(
  item: ButirLonceng,
  p: Penerjemah,
  isi: () => string | null,
): Hasil {
  return {
    judul: coba(p, `${AKAR}.${item.type}.judul`) ?? item.title,
    isi: isi() ?? item.body,
  };
}

/** "<sesuatu> by <nama>" dengan pola kalimat tersimpan. */
function polaOleh(
  item: ButirLonceng,
  p: Penerjemah,
  pola: RegExp,
  nama: readonly string[],
): Hasil {
  return jenisTetap(item, p, () => {
    const m = pola.exec(item.body);
    if (!m) return null;
    const nilai: Record<string, string> = {};
    nama.forEach((n, i) => {
      nilai[n] = m[i + 1] ?? "";
    });
    return coba(p, `${AKAR}.${item.type}.isi`, nilai);
  });
}

function statusBerubah(item: ButirLonceng, p: Penerjemah, awalan: string, domain: StatusDomain | "vendorReturn"): Hasil {
  return jenisTetap(item, p, () => {
    const m = new RegExp(`^${awalan} (.+) status changed from (\\S+) to (\\S+) by (.+)$`).exec(item.body);
    if (!m) return null;
    return coba(p, `${AKAR}.${item.type}.isi`, {
      dokumen: m[1],
      dari: labelStatus(p, domain, m[2]),
      ke: labelStatus(p, domain, m[3]),
      oleh: m[4],
    });
  });
}

// ─── Jurnal gagal diposting ──────────────────────────────────────────────────

/** Jenis dokumen dari metadata penulis `JOURNAL_PENDING` (urutan sama dengan tautannya). */
function dokumenJurnal(data: Record<string, unknown>): string {
  const kind = teks(data.kind);
  if (teks(data.docId) && kind) {
    if (["van_sale", "van_load", "van_reconcile", "supplier_payment", "supplier_payment_reversal"].includes(kind)) return kind;
    return "lain";
  }
  if (teks(data.grnId)) return kind === "reversal" ? "grn_reversal" : "grn";
  if (teks(data.receiptId)) return "fg_receipt";
  if (teks(data.opnameId)) return "opname";
  if (teks(data.salesReturnId)) return "sales_return";
  if (teks(data.orderId)) return "sales_order";
  return "lain";
}

/** Nomor dokumen yang hanya tersimpan di kalimatnya (opname, penjualan marketplace). */
function nomorJurnal(item: ButirLonceng): string | null {
  return (
    /^Opname (.+): journal not posted$/.exec(item.title)?.[1] ??
    /journal for (\S+) could not be posted/.exec(item.body)?.[1] ??
    null
  );
}

function sebabJurnal(p: Penerjemah, data: Record<string, unknown>): string | null {
  const kunci = kunciSebab(teks(data.reason));
  if (kunci === "UNMAPPED_ROLE") {
    const peran = teks(data.role);
    const label = peran ? coba(p, `financeAccountMapping.role.${peran}`) : null;
    return label
      ? coba(p, "financeJournals.tertunda.sebab.UNMAPPED_ROLE", { peran: label })
      : coba(p, "financeJournals.tertunda.sebab.UNMAPPED_ROLE_TANPA_PERAN");
  }
  return coba(p, `financeJournals.tertunda.sebab.${kunci}`);
}

function jurnalTertunda(item: ButirLonceng, p: Penerjemah, data: Record<string, unknown>): Hasil {
  return jenisTetap(item, p, () => {
    const dokumen = coba(p, `${AKAR}.JOURNAL_PENDING.dokumen.${dokumenJurnal(data)}`);
    const sebab = sebabJurnal(p, data);
    if (!dokumen || !sebab) return null;
    const nomor = nomorJurnal(item);
    return nomor
      ? coba(p, `${AKAR}.JOURNAL_PENDING.isiNomor`, { dokumen, nomor, sebab })
      : coba(p, `${AKAR}.JOURNAL_PENDING.isi`, { dokumen, sebab });
  });
}

// ─── Pesanan lapangan menunggu persetujuan ───────────────────────────────────

function pesananMenunggu(item: ButirLonceng, p: Penerjemah, data: Record<string, unknown>): Hasil {
  const konsi = data.orderType === "KONSI" || /^Konsi transfer /.test(item.title);
  const nomor = teks(data.orderNo) ?? /^(?:Putus order|Konsi transfer) (\S+) awaiting approval$/.exec(item.title)?.[1] ?? null;
  if (!nomor) return { judul: item.title, isi: item.body };
  const judul = coba(p, `${AKAR}.PENDING_ORDER_APPROVAL.${konsi ? "judulKonsi" : "judulPutus"}`, { nomor }) ?? item.title;

  let isi: string | null;
  if (konsi) {
    // Transfer konsinyasi tidak pernah menyebut rupiah.
    isi = coba(p, `${AKAR}.PENDING_ORDER_APPROVAL.isiKonsi`, { nomor });
  } else {
    const angka = Number(teks(data.total) ?? /\(total ([\d.]+)\)/.exec(item.body)?.[1] ?? Number.NaN);
    isi = Number.isFinite(angka)
      ? coba(p, `${AKAR}.PENDING_ORDER_APPROVAL.isiPutus`, { nomor, total: p.rupiah(angka) })
      : null;
  }
  if (!isi) return { judul, isi: item.body };

  const tambahan: (string | null)[] = [];
  if (data.kreditDitahan === "true" || data.kreditDitahan === true || /Credit on hold/.test(item.body)) {
    tambahan.push(coba(p, `${AKAR}.PENDING_ORDER_APPROVAL.kredit`));
  }
  const saluran = teks(data.remoteChannel) ?? /Remote order \(([^)]+)\)/.exec(item.body)?.[1] ?? null;
  if (saluran) tambahan.push(coba(p, `${AKAR}.PENDING_ORDER_APPROVAL.jarakJauh`, { saluran }));
  const inden = /Pre-order \(([^)]+)\)/.exec(item.body)?.[1];
  if (inden) tambahan.push(coba(p, `${AKAR}.PENDING_ORDER_APPROVAL.inden`, { jendela: inden }));
  const ganti = /Replaces (\S+), which the salesman cancelled/.exec(item.body)?.[1];
  if (ganti) tambahan.push(coba(p, `${AKAR}.PENDING_ORDER_APPROVAL.ganti`, { lama: ganti }));

  return { judul, isi: [isi, ...tambahan.filter((x): x is string => x !== null)].join(" ") };
}

/**
 * Teks yang ditampilkan untuk satu notifikasi. Murni.
 */
export function tampilanLonceng(item: ButirLonceng, p: Penerjemah): Hasil {
  const data = bacaDataNotifikasi(item.data);
  switch (item.type) {
    case "TEST":
      return {
        judul: coba(p, "notifications.testTitle") ?? item.title,
        isi: coba(p, "notifications.testBody") ?? item.body,
      };
    case "PO_OVERDUE":
      return polaOleh(item, p, /^(.+) \((.*)\) – ETA has passed$/, ["dokumen", "pemasok"]);
    case "WO_OVERDUE":
      return polaOleh(item, p, /^(.+) \((.*)\) – target date has passed$/, ["dokumen", "vendor"]);
    case "MATERIAL_ARRIVED":
      // Isinya sudah berbahasa Indonesia sejak ditulis.
      return jenisTetap(item, p, () => null);
    case "ACCESSORIES_PENDING_CMT":
      return jenisTetap(item, p, () => {
        const jumlah = Number(teks(data.woCount) ?? data.woCount);
        return Number.isFinite(jumlah) && jumlah > 0 ? coba(p, `${AKAR}.ACCESSORIES_PENDING_CMT.isi`, { jumlah }) : null;
      });
    case "WO_COMPLETED":
      return jenisTetap(item, p, () => {
        const m = /^(.+?) – (.+) completed(?: by (.+))?$/.exec(item.body);
        if (!m) return null;
        return m[3]
          ? coba(p, `${AKAR}.WO_COMPLETED.isiOleh`, { dokumen: m[1], barang: m[2], oleh: m[3] })
          : coba(p, `${AKAR}.WO_COMPLETED.isi`, { dokumen: m[1], barang: m[2] });
      });
    case "SUPPLIER_CREATED":
      return polaOleh(item, p, /^(.+) created by (.+)$/, ["nama", "oleh"]);
    case "SUPPLIER_APPROVED":
      return polaOleh(item, p, /^(.+) approved by (.+)$/, ["nama", "oleh"]);
    case "ITEM_CREATED":
      return polaOleh(item, p, /^(.+) added by (.+)$/, ["nama", "oleh"]);
    case "PO_CREATED":
      return polaOleh(item, p, /^PO (.+) created by (.+)$/, ["dokumen", "oleh"]);
    case "PO_PAYMENT_TOGGLED":
      return jenisTetap(item, p, () => {
        const m = /^PO (.+) marked (paid|unpaid) by (.+)$/.exec(item.body);
        if (!m) return null;
        return coba(p, `${AKAR}.PO_PAYMENT_TOGGLED.${m[2] === "paid" ? "isiLunas" : "isiBelumLunas"}`, {
          dokumen: m[1],
          oleh: m[3],
        });
      });
    case "PO_STATUS_UPDATED":
      return statusBerubah(item, p, "PO", "purchaseOrder");
    case "GRN_CREATED":
      return polaOleh(item, p, /^GRN (.+) created by (.+)$/, ["dokumen", "oleh"]);
    case "STOCK_ADJUSTMENT_CREATED":
      return polaOleh(item, p, /^Stock adjustment (.+) created by (.+)$/, ["dokumen", "oleh"]);
    case "WO_CREATED":
      return polaOleh(item, p, /^WO (.+) created by (.+)$/, ["dokumen", "oleh"]);
    case "WO_STATUS_UPDATED":
      return statusBerubah(item, p, "WO", "workOrder");
    case "WO_MATERIALS_ISSUED":
      return polaOleh(item, p, /^Materials issued for WO (.+) by (.+)$/, ["dokumen", "oleh"]);
    case "VENDOR_RETURN_CREATED":
      return polaOleh(item, p, /^Vendor return (.+) created by (.+)$/, ["dokumen", "oleh"]);
    case "VENDOR_RETURN_STATUS_UPDATED":
      return statusBerubah(item, p, "Vendor return", "vendorReturn");
    case "DOC_NUMBER_ALTERED":
      return polaOleh(item, p, /^Doc number config for (.+) updated by (.+)$/, ["jenis", "oleh"]);
    case "JOURNAL_PENDING":
      return jurnalTertunda(item, p, data);
    case "PENDING_ORDER_APPROVAL":
      return pesananMenunggu(item, p, data);
    case "STORE_CHANGE_REQUEST":
      return jenisTetap(item, p, () => {
        const toko = /^Store data change for (.+) awaiting approval$/.exec(item.title)?.[1];
        return toko ? coba(p, `${AKAR}.STORE_CHANGE_REQUEST.isi`, { toko }) : null;
      });
    default:
      return { judul: item.title, isi: item.body };
  }
}
