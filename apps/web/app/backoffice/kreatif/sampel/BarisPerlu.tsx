"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Check, ExternalLink, Loader2, PackageOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import { TombolWa } from "@/components/kreatif/TombolWa";
import { ID_DAFTAR_KURIR } from "@/components/kreatif/pengiriman/DaftarKurir";
import { AlamatKirim, KolSampel, PeringatanKirimDobel } from "@/components/kreatif/pengiriman/InfoKirim";
import { PemilihBarangSampel } from "@/components/kreatif/pengiriman/PemilihBarangSampel";
import {
  alasanBelumSiap,
  bacaOngkir,
  barisSamaIsian,
  dariBarang,
  teksBaris,
  teksBerhasil,
  teksGagal,
  untukServer,
  type BarisIsian,
} from "@/components/kreatif/pengiriman/isian-pengiriman";
import { simpanPengirimanAction } from "@/app/actions/kreatif-sampel";
import type { PilihanVarianKirim } from "@/lib/konsinyasi/varian-kirim";
import { umurMerah } from "@/lib/creative/sampel-aturan";
import type { BarisPerluKirim } from "@/lib/creative/sampel-queries";
import type { KurangStokSampel } from "@/lib/creative/sampel-writer";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { cn } from "@/lib/utils";

type Props = {
  b: BarisPerluKirim;
  varianAwal: Record<string, PilihanVarianKirim>;
  ambangHari: number;
  kolom: number;
  bolehMengelola: boolean;
  onSelesai: () => void;
};

/**
 * Satu kolaborasi yang perlu dikirimi sampel. Kurir + resi + ✓ memberangkatkan
 * paket: bila kolaborasinya sudah punya pengiriman yang belum berangkat, resi
 * mengisi pengiriman ITU (bukan membuat baris baru). Bila barangnya belum
 * jelas (belum ada rencana, atau ukurannya belum dipilih), pemilih barang
 * dibuka di bawah baris — tanpa jendela.
 */
