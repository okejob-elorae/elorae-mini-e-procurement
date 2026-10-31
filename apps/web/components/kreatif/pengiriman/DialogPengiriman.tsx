"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { Textarea } from "@/components/ui/textarea";
import { simpanPengirimanAction } from "@/app/actions/kreatif-sampel";
import type { PilihanVarianKirim } from "@/lib/konsinyasi/varian-kirim";
import type { BarangSampel, PengirimanPanel } from "@/lib/creative/sampel-queries";
import type { KurangStokSampel } from "@/lib/creative/sampel-writer";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { ID_DAFTAR_KURIR } from "./DaftarKurir";
import { PemilihBarangSampel } from "./PemilihBarangSampel";
import {
  alasanBelumSiap,
  bacaOngkir,
  barisSamaIsian,
  dariBarang,
  teksBerhasil,
  teksGagal,
  teksBaris,
  untukServer,
  type BarisIsian,
} from "./isian-pengiriman";

type Props = {
  kolaborasiId: string;
  /** "BRIEF/2026/0001 · @handle" — keterangan dialog untuk pembaca layar. */
  keterangan: string;
  /** null = pengiriman baru (barangnya diambil dari rencana sampel). */
  pengiriman: PengirimanPanel | null;
  rencana: BarangSampel[];
  varianAwal: Record<string, PilihanVarianKirim>;
  hariIni: string;
  onTutup: () => void;
  onTersimpan: () => void;
};

/**
 * Tambah/ubah satu pengiriman sampel. Barang per varian bisa diubah selama
 * paketnya belum berangkat; begitu resi disimpan stok keluar dan barangnya
 * terkunci — yang masih bisa dibetulkan hanya kurir, resi, tanggal, ongkir,
 * dan catatan.
 */
