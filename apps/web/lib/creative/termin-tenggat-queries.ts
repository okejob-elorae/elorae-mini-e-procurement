import type { Prisma } from "@elorae/db";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { nilaiBasis, type PemicuTermin, type StatusTermin } from "./termin-aturan";
import type { TerminTenggat } from "./tenggat";

/*
 * Termin pembayaran sebagai bahan tenggat (Hari ini, Kalender, Kolaborasi).
 * Jatuh tempo TIDAK dibaca dari kolom `jatuhTempo` kecuali pemicu TANGGAL —
 * diturunkan dari pemicunya oleh `tenggatKolaborasi`, sama dengan layar
 * Pembayaran (`termin-queries.ts`), supaya tanggal tayang yang baru tercatat
 * langsung menggeser jatuh tempo tanpa menunggu termin disentuh.
 */

export const PILIH_TERMIN_TENGGAT = {
  id: true,
  status: true,
  pemicu: true,
  hariSesudah: true,
  jatuhTempo: true,
  bruto: true,
  neto: true,
  grossUp: true,
} satisfies Prisma.KolPaymentTermSelect;

type BarisTermin = Prisma.KolPaymentTermGetPayload<{ select: typeof PILIH_TERMIN_TENGGAT }>;

/** Termin + jumlahnya dalam basis fee (neto untuk gross-up, bruto untuk dipotong). */
export type TerminTenggatJumlah = TerminTenggat & { jumlah: number };

export function keTerminTenggat(t: BarisTermin): TerminTenggatJumlah {
  return {
    id: t.id,
    status: t.status as StatusTermin,
    pemicu: t.pemicu as PemicuTermin,
    hariSesudah: t.hariSesudah,
    tanggal: t.pemicu === "TANGGAL" && t.jatuhTempo ? formatDateOnlyJakarta(t.jatuhTempo) : null,
    jumlah: nilaiBasis({ bruto: Number(t.bruto), neto: Number(t.neto), grossUp: t.grossUp }),
  };
}
