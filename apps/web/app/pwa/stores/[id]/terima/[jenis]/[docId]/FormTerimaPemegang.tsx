"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCheck, Loader2, Minus, PackageCheck, Plus } from "lucide-react";
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
import { UnggahFoto, type NilaiFoto } from "@/components/foto/UnggahFoto";
import { KeteranganKirim } from "@/app/pwa/KeteranganKirim";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { BatasWaktuHabis, denganBatasWaktu } from "@/lib/pwa/offline/batas-waktu";
import { cn } from "@/lib/utils";
import { terimaKirimanPemegangAction } from "../../actions";

/**
 * Penerimaan kiriman gudang oleh salesman pemegang toko yang SPG-nya sudah berhenti (P45/P45a).
 *
 * Per baris hanya jumlah yang TIBA: kurirnya sudah pergi, jadi tidak ada "ditolak". Yang tidak
 * tiba dicatat sebagai barang hilang oleh penulisnya. Nama penanggung jawab toko dan satu foto
 * wajib; fotonya diunggah ke R2 di folder dokumen ini saat disimpan (rute
 * `/pwa/api/upload/store-receipt-photo`), dengan kunci yang sama dengan kunci kirimannya — kirim
 * ulang sesudah jawaban hilang menimpa foto yang sama dan dijawab penulisnya dengan tanda terima
 * yang sudah ada. Hanya nama barang dan pcs: tidak ada harga di layar ini.
 */

export type JenisTerimaPemegang = "KONSI_TRANSFER" | "PUTUS_DELIVERY";

export type KirimanPemegang = {
  sourceType: JenisTerimaPemegang;
  sourceId: string;
  docNo: string;
  tanggalLabel: string;
  pesananNo: string | null;
  lines: Array<{ lineId: string; productName: string; variantSku: string; qty: number }>;
};

/** Halaman menolak membuka formulirnya — urutannya sama dengan penolakan penulisnya. */
export type AlasanTolakHalaman =
  | "BUKAN_PEMEGANG"
  | "TANPA_KUNJUNGAN"
  | "TOKO_PUNYA_SPG"
  | "SUDAH_DITERIMA"
  | "KIRIMAN_TIDAK_DITEMUKAN"
  | "KIRIMAN_DIBATALKAN"
  | "BELUM_DISERAHKAN";

/** Kode penolakan yang punya kalimatnya sendiri; selebihnya "gagal disimpan". */
const KODE_GALAT = new Set([
  "BUKAN_PEMEGANG",
  "TANPA_KUNJUNGAN",
  "TOKO_PUNYA_SPG",
  "BELUM_DISERAHKAN",
  "BELUM_BERANGKAT",
  "KIRIMAN_TIDAK_DITEMUKAN",
  "KIRIMAN_DIBATALKAN",
  "SUDAH_DITERIMA",
  "JUMLAH_TIDAK_VALID",
  "LEBIH_DARI_DIKIRIM",
  "NAMA_PJ_WAJIB",
  "FOTO_WAJIB",
  "KUNCI_DIPAKAI",
  "TANPA_AKSES",
  "ISIAN_TIDAK_VALID",
]);

/** Penolakan yang membuat formulir ini tidak ada gunanya lagi — kembali ke halaman toko. */
const KODE_KEMBALI = new Set(["SUDAH_DITERIMA", "KIRIMAN_TIDAK_DITEMUKAN", "KIRIMAN_DIBATALKAN", "TOKO_PUNYA_SPG", "BUKAN_PEMEGANG"]);

