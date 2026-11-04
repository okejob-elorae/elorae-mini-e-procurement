"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Loader2, Pencil, Receipt, Truck, Undo2, X } from "lucide-react";
import {
  periksaKlaimEkspedisiAction,
  putuskanKlaimEkspedisiAction,
  ubahNilaiKlaimEkspedisiAction,
} from "@/app/actions/barang-hilang";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { dinamis } from "@/lib/i18n/dinamis";
import {
  bacaIsianRupiah,
  BATAS_TEKS_HILANG,
  CARA_BAYAR_KLAIM,
  keSen,
  tulisIsianRupiah,
  type CaraBayarKlaim,
  type StatusHilang,
  type StatusKlaim,
} from "@/lib/spg/hilang";
import type { KlaimBagian, RincianHilangKantor } from "@/lib/spg/hilang-queries";
import { formatIDR } from "@/lib/sales-orders/format";

/**
 * Bahan panel klaim ekspedisi: bukti pengirimannya (`rincianHilangKantor().buktiKlaim`) dengan URL
 * foto yang dibuat halamannya, bagian EKSPEDISI catatan ini bila sudah diputuskan, dan status
 * catatannya.
 */
export type BuktiKlaimEkspedisi = NonNullable<RincianHilangKantor["buktiKlaim"]> & {
  /** Foto serah ke kurir dengan berat (P43). */
  fotoSerahUrl: string | null;
  /** Foto terima di toko (P43). */
  fotoTerimaUrl: string | null;
  bagian: { id: string; nilai: number; lunas: boolean; klaim: KlaimBagian | null } | null;
  statusCatatan: StatusHilang;
};

const NADA_KLAIM: Record<StatusKlaim, StatusTone> = {
  DIAJUKAN: "waiting",
  MENUNGGU_CEK: "progress",
  DIBAYAR: "settled",
  DITOLAK: "attention",
};

const bacaStatus = (s: string | null | undefined): StatusKlaim | null =>
  s === "DIAJUKAN" || s === "MENUNGGU_CEK" || s === "DIBAYAR" || s === "DITOLAK" ? s : null;

type JenisDialog = "CATAT" | "TOLAK" | "PERIKSA" | "UBAH_NILAI";

/**
 * Panel klaim ke ekspedisi untuk barang yang hilang di perjalanan sebuah pengiriman (P36, P42, P43).
 * Buktinya selalu tampil: pengiriman, ekspedisi, resi, berat, foto serah ke kurir, foto terima di
 * toko, dan jumlah dikirim / ditolak / tiba per barang. Tindakan klaimnya hanya pada bagian
 * EKSPEDISI, dan tiap tombol memakai izin yang SAMA dengan aksinya (`app/actions/barang-hilang.ts`):
 * - "Catat pembayaran klaim" dan "Klaim ditolak" — `receivables:manage`;
 * - "Periksa" (sah / kembalikan) — `payments:verify`, dan tidak ditawarkan kepada pencatat
 *   pembayarannya sendiri (penulisnya menolak `PEMERIKSA_SAMA`, keputusan 11);
 * - "Ubah nilai klaim" selama masih diajukan — `receivables:decide_bearer`.
 */
