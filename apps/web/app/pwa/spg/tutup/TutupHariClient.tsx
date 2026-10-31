"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, Loader2, MessageCircle, Send, Trash2 } from "lucide-react";
import { kirimTutupHariAction } from "@/app/actions/spg-tutup-hari";
import { KeteranganKirim } from "@/app/pwa/KeteranganKirim";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { UnggahFoto, type NilaiFoto } from "@/components/foto/UnggahFoto";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatRupiah } from "@/lib/format/rupiah";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import type { AturanTutupHari } from "@/lib/spg/pengaturan";
import {
  adaSelisih,
  MAKS_CATATAN_TUTUP,
  MAKS_FOTO_TUTUP,
  MAKS_PENGUNJUNG,
  selisihKasir,
  tautanWaTutup,
  type RingkasanTutupHp,
} from "@/lib/spg/tutup-hari";
import { cn } from "@/lib/utils";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";

/** Laporan yang sudah tersimpan untuk hari ini, sebagaimana dilihat HP. */
export type LaporanHp = {
  oleh: string;
  olehSaya: boolean;
  jam: string;
  pengunjung: number | null;
  totalKasir: number | null;
  catatan: string | null;
  foto: string[];
  teksWa: string;
};

const KODE_GALAT = new Set([
  "FORBIDDEN",
  "NO_ASSIGNED_STORE",
  "VALIDATION",
  "HARI_TIDAK_SAH",
  "TOKO_TIDAK_DITEMUKAN",
  "KUNCI_TIDAK_SAH",
  "PENGUNJUNG_TIDAK_SAH",
  "KASIR_TIDAK_SAH",
  "CATATAN_TERLALU_PANJANG",
  "FOTO_TIDAK_SAH",
  "FOTO_TERLALU_BANYAK",
  "FOTO_WAJIB",
]);

const hanyaAngka = (s: string, maks: number) => s.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, maks);
const kelompok = (digit: string) => digit.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/**
 * Formulir tutup hari di HP SPG. Ringkasan di atas adalah angka sistem (semua
 * SPG toko ini); isian di bawah ditanyakan sesuai Pengaturan → SPG. Mengirim
 * ulang memperbarui laporan hari itu (jejaknya tersimpan). Sesudah terkirim,
 * laporan bisa dibagikan ke WhatsApp — teksnya dirakit server dari laporan
 * yang tersimpan.
 */
