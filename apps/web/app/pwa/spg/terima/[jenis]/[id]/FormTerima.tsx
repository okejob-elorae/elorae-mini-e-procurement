"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCheck, CloudOff, Loader2, Minus, PackageCheck, PackageX, Plus } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { UnggahFoto, type NilaiFoto } from "@/components/foto/UnggahFoto";
import { terimaKirimanAction } from "@/app/actions/spg-stok";
import { KeteranganKirim } from "@/app/pwa/KeteranganKirim";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { dinamis } from "@/lib/i18n/dinamis";
import type { BarisKiriman, JenisKiriman } from "@/lib/spg/kiriman";
import { BATAS_TEKS_RUSAK } from "@/lib/spg/rusak";
import { cn } from "@/lib/utils";
import { PerluCheckIn } from "../../PerluCheckIn";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { unggahFoto } from "@/lib/foto/unggah";
import { BatasWaktuHabis, denganBatasWaktu, tanpaSinyal } from "@/lib/pwa/offline/batas-waktu";
import { PERISTIWA_ANTREAN } from "@/lib/pwa/offline/hitung";
import { antreTerima, terimaTertahanUntuk } from "@/lib/pwa/offline/luring-antrean";
import { ikatanKunjungan, kunjunganLokalSah } from "@/lib/pwa/offline/luring-kunjungan";
import { useKunjunganLokal } from "@/lib/pwa/offline/luring-kunjungan-hook";
import type { PendingStoreReceipt } from "@/lib/pwa/offline/db";

type KirimanForm = {
  sourceType: JenisKiriman;
  sourceId: string;
  docNo: string;
  tanggalLabel: string;
  lines: BarisKiriman[];
  /** Tanggal opname toko yang dilakukan sesudah kiriman ini berangkat, bila ada. */
  opnameSesudah?: string | null;
};

const KODE_GALAT = new Set([
  "FORBIDDEN",
  "NO_ASSIGNED_STORE",
  "NO_ACTIVE_VISIT",
  "VALIDATION",
  "KIRIMAN_TIDAK_DITEMUKAN",
  "SUDAH_DITERIMA",
  "JUMLAH_TIDAK_VALID",
  "LEBIH_DARI_DIKIRIM",
  "SIKLUS_TERKUNCI",
  "RUSAK_TIDAK_VALID",
  "KETERANGAN_RUSAK_WAJIB",
]);
/** Kiriman ini sudah tidak bisa diterima dari layar ini — kembali ke daftar. */
const KODE_KEMBALI = new Set(["KIRIMAN_TIDAK_DITEMUKAN", "SUDAH_DITERIMA"]);
const QTY_MAKS = 100_000;

const angka = (s: string | undefined) => (s === undefined || s === "" ? null : Number(s));

/** Mutasi antar toko: barang berpindah antar toko KITA, jadi tidak bisa diterima lebih dari yang dikirim. */
const dariMutasi = (j: JenisKiriman) => j === "MUTASI" || j === "MUTASI_KEMBALI";

/** Isian barang rusak satu baris. `buka` hanya soal tampilan — isian yang ditutup tidak dikirim. */
type IsianRusak = { buka: boolean; qty: string; catatan: string; foto: NilaiFoto };
const RUSAK_KOSONG: IsianRusak = { buka: false, qty: "", catatan: "", foto: null };

/**
 * SPG menghitung isi kiriman dan mengisi jumlah yang BENAR-BENAR diterima per
 * baris. Awalnya diisi sama dengan jumlah dikirim (kasus paling umum), dan
 * setiap baris yang berbeda ditandai — angka inilah yang masuk stok toko.
 */