export function DialogPengiriman({ kolaborasiId, keterangan, pengiriman, rencana, varianAwal, hariIni, onTutup, onTersimpan }: Props) {
  const t = useTranslations("kreatifRuang");
  const td = dinamis(t);
  const berangkat = pengiriman !== null && pengiriman.keadaan !== "BELUM_BERANGKAT";
  const asal = pengiriman ? pengiriman.baris : rencana;
  const [baris, setBaris] = useState<BarisIsian[]>(() => dariBarang(asal));
  const [varian, setVarian] = useState(varianAwal);
  const [kurir, setKurir] = useState(pengiriman?.courier ?? "");
  const [tanpaResi, setTanpaResi] = useState(pengiriman?.tanpaResi ?? false);
  const [resi, setResi] = useState(pengiriman && !pengiriman.tanpaResi ? (pengiriman.trackingNo ?? "") : "");
  const [kirim, setKirim] = useState(pengiriman?.sentAt ?? "");
  const [terima, setTerima] = useState(pengiriman?.receivedAt ?? "");
  const [ongkir, setOngkir] = useState(pengiriman?.shippingCost ? String(pengiriman.shippingCost) : "");
  const [catatan, setCatatan] = useState(pengiriman?.note ?? "");
  const [kurang, setKurang] = useState<KurangStokSampel[]>([]);
  const [kunci] = useState(() => newLocalId());
  const [menyimpan, mulaiSimpan] = useTransition();

  const adaResi = tanpaResi || resi.trim() !== "";
  const belum = berangkat ? null : alasanBelumSiap(baris, varian);

  const simpan = () => {
    if (belum && (adaResi || belum.kode === "KOSONG")) {
      toast.error(belum.kode === "KOSONG" ? t("sampel.belum.KOSONG") : td(`sampel.belum.${belum.kode}`, { barang: belum.nama }));
      return;
    }
    const nilaiOngkir = bacaOngkir(ongkir);
    if (nilaiOngkir !== null && Number.isNaN(nilaiOngkir)) {
      toast.error(t("sampel.err.ONGKIR_TIDAK_VALID"));
      return;
    }
    mulaiSimpan(async () => {
      const r = await simpanPengirimanAction({
        id: pengiriman?.id ?? null,
        kolaborasiId,
        courier: kurir.trim() || null,
        trackingNo: tanpaResi ? null : resi,
        tanpaResi,
        sentAt: adaResi ? kirim || null : null,
        receivedAt: adaResi ? terima || null : null,
        shippingCost: nilaiOngkir ?? 0,
        note: catatan.trim() || null,
        ...(berangkat || barisSamaIsian(baris, asal) ? {} : { baris: untukServer(baris) }),
        kunci,
      });
      if (!r.ok) {
        if (r.kode === "STOK_KURANG" && r.kurang) setKurang(r.kurang);
        toast.error(teksGagal(td, r));
        return;
      }
      toast.success(teksBerhasil(td, r.berangkat ? "resi" : r.diterima ? "terima" : "simpan", r));
      onTersimpan();
    });
  };

  return (
    <Dialog open onOpenChange={(v) => (!v && !menyimpan ? onTutup() : undefined)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{pengiriman ? t("sampel.panel.dialogUbah") : t("sampel.panel.dialogBaru")}</DialogTitle>
          <DialogDescription>{keterangan}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("sampel.kolom.barang")}</Label>
            {berangkat ? (
              <>
                <ul className="space-y-0.5 text-sm">
                  {baris.map((b) => (
                    <li key={b.uid}>{teksBaris(b)}</li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">{t("sampel.panel.terkunciBerangkat")}</p>
              </>
            ) : (
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
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sampel-kurir">{t("sampel.kurir")}</Label>
              <Input id="sampel-kurir" list={ID_DAFTAR_KURIR} value={kurir} onChange={(e) => setKurir(e.target.value)} disabled={menyimpan} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sampel-resi">{t("sampel.resi")}</Label>
              <Input
                id="sampel-resi"
                value={tanpaResi ? "" : resi}
                onChange={(e) => setResi(e.target.value)}
                placeholder={tanpaResi ? t("sampel.tanpaResiTeks") : undefined}
                disabled={menyimpan || tanpaResi}
              />
              <label className="flex items-center gap-1.5 text-xs">
                <Checkbox checked={tanpaResi} onCheckedChange={(v) => setTanpaResi(v === true)} disabled={menyimpan} />
                {t("sampel.tanpaResi")}
              </label>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sampel-kirim">{t("sampel.panel.tanggalKirim")}</Label>
              <TanggalInput
                id="sampel-kirim"
                value={adaResi ? kirim || hariIni : ""}
                onChange={(e) => setKirim(e.target.value)}
                max={hariIni}
                required={berangkat}
                placeholder={t("sampel.panel.isiResiDulu")}
                disabled={menyimpan || !adaResi}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sampel-terima">{t("sampel.tanggalTerima")}</Label>
              <TanggalInput
                id="sampel-terima"
                value={adaResi ? terima : ""}
                onChange={(e) => setTerima(e.target.value)}
                min={adaResi ? kirim || hariIni : undefined}
                max={hariIni}
                placeholder={t("sampel.panel.belumDiterima")}
                disabled={menyimpan || !adaResi}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sampel-ongkir">{t("sampel.ongkir")}</Label>
              <Input
                id="sampel-ongkir"
                inputMode="numeric"
                value={ongkir}
                onChange={(e) => setOngkir(e.target.value)}
                placeholder="Rp 0"
                className="tabular-nums"
                disabled={menyimpan}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sampel-catatan">{t("sampel.panel.catatan")}</Label>
            <Textarea id="sampel-catatan" value={catatan} onChange={(e) => setCatatan(e.target.value)} rows={2} maxLength={2000} disabled={menyimpan} />
          </div>
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <p className="text-xs text-muted-foreground">{berangkat ? "" : t("sampel.stokKeluar")}</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onTutup} disabled={menyimpan}>
              {t("sampel.panel.batal")}
            </Button>
            <Button type="button" onClick={simpan} disabled={menyimpan}>
              {menyimpan ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {menyimpan ? t("sampel.panel.menyimpan") : t("sampel.panel.simpan")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