export function BarisPerlu({ b, varianAwal, ambangHari, kolom, bolehMengelola, onSelesai }: Props) {
  const t = useTranslations("kreatifRuang");
  const td = dinamis(t);
  const awal = b.draf ? b.draf.baris : b.rencana;
  const [baris, setBaris] = useState<BarisIsian[]>(() => dariBarang(awal));
  const [varian, setVarian] = useState<Record<string, PilihanVarianKirim>>(varianAwal);
  const [kurir, setKurir] = useState(b.draf?.courier ?? "");
  const [resi, setResi] = useState("");
  const [tanpaResi, setTanpaResi] = useState(false);
  const [ongkir, setOngkir] = useState(b.draf?.shippingCost ? String(b.draf.shippingCost) : "");
  const [kurang, setKurang] = useState<KurangStokSampel[]>([]);
  const [kunci] = useState(() => newLocalId());
  const belum = alasanBelumSiap(baris, varian);
  const [buka, setBuka] = useState(belum !== null && awal.length > 0);
  const [menyimpan, mulaiSimpan] = useTransition();
  const merah = umurMerah(b.umurHari, ambangHari);

  const kirim = () => {
    if (belum) {
      setBuka(true);
      toast.error(belum.kode === "KOSONG" ? t("sampel.belum.KOSONG") : td(`sampel.belum.${belum.kode}`, { barang: belum.nama }));
      return;
    }
    if (!tanpaResi && !resi.trim()) {
      toast.error(t("sampel.resiKosong"));
      return;
    }
    const nilaiOngkir = bacaOngkir(ongkir);
    if (nilaiOngkir !== null && Number.isNaN(nilaiOngkir)) {
      toast.error(t("sampel.err.ONGKIR_TIDAK_VALID"));
      return;
    }
    mulaiSimpan(async () => {
      const r = await simpanPengirimanAction({
        id: b.draf?.id ?? null,
        kolaborasiId: b.kolaborasiId,
        courier: kurir.trim() || null,
        trackingNo: tanpaResi ? null : resi,
        tanpaResi,
        shippingCost: nilaiOngkir ?? 0,
        // Barang hanya dikirim bila diubah di layar; selain itu server memakai rencana/pengirimannya.
        ...(barisSamaIsian(baris, awal) ? {} : { baris: untukServer(baris) }),
        kunci,
      });
      if (!r.ok) {
        if (r.kode === "STOK_KURANG" && r.kurang) {
          setKurang(r.kurang);
          setBuka(true);
        }
        if (r.kode === "VARIAN_WAJIB") setBuka(true);
        toast.error(teksGagal(td, r));
        return;
      }
      toast.success(teksBerhasil(td, "resi", r));
      onSelesai();
    });
  };

  return (
    <>
      <TableRow className={cn(buka && "border-b-0")}>
        <TableCell className="max-w-[220px] align-top whitespace-normal">
          <KolSampel kol={b.kol} />
          <div className="mt-1 text-xs text-muted-foreground 2xl:hidden">{b.campaign?.nama ?? t("sampel.tanpaCampaign")}</div>
          {b.dobel.length > 0 ? (
            <div className="mt-1.5">
              <PeringatanKirimDobel dobel={b.dobel} />
            </div>
          ) : null}
        </TableCell>
        <TableCell className="hidden align-top text-sm 2xl:table-cell">{b.campaign?.nama ?? <span className="text-muted-foreground">{t("sampel.tanpaCampaign")}</span>}</TableCell>
        <TableCell className="align-top whitespace-normal">
          <AlamatKirim kol={b.kol} />
        </TableCell>
        <TableCell className="align-top whitespace-normal">
          {baris.length === 0 ? (
            <span className="text-sm text-muted-foreground">{t("sampel.barangKosong")}</span>
          ) : (
            <ul className="space-y-0.5 text-sm">
              {baris.map((x) => (
                <li key={x.uid} className="break-words">
                  {teksBaris(x)}
                </li>
              ))}
            </ul>
          )}
          {bolehMengelola ? (
            <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" aria-expanded={buka} onClick={() => setBuka((v) => !v)}>
              {buka ? t("sampel.tutupBarang") : baris.length ? t("sampel.ubahBarang") : t("sampel.pilihBarang")}
            </Button>
          ) : null}
        </TableCell>
        <TableCell className={cn("text-right align-top tabular-nums", merah && "font-bold text-destructive")}>
          {t("sampel.hari", { n: b.umurHari })}
        </TableCell>
        <TableCell className="align-top">
          {bolehMengelola ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <Input
                  list={ID_DAFTAR_KURIR}
                  value={kurir}
                  onChange={(e) => setKurir(e.target.value)}
                  placeholder={t("sampel.kurir")}
                  aria-label={t("sampel.kurir")}
                  className="h-8 w-20"
                  disabled={menyimpan}
                />
                <Input
                  value={tanpaResi ? "" : resi}
                  onChange={(e) => setResi(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") kirim();
                  }}
                  placeholder={tanpaResi ? t("sampel.tanpaResiTeks") : t("sampel.resi")}
                  aria-label={t("sampel.resi")}
                  className="h-8 w-32"
                  disabled={menyimpan || tanpaResi}
                />
                <Button
                  type="button"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  aria-label={t("sampel.simpanResi")}
                  title={t("sampel.simpanResi")}
                  onClick={kirim}
                  // Belum ada barang yang siap dikirim: tombol mati dan alasannya tertulis di bawah (petunjuk abu-abu, bukan galat).
                  disabled={menyimpan || belum !== null}
                  aria-describedby={belum ? `alasan-sampel-${b.kolaborasiId}` : undefined}
                >
                  {menyimpan ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs">
                  <Checkbox checked={tanpaResi} onCheckedChange={(v) => setTanpaResi(v === true)} disabled={menyimpan} />
                  {t("sampel.tanpaResi")}
                </label>
                <Input
                  inputMode="numeric"
                  value={ongkir}
                  onChange={(e) => setOngkir(e.target.value)}
                  placeholder={t("sampel.ongkir")}
                  aria-label={t("sampel.ongkir")}
                  className="h-7 w-28 text-xs tabular-nums"
                  disabled={menyimpan}
                />
              </div>
              {belum ? (
                <p id={`alasan-sampel-${b.kolaborasiId}`} className="text-xs text-muted-foreground">
                  {belum.kode === "KOSONG" ? t("sampel.belum.KOSONG") : td(`sampel.belum.${belum.kode}`, { barang: belum.nama })}
                </p>
              ) : null}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="text-right align-top">
          <div className="flex justify-end gap-1">
            <TombolWa kolId={b.kol.id} kolaborasiId={b.kolaborasiId} bolehMengelola={bolehMengelola} />
            <Button asChild variant="ghost" size="icon" className="h-8 w-8">
              <Link href={`/backoffice/kreatif/kolaborasi/${b.kolaborasiId}`} aria-label={t("sampel.bukaKolaborasi", { doc: b.docNo })} title={t("sampel.bukaKolaborasi", { doc: b.docNo })}>
                <ExternalLink className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {buka && bolehMengelola ? (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={kolom} className="whitespace-normal">
            <div className="max-w-2xl space-y-2 py-1">
              <p className="flex items-center gap-2 text-sm font-medium">
                <PackageOpen className="h-4 w-4" aria-hidden />
                {t("sampel.barangUntuk", { kol: b.kol.handle ? `@${b.kol.handle}` : b.kol.nama })}
              </p>
              <PemilihBarangSampel
                baris={baris}
                onChange={(x) => {
                  setKurang([]);
                  setBaris(x);
                }}
                varian={varian}
                onVarian={(itemId, p) => setVarian((lama) => ({ ...lama, [itemId]: p }))}
                kurang={kurang}
                disabled={menyimpan}
              />
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
