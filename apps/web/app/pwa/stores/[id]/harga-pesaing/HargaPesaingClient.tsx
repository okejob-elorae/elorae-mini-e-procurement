"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { KeteranganKirim } from "../../../KeteranganKirim";
import { toast } from "sonner";
import { CloudOff, ImageIcon, Loader2, Send, Tag } from "lucide-react";
import { catatHargaPesaingAction, type HasilCatatHargaPesaing } from "@/app/actions/harga-pesaing";
import { UnggahFoto, type NilaiFoto } from "@/components/foto/UnggahFoto";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { unggahFoto } from "@/lib/foto/unggah";
import { dinamis } from "@/lib/i18n/dinamis";
import { nasibUnggah } from "@/lib/pwa/offline/laporan-classify";
import { formatIDR } from "@/lib/sales-orders/format";
import { BATAS_HARGA_PESAING, periksaHargaPesaing } from "@/lib/salesman/harga-pesaing";
import type { BarisHargaPesaing } from "@/lib/salesman/checklist-queries";

import { TautanKembali } from "@/app/pwa/TautanKembali";
const angkaSaja = (s: string) => s.replace(/\D/g, "");
const kelompok = new Intl.NumberFormat("id-ID");

/** URL foto untuk server; unggah dulu kalau masih berkas yang disimpan di HP. */
const naikkan = async (f: NilaiFoto): Promise<string | null> =>
  f ? (f.berkas ? unggahFoto(new File([f.berkas], f.nama, { type: f.berkas.type || "image/jpeg" })) : f.url) : null;

/**
 * Formulir harga pesaing + catatan terakhir di toko ini.
 *
 * HANYA DARING, seperti biaya perjalanan: tanpa sinyal formulir tidak mengirim
 * dan tidak membuang isian, fotonya tetap di HP (`simpanDiHp`). Kiriman ulang
 * berisi sama dalam beberapa menit dikenali server sebagai satu catatan.
 * Merek dan kategori dipertahankan sesudah terkirim — salesman biasanya
 * mencatat beberapa produk dari merek yang sama berturut-turut.
 */
