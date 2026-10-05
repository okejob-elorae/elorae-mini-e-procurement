"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { History, Loader2, PackageX } from "lucide-react";
import { putuskanGudangRusakAction } from "@/app/actions/gudang-rusak";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatRupiah } from "@/lib/format/rupiah";
import { dinamis } from "@/lib/i18n/dinamis";
import {
  BATAS_CATATAN_GUDANG_RUSAK,
  KEPUTUSAN_GUDANG_RUSAK,
  type AsalRusak,
  type JenisGerakRusak,
  type KeputusanGudangRusak,
} from "@/lib/spg/gudang-rusak";
import type { AsalMasuk, SaldoGudangRusak } from "@/lib/spg/gudang-rusak-queries";
import { cn } from "@/lib/utils";

export type GerakTampil = {
  id: string;
  /** Sudah diformat di server (WIB). */
  waktu: string;
  productName: string;
  variantSku: string;
  jenis: JenisGerakRusak | null;
  qty: number;
  nilai: number | null;
  catatan: string | null;
  oleh: string;
  masuk: AsalMasuk | null;
  penyesuaian: string | null;
};

const NADA_JENIS: Record<JenisGerakRusak, string> = {
  MASUK_RETUR: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  PERBAIKI: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  JUAL_OBRAL: "bg-primary/15 text-foreground",
  MUSNAHKAN: "bg-muted text-muted-foreground",
};

/**
 * Gudang barang rusak — kantor. Tab "Saldo" (barang yang masih di gudang
 * barang rusak, dengan asalnya) dan "Riwayat" (gerakan terakhir). Tombol
 * putuskan hanya untuk `inventory:manage`; server memeriksa ulang.
 */
