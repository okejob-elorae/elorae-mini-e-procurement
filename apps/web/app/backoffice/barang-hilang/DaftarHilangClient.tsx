"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PackageX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dinamis } from "@/lib/i18n/dinamis";
import { STATUS_HILANG, SUMBER_HILANG, type StatusHilang, type SumberHilang } from "@/lib/spg/hilang";
import type { DaftarHilangKantor } from "@/lib/spg/hilang-queries";
import { formatIDR } from "@/lib/sales-orders/format";
import { cn } from "@/lib/utils";
import { CatatHilangDialog } from "./CatatHilangDialog";
import { nadaPenanggung, nadaStatusHilang } from "./tampilan";

const SEMUA = "__semua__";

export function DaftarHilangClient({
  status,
  sumber,
  storeId,
  data,
  bolehKelola,
  tokoAktif,
}: {
  status: StatusHilang | null;
  sumber: SumberHilang | null;
  storeId: string | null;
  data: DaftarHilangKantor;
  bolehKelola: boolean;
  tokoAktif: { id: string; name: string }[];
}) {
  const t = useTranslations("barangHilang");
  const td = dinamis(t);
  const router = useRouter();

  // Semua kunci saringan ditulis dalam SATU navigasi — dua dorongan berurutan saling menimpa.
  const pindah = (ubah: { status?: string | null; sumber?: string | null; toko?: string | null }) => {
    const q = new URLSearchParams();
    const s = ubah.status !== undefined ? ubah.status : status;
    const sb = ubah.sumber !== undefined ? ubah.sumber : sumber;
    const tk = ubah.toko !== undefined ? ubah.toko : storeId;
    if (s) q.set("status", s);
    if (sb) q.set("sumber", sb);
    if (tk) q.set("toko", tk);
    const qs = q.toString();
    router.replace(qs ? `/backoffice/barang-hilang?${qs}` : "/backoffice/barang-hilang");
  };

  const disaring = status !== null || sumber !== null || storeId !== null;
  const tokoPilihan = storeId && !data.toko.some((x) => x.id === storeId) ? [...data.toko, { id: storeId, name: storeId }] : data.toko;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("kantor.judul")}
        meta={t("kantor.ringkas", { terbuka: data.perStatus.TERBUKA, ditetapkan: data.perStatus.DITETAPKAN })}
        actions={bolehKelola ? <CatatHilangDialog toko={tokoAktif} /> : null}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Select value={status ?? SEMUA} onValueChange={(v) => pindah({ status: v === SEMUA ? null : v })}>
          <SelectTrigger className="w-full sm:w-48" aria-label={t("kantor.saringStatus")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA}>{t("kantor.semuaStatus")}</SelectItem>
            {STATUS_HILANG.map((s) => (
              <SelectItem key={s} value={s}>
                {td(`status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sumber ?? SEMUA} onValueChange={(v) => pindah({ sumber: v === SEMUA ? null : v })}>
          <SelectTrigger className="w-full sm:w-52" aria-label={t("kantor.saringSumber")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA}>{t("kantor.semuaSumber")}</SelectItem>
            {SUMBER_HILANG.map((s) => (
              <SelectItem key={s} value={s}>
                {td(`sumber.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={storeId ?? SEMUA} onValueChange={(v) => pindah({ toko: v === SEMUA ? null : v })}>
          <SelectTrigger className="w-full sm:w-64" aria-label={t("kantor.saringToko")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA}>{t("kantor.semuaToko")}</SelectItem>
            {tokoPilihan.map((x) => (
              <SelectItem key={x.id} value={x.id}>
                {x.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STATUS_HILANG.map((s) => (
          <Button
            key={s}
            variant="outline"
            aria-pressed={status === s}
            onClick={() => pindah({ status: status === s ? null : s })}
            className={cn("h-auto flex-col items-start gap-0.5 whitespace-normal px-4 py-3 text-left", status === s && "border-primary ring-1 ring-primary")}
          >
            <span className="text-xs font-normal text-muted-foreground">{td(`status.${s}`)}</span>
            <span className="text-lg font-semibold tabular-nums">{data.perStatus[s]}</span>
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackageX className="h-5 w-5" />
            {t("kantor.daftarJudul")}
          </CardTitle>
        </CardHeader>
        <CardContent className={data.baris.length === 0 ? undefined : "px-0"}>
          {data.baris.length === 0 ? (
            <EmptyState
              icon={PackageX}
              title={disaring ? t("kantor.kosongSaringJudul") : t("kantor.kosongJudul")}
              description={disaring ? t("kantor.kosongSaringIsi") : t("kantor.kosongIsi")}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kantor.kolom.dibuka")}</TableHead>
                    <TableHead>{t("kantor.kolom.sumber")}</TableHead>
                    <TableHead>{t("kantor.kolom.toko")}</TableHead>
                    <TableHead className="text-right">{t("kantor.kolom.barang")}</TableHead>
                    <TableHead className="text-right">{t("kantor.kolom.nilai")}</TableHead>
                    <TableHead>{t("kantor.kolom.penanggung")}</TableHead>
                    <TableHead>{t("kantor.kolom.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.baris.map((b) => (
                    <TableRow key={b.id} className={cn(b.status === "TERBUKA" && "bg-amber-500/[0.05]")}>
                      <TableCell>
                        <Link href={`/backoffice/barang-hilang/${b.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                          {b.dibuat}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{t("umur", { hari: b.umurHari })}</span>
                      </TableCell>
                      <TableCell className="min-w-[10rem] whitespace-normal">
                        <span className="block">{td(`sumber.${b.sumber}`)}</span>
                        {b.sourceDocNo ? <span className="block text-xs text-muted-foreground">{b.sourceDocNo}</span> : null}
                      </TableCell>
                      <TableCell className="min-w-[10rem] whitespace-normal">{b.toko ?? <span className="text-muted-foreground">{t("tanpaToko")}</span>}</TableCell>
                      <TableCell className="text-right tabular-nums">{t("pcs", { n: b.totalQty })}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatIDR(b.nilai)}
                        {b.status === "DITETAPKAN" && b.sisaTerbuka > 0 ? (
                          <span className="block text-xs text-muted-foreground">{t("kantor.sisaTerbuka", { nilai: formatIDR(b.sisaTerbuka) })}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="min-w-[8rem] whitespace-normal">
                        {b.penanggung.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {b.penanggung.map((p) => (
                              <span key={p} className={cn("rounded-full px-2 py-0.5 text-xs font-medium", nadaPenanggung(p))}>
                                {td(`penanggung.${p}`)}
                              </span>
                            ))}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", nadaStatusHilang(b.status))}>{td(`status.${b.status}`)}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {data.dibatasi ? <p className="px-6 pt-4 text-xs text-muted-foreground">{t("kantor.dibatasi")}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
