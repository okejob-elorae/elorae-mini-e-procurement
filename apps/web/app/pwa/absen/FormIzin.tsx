"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { KeteranganKirim } from "../KeteranganKirim";
import { toast } from "sonner";
import { CloudOff, Loader2, Send, TriangleAlert } from "lucide-react";
import { ajukanIzinAction } from "@/app/actions/izin";
import { UnggahFoto, type NilaiFoto } from "@/components/foto/UnggahFoto";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import {
  BATAS_ALASAN_IZIN,
  geserHari,
  hitungHariKerja,
  JENIS_IZIN,
  MAKS_HARI_AJUAN,
  MUNDUR_MAKS_HARI,
  periksaAjuanIzin,
  tanggalSah,
  type AjuanLain,
  type JenisIzin,
} from "@/lib/salesman/izin";
import { cn } from "@/lib/utils";
import { IkonJenisIzin } from "./tampilan-izin";
import { RentangTanggalInput } from "@/components/ui/rentang-tanggal-input";

/**
 * Lembar "Ajukan izin / sakit / cuti".
 *
 * HANYA DARING: keputusan kantor tidak bisa menunggu antrean, dan ajuan yang
 * tertahan di HP terbaca "sudah diajukan" oleh pemiliknya padahal kantor
 * belum melihatnya. Tanpa sinyal, isian tidak dibuang — tekan Kirim lagi saat
 * sinyal kembali. Kunci kiriman dibuat sekali per lembar, jadi kiriman ulang
 * tidak pernah menjadi dua ajuan.
 *
 * Pemeriksaan di sini sama dengan server (`periksaAjuanIzin`) supaya penolakan
 * terlihat sebelum foto diunggah; server tetap yang menentukan.
 */