export function FormTerima({
  storeId,
  kunjunganServer,
  sudahCheckIn: sudahCheckInServer,
  kiriman,
}: {
  /** Toko tetap SPG — dari server. Kunci kunjungan yang berjalan di HP. */
  storeId: string;
  /** Kunjungan berjalan di toko ini menurut server (halaman bisa dari cache). */
  kunjunganServer: { id: string; checkinAtMs: number } | null;
  sudahCheckIn: boolean;
  kiriman: KirimanForm | null;
}) {
  const t = useTranslations("pwa.spgTerima");
  const td = dinamis(t);
  const tr = useTranslations("spgRusak");
  const tl = useTranslations("pwaLuring.stok");
  const tf = dinamis(useTranslations("foto"));
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Check-in tanpa sinyal juga sah untuk menerima kiriman: hitungannya
  // diantrekan dan terkirim sesudah check-in-nya.
  const { kunjungan: lokal } = useKunjunganLokal(storeId, { segarkanSaatTerkirim: true });
  const sudahCheckIn = sudahCheckInServer || kunjunganLokalSah(lokal);
  // Satu kunci per formulir: dikirim langsung atau dari antrean, server mencatatnya sekali.
  const [kunci] = useState(newLocalId);
  // Kiriman ini sudah dihitung dan tersimpan di HP (antrean) — jangan dihitung lagi.
  const [tertahan, setTertahan] = useState<PendingStoreReceipt | null>(null);
  useEffect(() => {
    if (!kiriman) return;
    let hidup = true;
    const muat = () => {
      void terimaTertahanUntuk(kiriman.sourceType, kiriman.sourceId).then((r) => {
        if (hidup) setTertahan(r);
      });
    };
    muat();
    window.addEventListener(PERISTIWA_ANTREAN, muat);
    return () => {
      hidup = false;
      window.removeEventListener(PERISTIWA_ANTREAN, muat);
    };
  }, [kiriman]);
  const [diterima, setDiterima] = useState<Record<string, string>>(() =>
    Object.fromEntries((kiriman?.lines ?? []).map((l) => [l.lineId, String(l.qty)])),
  );
  const [catatan, setCatatan] = useState("");
  const [konfirmasi, setKonfirmasi] = useState(false);
  // Barang rusak per baris: tetap dihitung DITERIMA (tiba), tapi tidak masuk
  // stok toko sampai gudang memutuskannya.
  const [rusak, setRusak] = useState<Record<string, IsianRusak>>({});

  const kembali = (
    <Button variant="ghost" size="sm" asChild className="-ml-2">
      <TautanKembali cadangan="/pwa/spg/terima" />
    </Button>
  );

  if (!kiriman) {
    return (
      <div className="space-y-4 p-4">
        {kembali}
        <section className="beranda-kartu space-y-3">
          <h1 className="text-lg font-semibold leading-tight">{t("form.notFoundTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("form.notFoundBody")}</p>
          <Button asChild className="w-full">
            <Link href="/pwa/spg/terima">{t("form.backToList")}</Link>
          </Button>
        </section>
      </div>
    );
  }

  const lines = kiriman.lines;
  const mutasi = dariMutasi(kiriman.sourceType);
  const semuaSah = lines.every((l) => {
    const n = angka(diterima[l.lineId]);
    return n !== null && Number.isInteger(n) && n >= 0 && n <= QTY_MAKS;
  });
  const adaLebih = mutasi && lines.some((l) => (angka(diterima[l.lineId]) ?? 0) > l.qty);

  /** Jumlah rusak yang berlaku untuk satu baris (0 kalau isiannya ditutup atau kosong). */
  const rusakDari = (lineId: string) => {
    const r = rusak[lineId];
    return r?.buka ? (angka(r.qty) ?? 0) : 0;
  };
  // Baris rusak PERTAMA yang isiannya belum benar, menurut urutan baris.
  const rusakSalah = lines.find((l) => {
    const r = rusak[l.lineId];
    if (!r?.buka) return false;
    const n = angka(r.qty);
    return n === null || !Number.isInteger(n) || n < 0 || n > (angka(diterima[l.lineId]) ?? 0);
  });
  const rusakTanpaKet = lines.find((l) => rusakDari(l.lineId) > 0 && !rusak[l.lineId]?.catatan.trim());
  // Kekurangan PERTAMA menurut urutan isian — kalimat di bawah tombol simpan.
  const kurang = !sudahCheckIn
    ? t("form.needCheckIn")
    : !semuaSah
      ? t("form.fillAll")
      : adaLebih
        ? t("form.overTransfer")
        : rusakSalah
          ? tr("form.kurangJumlah", { name: rusakSalah.productName })
          : rusakTanpaKet
            ? tr("form.kurangKeterangan", { name: rusakTanpaKet.productName })
            : null;
  const totalKirim = lines.reduce((n, l) => n + l.qty, 0);
  const totalTerima = lines.reduce((n, l) => n + (angka(diterima[l.lineId]) ?? 0), 0);
  const totalRusak = lines.reduce((n, l) => n + rusakDari(l.lineId), 0);
  const barisBeda = lines.filter((l) => angka(diterima[l.lineId]) !== l.qty).length;
  const barisLuarKatalog = lines.filter((l) => !l.itemId).length;

  const ubah = (lineId: string, nilai: string) => setDiterima((lama) => ({ ...lama, [lineId]: nilai }));
  const semuaSesuai = () => setDiterima(Object.fromEntries(lines.map((l) => [l.lineId, String(l.qty)])));
  const ubahRusak = (lineId: string, ubahan: Partial<IsianRusak>) =>
    setRusak((lama) => ({ ...lama, [lineId]: { ...(lama[lineId] ?? RUSAK_KOSONG), ...ubahan } }));

  /**
   * Simpan ke antrean HP: tanpa sinyal, jawaban server tidak datang, atau
   * check-in-nya sendiri masih di HP. Foto barang rusak ikut sebagai berkas dan
   * diunggah saat sinkron. Stok toko bertambah saat terkirim.
   */
  const simpanDiHp = async (
    ikatan: { visitId: string | null; visitClientId: string | null },
    waktu: number,
    /** Foto yang sudah sempat terunggah sebelum sinyal putus — tidak diunggah lagi. */
    sudahNaik: Map<string, string | null> = new Map(),
  ) => {
    try {
      await antreTerima({
        localId: kunci,
        storeId,
        sourceType: kiriman.sourceType,
        sourceId: kiriman.sourceId,
        docNo: kiriman.docNo,
        waktu,
        visitId: ikatan.visitId,
        visitClientId: ikatan.visitClientId,
        diterima: lines.map((l) => {
          const r = rusak[l.lineId];
          const n = rusakDari(l.lineId);
          return {
            lineId: l.lineId,
            productName: l.productName,
            qtySent: l.qty,
            qtyReceived: Number(diterima[l.lineId]),
            ...(r && n > 0
              ? {
                  qtyDamaged: n,
                  damageNote: r.catatan.trim(),
                  foto: !r.foto
                    ? null
                    : sudahNaik.get(l.lineId)
                      ? { nama: r.foto.nama, url: sudahNaik.get(l.lineId) as string }
                      : r.foto.berkas
                        ? { nama: r.foto.nama, blob: r.foto.berkas }
                        : { nama: r.foto.nama, url: r.foto.url },
                }
              : {}),
          };
        }),
        note: catatan.trim() || null,
      });
    } catch {
      toast.error(tl("gagalSimpan"));
      return;
    }
    setKonfirmasi(false);
    toast.success(tl("tersimpanTerima", { docNo: kiriman.docNo, pcs: totalTerima }));
    router.replace("/pwa/spg/terima");
  };

  const simpan = () => {
    const ikatan = ikatanKunjungan(kunjunganServer, lokal);
    startTransition(async () => {
      // Waktu hitung = saat SPG menekan simpan, bukan saat antrean terkirim.
      const waktu = Date.now();
      // Check-in yang masih di HP: server belum mengenal kunjungannya.
      if (!ikatan || tanpaSinyal() || ikatan.visitClientId) {
        if (ikatan) await simpanDiHp(ikatan, waktu);
        else toast.error(td("err.NO_ACTIVE_VISIT"));
        return;
      }
      // Foto yang dipilih tanpa sinyal (masih berkas di HP) diunggah dulu.
      const urlFoto = new Map<string, string | null>();
      try {
        for (const l of lines) {
          const r = rusak[l.lineId];
          if (!r?.foto || rusakDari(l.lineId) === 0) continue;
          urlFoto.set(
            l.lineId,
            r.foto.berkas
              ? await denganBatasWaktu(unggahFoto(new File([r.foto.berkas], r.foto.nama || "foto.jpg", { type: r.foto.berkas.type || "image/jpeg" })))
              : r.foto.url,
          );
        }
      } catch (err) {
        // Sinyal putus: seluruh penerimaan (dengan fotonya) ke antrean. Foto yang
        // DITOLAK server (berkas rusak/terlalu besar) dilaporkan, tidak diantrekan.
        if (err instanceof TypeError || err instanceof BatasWaktuHabis) await simpanDiHp(ikatan, waktu, urlFoto);
        else toast.error(tf(`err${err instanceof Error ? err.message : "GAGAL"}`));
        return;
      }
      let res: Awaited<ReturnType<typeof terimaKirimanAction>>;
      try {
        res = await denganBatasWaktu(
          terimaKirimanAction({
            sourceType: kiriman.sourceType,
            sourceId: kiriman.sourceId,
            diterima: lines.map((l) => {
              const r = rusak[l.lineId];
              const n = rusakDari(l.lineId);
              return {
                lineId: l.lineId,
                qtyReceived: Number(diterima[l.lineId]),
                ...(r && n > 0 ? { qtyDamaged: n, damageNote: r.catatan.trim(), damagePhotoUrl: urlFoto.get(l.lineId) ?? null } : {}),
              };
            }),
            note: catatan.trim() || undefined,
            idempotencyKey: kunci,
          }),
        );
      } catch {
        // Sinyal putus / tidak ada jawaban: antrekan dengan kunci yang sama —
        // kalau ternyata sudah sampai, antrean hanya mendapat tanda terima yang ada.
        await simpanDiHp(ikatan, waktu, urlFoto);
        return;
      }
      setKonfirmasi(false);
      if (!res.ok) {
        toast.error(
          res.code === "SIKLUS_TERKUNCI"
            ? td("err.SIKLUS_TERKUNCI", { siklus: (res.noKonsi ?? []).join(", ") })
            : td(KODE_GALAT.has(res.code) ? `err.${res.code}` : "err.GENERIC"),
        );
        if (KODE_KEMBALI.has(res.code)) router.replace("/pwa/spg/terima");
        return;
      }
      toast.success(t("form.saved", { docNo: kiriman.docNo, pcs: totalTerima }));
      if (totalRusak > 0) toast.message(tr("form.tersimpanRusak", { pcs: totalRusak }));
      router.replace("/pwa/spg/terima");
    });
  };

  if (tertahan) {
    return (
      <div className="space-y-4 p-4">
        {kembali}
        <header>
          <h1 className="break-all text-2xl font-bold">{kiriman.docNo}</h1>
          <p className="text-sm text-muted-foreground">
            {kiriman.tanggalLabel} · {td(`source.${kiriman.sourceType}`)}
          </p>
        </header>
        <section className="beranda-kartu space-y-3" role="status">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
              <CloudOff className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold leading-tight">{tl("sudahDiHpJudul")}</h2>
              <p className="text-sm text-muted-foreground">
                {tertahan.syncState === "failed" ? tl("sudahDiHpDitolak") : tl("sudahDiHpIsi")}
              </p>
            </div>
          </div>
          <Button asChild variant="outline" className="w-full">
            <Link href="/pwa/spg/antrean">{tl("lihatAntrean")}</Link>
          </Button>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {kembali}

      <header>
        <h1 className="break-all text-2xl font-bold">{kiriman.docNo}</h1>
        <p className="text-sm text-muted-foreground">
          {kiriman.tanggalLabel} · {td(`source.${kiriman.sourceType}`)}
        </p>
      </header>

      {!sudahCheckIn ? (
        <PerluCheckIn judul={t("checkIn.title")} isi={t("checkIn.body")} tombol={t("checkIn.cta")} />
      ) : null}

      {kiriman.opnameSesudah ? (
        <p role="note" className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          {t("form.opnameAfter", { tanggal: kiriman.opnameSesudah })}
        </p>
      ) : null}

      <section className="beranda-kartu space-y-3">
        <p className="text-sm">{t("form.instructions")}</p>
        <Button type="button" variant="outline" className="w-full" onClick={semuaSesuai} disabled={pending}>
          <CheckCheck className="h-4 w-4" aria-hidden />
          {t("form.allMatch")}
        </Button>
      </section>

      <section className="space-y-2" aria-labelledby="judul-baris">
        <h2 id="judul-baris" className="beranda-judul px-1">
          {t("form.linesTitle", { count: lines.length })}
        </h2>
        <div className="beranda-kartu beranda-kartu-daftar">
          <ul className="divide-y">
            {lines.map((l) => {
              const teks = diterima[l.lineId] ?? "";
              const n = angka(teks);
              const selisih = n === null ? null : n - l.qty;
              return (
                <li
                  key={l.lineId}
                  className={cn(
                    "space-y-2 px-4 py-3",
                    selisih !== null && selisih !== 0 && "bg-amber-500/10",
                    n === null && "bg-destructive/5",
                  )}
                >
                  <div className="min-w-0">
                    <p className="font-medium leading-tight">{l.productName}</p>
                    {l.variantSku ? <p className="truncate text-xs text-muted-foreground">{l.variantSku}</p> : null}
                    {!l.itemId ? (
                      <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">{t("form.notCatalog")}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1 text-xs">
                      <span className="block text-muted-foreground">{t("form.sent", { qty: l.qty })}</span>
                      {selisih === null ? (
                        <span className="block font-medium text-destructive">{t("form.fillIn")}</span>
                      ) : selisih < 0 ? (
                        <span className="block font-semibold text-destructive">{t("form.short", { n: -selisih })}</span>
                      ) : selisih > 0 ? (
                        <span className="block font-semibold text-amber-700 dark:text-amber-300">
                          {t("form.over", { n: selisih })}
                        </span>
                      ) : (
                        <span className="block text-emerald-700 dark:text-emerald-300">{t("form.match")}</span>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => ubah(l.lineId, String(Math.max(0, (n ?? 0) - 1)))}
                      disabled={pending || n === null || n <= 0}
                      aria-label={t("form.decrease", { name: l.productName })}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <Input
                      value={teks}
                      onChange={(e) => ubah(l.lineId, e.target.value.replace(/\D/g, "").slice(0, 6))}
                      inputMode="numeric"
                      aria-label={t("form.receivedFor", { name: l.productName })}
                      aria-invalid={n === null || undefined}
                      disabled={pending}
                      className="w-20 text-center tabular-nums"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => ubah(l.lineId, String(Math.min(mutasi ? l.qty : QTY_MAKS, (n ?? 0) + 1)))}
                      disabled={pending || (n !== null && n >= (mutasi ? l.qty : QTY_MAKS))}
                      aria-label={t("form.increase", { name: l.productName })}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <BarisRusak
                    lineId={l.lineId}
                    namaBarang={l.productName}
                    isian={rusak[l.lineId] ?? RUSAK_KOSONG}
                    diterima={n}
                    pending={pending}
                    onUbah={(ubahan) => ubahRusak(l.lineId, ubahan)}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="beranda-kartu space-y-1 text-sm" aria-live="polite">
        <p className="flex justify-between gap-2">
          <span className="text-muted-foreground">{t("form.totalSent")}</span>
          <span className="font-medium tabular-nums">{totalKirim}</span>
        </p>
        <p className="flex justify-between gap-2">
          <span className="text-muted-foreground">{t("form.totalReceived")}</span>
          <span className="font-semibold tabular-nums">{totalTerima}</span>
        </p>
        {totalRusak > 0 ? (
          <p className="flex justify-between gap-2">
            <span className="text-muted-foreground">{tr("form.totalRusak")}</span>
            <span className="font-semibold tabular-nums text-destructive">{totalRusak}</span>
          </p>
        ) : null}
        <p className={cn("pt-1 text-xs", barisBeda > 0 ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
          {barisBeda > 0 ? t("form.diffLines", { count: barisBeda }) : t("form.noDiff")}
        </p>
      </section>

      <div className="space-y-2">
        <Label htmlFor="terima-catatan">{t("form.noteLabel")}</Label>
        <Textarea
          id="terima-catatan"
          value={catatan}
          onChange={(e) => setCatatan(e.target.value.slice(0, 500))}
          placeholder={barisBeda > 0 ? t("form.notePlaceholderDiff") : t("form.notePlaceholder")}
          rows={2}
          disabled={pending}
        />
      </div>

      <div className="space-y-2">
        <Button className="w-full" size="lg" disabled={kurang !== null || pending} onClick={() => setKonfirmasi(true)}>
          <PackageCheck className="h-4 w-4" aria-hidden />
          {t("form.save")}
        </Button>
        <KeteranganKirim teks={kurang} />
      </div>

      <AlertDialog open={konfirmasi} onOpenChange={(o) => !pending && setKonfirmasi(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirm.title")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>{t("confirm.body", { pcs: totalTerima, docNo: kiriman.docNo })}</p>
                {barisBeda > 0 ? (
                  <p className="font-medium text-amber-700 dark:text-amber-300">{t("confirm.diff", { count: barisBeda })}</p>
                ) : null}
                {barisLuarKatalog > 0 ? <p>{t("confirm.notCatalog", { count: barisLuarKatalog })}</p> : null}
                {totalRusak > 0 ? (
                  <p className="font-medium text-destructive">{tr("form.konfirmasiRusak", { pcs: totalRusak })}</p>
                ) : null}
                <p>{t("confirm.final")}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("confirm.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Dialog tetap terbuka selama menyimpan; ditutup oleh hasilnya.
                e.preventDefault();
                simpan();
              }}
              disabled={pending}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {pending ? t("confirm.saving") : t("confirm.ok")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * "Ada yang rusak?" di bawah jumlah diterima satu baris: jumlah rusak
 * (0..diterima), keterangan wajib, foto opsional. Barang rusak tetap dihitung
 * diterima — hanya tidak masuk stok toko sampai gudang memutuskannya.
 */
function BarisRusak({
  lineId,
  namaBarang,
  isian,
  diterima,
  pending,
  onUbah,
}: {
  lineId: string;
  namaBarang: string;
  isian: IsianRusak;
  diterima: number | null;
  pending: boolean;
  onUbah: (ubahan: Partial<IsianRusak>) => void;
}) {
  const tr = useTranslations("spgRusak");
  if (!isian.buka) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-2 text-muted-foreground"
        onClick={() => onUbah({ buka: true, qty: isian.qty || "1" })}
        disabled={pending}
      >
        <PackageX className="h-4 w-4" aria-hidden />
        {tr("form.adaRusak")}
      </Button>
    );
  }
  const n = angka(isian.qty);
  const maks = diterima ?? 0;
  const salah = n === null || n > maks;
  return (
    <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-sm font-medium">{tr("form.jumlahRusak")}</span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => onUbah({ qty: String(Math.max(0, (n ?? 0) - 1)) })}
          disabled={pending || n === null || n <= 0}
          aria-label={tr("form.kurangiRusak", { name: namaBarang })}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Input
          value={isian.qty}
          onChange={(e) => onUbah({ qty: e.target.value.replace(/\D/g, "").slice(0, 6) })}
          inputMode="numeric"
          aria-label={tr("form.jumlahRusakUntuk", { name: namaBarang })}
          aria-invalid={salah || undefined}
          disabled={pending}
          className="w-20 text-center tabular-nums"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => onUbah({ qty: String(Math.min(maks, (n ?? 0) + 1)) })}
          disabled={pending || (n !== null && n >= maks)}
          aria-label={tr("form.tambahRusak", { name: namaBarang })}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {salah ? <p className="text-xs font-medium text-destructive">{tr("form.batasRusak", { n: maks })}</p> : null}
      <div className="space-y-1">
        <Label htmlFor={`rusak-ket-${lineId}`}>{tr("form.keterangan")}</Label>
        <Input
          id={`rusak-ket-${lineId}`}
          value={isian.catatan}
          onChange={(e) => onUbah({ catatan: e.target.value.slice(0, BATAS_TEKS_RUSAK) })}
          placeholder={tr("form.keteranganContoh")}
          disabled={pending}
        />
      </div>
      {/* Tanpa sinyal, fotonya disimpan di HP dan diunggah saat penerimaan ini terkirim. */}
      <UnggahFoto
        label={tr("form.foto")}
        petunjuk={tr("form.fotoPetunjuk")}
        nilai={isian.foto}
        onChange={(foto) => onUbah({ foto })}
        disabled={pending}
        simpanDiHp
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-2"
        onClick={() => onUbah({ ...RUSAK_KOSONG })}
        disabled={pending}
      >
        {tr("form.tidakJadi")}
      </Button>
      <p className="text-xs text-muted-foreground">{tr("form.penjelasan")}</p>
    </div>
  );
}