export function HargaPesaingClient({
  toko,
  visitId,
  terakhir,
  saran,
}: {
  toko: { id: string; nama: string };
  visitId: string;
  terakhir: BarisHargaPesaing[];
  saran: { merek: string[]; kategori: string[] };
}) {
  const t = useTranslations("pwa.hargaPesaing");
  const td = dinamis(t);
  const tFoto = useTranslations("foto");
  const router = useRouter();
  const [sibuk, mulai] = useTransition();

  const [merek, setMerek] = useState("");
  const [produk, setProduk] = useState("");
  const [kategori, setKategori] = useState("");
  const [harga, setHarga] = useState("");
  const [foto, setFoto] = useState<NilaiFoto>(null);
  const [catatan, setCatatan] = useState("");
  const [daring, setDaring] = useState(true);
  const [tertahan, setTertahan] = useState(false);
  // Kunci baru setiap formulir dikosongkan — mereset UnggahFoto bersama isiannya.
  const [kunciForm, setKunciForm] = useState(0);

  useEffect(() => {
    const segarkan = () => {
      setDaring(navigator.onLine);
      if (navigator.onLine) setTertahan(false);
    };
    queueMicrotask(segarkan);
    window.addEventListener("online", segarkan);
    window.addEventListener("offline", segarkan);
    return () => {
      window.removeEventListener("online", segarkan);
      window.removeEventListener("offline", segarkan);
    };
  }, []);

  const lengkap = merek.trim() !== "" && produk.trim() !== "" && Number(harga) > 0;
  const kurang =
    merek.trim() === ""
      ? t("kurangMerek")
      : produk.trim() === ""
        ? t("kurangProduk")
        : !(Number(harga) > 0)
          ? t("kurangHarga")
          : null;

  const kirim = () =>
    mulai(async () => {
      const isian = {
        brand: merek,
        productName: produk,
        category: kategori || null,
        price: Number(harga),
        note: catatan || null,
      };
      // Pemeriksaan yang sama dengan server, sebelum foto diunggah.
      const cek = periksaHargaPesaing(isian);
      if (!cek.ok) {
        toast.error(td(`err.${cek.kode}`));
        return;
      }
      if (!navigator.onLine) {
        setTertahan(true);
        return;
      }
      let photoUrl: string | null;
      try {
        photoUrl = await naikkan(foto);
      } catch (err) {
        if (nasibUnggah(err) === "terminal") toast.error(tFoto(`err${err instanceof Error ? err.message : "GAGAL"}` as never));
        else setTertahan(true);
        return;
      }
      let r: HasilCatatHargaPesaing;
      try {
        r = await catatHargaPesaingAction({ storeId: toko.id, visitId, ...isian, photoUrl });
      } catch {
        setTertahan(true);
        return;
      }
      if (!r.ok) {
        toast.error(td(`err.${r.kode}`));
        return;
      }
      toast.success(t("terkirim"));
      setProduk("");
      setHarga("");
      setFoto(null);
      setCatatan("");
      setKunciForm((k) => k + 1);
      setTertahan(false);
      router.refresh();
    });

  return (
    <div className="space-y-4 p-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <TautanKembali cadangan={`/pwa/stores/${toko.id}`} />
      </Button>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{t("judul")}</h1>
        <p className="text-sm text-muted-foreground">{t("subjudul", { toko: toko.nama })}</p>
      </header>

      {!daring || tertahan ? (
        <p role="status" className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {t("luring")}
        </p>
      ) : null}

      <section className="beranda-kartu space-y-4">
        <div className="space-y-2">
          <Label htmlFor="hp-merek">
            {t("merekLabel")}
            <span className="ml-1 text-destructive">*</span>
          </Label>
          <Input
            id="hp-merek"
            list="hp-saran-merek"
            autoComplete="off"
            maxLength={BATAS_HARGA_PESAING.merek}
            value={merek}
            placeholder={t("merekPetunjuk")}
            onChange={(e) => setMerek(e.target.value)}
            disabled={sibuk}
          />
          <datalist id="hp-saran-merek">
            {saran.merek.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>

        <div className="space-y-2">
          <Label htmlFor="hp-produk">
            {t("produkLabel")}
            <span className="ml-1 text-destructive">*</span>
          </Label>
          <Input
            id="hp-produk"
            autoComplete="off"
            maxLength={BATAS_HARGA_PESAING.produk}
            value={produk}
            placeholder={t("produkPetunjuk")}
            onChange={(e) => setProduk(e.target.value)}
            disabled={sibuk}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="hp-kategori">{t("kategoriLabel")}</Label>
          <Input
            id="hp-kategori"
            list="hp-saran-kategori"
            autoComplete="off"
            maxLength={BATAS_HARGA_PESAING.kategori}
            value={kategori}
            placeholder={t("kategoriPetunjuk")}
            onChange={(e) => setKategori(e.target.value)}
            disabled={sibuk}
          />
          <datalist id="hp-saran-kategori">
            {saran.kategori.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
        </div>

        <div className="space-y-2">
          <Label htmlFor="hp-harga">
            {t("hargaLabel")}
            <span className="ml-1 text-destructive">*</span>
          </Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">Rp</span>
            <Input
              id="hp-harga"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              className="pl-10 text-lg tabular-nums"
              value={harga ? kelompok.format(Number(harga)) : ""}
              placeholder="0"
              onChange={(e) => setHarga(angkaSaja(e.target.value).slice(0, 9))}
              disabled={sibuk}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t("hargaPetunjuk")}</p>
        </div>

        <UnggahFoto
          key={kunciForm}
          label={t("fotoLabel")}
          petunjuk={t("fotoPetunjuk")}
          nilai={foto}
          onChange={setFoto}
          disabled={sibuk}
          simpanDiHp
        />

        <div className="space-y-2">
          <Label htmlFor="hp-catatan">{t("catatanLabel")}</Label>
          <Textarea
            id="hp-catatan"
            rows={2}
            maxLength={BATAS_HARGA_PESAING.catatan}
            value={catatan}
            placeholder={t("catatanPetunjuk")}
            onChange={(e) => setCatatan(e.target.value)}
            disabled={sibuk}
          />
        </div>
      </section>

      <Button className="w-full" size="lg" onClick={kirim} disabled={sibuk || !lengkap}>
        {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Send className="mr-2 h-4 w-4" aria-hidden />}
        {t("kirim")}
      </Button>
      {!sibuk && <KeteranganKirim teks={kurang} />}

      <section className="beranda-kartu beranda-kartu-daftar">
        <h2 className="beranda-judul px-4 pt-3">{t("terakhirJudul")}</h2>
        {terakhir.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">{t("terakhirKosong")}</p>
        ) : (
          <ul className="divide-y">
            {terakhir.map((b) => (
              <li key={b.id} className="flex min-h-14 items-start gap-3 px-4 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Tag className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium leading-tight">
                    {b.merek} · {b.produk}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {[b.kategori, b.tanggal, b.oleh].filter(Boolean).join(" · ")}
                  </span>
                  {b.catatan ? <span className="block whitespace-pre-line text-xs text-muted-foreground">{b.catatan}</span> : null}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-semibold tabular-nums">{formatIDR(b.harga)}</span>
                  {b.fotoUrl ? (
                    <a
                      href={b.fotoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
                    >
                      <ImageIcon className="h-3.5 w-3.5" aria-hidden />
                      {t("lihatFoto")}
                    </a>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