export function FormIzin({
  buka,
  onBuka,
  hariIni,
  kuotaCutiTahunan,
  lain,
  hariTidakKerja,
}: {
  buka: boolean;
  onBuka: (v: boolean) => void;
  /** Hari ini WIB, dari server. */
  hariIni: string;
  kuotaCutiTahunan: number;
  /** Ajuan saya yang lain — untuk peringatan bentrok/kuota sebelum mengirim. */
  lain: AjuanLain[];
  /** Hari libur saya (salesman: Minggu; SPG: menurut pengaturan) — sama dengan yang dipakai server. */
  hariTidakKerja: readonly number[];
}) {
  const t = useTranslations("pwa.izin");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulaiKirim] = useTransition();
  const [kunci, setKunci] = useState(newLocalId);
  const [jenis, setJenis] = useState<JenisIzin | null>(null);
  const [mulai, setMulai] = useState(hariIni);
  const [selesai, setSelesai] = useState(hariIni);
  const [alasan, setAlasan] = useState("");
  const [foto, setFoto] = useState<NilaiFoto>(null);
  const [daring, setDaring] = useState(true);

  useEffect(() => {
    const segarkan = () => setDaring(navigator.onLine);
    segarkan();
    window.addEventListener("online", segarkan);
    window.addEventListener("offline", segarkan);
    return () => {
      window.removeEventListener("online", segarkan);
      window.removeEventListener("offline", segarkan);
    };
  }, []);

  const kosongkan = () => {
    setJenis(null);
    setMulai(hariIni);
    setSelesai(hariIni);
    setAlasan("");
    setFoto(null);
    setKunci(newLocalId());
  };

  const palingAwal = jenis === "CUTI" ? hariIni : geserHari(hariIni, -MUNDUR_MAKS_HARI);
  const tanggalBenar = tanggalSah(mulai) && tanggalSah(selesai) && selesai >= mulai;
  const hariKerja = tanggalBenar ? hitungHariKerja(mulai, selesai, undefined, hariTidakKerja) : 0;
  const cek = useMemo(
    () =>
      jenis
        ? periksaAjuanIzin(
            { jenis, mulai, selesai, alasan: alasan || "-", fotoUrl: foto ? "/api/foto/pratinjau" : null },
            { hariIni, lain, kuotaCutiTahunan, hariTidakKerja },
          )
        : null,
    [jenis, mulai, selesai, alasan, foto, hariIni, lain, kuotaCutiTahunan, hariTidakKerja],
  );
  // Alasan diperiksa terpisah: peringatan tanggal tidak boleh tertutup "alasan wajib" selama orang masih mengetik.
  const galatTanggal = cek && !cek.ok ? cek : null;
  const fotoDisarankan = jenis === "SAKIT" && hariKerja > 1 && foto === null;
  const lengkap = jenis !== null && alasan.trim() !== "" && cek?.ok === true;
  const kurang =
    jenis === null
      ? t("kurangJenis")
      : // Tanggal atau foto yang belum sah sudah diterangkan kotak merah di atasnya.
        !cek?.ok
        ? null
        : alasan.trim() === ""
          ? t("kurangAlasan")
          : null;

  const batas = { maks: MAKS_HARI_AJUAN, hari: MUNDUR_MAKS_HARI };
  const pesanGalat = (r: { kode: string; tahun?: string; sisa?: number }) =>
    r.kode === "KUOTA_CUTI_HABIS" ? t("err.KUOTA_CUTI_HABIS", { tahun: r.tahun ?? "", sisa: r.sisa ?? 0 }) : td(`err.${r.kode}`, batas);

  const kirim = () =>
    mulaiKirim(async () => {
      if (!jenis) return;
      if (!navigator.onLine) {
        setDaring(false);
        toast.error(t("luring"));
        return;
      }
      // `UnggahFoto` (tanpa `simpanDiHp`) mengunggah saat dipilih: nilainya sudah URL /api/foto/….
      const fotoUrl = foto?.url ?? null;
      let hasil: Awaited<ReturnType<typeof ajukanIzinAction>>;
      try {
        hasil = await ajukanIzinAction({ jenis, mulai, selesai, alasan: alasan.trim(), fotoUrl, idempotencyKey: kunci });
      } catch {
        // Aksi server yang tidak terjangkau melempar — itu sinyal, bukan isian.
        toast.error(t("luring"));
        return;
      }
      if (hasil.ok) {
        toast.success(t("terkirim"));
        kosongkan();
        onBuka(false);
        router.refresh();
      } else {
        toast.error(pesanGalat(hasil));
      }
    });

  return (
    <Sheet open={buka} onOpenChange={(v) => !sibuk && onBuka(v)}>
      <SheetContent side="bottom" className="mx-auto flex max-h-[92dvh] w-full max-w-xl flex-col gap-0 p-0">
        <SheetHeader className="border-b pb-3">
          <SheetTitle>{t("formJudul")}</SheetTitle>
          <SheetDescription>{t("formIsi")}</SheetDescription>
        </SheetHeader>

        <div className="space-y-5 overflow-y-auto p-4">
          {!daring ? (
            <p
              role="status"
              className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
            >
              <CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {t("luring")}
            </p>
          ) : null}

          <div className="space-y-2">
            <Label id="izin-jenis">
              {t("jenisLabel")}
              <span className="ml-1 text-destructive">*</span>
            </Label>
            <div role="radiogroup" aria-labelledby="izin-jenis" className="grid grid-cols-3 gap-2">
              {JENIS_IZIN.map((j) => {
                const pilih = jenis === j;
                return (
                  <Button
                    key={j}
                    type="button"
                    role="radio"
                    aria-checked={pilih}
                    variant="outline"
                    disabled={sibuk}
                    onClick={() => {
                      setJenis(j);
                      // Cuti tidak boleh mundur: tanggal lampau digeser ke hari ini.
                      if (j === "CUTI" && mulai < hariIni) {
                        setMulai(hariIni);
                        if (selesai < hariIni) setSelesai(hariIni);
                      }
                    }}
                    className={cn(
                      "h-auto min-h-16 flex-col gap-1 whitespace-normal py-3",
                      pilih && "border-primary bg-primary/10 ring-1 ring-primary",
                    )}
                  >
                    <IkonJenisIzin jenis={j} className="h-5 w-5" />
                    <span className="text-sm font-medium">{td(`jenis.${j}`)}</span>
                  </Button>
                );
              })}
            </div>
            {jenis ? <p className="text-xs text-muted-foreground">{td(`jenisPetunjuk.${jenis}`, batas)}</p> : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="izin-tanggal">{t("tanggalLabel")}</Label>
            <RentangTanggalInput
              id="izin-tanggal"
              required
              pilihanCepat={false}
              maksHari={MAKS_HARI_AJUAN}
              min={palingAwal}
              dari={mulai}
              sampai={selesai}
              onChange={({ dari, sampai }) => {
                setMulai(dari);
                setSelesai(sampai);
              }}
              disabled={sibuk}
            />
          </div>
          <p className="-mt-3 text-xs text-muted-foreground">
            {tanggalBenar ? t("hariKerja", { n: hariKerja }) : t("tanggalPetunjuk", batas)}
          </p>

          {galatTanggal && galatTanggal.kode !== "ALASAN_WAJIB" ? (
            <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {pesanGalat(galatTanggal)}
            </p>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="izin-alasan">
              {t("alasanLabel")}
              <span className="ml-1 text-destructive">*</span>
            </Label>
            <Textarea
              id="izin-alasan"
              value={alasan}
              maxLength={BATAS_ALASAN_IZIN}
              rows={3}
              placeholder={jenis ? td(`alasanContoh.${jenis}`) : t("alasanPetunjuk")}
              onChange={(e) => setAlasan(e.target.value)}
              disabled={sibuk}
            />
          </div>

          <UnggahFoto
            label={jenis === "SAKIT" ? t("fotoSuratLabel") : t("fotoLabel")}
            petunjuk={jenis === "SAKIT" ? t("fotoSuratPetunjuk") : t("fotoPetunjuk")}
            nilai={foto}
            onChange={setFoto}
            disabled={sibuk || !daring}
          />
          {fotoDisarankan ? (
            <p className="-mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
              {t("fotoDisarankan")}
            </p>
          ) : null}
        </div>

        <div className="border-t p-4">
          <Button className="w-full" size="lg" onClick={kirim} disabled={sibuk || !lengkap}>
            {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Send className="mr-2 h-4 w-4" aria-hidden />}
            {jenis && hariKerja > 0 ? t("kirimJenis", { jenis: td(`jenis.${jenis}`), n: hariKerja }) : t("kirim")}
          </Button>
          {!sibuk && <KeteranganKirim teks={kurang} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
