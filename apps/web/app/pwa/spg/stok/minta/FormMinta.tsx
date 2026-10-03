"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Loader2, Minus, Plus, Search, Send, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { mintaKirimanAction } from "@/app/actions/spg-stok";
import { dinamis } from "@/lib/i18n/dinamis";
import type { HasilSaranMinta } from "@/lib/spg/saran-minta-queries";
import type { AlasanPermintaan, BarisTambahan } from "@/lib/spg/saran-minta";
import { kunciBaris } from "@/lib/spg/stok";
import { cn } from "@/lib/utils";
import { cocokCari, type BarisPilihan } from "../barang-pilihan";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { bacaDraf, hapusDraf, tulisDraf } from "./draf";
import { SaranMinta } from "./SaranMinta";

import { TautanKembali } from "@/app/pwa/TautanKembali";
import { KeteranganKirim } from "@/app/pwa/KeteranganKirim";
/** Hasil pencarian yang dirender sekaligus — katalog bisa ribuan varian. */
const BATAS_HASIL = 30;
const QTY_MAKS = 10_000;

const KODE_GALAT = new Set([
  "FORBIDDEN",
  "NO_ASSIGNED_STORE",
  "VALIDATION",
  "TANPA_BARIS",
  "JUMLAH_TIDAK_VALID",
  "BARANG_TIDAK_DITEMUKAN",
  "ALASAN_TIDAK_VALID",
]);

type Dipilih = { barang: BarisPilihan; qty: string; alasan: AlasanPermintaan };

const angka = (s: string) => (s === "" ? null : Number(s));
const sah = (s: string) => {
  const n = angka(s);
  return n !== null && Number.isInteger(n) && n >= 1 && n <= QTY_MAKS;
};

/**
 * Formulir minta kiriman SPG. Permintaannya sampai ke kantor DAN ke salesman
 * pemegang toko (kalau ada), yang bisa langsung membuatkan pesanannya.
 *
 * Barang bisa datang dari tiga jalan: saran (laku di toko lain, sering
 * dikirim, barang baru — membawa alasannya), tombol "Minta" di layar analisa
 * (`?tambah=`, alasan LAKU_DI_SINI), atau dipilih sendiri dari pencarian
 * (MANUAL). Daftarnya disimpan sebagai draf per toko (`draf.ts`), jadi
 * beberapa "Minta" dari layar analisa terkumpul di satu permintaan.
 */