const angka = (teks: string | undefined): number | null => {
  if (teks === undefined || teks.trim() === "") return null;
  const n = Number(teks);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

const panjangNama = (s: string) => Array.from(s.replace(/\s+/g, " ").trim()).length;

export function TolakTerimaPemegang({ storeId, alasan }: { storeId: string; alasan: AlasanTolakHalaman }) {
  const t = useTranslations("pwa.terimaPemegang");
  const td = dinamis(t);
  const keToko = `/pwa/stores/${encodeURIComponent(storeId)}`;
  return (
    <div className="space-y-4 p-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <TautanKembali cadangan={keToko} />
      </Button>
      <section className="beranda-kartu space-y-3" role="status">
        <h1 className="text-lg font-semibold leading-tight">{t("tolakJudul")}</h1>
        <p className="text-sm text-muted-foreground">{td(`err.${alasan}`)}</p>
        <Button asChild className="w-full">
          <Link href={keToko}>{t("keToko")}</Link>
        </Button>
      </section>
    </div>
  );
}

export function FormTerimaPemegang({ storeId, kiriman }: { storeId: string; kiriman: KirimanPemegang }) {
  const t = useTranslations("pwa.terimaPemegang");
  const td = dinamis(t);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kunci] = useState(newLocalId);
  const [tiba, setTiba] = useState<Record<string, string>>(() =>
    Object.fromEntries(kiriman.lines.map((l) => [l.lineId, String(l.qty)])),
  );
  const [namaPj, setNamaPj] = useState("");
  const [foto, setFoto] = useState<NilaiFoto>(null);
  const [konfirmasi, setKonfirmasi] = useState(false);

  const keToko = `/pwa/stores/${encodeURIComponent(storeId)}`;
  const lines = kiriman.lines;
  const semuaSah = lines.every((l) => {
    const n = angka(tiba[l.lineId]);
    return n !== null && n <= l.qty;
  });
  const totalKirim = lines.reduce((s, l) => s + l.qty, 0);
  const totalTiba = lines.reduce((s, l) => s + Math.min(l.qty, angka(tiba[l.lineId]) ?? 0), 0);
  const tidakTiba = Math.max(0, totalKirim - totalTiba);
  const namaSah = panjangNama(namaPj) >= 2 && panjangNama(namaPj) <= 100;

  // Kekurangan PERTAMA menurut urutan isian — kalimat di bawah tombol simpan.
  const kurang = !semuaSah ? t("perlu.jumlah") : !namaSah ? t("perlu.namaPj") : !foto?.berkas ? t("perlu.foto") : null;

  const ubah = (lineId: string, nilai: string) => setTiba((lama) => ({ ...lama, [lineId]: nilai }));
  const semuaTiba = () => setTiba(Object.fromEntries(lines.map((l) => [l.lineId, String(l.qty)])));

  const unggah = async (berkas: Blob, nama: string): Promise<{ url: string; key: string } | { galat: string }> => {
    const isi = new FormData();
    isi.append("file", berkas, nama || "terima.jpg");
    isi.append("storeId", storeId);
    isi.append("sourceType", kiriman.sourceType);
    isi.append("sourceId", kiriman.sourceId);
    isi.append("clientId", kunci);
    const res = await fetch("/pwa/api/upload/store-receipt-photo", { method: "POST", body: isi });
    const jawab = (await res.json().catch(() => null)) as { url?: string; key?: string; error?: string } | null;
    if (!res.ok || !jawab?.url || !jawab.key) return { galat: jawab?.error === "BUKAN_PEMEGANG" ? "BUKAN_PEMEGANG" : "FOTO_GAGAL" };
    return { url: jawab.url, key: jawab.key };
  };

  const simpan = () => {
    if (!foto?.berkas) return;
    const berkas = foto.berkas;
    const namaBerkas = foto.nama;
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof terimaKirimanPemegangAction>>;
      try {
        const unggahan = await denganBatasWaktu(unggah(berkas, namaBerkas));
        if ("galat" in unggahan) {
          toast.error(td(`err.${unggahan.galat}`));
          return;
        }
        res = await denganBatasWaktu(
          terimaKirimanPemegangAction({
            storeId,
            sourceType: kiriman.sourceType,
            sourceId: kiriman.sourceId,
            diterima: lines.map((l) => ({ lineId: l.lineId, qtyReceived: Number(tiba[l.lineId]) })),
            picName: namaPj,
            photoUrl: unggahan.url,
            photoR2Key: unggahan.key,
            idempotencyKey: kunci,
          }),
        );
      } catch (err) {
        // Tanpa jawaban: aman dikirim lagi — kuncinya sama, penulisnya mencatat sekali.
        toast.error(td(err instanceof TypeError || err instanceof BatasWaktuHabis ? "err.JARINGAN" : "err.GAGAL"));
        return;
      }
      setKonfirmasi(false);
      if (!res.ok) {
        const kode = res.alasan;
        toast.error(
          kode === "SIKLUS_TERKUNCI"
            ? t("err.SIKLUS_TERKUNCI", { siklus: ("noKonsi" in res ? (res.noKonsi ?? []) : []).join(", ") })
            : td(KODE_GALAT.has(kode) ? `err.${kode}` : "err.GAGAL"),
        );
        if (KODE_KEMBALI.has(kode)) router.replace(keToko);
        return;
      }
      toast.success(t("tersimpan", { docNo: kiriman.docNo, pcs: totalTiba }));
      if (tidakTiba > 0) toast.message(t("tersimpanHilang", { pcs: tidakTiba }));
      router.replace(keToko);
    });
  };

  return (
    <div className="space-y-4 p-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <TautanKembali cadangan={keToko} />
      </Button>

      <header>
        <h1 className="min-w-0 break-all text-2xl font-bold">{kiriman.docNo}</h1>
        <p className="text-sm text-muted-foreground">
          {kiriman.tanggalLabel} · {td(`jenis.${kiriman.sourceType}`)}
        </p>
        {kiriman.pesananNo ? (
          <p className="text-sm text-muted-foreground">{t("pesanan", { no: kiriman.pesananNo })}</p>
        ) : null}
      </header>

      <section className="beranda-kartu space-y-3">
        <p className="text-sm">{t("petunjuk")}</p>
        <Button type="button" variant="outline" className="w-full" onClick={semuaTiba} disabled={pending}>
          <CheckCheck className="h-4 w-4" aria-hidden />
          {t("semuaTiba")}
        </Button>
      </section>

      <section className="space-y-2" aria-labelledby="judul-baris-pemegang">
        <h2 id="judul-baris-pemegang" className="beranda-judul px-1">
          {t("judulBaris", { count: lines.length })}
        </h2>
        <div className="beranda-kartu beranda-kartu-daftar">
          <ul className="divide-y">
            {lines.map((l) => {
              const teks = tiba[l.lineId] ?? "";
              const n = angka(teks);
              const selisih = n === null ? null : n - l.qty;
              return (
                <li
                  key={l.lineId}
                  className={cn(
                    "space-y-2 px-4 py-3",
                    selisih !== null && selisih < 0 && "bg-amber-500/10",
                    (n === null || (selisih !== null && selisih > 0)) && "bg-destructive/5",
                  )}
                >
                  <div className="min-w-0">
                    <p className="font-medium leading-tight">{l.productName}</p>
                    {l.variantSku ? <p className="truncate text-xs text-muted-foreground">{l.variantSku}</p> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1 text-xs">
                      <span className="block text-muted-foreground">{t("dikirim", { qty: l.qty })}</span>
                      {selisih === null ? (
                        <span className="block font-medium text-destructive">{t("isiDulu")}</span>
                      ) : selisih > 0 ? (
                        <span className="block font-semibold text-destructive">{t("lebih")}</span>
                      ) : selisih < 0 ? (
                        <span className="block font-semibold text-amber-700 dark:text-amber-300">
                          {t("kurang", { n: -selisih })}
                        </span>
                      ) : (
                        <span className="block text-emerald-700 dark:text-emerald-300">{t("sesuai")}</span>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => ubah(l.lineId, String(Math.max(0, (n ?? 0) - 1)))}
                      disabled={pending || n === null || n <= 0}
                      aria-label={t("kurangi", { name: l.productName })}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <Input
                      value={teks}
                      onChange={(e) => ubah(l.lineId, e.target.value.replace(/\D/g, "").slice(0, 6))}
                      inputMode="numeric"
                      aria-label={t("tibaUntuk", { name: l.productName })}
                      aria-invalid={n === null || (selisih !== null && selisih > 0) || undefined}
                      disabled={pending}
                      className="w-20 text-center tabular-nums"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => ubah(l.lineId, String(Math.min(l.qty, (n ?? 0) + 1)))}
                      disabled={pending || (n !== null && n >= l.qty)}
                      aria-label={t("tambah", { name: l.productName })}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="beranda-kartu space-y-1 text-sm" aria-live="polite">
        <p className="flex justify-between gap-2">
          <span className="text-muted-foreground">{t("totalDikirim")}</span>
          <span className="font-medium tabular-nums">{totalKirim}</span>
        </p>
        <p className="flex justify-between gap-2">
          <span className="text-muted-foreground">{t("totalTiba")}</span>
          <span className="font-semibold tabular-nums">{totalTiba}</span>
        </p>
        {semuaSah && tidakTiba > 0 ? (
          <p className="pt-1 text-xs font-medium text-amber-700 dark:text-amber-300">{t("sisaHilang", { pcs: tidakTiba })}</p>
        ) : null}
      </section>

      <div className="space-y-2">
        <Label htmlFor="terima-pemegang-pj">{t("namaPj")}</Label>
        <Input
          id="terima-pemegang-pj"
          value={namaPj}
          onChange={(e) => setNamaPj(e.target.value.slice(0, 100))}
          autoComplete="off"
          disabled={pending}
        />
        <p className="text-xs text-muted-foreground">{t("namaPjPetunjuk")}</p>
      </div>

      <UnggahFoto
        label={t("foto")}
        petunjuk={t("fotoPetunjuk")}
        nilai={foto}
        onChange={setFoto}
        wajib
        tundaUnggah
        disabled={pending}
      />

      <div className="space-y-2">
        <Button className="w-full" size="lg" disabled={kurang !== null || pending} onClick={() => setKonfirmasi(true)}>
          <PackageCheck className="h-4 w-4" aria-hidden />
          {t("simpan")}
        </Button>
        <KeteranganKirim teks={kurang} />
      </div>

      <AlertDialog open={konfirmasi} onOpenChange={(o) => !pending && setKonfirmasi(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("konfirmasi.judul")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>{t("konfirmasi.isi", { tiba: totalTiba, kirim: totalKirim, nama: namaPj.replace(/\s+/g, " ").trim() })}</p>
                {tidakTiba > 0 ? (
                  <p className="font-medium text-amber-700 dark:text-amber-300">{t("konfirmasi.hilang", { pcs: tidakTiba })}</p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("konfirmasi.batal")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Dialog tetap terbuka selama menyimpan; ditutup oleh hasilnya.
                e.preventDefault();
                simpan();
              }}
              disabled={pending}
            >
              {pending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {t("konfirmasi.menyimpan")}
                </>
              ) : (
                t("konfirmasi.ya")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
