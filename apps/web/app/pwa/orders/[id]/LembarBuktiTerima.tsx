"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { KeteranganKirim } from "../../KeteranganKirim";
import { toast } from "sonner";
import { Camera, Loader2, PenLine, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { UnggahFoto, type NilaiFoto } from "@/components/foto/UnggahFoto";
import { KanvasTandaTangan, type PeganganTandaTangan } from "@/components/bukti-terima/KanvasTandaTangan";
import { catatBuktiTerimaAction } from "@/app/actions/bukti-terima";
import {
  bacaWaktuInputWib,
  periksaWaktuTerima,
  rapikanNamaPenerima,
  waktuWibUntukInput,
  type JenisBukti,
} from "@/lib/field-sales/delivery/bukti-terima";
import { dinamis } from "@/lib/i18n/dinamis";
import { unggahFoto } from "@/lib/foto/unggah";
import { newLocalId } from "@/lib/pwa/id-lokal";
import type { FotoTertunda } from "@/lib/pwa/offline/db";
import { antreBuktiTerima } from "@/lib/pwa/offline/bukti-terima-queue";
import { nasibBuktiTerima } from "@/lib/pwa/offline/bukti-terima-classify";
import { nasibUnggah } from "@/lib/pwa/offline/laporan-classify";
import { PERISTIWA_ANTREAN } from "@/lib/pwa/offline/hitung";
import { cn } from "@/lib/utils";
import { TanggalJamInput } from "@/components/ui/tanggal-input";

export type SasaranBuktiTerima = {
  deliveryId: string;
  docNo: string;
  /** Instan ISO — waktu paling awal yang boleh diisi. */
  batasAwalIso: string;
};

/**
 * Lembar "Konfirmasi diterima toko" untuk satu pengiriman.
 *
 * Isinya hanya dipasang selama lembarnya terbuka, jadi setiap pembukaan
 * mendapat kunci kiriman baru — dan dua ketukan Simpan dalam satu pembukaan
 * tetap satu bukti di server.
 */
export function LembarBuktiTerima({
  sasaran,
  orderId,
  storeName,
  onTutup,
  onTersimpan,
}: {
  sasaran: SasaranBuktiTerima | null;
  orderId: string;
  storeName: string;
  onTutup: () => void;
  /** Dipanggil sesudah tersimpan di server ATAU masuk antrean HP. */
  onTersimpan: () => void;
}) {
  const t = useTranslations("buktiTerima.lembar");
  return (
    <Sheet open={sasaran !== null} onOpenChange={(buka) => !buka && onTutup()}>
      <SheetContent side="bottom" className="max-h-[92dvh] gap-0 overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <SheetHeader>
          <SheetTitle>{t("judul")}</SheetTitle>
          <SheetDescription>{sasaran ? t("isi", { docNo: sasaran.docNo }) : null}</SheetDescription>
        </SheetHeader>
        {sasaran ? (
          <IsiLembar sasaran={sasaran} orderId={orderId} storeName={storeName} onTersimpan={onTersimpan} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** Gambar → bentuk antrean: berkas di HP bila belum naik, URL bila sudah. */
const keTertunda = (f: NonNullable<NilaiFoto>, urlNaik: string | null): FotoTertunda =>
  urlNaik ? { nama: f.nama, url: urlNaik } : f.berkas ? { nama: f.nama, blob: f.berkas } : { nama: f.nama, url: f.url };

function IsiLembar({
  sasaran,
  orderId,
  storeName,
  onTersimpan,
}: {
  sasaran: SasaranBuktiTerima;
  orderId: string;
  storeName: string;
  onTersimpan: () => void;
}) {
  const t = useTranslations("buktiTerima.lembar");
  const tErr = dinamis(useTranslations("buktiTerima.err"));
  const tFoto = dinamis(useTranslations("foto"));
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kunci] = useState(newLocalId);
  // Jam "sekarang" saat lembar dibuka — nilai awal dan batas atas isian waktu.
  const [dibuka] = useState(() => new Date());
  const batasAwal = new Date(sasaran.batasAwalIso);

  const [nama, setNama] = useState("");
  const [teksWaktu, setTeksWaktu] = useState(() => waktuWibUntukInput(dibuka));
  const [jenis, setJenis] = useState<JenisBukti>("FOTO");
  const [foto, setFoto] = useState<NilaiFoto>(null);
  const [adaTandaTangan, setAdaTandaTangan] = useState(false);
  const pegangan = useRef<PeganganTandaTangan>(null);

  const namaRapi = rapikanNamaPenerima(nama);
  const waktu = bacaWaktuInputWib(teksWaktu);
  const galatWaktu = waktu
    ? periksaWaktuTerima(waktu, { invoiceDate: batasAwal, deliveredAt: batasAwal }, new Date())
    : "WAKTU_TIDAK_SAH";
  const adaBukti = jenis === "FOTO" ? foto !== null : adaTandaTangan;
  const bisaSimpan = !pending && namaRapi !== null && galatWaktu === null && adaBukti;
  const kurang = pending
    ? null
    : namaRapi === null
      ? t("kurangNama")
      : galatWaktu !== null
        ? t("kurangWaktu")
        : !adaBukti
          ? jenis === "FOTO"
            ? t("kurangFoto")
            : t("kurangTandaTangan")
          : null;

  const simpan = () => {
    if (!namaRapi || !waktu) return;
    startTransition(async () => {
      const isi = { receivedByName: namaRapi, receivedAt: waktu.toISOString(), jenisBukti: jenis };

      const blob = jenis === "TANDA_TANGAN" ? await pegangan.current?.keBlob() : null;
      const gambar: NilaiFoto = jenis === "FOTO" ? foto : blob ? { url: "", nama: "tanda-tangan.png", berkas: blob } : null;
      if (!gambar) {
        toast.error(tErr("FOTO_WAJIB"));
        return;
      }

      // URL gambar yang sudah sempat naik — supaya antrean tidak mengunggahnya lagi.
      let urlNaik: string | null = null;
      const antrekan = async () => {
        await antreBuktiTerima({
          localId: kunci,
          deliveryId: sasaran.deliveryId,
          orderId,
          docNo: sasaran.docNo,
          storeName,
          payload: isi,
          foto: keTertunda(gambar, urlNaik),
        });
        window.dispatchEvent(new Event(PERISTIWA_ANTREAN));
        toast.success(t("okAntre"));
        onTersimpan();
      };

      if (!navigator.onLine) return antrekan();

      let hasil: Awaited<ReturnType<typeof catatBuktiTerimaAction>>;
      try {
        urlNaik = gambar.berkas
          ? await unggahFoto(new File([gambar.berkas], gambar.nama, { type: gambar.berkas.type || "image/jpeg" }))
          : gambar.url;
        hasil = await catatBuktiTerimaAction({
          deliveryId: sasaran.deliveryId,
          ...isi,
          podPhotoUrl: urlNaik,
          idempotencyKey: kunci,
        });
      } catch (err) {
        // Gambar yang DITOLAK server tidak akan lolos di antrean juga — sampaikan sekarang.
        if (urlNaik === null && nasibUnggah(err) === "terminal") {
          toast.error(tFoto(`err${err instanceof Error ? err.message : "GAGAL"}`));
          return;
        }
        return antrekan();
      }

      if (hasil.ok) {
        toast.success(t("okTersimpan"));
        onTersimpan();
        router.refresh();
      } else if (nasibBuktiTerima(hasil) === "retry") {
        await antrekan();
      } else {
        toast.error(tErr(hasil.kode));
      }
    });
  };

  return (
    <div className="space-y-4 px-4 pt-2">
      <div className="space-y-2">
        <Label htmlFor="bt-nama">{t("nama")}</Label>
        <Input
          id="bt-nama"
          value={nama}
          onChange={(e) => setNama(e.target.value)}
          placeholder={t("namaPlaceholder")}
          autoComplete="off"
          maxLength={120}
          aria-invalid={nama.trim() !== "" && namaRapi === null}
          disabled={pending}
        />
        {nama.trim() !== "" && namaRapi === null ? <p className="text-xs text-destructive">{tErr("NAMA_TIDAK_SAH")}</p> : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="bt-waktu">{t("waktu")}</Label>
        <TanggalJamInput
          id="bt-waktu"
          value={teksWaktu}
          min={waktuWibUntukInput(batasAwal)}
          max={waktuWibUntukInput(dibuka)}
          onChange={(e) => setTeksWaktu(e.target.value)}
          aria-invalid={galatWaktu !== null}
          aria-describedby="bt-waktu-petunjuk"
          disabled={pending}
        />
        <p id="bt-waktu-petunjuk" className={cn("text-xs", galatWaktu ? "text-destructive" : "text-muted-foreground")}>
          {galatWaktu ? tErr(galatWaktu) : t("waktuPetunjuk")}
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("jenis")}</legend>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={jenis === "FOTO" ? "default" : "outline"}
            aria-pressed={jenis === "FOTO"}
            disabled={pending}
            onClick={() => setJenis("FOTO")}
          >
            <Camera className="h-4 w-4" aria-hidden />
            {t("jenisFOTO")}
          </Button>
          <Button
            type="button"
            variant={jenis === "TANDA_TANGAN" ? "default" : "outline"}
            aria-pressed={jenis === "TANDA_TANGAN"}
            disabled={pending}
            onClick={() => setJenis("TANDA_TANGAN")}
          >
            <PenLine className="h-4 w-4" aria-hidden />
            {t("jenisTANDA_TANGAN")}
          </Button>
        </div>
      </fieldset>

      {jenis === "FOTO" ? (
        <UnggahFoto
          label={t("foto")}
          petunjuk={t("fotoPetunjuk")}
          nilai={foto}
          onChange={setFoto}
          wajib
          disabled={pending}
          simpanDiHp
        />
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label>{t("tandaTangan")}</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending || !adaTandaTangan}
              onClick={() => pegangan.current?.hapus()}
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              {t("ulangiTandaTangan")}
            </Button>
          </div>
          <KanvasTandaTangan ref={pegangan} label={t("tandaTangan")} onChange={setAdaTandaTangan} disabled={pending} />
          <p className="text-xs text-muted-foreground">{t("tandaTanganPetunjuk")}</p>
        </div>
      )}

      <Button type="button" className="w-full" disabled={!bisaSimpan} onClick={simpan}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
        {pending ? t("menyimpan") : t("simpan")}
      </Button>
      <KeteranganKirim teks={kurang} />
    </div>
  );
}
