"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { BellRing, Store, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { TautanTerkaitSpg } from "./TautanTerkaitSpg";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDisplayDate } from "@/lib/date-only";
import { dinamis } from "@/lib/i18n/dinamis";
import { formatIDR } from "@/lib/sales-orders/format";
import type { DataMemberKantor, DataPelangganToko, DataRingkasPelanggan } from "@/lib/spg/pelanggan-kantor";
import { PERIODE_BAWAAN_HARI, type SaringMember, type SaringStatusMember, type StatusPelanggan } from "@/lib/spg/pelanggan-lacak";
import { STATUS_TITIP } from "@/lib/spg/titip";
import type { RingkasTitipToko } from "@/lib/spg/titip-kantor";
import { cn } from "@/lib/utils";
import { nadaStatusTitip } from "@/app/pwa/spg/titip/tampilan";
import { denganParam } from "../piutang/_daftar/halaman";
import { DaftarMemberKantor } from "./DaftarMemberKantor";
import { DaftarPelangganToko } from "./DaftarPelangganToko";
import { PilihPeriode, UbinLacak } from "./UbinLacak";

const JALUR = "/backoffice/spg-pelanggan";
type Tab = "pelanggan" | "member" | "titip";

/**
 * Pelanggan, member & titip pesan SPG di kantor. Nomor HP pembeli selalu
 * disamarkan — yang menghubungi pembeli adalah SPG tokonya, dari HP-nya.
 */
