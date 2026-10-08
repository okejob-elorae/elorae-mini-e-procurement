import { parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { getAccountBalances } from "./balances";
import { listAccountSections } from "./cash-flow-queries";
import { resolveCashFlowSection } from "./cash-flow-classify";
import { buildIncomeStatement } from "./income-statement";
import { jumlahHari, periodeBanding, type RentangTanggal } from "./periode-banding";
import { hitungRasio, ringkasPosisiRasio, type HasilRasio, type KelasAkunRasio } from "./rasio";

export type LaporanRasio = {
  periode: RentangTanggal;
  sebelumnya: RentangTanggal;
  ini: HasilRasio;
  lalu: HasilRasio;
};

async function rasioUntuk(rentang: RentangTanggal, kelas: ReadonlyMap<string, KelasAkunRasio>): Promise<HasilRasio> {
  const from = parseDateOnly(rentang.dari)!;
  const to = parseDateOnlyEnd(rentang.sampai)!;
  /* Akun neraca tidak disentuh jurnal penutup tahun, jadi bacaan bawaan cukup. */
  const [periode, akhir, awal] = await Promise.all([
    getAccountBalances({ from, to }),
    getAccountBalances({ to }),
    getAccountBalances({ to: new Date(from.getTime() - 1) }),
  ]);
  const lr = buildIncomeStatement(periode);
  return hitungRasio({
    labaRugi: { pendapatan: lr.totalPendapatan, hpp: lr.totalHpp, labaKotor: lr.labaKotor, labaBersih: lr.labaBersih },
    awal: ringkasPosisiRasio(awal, kelas),
    akhir: ringkasPosisiRasio(akhir, kelas),
    hari: jumlahHari(rentang.dari, rentang.sampai),
  });
}

/**
 * Rasio keuangan periode ini dan periode sebelumnya (aturan pembanding
 * `periodeBanding`). Golongan lancar dari Klasifikasi Arus Kas + peran posting
 * (`rasio.ts`).
 */
export async function muatRasio(periode: RentangTanggal): Promise<LaporanRasio> {
  const seksi = await listAccountSections();
  const kelas = new Map<string, KelasAkunRasio>(
    seksi.map((s) => [
      s.accountId,
      {
        accountId: s.accountId,
        type: s.type,
        section: resolveCashFlowSection({ type: s.type, override: s.override, roles: s.roles }),
        roles: s.roles,
      },
    ]),
  );
  const { sebelumnya } = periodeBanding(periode.dari, periode.sampai);
  const [ini, lalu] = await Promise.all([rasioUntuk(periode, kelas), rasioUntuk(sebelumnya, kelas)]);
  return { periode, sebelumnya, ini, lalu };
}
