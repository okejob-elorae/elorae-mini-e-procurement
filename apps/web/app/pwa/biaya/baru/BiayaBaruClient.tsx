"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { KeteranganKirim } from "../../KeteranganKirim";
import { toast } from "sonner";
import { CloudOff, Loader2, MapPin, Send } from "lucide-react";
import { ajukanBiayaAction } from "@/app/actions/expense-claims";
import { UnggahFoto, type NilaiFoto } from "@/components/foto/UnggahFoto";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { unggahFoto } from "@/lib/foto/unggah";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { nasibUnggah } from "@/lib/pwa/offline/laporan-classify";
import { formatIDR } from "@/lib/sales-orders/format";
import { BATAS_CATATAN, BATAS_NILAI_BIAYA, KATEGORI_BIAYA, periksaBiaya, type KategoriBiaya } from "@/lib/salesman/biaya";
import type { BahanBiayaBaru } from "@/lib/salesman/biaya-queries";
import { cn } from "@/lib/utils";
import { IkonKategori } from "../tampilan";

import { TautanKembali } from "@/app/pwa/TautanKembali";
import { TanggalInput } from "@/components/ui/tanggal-input";
const angkaSaja = (s: string) => s.replace(/\D/g, "");
const kelompok = new Intl.NumberFormat("id-ID");

/** URL foto untuk server; unggah dulu kalau masih berkas yang disimpan di HP. */
const naikkan = async (f: NilaiFoto): Promise<string | null> =>
  f ? (f.berkas ? unggahFoto(new File([f.berkas], f.nama, { type: f.berkas.type || "image/jpeg" })) : f.url) : null;

/**
 * Formulir ajukan biaya perjalanan.
 *
 * SEMENTARA HANYA DARING. Antrean laporan luring (`lib/pwa/offline/laporan-*`)
 * sedang diubah di cabang lain; sampai biaya ikut antrean itu, tanpa sinyal
 * formulir TIDAK mengirim dan TIDAK membuang isian — fotonya tetap disimpan di
 * HP (`simpanDiHp`), salesman cukup menekan Kirim lagi saat sinyal kembali.
 * Kunci kiriman dibuat sekali saat formulir dibuka, jadi kiriman ulang itu
 * tidak pernah menjadi dua klaim.
 */