export function TutupHariClient({
  day,
  pilihan,
  labelHari,
  data,
  laporan,
  aturan,
  pengunjungTerhitung = null,
}: {
  day: string;
  pilihan: "hariIni" | "kemarin";
  labelHari: string;
  data: RingkasanTutupHp;
  laporan: LaporanHp | null;
  aturan: AturanTutupHari;
  /** Total penghitung pengunjung toko hari itu — mengisi isian kalau laporan belum ada. */
  pengunjungTerhitung?: number | null;
}) {
  const t = useTranslations("spgTutupHari.hp");
  const te = dinamis(useTranslations("spgTutupHari.err"));
  const ts = dinamis(useTranslations("spgTutupHari.sumber"));
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pindah, mulaiPindah] = useTransition();

  // Laporan yang sudah ada mengisi formulir: kirim ulang = memperbarui, bukan mengulang dari nol.
  // Belum ada laporan: isian pengunjung diambil dari penghitung (SPG tetap boleh mengubahnya).
  const [pengunjung, setPengunjung] = useState(
    laporan?.pengunjung != null ? String(laporan.pengunjung) : pengunjungTerhitung != null ? String(pengunjungTerhitung) : "",
  );
  const [kasir, setKasir] = useState(laporan?.totalKasir != null ? String(Math.round(laporan.totalKasir)) : "");
  const [catatan, setCatatan] = useState(laporan?.catatan ?? "");
  const [foto, setFoto] = useState<string[]>(laporan?.foto ?? []);
  // Satu kunci per kiriman: jawaban yang hilang lalu dikirim ulang tidak menulis jejak kedua.
  const [kunci, setKunci] = useState(() => newLocalId());
  const [teksWa, setTeksWa] = useState<string | null>(null);

  const nilaiPengunjung = pengunjung === "" ? null : Number(pengunjung);
  const nilaiKasir = kasir === "" ? null : Number(kasir);
  const selisih = aturan.tanyaTotalKasir ? selisihKasir(nilaiKasir, data.nilaiBersih) : null;

  const kurang = pending
    ? null
    : nilaiPengunjung !== null && nilaiPengunjung > MAKS_PENGUNJUNG
      ? t("kurangPengunjung")
      : aturan.wajibFoto && foto.length === 0
        ? t("kurangFoto")
        : null;

  const gantiHari = (p: "hariIni" | "kemarin") => {
    if (p === pilihan) return;
    mulaiPindah(() => router.replace(p === "kemarin" ? "/pwa/spg/tutup?hari=kemarin" : "/pwa/spg/tutup", { scroll: false }));
  };

  const tambahFoto = (n: NilaiFoto) => {
    if (!n) return;
    setFoto((lama) => (lama.includes(n.url) || lama.length >= MAKS_FOTO_TUTUP ? lama : [...lama, n.url]));
  };

  const kirim = () => {
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof kirimTutupHariAction>>;
      try {
        res = await kirimTutupHariAction({
          day,
          pengunjung: aturan.tanyaPengunjung ? nilaiPengunjung : null,
          totalKasir: aturan.tanyaTotalKasir ? nilaiKasir : null,
          catatan: catatan.trim() || null,
          foto,
          idempotencyKey: kunci,
        });
      } catch {
        // Jaringan putus: kunci dipertahankan, jadi mengetuk Kirim lagi aman.
        toast.error(te("NETWORK"));
        return;
      }
      if (!res.ok) {
        toast.error(te(KODE_GALAT.has(res.code) ? res.code : "GENERIC"));
        return;
      }
      setKunci(newLocalId());
      setTeksWa(res.teksWa);
      toast.success(res.diperbarui ? t("diperbarui") : t("terkirim"));
      router.refresh();
    });
  };

  const waSekarang = teksWa ?? laporan?.teksWa ?? null;

  return (
    <div className="flex min-h-dvh flex-col gap-4 p-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <TautanKembali cadangan="/pwa/spg/lainnya" />
      </Button>

      <header>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t("judul")}</h1>
          <TombolBantuanHp judul={t("judul")} />
        </div>
        <p className="text-sm text-muted-foreground">
          {data.namaToko} · {labelHari}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-2" role="group" aria-label={t("pilihHari")}>
        {(["hariIni", "kemarin"] as const).map((p) => (
          <Button key={p} variant={p === pilihan ? "default" : "outline"} aria-pressed={p === pilihan} disabled={pindah || pending} onClick={() => gantiHari(p)}>
            {p === "hariIni" ? t("hariIni") : t("kemarin")}
          </Button>
        ))}
      </div>

      {laporan || teksWa ? (
        <section className="beranda-kartu flex flex-col gap-3" aria-live="polite">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0 space-y-0.5">
              <p className="font-semibold leading-tight">{t("sudahJudul")}</p>
              {laporan ? (
                <p className="text-sm text-muted-foreground">
                  {laporan.olehSaya ? t("sudahOlehAnda", { jam: laporan.jam }) : t("sudahOleh", { nama: laporan.oleh, jam: laporan.jam })}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">{t("sudahUlang")}</p>
            </div>
          </div>
          {waSekarang ? (
            <Button asChild variant="outline" className="w-full">
              <a href={tautanWaTutup(waSekarang)} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="h-4 w-4" aria-hidden />
                {t("bagikanWa")}
              </a>
            </Button>
          ) : null}
        </section>
      ) : null}

      <div className={cn("flex flex-col gap-4 transition-opacity", pindah && "opacity-60")} aria-busy={pindah}>
        {/* Angka sistem: semua nota toko ini pada hari itu. */}
        <section className="beranda-kartu beranda-kartu-utama">
          <h2 className="beranda-judul">{t("bersihJudul")}</h2>
          <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{formatRupiah(data.nilaiBersih)}</p>
          <p className="text-sm tabular-nums">{t("notaPotong", { nota: data.nota, pcs: data.potong })}</p>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="opacity-80">{t("kotor")}</dt>
              <dd className="tabular-nums">{formatRupiah(data.nilaiKotor)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="opacity-80">{t("potongan")}</dt>
              <dd className="tabular-nums">{formatRupiah(data.potongan)}</dd>
            </div>
            {data.potongKembali > 0 ? (
              <div className="flex justify-between gap-3">
                <dt className="opacity-80">{t("retur", { pcs: data.potongKembali })}</dt>
                <dd className="tabular-nums">−{formatRupiah(data.nilaiRetur)}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className="space-y-2" aria-labelledby="tutup-terlaris">
          <h2 id="tutup-terlaris" className="beranda-judul px-1">
            {t("terlarisJudul")}
          </h2>
          {data.terlaris.length === 0 ? (
            <p className="beranda-kartu text-sm text-muted-foreground">{t("terlarisKosong")}</p>
          ) : (
            <ol className="beranda-kartu beranda-kartu-daftar divide-y">
              {data.terlaris.map((x, i) => (
                <li key={`${x.itemId}:${x.variantSku}`} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-5 shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1 font-medium leading-tight">{x.nama}</span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{t("pcs", { n: x.qty })}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {data.perSpg.length > 0 ? (
          <section className="space-y-2" aria-labelledby="tutup-per-spg">
            <h2 id="tutup-per-spg" className="beranda-judul px-1">
              {t("perSpgJudul")}
            </h2>
            <ul className="beranda-kartu beranda-kartu-daftar divide-y">
              {data.perSpg.map((x) => (
                <li key={x.userId} className="space-y-0.5 px-4 py-3">
                  <p className="font-medium leading-tight">
                    {x.nama}
                    {x.saya ? <span className="ml-1 text-xs font-normal text-muted-foreground">{t("anda")}</span> : null}
                  </p>
                  <p className="text-sm tabular-nums text-muted-foreground">{t("notaPotong", { nota: x.nota, pcs: x.potong })}</p>
                  {x.nilai !== null ? <p className="text-sm font-semibold tabular-nums">{formatRupiah(x.nilai)}</p> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {data.kiriman.length > 0 ? (
          <section className="space-y-2" aria-labelledby="tutup-kiriman">
            <h2 id="tutup-kiriman" className="beranda-judul px-1">
              {t("kirimanJudul")}
            </h2>
            <ul className="beranda-kartu beranda-kartu-daftar divide-y">
              {data.kiriman.map((k, i) => (
                <li key={`${k.docNo}:${i}`} className="space-y-0.5 px-4 py-3">
                  <p className="font-medium leading-tight">{k.docNo}</p>
                  <p className="text-sm text-muted-foreground">
                    {ts(k.sourceType)} · {t("diterima", { pcs: k.diterima })}
                    {k.rusak > 0 ? ` · ${t("rusak", { pcs: k.rusak })}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {data.dicari.length > 0 ? (
          <section className="space-y-2" aria-labelledby="tutup-dicari">
            <h2 id="tutup-dicari" className="beranda-judul px-1">
              {t("dicariJudul")}
            </h2>
            <ul className="beranda-kartu beranda-kartu-daftar divide-y">
              {data.dicari.map((x, i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1 leading-tight">{x.description}</span>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{t("pcs", { n: x.qty })}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="beranda-kartu space-y-4" aria-labelledby="tutup-isian">
          <h2 id="tutup-isian" className="beranda-judul">
            {t("isianJudul")}
          </h2>

          {aturan.tanyaPengunjung ? (
            <div className="space-y-1.5">
              <Label htmlFor="tutup-pengunjung">{t("pengunjung")}</Label>
              <Input
                id="tutup-pengunjung"
                inputMode="numeric"
                value={pengunjung}
                onChange={(e) => setPengunjung(hanyaAngka(e.target.value, 6))}
                placeholder={t("pengunjungContoh")}
                disabled={pending}
                className="tabular-nums"
              />
              <p className="text-xs text-muted-foreground">
                {pengunjungTerhitung != null ? t("pengunjungDariPenghitung", { jumlah: pengunjungTerhitung }) : t("pengunjungIsi")}
              </p>
            </div>
          ) : null}

          {aturan.tanyaTotalKasir ? (
            <div className="space-y-1.5">
              <Label htmlFor="tutup-kasir">{t("kasir")}</Label>
              <Input
                id="tutup-kasir"
                inputMode="numeric"
                value={kelompok(kasir)}
                onChange={(e) => setKasir(hanyaAngka(e.target.value, 10))}
                placeholder={t("kasirContoh")}
                disabled={pending}
                className="tabular-nums"
              />
              <p className="text-xs text-muted-foreground">{t("kasirIsi")}</p>
              {adaSelisih(selisih) ? (
                <p className="rounded-md bg-amber-500/15 px-3 py-2 text-sm text-amber-900 dark:text-amber-200" role="status">
                  <span className="block font-semibold tabular-nums">{t("selisih", { nilai: formatRupiah(Math.abs(selisih!)) })}</span>
                  <span className="block text-xs">{selisih! > 0 ? t("selisihLebih") : t("selisihKurang")}</span>
                </p>
              ) : selisih !== null ? (
                <p className="text-sm text-emerald-700 dark:text-emerald-300" role="status">
                  {t("sesuai")}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="tutup-catatan">{t("catatan")}</Label>
            <Textarea
              id="tutup-catatan"
              value={catatan}
              onChange={(e) => setCatatan(e.target.value.slice(0, MAKS_CATATAN_TUTUP))}
              placeholder={t("catatanContoh")}
              rows={3}
              disabled={pending}
            />
          </div>

          <div className="space-y-2">
            {foto.length > 0 ? (
              <ul className="grid grid-cols-3 gap-2">
                {foto.map((url, i) => (
                  <li key={url} className="relative overflow-hidden rounded-lg border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={t("fotoKe", { n: i + 1 })} className="aspect-square w-full object-cover" />
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      className="absolute right-1 top-1"
                      onClick={() => setFoto((lama) => lama.filter((u) => u !== url))}
                      disabled={pending}
                      aria-label={t("hapusFoto", { n: i + 1 })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            {foto.length < MAKS_FOTO_TUTUP ? (
              <UnggahFoto
                label={t("foto")}
                petunjuk={t("fotoIsi", { maks: MAKS_FOTO_TUTUP })}
                nilai={null}
                onChange={tambahFoto}
                wajib={aturan.wajibFoto}
                disabled={pending}
              />
            ) : (
              <p className="text-xs text-muted-foreground">{t("fotoPenuh", { maks: MAKS_FOTO_TUTUP })}</p>
            )}
          </div>
        </section>
      </div>

      <div className="sticky bottom-0 z-20 -mx-4 -mb-4 mt-auto space-y-2 border-t bg-background/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
        <Button type="button" size="lg" className="w-full" onClick={kirim} disabled={pending || pindah || kurang !== null}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
          {laporan ? t("kirimUlang") : t("kirim")}
        </Button>
        <KeteranganKirim teks={kurang} />
      </div>
    </div>
  );
}
