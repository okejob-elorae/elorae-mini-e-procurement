"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { History, Loader2, PackageX } from "lucide-react";
import { putuskanBarangRusakAction } from "@/app/actions/spg-rusak";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { dinamis } from "@/lib/i18n/dinamis";
import { BATAS_TEKS_RUSAK, KEPUTUSAN_RUSAK, type KeputusanRusak, type StatusRusak } from "@/lib/spg/rusak";
import { cn } from "@/lib/utils";

export type BarisRusakTampil = {
  id: string;
  toko: string;
  sourceType: string;
  docNo: string;
  diterima: string;
  penerima: string;
  productName: string;
  variantSku: string;
  katalog: boolean;
  qtyReceived: number;
  qty: number;
  keterangan: string | null;
  fotoUrl: string | null;
  status: StatusRusak;
  diputuskanOleh: string | null;
  diputuskanPada: string | null;
  catatanKeputusan: string | null;
  dikembalikan: number;
  notaRetur: string[];
};

const NADA: Record<StatusRusak, string> = {
  TERBUKA: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  LAYAK_JUAL: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  KEMBALI_GUDANG: "bg-primary/15 text-foreground",
  DIHAPUSKAN: "bg-muted text-muted-foreground",
};

/**
 * Barang rusak dari kiriman ke toko SPG — kantor. Tab "Terbuka" (yang menunggu
 * keputusan gudang, terlama dulu) dan "Riwayat" (100 keputusan terakhir).
 * Tombol putuskan hanya untuk `inventory:manage`; server memeriksa ulang.
 */