export function BiayaBaruClient({ bahan }: { bahan: BahanBiayaBaru }) {
  const t = useTranslations("pwa.biaya");
  const td = dinamis(t);
  const tFoto = useTranslations("foto");
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [kunci] = useState(newLocalId);

  const [tanggal, setTanggal] = useState(bahan.hariIni);
  const [kategori, setKategori] = useState<KategoriBiaya | null>(null);
  const [nilai, setNilai] = useState("");
  const [foto, setFoto] = useState<NilaiFoto>(null);
  const [catatan, setCatatan] = useState("");
  const [daring, setDaring] = useState(true);
  const [tertahan, setTertahan] = useState(false);

  useEffect(() => {
    const segarkan = () => {
      setDaring(navigator.onLine);
      if (navigator.onLine) setTertahan(false);
    };
    segarkan();
    window.addEventListener("online", segarkan);
    window.addEventListener("offline", segarkan);
    return () => {
      window.removeEventListener("online", segarkan);
      window.removeEventListener("offline", segarkan);
    };
  }, []);

  const { pengaturan } = bahan;
  const perluCatatan = kategori === "LAINNYA";
  const lengkap =
    kategori !== null &&
    Number(nilai) > 0 &&
    tanggal !== "" &&
    (!pengaturan.fotoWajib || foto !== null) &&
    (!perluCatatan || catatan.trim() !== "");
  const kurang =
    kategori === null
      ? t("kurangJenis")
      : !(Number(nilai) > 0)
        ? t("kurangJumlah")
        : tanggal === ""
          ? t("kurangTanggal")
          : pengaturan.fotoWajib && foto === null
            ? t("kurangFoto")
            : perluCatatan && catatan.trim() === ""
              ? t("kurangCatatan")
              : null;

  const kirim = () =>
    mulai(async () => {
      if (!kategori) return;
      // Pemeriksaan yang sama dengan server, supaya penolakan terlihat sebelum
      // foto diunggah. Server tetap yang menjaga (jam HP bisa salah).
      const cek = periksaBiaya(
        { tanggal, kategori, nilai: Number(nilai), catatan, fotoUrl: foto ? "/api/foto/pratinjau" : null },
        pengaturan,
        new Date(),
      );
      if (!cek.ok) {
        toast.error(td(`err.${cek.kode}`));
        return;
      }
      if (!navigator.onLine) {
        setTertahan(true);
        return;
      }

      let fotoUrl: string | null;
      try {
        fotoUrl = await naikkan(foto);
      } catch (err) {
        // Foto yang DITOLAK server (terlalu besar, bukan gambar) tidak akan lolos
        // dicoba ulang — sampaikan. Selebihnya sinyal putus di tengah jalan.
        if (nasibUnggah(err) === "terminal") {
          toast.error(tFoto(`err${err instanceof Error ? err.message : "GAGAL"}` as never));
        } else {
          setTertahan(true);
        }
        return;
      }

      let hasil: Awaited<ReturnType<typeof ajukanBiayaAction>>;
      try {
        hasil = await ajukanBiayaAction({
          tanggal,
          kategori,
          nilai: Number(nilai),
          catatan: catatan.trim() || null,
          fotoUrl,
          visitId: bahan.kunjungan?.id ?? null,
          idempotencyKey: kunci,
        });
      } catch {
        // Aksi server yang tidak terjangkau melempar — itu sinyal, bukan isian.
        setTertahan(true);
        return;
      }
      if (hasil.ok) {
        toast.success(t("terkirim"));
        router.replace("/pwa/biaya");
        router.refresh();
      } else {
        toast.error(td(`err.${hasil.kode}`));
      }
    });

  return (
    <div className="space-y-4 p-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <TautanKembali cadangan="/pwa/biaya" />
      </Button>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{t("baruJudul")}</h1>
        <p className="text-sm text-muted-foreground">{t("baruSubjudul")}</p>
      </header>

      {!pengaturan.aktif ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">{t("nonaktif")}</p>
      ) : (
        <>
          {!daring || tertahan ? (
            <p
              role="status"
              className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
            >
              <CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {t("luring")}
            </p>
          ) : null}

          {bahan.kunjungan ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 shrink-0" aria-hidden />
              {t("tertautKunjungan", { toko: bahan.kunjungan.toko })}
            </p>
          ) : null}

          <section className="beranda-kartu space-y-5">
            <div className="space-y-2">
              <Label id="biaya-kategori">
                {t("kategoriLabel")}
                <span className="ml-1 text-destructive">*</span>
              </Label>
              <div role="radiogroup" aria-labelledby="biaya-kategori" className="grid grid-cols-3 gap-2">
                {KATEGORI_BIAYA.map((k) => {
                  const pilih = kategori === k;
                  return (
                    <Button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={pilih}
                      variant="outline"
                      disabled={sibuk}
                      onClick={() => setKategori(k)}
                      className={cn(
                        "h-auto min-h-16 flex-col gap-1 whitespace-normal py-3",
                        pilih && "border-primary bg-primary/10 ring-1 ring-primary",
                      )}
                    >
                      <IkonKategori kategori={k} className="h-5 w-5" />
                      <span className="text-sm font-medium">{td(`kategori.${k}`)}</span>
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="biaya-nilai">
                {t("nilaiLabel")}
                <span className="ml-1 text-destructive">*</span>
              </Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  Rp
                </span>
                <Input
                  id="biaya-nilai"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  className="pl-10 text-lg tabular-nums"
                  value={nilai ? kelompok.format(Number(nilai)) : ""}
                  placeholder="0"
                  onChange={(e) => setNilai(angkaSaja(e.target.value).slice(0, 10))}
                  disabled={sibuk}
                />
              </div>
              <p className="text-xs text-muted-foreground">{t("nilaiPetunjuk", { maks: formatIDR(BATAS_NILAI_BIAYA) })}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="biaya-tanggal">{t("tanggalLabel")}</Label>
              <TanggalInput
                id="biaya-tanggal"
                value={tanggal}
                min={bahan.palingLama}
                max={bahan.hariIni}
                onChange={(e) => setTanggal(e.target.value)}
                disabled={sibuk}
              />
              <p className="text-xs text-muted-foreground">{t("tanggalPetunjuk", { hari: pengaturan.batasHari })}</p>
            </div>

            <UnggahFoto
              label={t("fotoLabel")}
              petunjuk={t("fotoPetunjuk")}
              nilai={foto}
              onChange={setFoto}
              wajib={pengaturan.fotoWajib}
              disabled={sibuk}
              simpanDiHp
            />

            <div className="space-y-2">
              <Label htmlFor="biaya-catatan">
                {t("catatanLabel")}
                {perluCatatan ? <span className="ml-1 text-destructive">*</span> : null}
              </Label>
              <Textarea
                id="biaya-catatan"
                value={catatan}
                maxLength={BATAS_CATATAN}
                rows={3}
                placeholder={perluCatatan ? t("catatanWajibPetunjuk") : t("catatanPetunjuk")}
                onChange={(e) => setCatatan(e.target.value)}
                disabled={sibuk}
              />
            </div>
          </section>

          <Button className="w-full" size="lg" onClick={kirim} disabled={sibuk || !lengkap}>
            {sibuk ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Send className="mr-2 h-4 w-4" aria-hidden />
            )}
            {nilai && Number(nilai) > 0 ? t("kirimNilai", { nilai: formatIDR(Number(nilai)) }) : t("kirim")}
          </Button>
          {!sibuk && <KeteranganKirim teks={kurang} />}
        </>
      )}
    </div>
  );
}
