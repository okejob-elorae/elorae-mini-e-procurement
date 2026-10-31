"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UnggahFoto, type NilaiFoto } from "@/components/foto/UnggahFoto";
import { catatBuktiTerimaAction, koreksiBuktiTerimaAction } from "@/app/actions/bukti-terima";
import { formatDisplayDateTime } from "@/lib/date-only";
import {
  bacaWaktuInputWib,
  batasAwalTerima,
  periksaWaktuTerima,
  rapikanNamaPenerima,
  waktuWibUntukInput,
} from "@/lib/field-sales/delivery/bukti-terima";
import type { FieldSalesDeliverySummary } from "@/lib/field-sales/queries";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { TanggalJamInput } from "@/components/ui/tanggal-input";

/**
 * Bukti terima digital di layar kantor: sel "Diterima" per pengiriman, dialog
 * catat/koreksi (penulis yang sama dengan HP), dan pratinjau gambarnya.
 *
 * Kantor mencatat dari nota bertanda tangan yang kembali ke kantor — jadi di
 * sini hanya foto/pindaian, tanpa kotak tanda tangan di layar.
 */

type Kiriman = FieldSalesDeliverySummary;

/** Isi kolom "Diterima": nama + jam terima (WIB) dan gambar kecilnya, atau "Belum". */
export function SelBuktiTerima({ kiriman, onLihat }: { kiriman: Kiriman; onLihat: () => void }) {
  const t = useTranslations("buktiTerima.kantor");
  const locale = useLocale();
  if (!kiriman.receivedAt) {
    return (
      <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
        {t("belum")}
      </Badge>
    );
  }
  return (
    <div className="flex items-center gap-2 whitespace-normal">
      {kiriman.podPhotoUrl ? (
        <Button
          type="button"
          variant="outline"
          className="h-9 w-9 shrink-0 overflow-hidden p-0"
          aria-label={t("lihat")}
          title={t("lihat")}
          onClick={onLihat}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={kiriman.podPhotoUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        </Button>
      ) : (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
      )}
      <span className="min-w-0 text-xs leading-tight">
        <span className="block max-w-36 truncate font-medium">{kiriman.receivedByName ?? "—"}</span>
        <span className="block text-muted-foreground">{formatDisplayDateTime(kiriman.receivedAt, locale)}</span>
      </span>
    </div>
  );
}

/** Pratinjau besar gambar bukti terima. */
export function LightboxBuktiTerima({ kiriman, onTutup }: { kiriman: Kiriman | null; onTutup: () => void }) {
  const t = useTranslations("buktiTerima.kantor");
  const locale = useLocale();
  return (
    <Dialog open={kiriman !== null} onOpenChange={(buka) => !buka && onTutup()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{kiriman ? t("judulLihat", { docNo: kiriman.docNo }) : null}</DialogTitle>
          {kiriman?.receivedAt ? (
            <DialogDescription>
              {t("olehPada", {
                name: kiriman.receivedByName ?? "—",
                date: formatDisplayDateTime(kiriman.receivedAt, locale),
              })}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {kiriman?.podPhotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={kiriman.podPhotoUrl}
            alt={t("judulLihat", { docNo: kiriman.docNo })}
            className="max-h-[70vh] w-full rounded-md border bg-white object-contain"
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export type SasaranKantor = { kiriman: Kiriman; mode: "CATAT" | "KOREKSI" };

/** Dialog catat / koreksi bukti terima untuk kantor. */
export function DialogBuktiTerimaKantor({ sasaran, onTutup }: { sasaran: SasaranKantor | null; onTutup: () => void }) {
  const t = useTranslations("buktiTerima.kantor");
  return (
    <Dialog open={sasaran !== null} onOpenChange={(buka) => !buka && onTutup()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{sasaran?.mode === "KOREKSI" ? t("judulKoreksi") : t("judulCatat")}</DialogTitle>
          <DialogDescription>
            {sasaran
              ? sasaran.mode === "KOREKSI"
                ? t("isiKoreksi", { docNo: sasaran.kiriman.docNo })
                : t("isiCatat", { docNo: sasaran.kiriman.docNo })
              : null}
          </DialogDescription>
        </DialogHeader>
        {/* Dipasang hanya selama terbuka: setiap pembukaan = satu kunci kiriman baru. */}
        {sasaran ? <IsiDialog key={`${sasaran.kiriman.id}-${sasaran.mode}`} sasaran={sasaran} onTutup={onTutup} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function IsiDialog({ sasaran, onTutup }: { sasaran: SasaranKantor; onTutup: () => void }) {
  const t = useTranslations("buktiTerima.kantor");
  const tLembar = useTranslations("buktiTerima.lembar");
  const tErr = dinamis(useTranslations("buktiTerima.err"));
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { kiriman: k, mode } = sasaran;
  const koreksi = mode === "KOREKSI";

  const [kunci] = useState(newLocalId);
  const [dibuka] = useState(() => new Date());
  const [nama, setNama] = useState(koreksi ? (k.receivedByName ?? "") : "");
  const [teksWaktu, setTeksWaktu] = useState(() => waktuWibUntukInput(koreksi && k.receivedAt ? new Date(k.receivedAt) : dibuka));
  const [foto, setFoto] = useState<NilaiFoto>(koreksi && k.podPhotoUrl ? { url: k.podPhotoUrl, nama: "bukti-terima" } : null);
  const [alasan, setAlasan] = useState("");

  const batasAwal = batasAwalTerima({ invoiceDate: new Date(k.invoiceDate), deliveredAt: new Date(k.deliveredAt) });
  const namaRapi = rapikanNamaPenerima(nama);
  const waktu = bacaWaktuInputWib(teksWaktu);
  const galatWaktu = waktu ? periksaWaktuTerima(waktu, { invoiceDate: batasAwal, deliveredAt: batasAwal }, new Date()) : "WAKTU_TIDAK_SAH";
  const bisaSimpan =
    !pending && namaRapi !== null && galatWaktu === null && foto !== null && (!koreksi || alasan.trim() !== "");

  const simpan = () => {
    if (!namaRapi || !waktu || !foto) return;
    startTransition(async () => {
      const isi = {
        deliveryId: k.id,
        receivedByName: namaRapi,
        receivedAt: waktu.toISOString(),
        podPhotoUrl: foto.url,
        idempotencyKey: kunci,
        jenisBukti: "FOTO" as const,
      };
      try {
        const hasil = koreksi
          ? await koreksiBuktiTerimaAction({
              ...isi,
              reason: alasan.trim(),
              sebelum: {
                receivedByName: k.receivedByName,
                receivedAt: k.receivedAt ? new Date(k.receivedAt).toISOString() : null,
                podPhotoUrl: k.podPhotoUrl,
              },
            })
          : await catatBuktiTerimaAction(isi);
        if (hasil.ok) {
          toast.success(koreksi ? t("okKoreksi") : t("okCatat"));
          onTutup();
          router.refresh();
          return;
        }
        toast.error(tErr(hasil.kode));
      } catch {
        toast.error(tErr("GAGAL"));
      }
    });
  };

  return (
    <>
      <div className="space-y-4 py-2">
        <div className="space-y-1">
          <Label htmlFor="btk-nama" className="text-xs text-muted-foreground">
            {tLembar("nama")}
          </Label>
          <Input
            id="btk-nama"
            className="h-10"
            value={nama}
            maxLength={120}
            placeholder={tLembar("namaPlaceholder")}
            disabled={pending}
            aria-invalid={nama.trim() !== "" && namaRapi === null}
            onChange={(e) => setNama(e.target.value)}
          />
          {nama.trim() !== "" && namaRapi === null ? <p className="text-xs text-destructive">{tErr("NAMA_TIDAK_SAH")}</p> : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor="btk-waktu" className="text-xs text-muted-foreground">
            {tLembar("waktu")}
          </Label>
          <TanggalJamInput
            id="btk-waktu"
            className="h-10"
            value={teksWaktu}
            min={waktuWibUntukInput(batasAwal)}
            max={waktuWibUntukInput(dibuka)}
            disabled={pending}
            aria-invalid={galatWaktu !== null}
            onChange={(e) => setTeksWaktu(e.target.value)}
          />
          {galatWaktu ? <p className="text-xs text-destructive">{tErr(galatWaktu)}</p> : null}
        </div>
        <UnggahFoto label={tLembar("foto")} petunjuk={t("fotoPetunjuk")} nilai={foto} onChange={setFoto} wajib disabled={pending} />
        {koreksi ? (
          <div className="space-y-1">
            <Label htmlFor="btk-alasan" className="text-xs text-muted-foreground">
              {t("alasan")}
            </Label>
            <Textarea
              id="btk-alasan"
              rows={3}
              maxLength={500}
              value={alasan}
              disabled={pending}
              onChange={(e) => setAlasan(e.target.value)}
            />
          </div>
        ) : null}
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline" className="h-10" disabled={pending}>
            {tCommon("cancel")}
          </Button>
        </DialogClose>
        <Button className="h-10" disabled={!bisaSimpan} onClick={simpan}>
          {pending ? tLembar("menyimpan") : tCommon("save")}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Cetak lewat iframe tersembunyi, menunggu gambar bukti termuat dulu.
 *
 * Pencetak nota lain di kartu ini mencetak 350 ms sesudah menulis dokumennya —
 * cukup untuk teks, tidak untuk foto dari `/api/foto` yang masih diunduh, dan
 * hasilnya tanda terima tanpa gambar buktinya. Batas tunggu 5 detik supaya
 * gambar yang gagal dimuat tidak menahan cetaknya selamanya.
 */
export function cetakDenganGambar(html: string, judul: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("style", "position:absolute;width:0;height:0;border:0;visibility:hidden;");
  iframe.setAttribute("title", judul);
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  const gambar = Array.from(doc.images).filter((g) => !g.complete);
  const tunggu = Promise.all(
    gambar.map(
      (g) =>
        new Promise<void>((selesai) => {
          g.addEventListener("load", () => selesai(), { once: true });
          g.addEventListener("error", () => selesai(), { once: true });
        }),
    ),
  );
  const batas = new Promise<void>((selesai) => setTimeout(selesai, 5000));
  void Promise.race([tunggu, batas]).then(() => {
    setTimeout(() => {
      iframe.contentWindow?.print();
      setTimeout(() => iframe.parentNode && document.body.removeChild(iframe), 1000);
    }, 150);
  });
}