export function KlaimEkspedisiPanel({
  klaim: k,
  bolehMengelola,
  bolehMemeriksa,
  bolehMengubahNilai,
  userId,
}: {
  klaim: BuktiKlaimEkspedisi;
  bolehMengelola: boolean;
  bolehMemeriksa: boolean;
  bolehMengubahNilai: boolean;
  userId: string;
}) {
  const t = useTranslations("barangHilang.klaim");
  const td = dinamis(t);
  const tErr = dinamis(useTranslations("barangHilang.err"));
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [dialog, setDialog] = useState<JenisDialog | null>(null);
  const [cara, setCara] = useState<CaraBayarKlaim | "">("");
  const [referensi, setReferensi] = useState("");
  const [catatan, setCatatan] = useState("");
  const [nilai, setNilai] = useState("");
  const [hasilPeriksa, setHasilPeriksa] = useState<"SAH" | "KEMBALIKAN">("SAH");

  const bagian = k.bagian;
  const status = bacaStatus(bagian?.klaim?.status);
  const ditetapkan = k.statusCatatan === "DITETAPKAN";
  const pencatatSaya = bagian?.klaim?.dicatatOleh?.id === userId;

  const bisaCatat = bolehMengelola && ditetapkan && status === "DIAJUKAN";
  const bisaUbahNilai = bolehMengubahNilai && ditetapkan && status === "DIAJUKAN";
  const bisaPeriksa = bolehMemeriksa && ditetapkan && status === "MENUNGGU_CEK" && !pencatatSaya;

  const tutup = () => {
    if (sibuk) return;
    setDialog(null);
    setCara("");
    setReferensi("");
    setCatatan("");
    setNilai("");
    setHasilPeriksa("SAH");
  };

  const nilaiAngka = bacaIsianRupiah(nilai);
  const catatanRapi = catatan.trim();
  // Alasan pertama yang membuat tombol simpan nonaktif, menurut urutan formulir.
  const kurang =
    dialog === "CATAT"
      ? cara === ""
        ? t("kurangCara")
        : cara === "potong_ongkir" && referensi.trim() === ""
          ? t("kurangReferensi")
          : null
      : dialog === "TOLAK"
        ? catatanRapi === ""
          ? t("kurangAlasan")
          : null
        : dialog === "PERIKSA"
          ? hasilPeriksa === "KEMBALIKAN" && catatanRapi === ""
            ? t("kurangAlasan")
            : null
          : dialog === "UBAH_NILAI"
            ? nilaiAngka === null || nilaiAngka <= 0
              ? t("kurangNilai")
              : bagian && keSen(nilaiAngka) === keSen(bagian.nilai)
                ? t("kurangNilaiSama")
                : catatanRapi === ""
                  ? t("kurangAlasan")
                  : null
            : null;

  const kirim = () => {
    if (!bagian || !dialog || kurang !== null) return;
    mulai(async () => {
      let r: { ok: true } | { ok: false; code: string };
      try {
        if (dialog === "CATAT") {
          r = await putuskanKlaimEkspedisiAction({
            shareId: bagian.id,
            hasil: "DIBAYAR",
            cara: cara || null,
            referensi: referensi.trim() || null,
            catatan: catatanRapi || null,
          });
        } else if (dialog === "TOLAK") {
          r = await putuskanKlaimEkspedisiAction({ shareId: bagian.id, hasil: "DITOLAK", catatan: catatanRapi });
        } else if (dialog === "PERIKSA") {
          r = await periksaKlaimEkspedisiAction({ shareId: bagian.id, hasil: hasilPeriksa, catatan: catatanRapi || null });
        } else {
          r = await ubahNilaiKlaimEkspedisiAction({ shareId: bagian.id, nilai: nilaiAngka ?? 0, catatan: catatanRapi });
        }
      } catch {
        toast.error(tErr("NETWORK"));
        return;
      }
      if (!r.ok) {
        toast.error(tErr(r.code));
        // Klaimnya berubah sejak halaman dimuat: tampilkan keadaannya yang sekarang.
        if (r.code === "SUDAH_DIPUTUSKAN" || r.code === "BUKAN_MENUNGGU_CEK" || r.code === "BUKAN_DIAJUKAN" || r.code === "BERUBAH") {
          router.refresh();
        }
        return;
      }
      toast.success(td(`ok.${dialog === "PERIKSA" ? hasilPeriksa : dialog}`));
      setDialog(null);
      setCara("");
      setReferensi("");
      setCatatan("");
      setNilai("");
      setHasilPeriksa("SAH");
      router.refresh();
    });
  };

  const info: { label: string; nilai: string | null }[] = [
    { label: t("pengiriman"), nilai: k.docNo },
    { label: t("cara"), nilai: td(`caraKirim.${k.cara}`) },
    { label: t("ekspedisi"), nilai: k.ekspedisi },
    { label: t("resi"), nilai: k.resi },
    { label: t("berat"), nilai: k.beratKg === null ? null : t("beratKg", { kg: k.beratKg.toLocaleString("id-ID") }) },
    { label: t("nilaiKlaim"), nilai: k.nilaiKlaim === null ? null : formatIDR(k.nilaiKlaim) },
    {
      label: t("penerimaan"),
      nilai: k.penerimaan
        ? [k.penerimaan.oleh, k.penerimaan.pada, k.penerimaan.namaPj ? t("namaPj", { nama: k.penerimaan.namaPj }) : null]
            .filter(Boolean)
            .join(" · ")
        : null,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Truck className="h-5 w-5" aria-hidden />
          {t("judul")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {info
            .filter((x) => x.nilai)
            .map((x) => (
              <div key={x.label} className="space-y-0.5">
                <dt className="text-xs text-muted-foreground">{x.label}</dt>
                <dd>{x.nilai}</dd>
              </div>
            ))}
        </dl>

        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["fotoSerah", k.fotoSerahUrl],
              ["fotoTerima", k.fotoTerimaUrl],
            ] as const
          ).map(([kunci, url]) => (
            <figure key={kunci} className="space-y-1.5">
              <figcaption className="text-xs text-muted-foreground">{t(kunci)}</figcaption>
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={t(kunci)} className="max-h-64 w-full object-contain" />
                </a>
              ) : (
                <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">{t("fotoKosong")}</p>
              )}
            </figure>
          ))}
        </div>

        {k.penerimaan && k.penerimaan.baris.length > 0 ? (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("kolom.barang")}</TableHead>
                  <TableHead className="text-right">{t("kolom.dikirim")}</TableHead>
                  <TableHead className="text-right">{t("kolom.ditolak")}</TableHead>
                  <TableHead className="text-right">{t("kolom.tiba")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {k.penerimaan.baris.map((b, i) => (
                  <TableRow key={`${b.productName}-${b.variantSku}-${i}`}>
                    <TableCell className="whitespace-normal">
                      <span className="block font-medium">{b.productName}</span>
                      {b.variantSku ? <span className="block text-xs text-muted-foreground">{b.variantSku}</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{b.dikirim}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.ditolak}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.tiba}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}

        {bagian && status ? (
          <div className="space-y-3 rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone={NADA_KLAIM[status]}>{td(`status.${status}`)}</StatusPill>
                <span className="text-sm font-semibold tabular-nums">{formatIDR(bagian.nilai)}</span>
              </div>
              {bisaCatat || bisaUbahNilai || bisaPeriksa ? (
                <div className="flex flex-wrap gap-2">
                  {bisaCatat ? (
                    <Button size="sm" disabled={sibuk} onClick={() => setDialog("CATAT")}>
                      <Receipt className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      {t("tombolCatat")}
                    </Button>
                  ) : null}
                  {bisaCatat ? (
                    <Button size="sm" variant="outline" disabled={sibuk} onClick={() => setDialog("TOLAK")}>
                      <X className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      {t("tombolTolak")}
                    </Button>
                  ) : null}
                  {bisaUbahNilai ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={sibuk}
                      onClick={() => {
                        setNilai(tulisIsianRupiah(bagian.nilai));
                        setDialog("UBAH_NILAI");
                      }}
                    >
                      <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      {t("tombolUbahNilai")}
                    </Button>
                  ) : null}
                  {bisaPeriksa ? (
                    <Button size="sm" disabled={sibuk} onClick={() => setDialog("PERIKSA")}>
                      <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      {t("tombolPeriksa")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {bagian.klaim?.diajukanPada ? <li>{t("diajukanPada", { pada: bagian.klaim.diajukanPada })}</li> : null}
              {bagian.klaim?.cara && (status === "MENUNGGU_CEK" || status === "DIBAYAR") ? (
                <li>
                  {t("dibayarLewat", { cara: td(`caraBayar.${bagian.klaim.cara}`) })}
                  {bagian.klaim.referensi ? ` · ${bagian.klaim.referensi}` : ""}
                </li>
              ) : null}
              {bagian.klaim?.dicatatOleh && (status === "MENUNGGU_CEK" || status === "DIBAYAR") ? (
                <li>{t("dicatatOleh", { oleh: bagian.klaim.dicatatOleh.nama, pada: bagian.klaim.dicatatPada ?? "—" })}</li>
              ) : null}
              {bagian.klaim?.diputuskanOleh && (status === "DIBAYAR" || status === "DITOLAK") ? (
                <li>
                  {td(status === "DIBAYAR" ? "dicekOleh" : "ditolakOleh", {
                    oleh: bagian.klaim.diputuskanOleh,
                    pada: bagian.klaim.diputuskanPada ?? "—",
                  })}
                </li>
              ) : null}
              {bagian.klaim?.catatan ? <li className="whitespace-pre-line text-foreground">{bagian.klaim.catatan}</li> : null}
            </ul>
            {status === "MENUNGGU_CEK" && bolehMemeriksa && pencatatSaya ? (
              <p className="text-xs text-muted-foreground">{t("pencatatTidakMemeriksa")}</p>
            ) : null}
            {status === "MENUNGGU_CEK" && !bolehMemeriksa ? <p className="text-xs text-muted-foreground">{t("menungguCek")}</p> : null}
            {status === "DITOLAK" ? <p className="text-xs text-muted-foreground">{t("ditolakLanjut")}</p> : null}
          </div>
        ) : null}
      </CardContent>

      <Dialog open={dialog !== null} onOpenChange={(o) => (o ? undefined : tutup())}>
        <DialogContent>
          {dialog ? (
            <>
              <DialogHeader>
                <DialogTitle>{td(`judul${dialog}`)}</DialogTitle>
                <DialogDescription>{td(`isi${dialog}`, { nilai: formatIDR(bagian?.nilai ?? 0) })}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                {dialog === "CATAT" ? (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="klaim-cara">{t("caraLabel")}</Label>
                      <Select value={cara} onValueChange={(v) => setCara(v as CaraBayarKlaim)}>
                        <SelectTrigger id="klaim-cara" className="w-full">
                          <SelectValue placeholder={t("caraPilih")} />
                        </SelectTrigger>
                        <SelectContent>
                          {CARA_BAYAR_KLAIM.map((c) => (
                            <SelectItem key={c} value={c}>
                              {td(`caraBayar.${c}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="klaim-referensi">
                        {cara === "potong_ongkir" ? t("referensiOngkir") : t("referensiLabel")}
                        {cara === "potong_ongkir" ? <span className="ml-1 text-destructive">*</span> : null}
                      </Label>
                      <Input
                        id="klaim-referensi"
                        value={referensi}
                        maxLength={191}
                        onChange={(e) => setReferensi(e.target.value)}
                      />
                    </div>
                  </>
                ) : null}
                {dialog === "PERIKSA" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="klaim-periksa">{t("hasilLabel")}</Label>
                    <Select value={hasilPeriksa} onValueChange={(v) => setHasilPeriksa(v === "KEMBALIKAN" ? "KEMBALIKAN" : "SAH")}>
                      <SelectTrigger id="klaim-periksa" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="SAH">{t("hasilSah")}</SelectItem>
                        <SelectItem value="KEMBALIKAN">{t("hasilKembalikan")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                {dialog === "UBAH_NILAI" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="klaim-nilai">{t("nilaiBaru")}</Label>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Rp</span>
                      <Input
                        id="klaim-nilai"
                        inputMode="decimal"
                        value={nilai}
                        onChange={(e) => setNilai(e.target.value.replace(/[^\d.,]/g, "").slice(0, 20))}
                        className="w-48 text-right tabular-nums"
                        aria-invalid={nilaiAngka === null}
                      />
                    </div>
                  </div>
                ) : null}
                <div className="space-y-1.5">
                  <Label htmlFor="klaim-catatan">
                    {dialog === "TOLAK" || dialog === "UBAH_NILAI" || (dialog === "PERIKSA" && hasilPeriksa === "KEMBALIKAN")
                      ? t("alasanWajib")
                      : t("catatanOpsional")}
                  </Label>
                  <Textarea
                    id="klaim-catatan"
                    value={catatan}
                    maxLength={BATAS_TEKS_HILANG}
                    onChange={(e) => setCatatan(e.target.value)}
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
                {kurang ? <p className="text-xs text-muted-foreground sm:mr-auto">{kurang}</p> : null}
                <Button variant="ghost" disabled={sibuk} onClick={tutup}>
                  <Undo2 className="mr-1.5 h-4 w-4" aria-hidden />
                  {t("batal")}
                </Button>
                <Button onClick={kirim} disabled={sibuk || kurang !== null}>
                  {sibuk ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  {td(`simpan${dialog}`)}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
