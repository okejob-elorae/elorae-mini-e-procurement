"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Camera, CloudOff, ImageIcon, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { compressImage } from "@/lib/pwa/photo/compress";
import { enqueuePhoto } from "@/lib/pwa/offline/photo-queue";
import { flushPendingPhotos } from "@/lib/pwa/offline/photo-sync";
import { PERISTIWA_ANTREAN } from "@/lib/pwa/offline/hitung";
import { newLocalId } from "@/lib/pwa/id-lokal";

/**
 * Ambil satu foto kunjungan untuk daftar periksa atau panduan display.
 *
 * Fotonya masuk ANTREAN FOTO KUNJUNGAN yang sudah ada (sama dengan kartu "Foto
 * Kunjungan" di halaman toko): tersimpan di HP dulu, naik saat ada sinyal,
 * dan kembar tidak mungkin karena server menyaring `clientId`. Yang
 * dikembalikan ke pemanggil adalah `clientId` itu — jawaban FOTO dan tanda
 * panduan menunjuk foto lewat id ini, bukan lewat URL yang belum ada.
 */
export function AmbilFotoKunjungan({
  visitId,
  storeId,
  keterangan,
  label,
  disabled = false,
  variant = "outline",
  onDiambil,
}: {
  visitId: string;
  storeId: string;
  /** Keterangan foto di galeri kunjungan kantor, mis. teks pertanyaannya. */
  keterangan: string;
  label: string;
  disabled?: boolean;
  variant?: "outline" | "default" | "secondary";
  onDiambil: (clientId: string, pratinjau: string) => void;
}) {
  const t = useTranslations("pwa.checklist");
  const input = useRef<HTMLInputElement>(null);
  const [sibuk, setSibuk] = useState(false);

  const pilih = async (file: File) => {
    setSibuk(true);
    try {
      const kecil = await compressImage(file);
      const clientId = newLocalId();
      await enqueuePhoto({ localId: clientId, visitId, storeId, blob: kecil, caption: keterangan.slice(0, 200) || undefined });
      onDiambil(clientId, URL.createObjectURL(kecil));
      // Beri tahu layar lain (lencana "belum terkirim", tanda panduan) begitu
      // antrean selesai dicoba — berhasil atau tertahan karena sinyal.
      void flushPendingPhotos().finally(() => window.dispatchEvent(new Event(PERISTIWA_ANTREAN)));
    } catch {
      toast.error(t("fotoGagal"));
    } finally {
      setSibuk(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <>
      <Button type="button" variant={variant} className="w-full" disabled={disabled || sibuk} onClick={() => input.current?.click()}>
        {sibuk ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />}
        {label}
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pilih(f);
        }}
      />
    </>
  );
}

/**
 * Gambar kecil satu foto kunjungan. `url` = sudah naik; `pratinjau` = masih di
 * HP (blob). Tanpa keduanya (foto sudah naik tapi layar belum disegarkan, atau
 * diambil di HP lain) tampil sebagai ikon, bukan gambar rusak.
 */
export function FotoKecil({
  url,
  pratinjau,
  onHapus,
  labelHapus,
  labelMenunggu,
}: {
  url: string | null;
  pratinjau: string | null;
  onHapus?: () => void;
  labelHapus?: string;
  labelMenunggu: string;
}) {
  const src = url ?? pratinjau;
  return (
    <div className="relative h-20 w-20 overflow-hidden rounded-md border bg-muted">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="grid h-full w-full place-items-center text-muted-foreground">
          <ImageIcon className="h-6 w-6" aria-hidden />
        </span>
      )}
      {!url ? (
        <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/60 py-0.5 text-[10px] text-white">
          <CloudOff className="h-3 w-3" aria-hidden />
          {labelMenunggu}
        </span>
      ) : null}
      {onHapus ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onHapus}
          aria-label={labelHapus}
          className="absolute right-0 top-0 h-11 w-11 items-start justify-end rounded-none p-1 hover:bg-transparent"
        >
          <span className="grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white">
            <X className="h-3.5 w-3.5" aria-hidden />
          </span>
        </Button>
      ) : null}
    </div>
  );
}
