"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Check, Loader2, Package, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { hapusPengirimanAction, tandaiDiterimaAction } from "@/app/actions/kreatif-sampel";
import { formatDisplayDate } from "@/lib/date-only";
import { rupiahTeks } from "@/lib/creative/angka-konten";
import type { DataPanelPengiriman, PengirimanPanel } from "@/lib/creative/sampel-queries";
import { dinamis } from "@/lib/i18n/dinamis";
import { DaftarKurir } from "./DaftarKurir";
import { DialogPengiriman } from "./DialogPengiriman";
import { PeringatanKirimDobel } from "./InfoKirim";
import { teksBaris, teksBerhasil, teksGagal } from "./isian-pengiriman";

type Props = { data: DataPanelPengiriman; bolehMengelola: boolean };

/**
 * Tab Pengiriman di detail kolaborasi: setiap paket sampel dengan barang per
 * varian, kurir, resi, tanggal kirim/terima, ongkir, dan HPP yang disalin
 * saat berangkat. Paling banyak satu rencana pengiriman yang belum berangkat —
 * "Tambah pengiriman" muncul lagi begitu paket itu berangkat.
 */
export function PanelPengirimanClient({ data, bolehMengelola }: Props) {
  const t = useTranslations("kreatifRuang");
  const td = dinamis(t);
  const locale = useLocale();
  const router = useRouter();
  const [dialog, setDialog] = useState<{ pengiriman: PengirimanPanel | null } | null>(null);
  const [hapus, setHapus] = useState<PengirimanPanel | null>(null);
  const [menghapus, mulaiHapus] = useTransition();

  const adaBelumBerangkat = data.pengiriman.some((p) => p.keadaan === "BELUM_BERANGKAT");
  const totalOngkir = data.pengiriman.filter((p) => p.keadaan !== "BELUM_BERANGKAT").reduce((s, p) => s + p.shippingCost, 0);
  const totalHpp = data.pengiriman.reduce((s, p) => s + p.totalHpp, 0);

  const segarkan = () => router.refresh();

  const jalankanHapus = () => {
    if (!hapus) return;
    mulaiHapus(async () => {
      const r = await hapusPengirimanAction({ pengirimanId: hapus.id });
      setHapus(null);
      if (!r.ok) {
        toast.error(teksGagal(td, r));
        return;
      }
      toast.success(teksBerhasil(td, "hapus", r));
      segarkan();
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" aria-hidden />
          {t("sampel.panel.judul")}
        </CardTitle>
        {bolehMengelola && !adaBelumBerangkat ? (
          <Button size="sm" onClick={() => setDialog({ pengiriman: null })}>
            <Plus className="h-4 w-4" aria-hidden />
            {t("sampel.panel.tambah")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <DaftarKurir />
        {data.dobel.length > 0 ? <PeringatanKirimDobel dobel={data.dobel} rinci /> : null}

        {data.rencana.length > 0 ? (
          <div className="text-sm">
            <span className="text-muted-foreground">{t("sampel.panel.rencana")}: </span>
            {data.rencana.map((b) => teksBaris(b)).join(", ")}
          </div>
        ) : null}

        {data.pengiriman.length === 0 ? (
          <EmptyState
            icon={Package}
            title={t("sampel.panel.kosong")}
            action={
              bolehMengelola ? (
                <Button variant="outline" onClick={() => setDialog({ pengiriman: null })}>
                  <Plus className="h-4 w-4" aria-hidden />
                  {t("sampel.panel.tambah")}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[180px]">{t("sampel.kolom.barang")}</TableHead>
                  <TableHead>{t("sampel.kurir")}</TableHead>
                  <TableHead className="min-w-[120px]">{t("sampel.resi")}</TableHead>
                  <TableHead>{t("sampel.panel.kirim")}</TableHead>
                  <TableHead className="min-w-[150px]">{t("sampel.panel.terima")}</TableHead>
                  <TableHead className="text-right">{t("sampel.ongkir")}</TableHead>
                  <TableHead className="text-right">{t("sampel.panel.hpp")}</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">{t("sampel.kolom.aksi")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.pengiriman.map((p) => (
                  <BarisPanel
                    key={p.id}
                    p={p}
                    hariIni={data.hariIni}
                    locale={locale}
                    bolehMengelola={bolehMengelola}
                    onUbah={() => setDialog({ pengiriman: p })}
                    onHapus={() => setHapus(p)}
                    onSelesai={segarkan}
                  />
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={5} className="text-right text-sm font-medium">
                    {t("sampel.panel.total")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{rupiahTeks(totalOngkir)}</TableCell>
                  <TableCell className="text-right tabular-nums">{rupiahTeks(totalHpp)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </CardContent>

      {dialog ? (
        <DialogPengiriman
          kolaborasiId={data.kolaborasi.id}
          keterangan={`${data.kolaborasi.docNo} · ${data.kolaborasi.kol.handle ? `@${data.kolaborasi.kol.handle}` : data.kolaborasi.kol.nama}`}
          pengiriman={dialog.pengiriman}
          rencana={data.rencana}
          varianAwal={data.varianBarang}
          hariIni={data.hariIni}
          onTutup={() => setDialog(null)}
          onTersimpan={() => {
            setDialog(null);
            segarkan();
          }}
        />
      ) : null}

      <AlertDialog open={hapus !== null} onOpenChange={(v) => (!v && !menghapus ? setHapus(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("sampel.panel.hapusJudul")}</AlertDialogTitle>
            <AlertDialogDescription>{t("sampel.panel.hapusIsi")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={menghapus}>{t("sampel.panel.batal")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={menghapus}
              onClick={(e) => {
                e.preventDefault();
                jalankanHapus();
              }}
            >
              {menghapus ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("sampel.panel.hapus")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function BarisPanel({
  p,
  hariIni,
  locale,
  bolehMengelola,
  onUbah,
  onHapus,
  onSelesai,
}: {
  p: PengirimanPanel;
  hariIni: string;
  locale: string;
  bolehMengelola: boolean;
  onUbah: () => void;
  onHapus: () => void;
  onSelesai: () => void;
}) {
  const t = useTranslations("kreatifRuang");
  const td = dinamis(t);
  const [terima, setTerima] = useState(hariIni);
  const [menyimpan, mulaiSimpan] = useTransition();
  const belum = p.keadaan === "BELUM_BERANGKAT";

  const tandai = () =>
    mulaiSimpan(async () => {
      const r = await tandaiDiterimaAction({ pengirimanId: p.id, receivedAt: terima });
      if (!r.ok) {
        toast.error(teksGagal(td, r));
        return;
      }
      toast.success(teksBerhasil(td, "terima", r));
      onSelesai();
    });

  return (
    <TableRow>
      <TableCell className="align-top whitespace-normal">
        <ul className="space-y-0.5 text-sm">
          {p.baris.map((b, i) => (
            <li key={`${b.itemId}-${b.variantSku ?? ""}-${i}`} className="break-words">
              {teksBaris(b)}
            </li>
          ))}
        </ul>
        {belum ? (
          <div className="mt-1">
            <StatusPill tone="inactive">{t("sampel.panel.keadaan.BELUM_BERANGKAT")}</StatusPill>
          </div>
        ) : null}
        {p.note ? <p className="mt-1 text-xs text-muted-foreground">{p.note}</p> : null}
      </TableCell>
      <TableCell className="align-top text-sm">{p.courier ?? "—"}</TableCell>
      <TableCell className="align-top text-sm">
        {p.tanpaResi ? (
          <span className="text-muted-foreground italic">{t("sampel.tanpaResiTeks")}</span>
        ) : p.trackingNo ? (
          <span className="font-mono text-xs break-all">{p.trackingNo}</span>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell className="align-top text-sm whitespace-nowrap">{p.sentAt ? formatDisplayDate(p.sentAt, locale) : "—"}</TableCell>
      <TableCell className="align-top text-sm">
        {p.receivedAt ? (
          <span className="whitespace-nowrap">{formatDisplayDate(p.receivedAt, locale)}</span>
        ) : belum ? (
          "—"
        ) : bolehMengelola ? (
          <div className="flex items-center gap-1.5">
            <TanggalInput
              value={terima}
              onChange={(e) => setTerima(e.target.value)}
              min={p.sentAt ?? undefined}
              max={hariIni}
              required
              aria-label={t("sampel.tanggalTerima")}
              className="h-8 w-36"
              disabled={menyimpan}
            />
            <Button
              type="button"
              size="icon"
              className="h-8 w-8 shrink-0"
              aria-label={t("sampel.tandaiTerima")}
              title={t("sampel.tandaiTerima")}
              onClick={tandai}
              disabled={menyimpan}
            >
              {menyimpan ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
            </Button>
          </div>
        ) : (
          <StatusPill tone="waiting">{t("sampel.panel.jalan")}</StatusPill>
        )}
      </TableCell>
      <TableCell className="text-right align-top tabular-nums">{rupiahTeks(p.shippingCost)}</TableCell>
      <TableCell className="text-right align-top tabular-nums">{belum ? "—" : rupiahTeks(p.totalHpp)}</TableCell>
      <TableCell className="text-right align-top">
        {bolehMengelola ? (
          <div className="flex justify-end gap-1">
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={t("sampel.panel.ubah")} title={t("sampel.panel.ubah")} onClick={onUbah}>
              <Pencil className="h-4 w-4" aria-hidden />
            </Button>
            {belum ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive"
                aria-label={t("sampel.panel.hapus")}
                title={t("sampel.panel.hapus")}
                onClick={onHapus}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            ) : null}
          </div>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