export function FormMinta({
  storeId,
  namaToko,
  pemegang,
  pilihan,
  saran,
  tambahAwal,
}: {
  /** Kunci draf — draf toko lain tidak pernah terbawa. */
  storeId: string;
  namaToko: string;
  /** Nama salesman pemegang toko; null bila toko belum punya pemegang. */
  pemegang: string | null;
  pilihan: BarisPilihan[];
  saran: HasilSaranMinta | null;
  /** Baris dari alamat (`?tambah=`), ditambahkan ke draf sekali saat layar dibuka. */
  tambahAwal: BarisTambahan[];
}) {
  const t = useTranslations("pwa.spgStok.request");
  const tf = useTranslations("pwa.spgStok.formMinta");
  const td = dinamis(useTranslations("pwa.spgStok"));
  const tAlasan = dinamis(useTranslations("alasanPermintaanSpg"));
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Satu kunci per formulir: kiriman ulang setelah jawaban server hilang di
  // jalan tidak membuat permintaan ganda. Diganti hanya setelah berhasil, dan
  // ikut tersimpan di draf.
  const [kunciKirim, setKunciKirim] = useState(() => newLocalId());
  const [cari, setCari] = useState("");
  const [dipilih, setDipilih] = useState<Dipilih[]>([]);
  const [catatan, setCatatan] = useState("");
  // Draf dibaca setelah mount (server merender daftar kosong). Sebelum itu
  // tidak ada yang ditulis, supaya draf tidak tertimpa daftar kosong.
  const [drafSiap, setDrafSiap] = useState(false);

  const perKunci = useMemo(() => new Map(pilihan.map((p) => [p.kunci, p])), [pilihan]);
  const sudahDipilih = useMemo(() => new Set(dipilih.map((d) => d.barang.kunci)), [dipilih]);

  useEffect(() => {
    const draf = bacaDraf(storeId);
    const awal: Dipilih[] = [];
    const ada = new Set<string>();
    for (const b of draf?.baris ?? []) {
      const p = perKunci.get(b.kunci);
      if (!p || ada.has(p.kunci)) continue;
      ada.add(p.kunci);
      awal.push({ barang: p, qty: b.qty, alasan: b.alasan });
    }
    // Baris dari layar analisa. Barang bervarian tanpa ukuran (mis. "barang
    // dicari" yang dicatat tanpa ukuran) tidak bisa diminta begitu saja:
    // pencarian diisi SKU-nya supaya SPG memilih ukurannya sendiri.
    let cariAwal = "";
    for (const x of tambahAwal) {
      const p = perKunci.get(kunciBaris(x.itemId, x.variantSku));
      if (!p) {
        const induk = pilihan.find((q) => q.itemId === x.itemId);
        if (induk && !cariAwal) cariAwal = induk.sku;
        continue;
      }
      if (ada.has(p.kunci)) continue;
      ada.add(p.kunci);
      awal.push({ barang: p, qty: String(x.qty), alasan: x.alasan });
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- draf ada di localStorage, hanya terbaca di klien sesudah mount
    if (awal.length > 0) setDipilih(awal);
    if (draf) {
      setCatatan(draf.catatan);
      if (draf.kunciKirim) setKunciKirim(draf.kunciKirim);
    }
    if (cariAwal) setCari(cariAwal);
    // Alamat dibersihkan tanpa memuat ulang halaman: muat ulang atau Kembali
    // tidak menambahkan baris yang sudah dihapus SPG. `null` (bukan keadaan
    // riwayat yang ada) supaya router Next ikut menyelaraskan alamatnya.
    if (tambahAwal.length > 0) {
      try {
        window.history.replaceState(null, "", "/pwa/spg/stok/minta");
      } catch {
        // Riwayat tidak bisa diubah: baris yang sama hanya dilewati saat dibuka lagi.
      }
    }
    setDrafSiap(true);
    // Sekali saat layar dibuka.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!drafSiap) return;
    tulisDraf(storeId, {
      baris: dipilih.map((d) => ({ kunci: d.barang.kunci, qty: d.qty, alasan: d.alasan })),
      catatan,
      kunciKirim,
    });
  }, [drafSiap, storeId, dipilih, catatan, kunciKirim]);

  const { hasil, cocokTotal } = useMemo(() => {
    const q = cari.trim();
    if (!q) {
      // Tanpa kata kunci: barang toko yang paling menipis dulu — itulah yang
      // biasanya diminta.
      const dilacak = pilihan.filter((p) => p.dilacak).sort((a, b) => a.stok - b.stok);
      return { hasil: dilacak.slice(0, BATAS_HASIL), cocokTotal: dilacak.length };
    }
    const cocok = pilihan.filter((p) => cocokCari(p, q));
    return { hasil: cocok.slice(0, BATAS_HASIL), cocokTotal: cocok.length };
  }, [pilihan, cari]);

  const tambah = (barang: BarisPilihan, alasan: AlasanPermintaan = "MANUAL") => {
    if (sudahDipilih.has(barang.kunci)) return;
    setDipilih((lama) => (lama.some((d) => d.barang.kunci === barang.kunci) ? lama : [...lama, { barang, qty: "1", alasan }]));
  };
  const tambahBanyak = (baris: BarisPilihan[], alasan: AlasanPermintaan) =>
    setDipilih((lama) => {
      const ada = new Set(lama.map((d) => d.barang.kunci));
      return [...lama, ...baris.filter((b) => !ada.has(b.kunci)).map((barang) => ({ barang, qty: "1", alasan }))];
    });
  const ubahQty = (kunci: string, qty: string) =>
    setDipilih((lama) => lama.map((d) => (d.barang.kunci === kunci ? { ...d, qty } : d)));
  const hapus = (kunci: string) => setDipilih((lama) => lama.filter((d) => d.barang.kunci !== kunci));

  const semuaSah = dipilih.length > 0 && dipilih.every((d) => sah(d.qty));
  // Kekurangan PERTAMA menurut urutan isian, ditulis di bawah tombol yang mati.
  const qtySalah = dipilih.find((d) => !sah(d.qty));
  const kurang = pending
    ? null
    : dipilih.length === 0
      ? t("whyEmpty")
      : qtySalah
        ? t("whyQty", { name: qtySalah.barang.nama })
        : null;
  const totalPotong = dipilih.reduce((n, d) => n + (angka(d.qty) ?? 0), 0);

  const kirim = () => {
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof mintaKirimanAction>>;
      try {
        res = await mintaKirimanAction({
          baris: dipilih.map((d) => ({
            itemId: d.barang.itemId,
            variantSku: d.barang.variantSku,
            qty: Number(d.qty),
            alasan: d.alasan,
          })),
          note: catatan.trim() || undefined,
          idempotencyKey: kunciKirim,
        });
      } catch {
        // Jaringan putus: kunci dipertahankan, jadi mengetuk Kirim lagi aman.
        toast.error(td("err.NETWORK"));
        return;
      }
      if (!res.ok) {
        toast.error(td(KODE_GALAT.has(res.code) ? `err.${res.code}` : "err.GENERIC"));
        return;
      }
      hapusDraf(storeId);
      // Tanpa ini efek draf menulis ulang daftar lama sebelum layar berpindah.
      setDrafSiap(false);
      setKunciKirim(newLocalId());
      toast.success(pemegang ? tf("sentHolder", { name: pemegang }) : t("sent"));
      router.replace("/pwa/spg/stok");
    });
  };

  return (
    <div className="space-y-4 p-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <TautanKembali cadangan="/pwa/spg/stok" />
      </Button>

      <header>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {pemegang ? tf("subtitleHolder", { store: namaToko, name: pemegang }) : t("subtitle", { store: namaToko })}
        </p>
      </header>

      {saran ? (
        <SaranMinta
          saran={saran}
          pilihan={perKunci}
          sudahDipilih={sudahDipilih}
          onTambah={(baris, alasan) => tambahBanyak(baris, alasan)}
          disabled={pending}
        />
      ) : null}

      <section className="space-y-2" aria-labelledby="judul-cari">
        <h2 id="judul-cari" className="beranda-judul px-1">
          {cari.trim() ? t("resultsTitle") : t("lowestTitle")}
        </h2>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="pl-9"
          />
        </div>
        <div className="beranda-kartu beranda-kartu-daftar">
          {hasil.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              {cari.trim() ? t("noMatch") : t("noTracked")}
            </p>
          ) : (
            <ul className="divide-y">
              {hasil.map((p) => {
                const ada = sudahDipilih.has(p.kunci);
                return (
                  <li key={p.kunci}>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => tambah(p)}
                      disabled={ada || pending}
                      aria-label={ada ? t("alreadyAdded", { name: p.nama }) : t("add", { name: p.nama })}
                      className="h-auto min-h-14 w-full justify-start gap-3 rounded-none px-4 py-2 text-left whitespace-normal disabled:opacity-100"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium leading-tight">{p.nama}</span>
                        <span className="block truncate text-xs font-normal text-muted-foreground">
                          {[p.varian, p.kode].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-xs font-normal tabular-nums text-muted-foreground",
                          p.stok < 0 && "text-destructive",
                        )}
                      >
                        {p.dilacak ? t("stock", { qty: p.stok }) : t("neverInStore")}
                      </span>
                      <span
                        className={cn(
                          "grid h-8 w-8 shrink-0 place-items-center rounded-full",
                          ada ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-primary text-primary-foreground",
                        )}
                        aria-hidden
                      >
                        {ada ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {cocokTotal > hasil.length ? (
          <p className="px-1 text-xs text-muted-foreground">{t("moreResults", { shown: hasil.length, total: cocokTotal })}</p>
        ) : null}
      </section>

      <section className="space-y-2" aria-labelledby="judul-dipilih">
        <h2 id="judul-dipilih" className="beranda-judul px-1">
          {t("listTitle", { count: dipilih.length, pcs: totalPotong })}
        </h2>
        {dipilih.length === 0 ? (
          <p className="beranda-kartu text-sm text-muted-foreground">{t("listEmpty")}</p>
        ) : (
          <div className="beranda-kartu beranda-kartu-daftar">
            <ul className="divide-y">
              {dipilih.map((d) => {
                const n = angka(d.qty);
                const salah = !sah(d.qty);
                return (
                  <li key={d.barang.kunci} className="space-y-2 px-4 py-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium leading-tight">{d.barang.nama}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[d.barang.varian, d.barang.kode].filter(Boolean).join(" · ")}
                        </p>
                        {d.alasan !== "MANUAL" ? (
                          <Badge variant="outline" className="mt-1 font-normal">
                            {tAlasan(d.alasan)}
                          </Badge>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => hapus(d.barang.kunci)}
                        disabled={pending}
                        aria-label={t("remove", { name: d.barang.nama })}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      {salah ? <p className="mr-auto text-xs text-destructive">{t("qtyInvalid")}</p> : null}
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => ubahQty(d.barang.kunci, String(Math.max(1, (n ?? 1) - 1)))}
                        disabled={pending || n === null || n <= 1}
                        aria-label={t("decrease", { name: d.barang.nama })}
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <Input
                        value={d.qty}
                        onChange={(e) => ubahQty(d.barang.kunci, e.target.value.replace(/\D/g, "").slice(0, 5))}
                        inputMode="numeric"
                        aria-label={t("qtyFor", { name: d.barang.nama })}
                        aria-invalid={salah || undefined}
                        disabled={pending}
                        className="w-20 text-center tabular-nums"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => ubahQty(d.barang.kunci, String(Math.min(QTY_MAKS, (n ?? 0) + 1)))}
                        disabled={pending || (n !== null && n >= QTY_MAKS)}
                        aria-label={t("increase", { name: d.barang.nama })}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      <div className="space-y-2">
        <Label htmlFor="minta-catatan">{pemegang ? tf("noteLabelHolder") : t("noteLabel")}</Label>
        <Textarea
          id="minta-catatan"
          value={catatan}
          onChange={(e) => setCatatan(e.target.value.slice(0, 500))}
          placeholder={t("notePlaceholder")}
          rows={2}
          disabled={pending}
        />
      </div>

      <Button className="w-full" size="lg" disabled={!semuaSah || pending} onClick={kirim}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
        {t("submit", { count: dipilih.length })}
      </Button>
      <KeteranganKirim teks={kurang} />
    </div>
  );
}