export function PelangganKantorClient({
  tab,
  bolehAturMember,
  periodeHari,
  cari,
  saring,
  ringkas,
  perToko,
  member,
  titip,
}: {
  tab: Tab;
  /** `promos:manage` — menonaktifkan / mengaktifkan member. */
  bolehAturMember: boolean;
  periodeHari: number;
  cari: string;
  saring: { status: StatusPelanggan | null; member: SaringMember | null; statusMember: SaringStatusMember | null };
  ringkas: DataRingkasPelanggan | null;
  perToko: DataPelangganToko | null;
  member: DataMemberKantor | null;
  titip: RingkasTitipToko[];
}) {
  const t = useTranslations("spgPelanggan.kantor");
  const tt = useTranslations("spgTitip");
  const ttd = dinamis(tt);
  const locale = useLocale();
  const router = useRouter();
  const tgl = (iso: string | null) => (iso ? formatDisplayDate(iso, locale) : "—");
  const angka = new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID", { maximumFractionDigits: 1 });
  const persen = (n: number | null) => (n === null ? "—" : `${angka.format(n)}%`);
  const periode = periodeHari === PERIODE_BAWAAN_HARI ? null : String(periodeHari);

  const totalTerbuka = titip.reduce((n, r) => n + r.terbuka, 0);
  const meta =
    tab === "titip"
      ? t("ringkasTitip", { toko: titip.length, n: totalTerbuka })
      : tab === "member" && member
        ? t("ringkasMember", { aktif: member.hitung.aktif, n: member.hitung.semua })
        : perToko
          ? t("ringkasToko", { toko: perToko.toko.name, n: perToko.ringkas.pelanggan })
          : ringkas
            ? t("ringkasPelanggan", { toko: ringkas.toko.length, n: ringkas.semua.pelanggan })
            : undefined;

  return (
    <div className="space-y-6">
      <PageHeader title={t("judulMenu")} meta={meta} actions={<TautanTerkaitSpg kecuali="titip" />} />

      <Tabs value={tab} onValueChange={(v) => router.replace(v === "pelanggan" ? denganParam(JALUR, {}, { periode }) : `${JALUR}?tab=${v}`)}>
        <TabsList>
          <TabsTrigger value="pelanggan">{t("tabPelanggan")}</TabsTrigger>
          <TabsTrigger value="member">{t("tabMember")}</TabsTrigger>
          <TabsTrigger value="titip">{t("tabTitip")}</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "pelanggan" && perToko ? (
        <DaftarPelangganToko data={perToko} periodeHari={periodeHari} cari={cari} saring={{ status: saring.status, member: saring.member }} />
      ) : tab === "pelanggan" && ringkas ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium">{t("semuaTokoPeriode", { n: periodeHari })}</p>
            <PilihPeriode periodeHari={periodeHari} />
          </div>
          <UbinLacak r={ringkas.semua} hariTidur={ringkas.hariTidur} />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Store className="h-5 w-5" />
                {t("perTokoJudul")}
              </CardTitle>
            </CardHeader>
            <CardContent className={ringkas.toko.length === 0 ? undefined : "px-0"}>
              {ringkas.toko.length === 0 ? (
                <EmptyState icon={Users} title={t("kosongJudul")} description={t("kosongIsi")} />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="[&_th]:whitespace-normal">
                      <TableRow>
                        <TableHead>{t("kolom.toko")}</TableHead>
                        <TableHead className="text-right">{t("kolom.pelanggan")}</TableHead>
                        <TableHead className="text-right">{t("kolom.member")}</TableHead>
                        <TableHead className="text-right">{t("kolom.cakupan")}</TableHead>
                        <TableHead className="text-right">{t("kolom.kembali")}</TableHead>
                        <TableHead className="text-right">{t("kolom.baru")}</TableHead>
                        <TableHead className="text-right">{t("kolom.tidur")}</TableHead>
                        <TableHead className="text-right">{t("kolom.belanjaPeriode")}</TableHead>
                        <TableHead className="hidden 2xl:table-cell">{t("kolom.belanjaTerakhir")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ringkas.toko.map((r) => (
                        <TableRow key={r.storeId}>
                          <TableCell className="min-w-[12rem] whitespace-normal">
                            <Link
                              href={denganParam(JALUR, {}, { toko: r.storeId, periode })}
                              className="font-medium underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground"
                            >
                              {r.toko}
                            </Link>
                            {r.kode ? <span className="block text-xs text-muted-foreground">{r.kode}</span> : null}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{r.pelanggan}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.member}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {persen(r.cakupanPersen)}
                            <span className="block text-xs text-muted-foreground">{t("dariNota", { ada: r.notaBerpembeli, nota: r.notaPeriode })}</span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{persen(r.kembaliPersen)}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.baru}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {r.tidur > 0 ? (
                              <Link
                                href={denganParam(JALUR, {}, { toko: r.storeId, periode, status: "TIDUR" })}
                                className="underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground"
                              >
                                {r.tidur}
                              </Link>
                            ) : (
                              0
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatIDR(r.belanjaPeriode)}</TableCell>
                          <TableCell className="hidden 2xl:table-cell">{tgl(r.belanjaTerakhir)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : tab === "member" && member ? (
        <DaftarMemberKantor data={member} cari={cari} status={saring.statusMember} bolehAtur={bolehAturMember} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BellRing className="h-5 w-5" />
              {t("titipJudul")}
            </CardTitle>
          </CardHeader>
          <CardContent className={titip.length === 0 ? undefined : "px-0"}>
            {titip.length === 0 ? (
              <EmptyState icon={BellRing} title={t("titipKosongJudul")} description={t("titipKosongIsi")} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("kolom.toko")}</TableHead>
                      {STATUS_TITIP.map((s) => (
                        <TableHead key={s} className="text-right">
                          {ttd(`status.${s}`)}
                        </TableHead>
                      ))}
                      <TableHead>{t("kolom.menungguTertua")}</TableHead>
                      <TableHead>{t("kolom.palingSering")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {titip.map((r) => (
                      <TableRow key={r.storeId} className={cn(r.perStatus.TERSEDIA > 0 && "bg-amber-500/[0.05]")}>
                        <TableCell className="min-w-[12rem] whitespace-normal">
                          <span className="font-medium">{r.toko}</span>
                          {r.kode ? <span className="block text-xs text-muted-foreground">{r.kode}</span> : null}
                        </TableCell>
                        {STATUS_TITIP.map((s) => (
                          <TableCell key={s} className="text-right tabular-nums">
                            {r.perStatus[s] > 0 ? (
                              <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", nadaStatusTitip(s))}>{r.perStatus[s]}</span>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </TableCell>
                        ))}
                        <TableCell>{tgl(r.menungguTertua)}</TableCell>
                        <TableCell className="min-w-[12rem] whitespace-normal">
                          {r.palingSering ? (
                            <>
                              <span>{r.palingSering.label}</span>
                              <span className="block text-xs text-muted-foreground">
                                {r.palingSering.katalog ? t("palingSeringKatalog", { n: r.palingSering.jumlah }) : t("palingSeringBebas", { n: r.palingSering.jumlah })}
                              </span>
                            </>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