export function GudangRusakClient({
  tab,
  bolehPutuskan,
  saldo,
  riwayat,
}: {
  tab: "saldo" | "riwayat";
  bolehPutuskan: boolean;
  saldo: SaldoGudangRusak[];
  riwayat: GerakTampil[];
}) {
  const t = useTranslations("gudangRusak");
  const td = dinamis(t);
  const router = useRouter();
  const [dipilih, setDipilih] = useState<SaldoGudangRusak | null>(null);

  const pcs = saldo.reduce((n, b) => n + Math.max(0, b.saldo), 0);
  const pindahTab = (ke: "saldo" | "riwayat") =>
    router.replace(ke === "riwayat" ? "/backoffice/gudang-rusak?tab=riwayat" : "/backoffice/gudang-rusak");
  const teksAsal = (asal: AsalRusak[]) => asal.map((a) => td(`asal.${a}`)).join(", ");

  return (
    <div className="space-y-6">
      <PageHeader title={t("kantor.judul")} meta={t("kantor.ringkas", { baris: saldo.length, pcs })} />

      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("kantor.judul")}>
        <Button role="tab" aria-selected={tab === "saldo"} variant={tab === "saldo" ? "default" : "outline"} onClick={() => pindahTab("saldo")}>
          {t("kantor.tabSaldo", { n: saldo.length })}
        </Button>
        <Button role="tab" aria-selected={tab === "riwayat"} variant={tab === "riwayat" ? "default" : "outline"} onClick={() => pindahTab("riwayat")}>
          {t("kantor.tabRiwayat")}
        </Button>
      </div>

      {!bolehPutuskan && tab === "saldo" && saldo.length > 0 ? <p className="text-sm text-muted-foreground">{t("kantor.hanyaLihat")}</p> : null}

      {tab === "saldo" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PackageX className="h-5 w-5" />
              {t("kantor.judulSaldo")}
            </CardTitle>
          </CardHeader>
          <CardContent className={saldo.length === 0 ? undefined : "px-0"}>
            {saldo.length === 0 ? (
              <EmptyState icon={PackageX} title={t("kantor.kosongSaldoJudul")} description={t("kantor.kosongSaldoIsi")} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("kantor.kolom.barang")}</TableHead>
                      <TableHead className="text-right">{t("kantor.kolom.saldo")}</TableHead>
                      <TableHead className="text-right">{t("kantor.kolom.masukKeluar")}</TableHead>
                      <TableHead>{t("kantor.kolom.asal")}</TableHead>
                      <TableHead>{t("kantor.kolom.aksi")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {saldo.map((b) => (
                      <TableRow key={b.kunci}>
                        <TableCell className="min-w-[14rem] whitespace-normal">
                          <span className="block font-medium">{b.productName}</span>
                          <span className="block text-xs text-muted-foreground">{b.sku}</span>
                        </TableCell>
                        <TableCell className={cn("text-right font-semibold tabular-nums", b.saldo < 0 && "text-destructive")}>{b.saldo}</TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                          {t("kantor.masukKeluar", { masuk: b.masuk, keluar: b.keluar })}
                        </TableCell>
                        <TableCell className="min-w-[16rem] whitespace-normal text-sm">
                          {b.asal.length === 0 ? (
                            "—"
                          ) : (
                            <ul className="space-y-0.5">
                              {b.asal.map((a, i) => (
                                <li key={i}>
                                  {t("kantor.asalBaris", { toko: a.toko ?? t("kantor.tanpaToko"), asal: teksAsal(a.asal), n: a.qty })}
                                </li>
                              ))}
                            </ul>
                          )}
                        </TableCell>
                        <TableCell>
                          {bolehPutuskan && b.saldo > 0 ? (
                            <Button size="sm" onClick={() => setDipilih(b)}>
                              {t("kantor.putuskan")}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
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
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              {t("kantor.judulRiwayat")}
            </CardTitle>
          </CardHeader>
          <CardContent className={riwayat.length === 0 ? undefined : "px-0"}>
            {riwayat.length === 0 ? (
              <EmptyState icon={History} title={t("kantor.kosongRiwayatJudul")} description={t("kantor.kosongRiwayatIsi")} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("kantor.kolom.waktu")}</TableHead>
                      <TableHead>{t("kantor.kolom.barang")}</TableHead>
                      <TableHead>{t("kantor.kolom.jenis")}</TableHead>
                      <TableHead className="text-right">{t("kantor.kolom.jumlah")}</TableHead>
                      <TableHead>{t("kantor.kolom.dokumen")}</TableHead>
                      <TableHead>{t("kantor.kolom.catatan")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {riwayat.map((g) => (
                      <TableRow key={g.id}>
                        <TableCell className="min-w-[9rem] whitespace-normal text-sm">
                          <span className="block">{g.waktu}</span>
                          <span className="block text-xs text-muted-foreground">{g.oleh}</span>
                        </TableCell>
                        <TableCell className="min-w-[12rem] whitespace-normal">
                          <span className="block">{g.productName}</span>
                          {g.variantSku ? <span className="block text-xs text-muted-foreground">{g.variantSku}</span> : null}
                        </TableCell>
                        <TableCell className="min-w-[10rem] whitespace-normal">
                          {g.jenis ? (
                            <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", NADA_JENIS[g.jenis])}>{td(`jenis.${g.jenis}`)}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className={cn("text-right font-semibold tabular-nums", g.qty < 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-400")}>
                          {g.qty > 0 ? `+${g.qty}` : g.qty}
                        </TableCell>
                        <TableCell className="min-w-[12rem] whitespace-normal text-sm">
                          {g.masuk ? (
                            <span className="block space-y-0.5">
                              <span className="block">{g.masuk.toko ? t("kantor.dariNriToko", { nri: g.masuk.noNri, toko: g.masuk.toko }) : g.masuk.noNri}</span>
                              {g.masuk.noNrt ? <span className="block text-xs text-muted-foreground">{t("kantor.nrt", { nrt: g.masuk.noNrt })}</span> : null}
                              <span className="block text-xs text-muted-foreground">{teksAsal(g.masuk.asal)}</span>
                            </span>
                          ) : g.penyesuaian ? (
                            t("kantor.penyesuaian", { doc: g.penyesuaian })
                          ) : g.jenis === "JUAL_OBRAL" && g.nilai !== null ? (
                            t("kantor.nilaiObral", { nilai: formatRupiah(g.nilai) })
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="min-w-[12rem] whitespace-normal text-sm">{g.catatan ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <DialogKeputusan baris={dipilih} onTutup={() => setDipilih(null)} onSelesai={() => router.refresh()} />
    </div>
  );
}

const KODE_GALAT = new Set([
  "FORBIDDEN",
  "VALIDATION",
  "KEPUTUSAN_TIDAK_SAH",
  "JUMLAH_TIDAK_SAH",
  "CATATAN_WAJIB",
  "NILAI_TIDAK_SAH",
  "SALDO_KURANG",
  "BARANG_TIDAK_DITEMUKAN",
]);

function DialogKeputusan({
  baris,
  onTutup,
  onSelesai,
}: {
  baris: SaldoGudangRusak | null;
  onTutup: () => void;
  onSelesai: () => void;
}) {
  const t = useTranslations("gudangRusak");
  const td = dinamis(t);
  const [pending, mulai] = useTransition();
  const [keputusan, setKeputusan] = useState<KeputusanGudangRusak | null>(null);
  const [qty, setQty] = useState("");
  const [nilai, setNilai] = useState("");
  const [catatan, setCatatan] = useState("");

  const kosongkan = () => {
    setKeputusan(null);
    setQty("");
    setNilai("");
    setCatatan("");
  };
  const tutup = () => {
    if (pending) return;
    kosongkan();
    onTutup();
  };

  const saldo = baris?.saldo ?? 0;
  // Kosong = seluruh saldo (bawaan yang paling sering: satu keputusan untuk semuanya).
  const jumlah = qty.trim() === "" ? saldo : Number(qty);
  const jumlahSah = Number.isInteger(jumlah) && jumlah >= 1 && jumlah <= saldo;
  const nilaiSah = nilai.trim() === "" || (Number.isFinite(Number(nilai)) && Number(nilai) >= 0);
  const kurang = !keputusan
    ? t("kantor.dialog.kurangPilihan")
    : !jumlahSah
      ? t("kantor.dialog.kurangJumlah", { n: saldo })
      : keputusan === "JUAL_OBRAL" && !nilaiSah
        ? t("kantor.dialog.kurangNilai")
        : !catatan.trim()
          ? t("kantor.dialog.kurangCatatan")
          : null;

  const simpan = () => {
    if (!baris || !keputusan || kurang) return;
    mulai(async () => {
      let res: Awaited<ReturnType<typeof putuskanGudangRusakAction>>;
      try {
        res = await putuskanGudangRusakAction({
          itemId: baris.itemId,
          variantSku: baris.variantSku,
          keputusan,
          qty: jumlah,
          catatan: catatan.trim(),
          nilai: keputusan === "JUAL_OBRAL" && nilai.trim() !== "" ? Number(nilai) : null,
        });
      } catch {
        toast.error(t("kantor.err.GAGAL"));
        return;
      }
      if (!res.ok) {
        toast.error(td(KODE_GALAT.has(res.code) ? `kantor.err.${res.code}` : "kantor.err.GAGAL"));
        if (res.code === "SALDO_KURANG") {
          kosongkan();
          onTutup();
          onSelesai();
        }
        return;
      }
      toast.success(td(`kantor.dialog.berhasil.${keputusan}`, { n: jumlah }));
      kosongkan();
      onTutup();
      onSelesai();
    });
  };

  return (
    <Dialog open={baris !== null} onOpenChange={(v) => (v ? undefined : tutup())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("kantor.dialog.judul")}</DialogTitle>
          <DialogDescription>
            {baris ? t("kantor.dialog.isi", { barang: baris.productName, sku: baris.sku, n: baris.saldo }) : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2" role="radiogroup" aria-label={t("kantor.dialog.pilihan")}>
            {KEPUTUSAN_GUDANG_RUSAK.map((k) => (
              <Button
                key={k}
                type="button"
                role="radio"
                aria-checked={keputusan === k}
                variant="outline"
                onClick={() => setKeputusan(k)}
                disabled={pending}
                className={cn(
                  "h-auto w-full flex-col items-start gap-0.5 whitespace-normal px-4 py-3 text-left",
                  keputusan === k && "border-primary ring-1 ring-primary",
                )}
              >
                <span className="font-medium">{td(`keputusan.${k}`)}</span>
                <span className="text-xs font-normal text-muted-foreground">{td(`kantor.dialog.arti.${k}`)}</span>
              </Button>
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor="gr-jumlah">{t("kantor.dialog.jumlah")}</Label>
            <Input
              id="gr-jumlah"
              type="number"
              inputMode="numeric"
              min={1}
              max={saldo}
              value={qty}
              placeholder={String(saldo)}
              onChange={(e) => setQty(e.target.value)}
              disabled={pending}
              className="w-32 tabular-nums"
            />
            <p className="text-xs text-muted-foreground">{t("kantor.dialog.jumlahHint", { n: saldo })}</p>
          </div>
          {keputusan === "JUAL_OBRAL" ? (
            <div className="space-y-2">
              <Label htmlFor="gr-nilai">{t("kantor.dialog.nilai")}</Label>
              <Input
                id="gr-nilai"
                type="number"
                inputMode="numeric"
                min={0}
                value={nilai}
                onChange={(e) => setNilai(e.target.value)}
                disabled={pending}
                className="w-48 tabular-nums"
              />
              <p className="text-xs text-muted-foreground">{t("kantor.dialog.nilaiHint")}</p>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="gr-catatan">{t("kantor.dialog.catatan")}</Label>
            <Textarea
              id="gr-catatan"
              value={catatan}
              onChange={(e) => setCatatan(e.target.value.slice(0, BATAS_CATATAN_GUDANG_RUSAK))}
              placeholder={t("kantor.dialog.catatanContoh")}
              rows={3}
              disabled={pending}
            />
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {kurang ? <p className="text-sm text-muted-foreground sm:mr-auto sm:self-center">{kurang}</p> : null}
          <Button variant="outline" onClick={tutup} disabled={pending}>
            {t("kantor.dialog.batal")}
          </Button>
          <Button onClick={simpan} disabled={pending || kurang !== null}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {pending ? t("kantor.dialog.menyimpan") : t("kantor.dialog.simpan")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