export function DaftarRusakClient({
  tab,
  terbuka,
  riwayat,
  bolehPutuskan,
}: {
  tab: "terbuka" | "riwayat";
  terbuka: BarisRusakTampil[];
  riwayat: BarisRusakTampil[];
  bolehPutuskan: boolean;
}) {
  const t = useTranslations("spgRusak");
  const td = dinamis(t);
  const tSumber = useTranslations("pwa.spgTerima");
  const tsd = dinamis(tSumber);
  const router = useRouter();
  const [dipilih, setDipilih] = useState<BarisRusakTampil | null>(null);

  const baris = tab === "terbuka" ? terbuka : riwayat;
  const pcsTerbuka = terbuka.reduce((n, b) => n + b.qty, 0);
  const pindahTab = (ke: "terbuka" | "riwayat") =>
    router.replace(ke === "riwayat" ? "/backoffice/spg-kiriman-rusak?tab=riwayat" : "/backoffice/spg-kiriman-rusak");

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("kantor.judul")}
        description={t("kantor.deskripsi")}
        meta={t("kantor.ringkas", { baris: terbuka.length, pcs: pcsTerbuka })}
      />

      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("kantor.judul")}>
        <Button role="tab" aria-selected={tab === "terbuka"} variant={tab === "terbuka" ? "default" : "outline"} onClick={() => pindahTab("terbuka")}>
          {t("kantor.tabTerbuka", { n: terbuka.length })}
        </Button>
        <Button role="tab" aria-selected={tab === "riwayat"} variant={tab === "riwayat" ? "default" : "outline"} onClick={() => pindahTab("riwayat")}>
          {t("kantor.tabRiwayat")}
        </Button>
      </div>

      {!bolehPutuskan && tab === "terbuka" && terbuka.length > 0 ? (
        <p className="text-sm text-muted-foreground">{t("kantor.hanyaLihat")}</p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {tab === "terbuka" ? <PackageX className="h-5 w-5" /> : <History className="h-5 w-5" />}
            {tab === "terbuka" ? t("kantor.judulTerbuka") : t("kantor.judulRiwayat")}
          </CardTitle>
        </CardHeader>
        <CardContent className={baris.length === 0 ? undefined : "px-0"}>
          {baris.length === 0 ? (
            <EmptyState
              icon={tab === "terbuka" ? PackageX : History}
              title={tab === "terbuka" ? t("kantor.kosongTerbukaJudul") : t("kantor.kosongRiwayatJudul")}
              description={tab === "terbuka" ? t("kantor.kosongTerbukaIsi") : t("kantor.kosongRiwayatIsi")}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kantor.kolom.toko")}</TableHead>
                    <TableHead>{t("kantor.kolom.dokumen")}</TableHead>
                    <TableHead>{t("kantor.kolom.barang")}</TableHead>
                    <TableHead className="text-right">{t("kantor.kolom.jumlah")}</TableHead>
                    <TableHead>{t("kantor.kolom.keterangan")}</TableHead>
                    <TableHead>{t("kantor.kolom.foto")}</TableHead>
                    <TableHead>{tab === "terbuka" ? t("kantor.kolom.aksi") : t("kantor.kolom.keputusan")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="min-w-[10rem] whitespace-normal font-medium">{b.toko}</TableCell>
                      <TableCell className="min-w-[11rem] whitespace-normal">
                        <span className="block font-medium">{b.docNo}</span>
                        <span className="block text-xs text-muted-foreground">{tsd(`source.${b.sourceType}`)}</span>
                        <span className="block text-xs text-muted-foreground">{t("kantor.diterimaOleh", { tanggal: b.diterima, nama: b.penerima })}</span>
                      </TableCell>
                      <TableCell className="min-w-[12rem] whitespace-normal">
                        <span className="block">{b.productName}</span>
                        {b.variantSku ? <span className="block text-xs text-muted-foreground">{b.variantSku}</span> : null}
                        {!b.katalog ? <span className="block text-xs text-amber-700 dark:text-amber-300">{t("kantor.bukanKatalog")}</span> : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className="block font-semibold text-destructive">{b.qty}</span>
                        <span className="block text-xs text-muted-foreground">{t("kantor.dariTiba", { n: b.qtyReceived })}</span>
                      </TableCell>
                      <TableCell className="min-w-[12rem] whitespace-normal text-sm">{b.keterangan ?? "—"}</TableCell>
                      <TableCell>
                        {b.fotoUrl ? (
                          <a href={b.fotoUrl} target="_blank" rel="noopener noreferrer" aria-label={t("kantor.lihatFoto")}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={b.fotoUrl} alt="" loading="lazy" className="h-10 w-10 rounded-md border object-cover" />
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="min-w-[12rem] whitespace-normal">
                        {b.status === "TERBUKA" ? (
                          bolehPutuskan ? (
                            <Button size="sm" onClick={() => setDipilih(b)}>
                              {t("kantor.putuskan")}
                            </Button>
                          ) : (
                            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", NADA.TERBUKA)}>{td("hp.status.TERBUKA")}</span>
                          )
                        ) : (
                          <span className="block space-y-1">
                            <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", NADA[b.status])}>
                              {td(`kantor.keputusan.${b.status}`)}
                            </span>
                            {b.catatanKeputusan ? <span className="block text-xs">{b.catatanKeputusan}</span> : null}
                            <span className="block text-xs text-muted-foreground">
                              {t("kantor.olehPada", { nama: b.diputuskanOleh ?? "—", tanggal: b.diputuskanPada ?? "—" })}
                            </span>
                            {b.status === "KEMBALI_GUDANG" ? (
                              <span className="block text-xs text-muted-foreground">
                                {b.notaRetur.length > 0
                                  ? t("kantor.sudahKembali", { n: b.dikembalikan, dari: b.qty, nota: b.notaRetur.join(", ") })
                                  : t("kantor.belumKembali")}
                              </span>
                            ) : null}
                          </span>
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

      <DialogKeputusan baris={dipilih} onTutup={() => setDipilih(null)} onSelesai={() => router.refresh()} />
    </div>
  );
}

const KODE_GALAT = new Set(["FORBIDDEN", "VALIDATION", "KEPUTUSAN_TIDAK_SAH", "CATATAN_WAJIB", "TIDAK_DITEMUKAN", "SUDAH_DIPUTUSKAN"]);

function DialogKeputusan({
  baris,
  onTutup,
  onSelesai,
}: {
  baris: BarisRusakTampil | null;
  onTutup: () => void;
  onSelesai: () => void;
}) {
  const t = useTranslations("spgRusak");
  const td = dinamis(t);
  const [pending, mulai] = useTransition();
  const [keputusan, setKeputusan] = useState<KeputusanRusak | null>(null);
  const [catatan, setCatatan] = useState("");

  const tutup = () => {
    if (pending) return;
    setKeputusan(null);
    setCatatan("");
    onTutup();
  };

  const kurang = !keputusan ? t("kantor.dialog.kurangPilihan") : !catatan.trim() ? t("kantor.dialog.kurangCatatan") : null;

  const simpan = () => {
    if (!baris || !keputusan) return;
    mulai(async () => {
      let res: Awaited<ReturnType<typeof putuskanBarangRusakAction>>;
      try {
        res = await putuskanBarangRusakAction({ lineId: baris.id, keputusan, catatan: catatan.trim() });
      } catch {
        toast.error(t("kantor.err.GAGAL"));
        return;
      }
      if (!res.ok) {
        toast.error(td(KODE_GALAT.has(res.code) ? `kantor.err.${res.code}` : "kantor.err.GAGAL"));
        if (res.code === "SUDAH_DIPUTUSKAN" || res.code === "TIDAK_DITEMUKAN") {
          setKeputusan(null);
          setCatatan("");
          onTutup();
          onSelesai();
        }
        return;
      }
      toast.success(td(`kantor.dialog.berhasil.${keputusan}`));
      setKeputusan(null);
      setCatatan("");
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
            {baris ? t("kantor.dialog.isi", { n: baris.qty, barang: baris.productName, toko: baris.toko, doc: baris.docNo }) : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2" role="radiogroup" aria-label={t("kantor.dialog.pilihan")}>
            {KEPUTUSAN_RUSAK.map((k) => (
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
                <span className="font-medium">{td(`kantor.keputusan.${k}`)}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {k === "LAYAK_JUAL" && baris && !baris.katalog ? t("kantor.dialog.layakBukanKatalog") : td(`kantor.dialog.arti.${k}`)}
                </span>
              </Button>
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor="rusak-catatan">{t("kantor.dialog.catatan")}</Label>
            <Textarea
              id="rusak-catatan"
              value={catatan}
              onChange={(e) => setCatatan(e.target.value.slice(0, BATAS_TEKS_RUSAK))}
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
