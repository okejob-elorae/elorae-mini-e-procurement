"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowDownToLine, ArrowUpFromLine, Info, Loader2, Minus, Plus, Send, Trash2 } from "lucide-react";
import { ajukanTukarAction } from "@/app/actions/tukar-barang";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { formatIDR } from "@/lib/sales-orders/format";
import {
  arahSelisih,
  BATAS_QTY_TUKAR,
  BATAS_TEKS_TUKAR,
  hitungNilaiTukar,
  kunciBarisTukar,
  periksaNilaiTukar,
  type ArahTukar,
  type BarisTukar,
} from "@/lib/salesman/tukar-barang";
import type { BahanTukar } from "@/lib/salesman/tukar-queries";
import { cn } from "@/lib/utils";
import { namaBaris, tersediaUntuk } from "./barang";
import { PilihBarangSheet } from "./PilihBarangSheet";

import { TautanKembali } from "@/app/pwa/TautanKembali";
type Keadaan = "SIAP" | "KONSI" | "TANPA_KUNJUNGAN";

const kunciBaris = (b: { direction: ArahTukar; itemId: string; variantSku: string }) =>
  `${b.direction}|${kunciBarisTukar(b.itemId, b.variantSku)}`;

export function TukarBaruClient({
  keadaan,
  toko,
  bahan,
}: {
  keadaan: Keadaan;
  toko: { id: string; nama: string };
  bahan: BahanTukar | null;
}) {
  const t = useTranslations("pwa.tukar");

  return (
    <div className="space-y-4 p-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <TautanKembali cadangan={`/pwa/stores/${toko.id}`} />
      </Button>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{t("judul")}</h1>
        <p className="text-sm text-muted-foreground">{t("subjudul", { toko: toko.nama })}</p>
      </header>

      {keadaan === "SIAP" && bahan ? (
        <Formulir toko={toko} bahan={bahan} />
      ) : (
        <section className="beranda-kartu space-y-3">
          <p className="flex items-start gap-2 font-medium">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            {keadaan === "KONSI" ? t("konsiJudul") : t("tanpaKunjunganJudul")}
          </p>
          <p className="text-sm text-muted-foreground">{keadaan === "KONSI" ? t("konsiIsi") : t("tanpaKunjunganIsi")}</p>
          <Button asChild variant="outline" className="w-full">
            <Link href={`/pwa/stores/${toko.id}`}>{t("kembaliToko")}</Link>
          </Button>
        </section>
      )}
    </div>
  );
}

function Formulir({ toko, bahan }: { toko: { id: string; nama: string }; bahan: BahanTukar }) {
  const t = useTranslations("pwa.tukar");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  // Dibuat sekali per formulir: kiriman ulang (jaringan putus, dua ketukan)
  // tetap satu dokumen di server.
  const [kunci] = useState(newLocalId);
  const [baris, setBaris] = useState<BarisTukar[]>([]);
  const [catatan, setCatatan] = useState("");
  const [pilih, setPilih] = useState<ArahTukar | null>(null);

  const barangById = useMemo(() => new Map(bahan.barang.map((b) => [b.itemId, b])), [bahan.barang]);
  const harga = useMemo(() => new Map(bahan.barang.map((b) => [b.itemId, b.harga])), [bahan.barang]);

  const ubahQty = (sasaran: BarisTukar, qty: number) =>
    setBaris((lama) => {
      const k = kunciBaris(sasaran);
      const batas = sasaran.direction === "KELUAR" ? tersediaUntuk(barangById.get(sasaran.itemId), sasaran.variantSku) : BATAS_QTY_TUKAR;
      const q = Math.min(Math.max(0, qty), batas, BATAS_QTY_TUKAR);
      const ada = lama.some((b) => kunciBaris(b) === k);
      if (q <= 0) return lama.filter((b) => kunciBaris(b) !== k);
      if (ada) return lama.map((b) => (kunciBaris(b) === k ? { ...b, qty: q } : b));
      return [...lama, { ...sasaran, qty: q }];
    });

  const tambah = (direction: ArahTukar, itemId: string, variantSku: string) => {
    const ada = baris.find((b) => kunciBaris(b) === kunciBaris({ direction, itemId, variantSku }));
    ubahQty({ direction, itemId, variantSku, qty: 0 }, (ada?.qty ?? 0) + 1);
  };

  const masuk = baris.filter((b) => b.direction === "MASUK");
  const keluar = baris.filter((b) => b.direction === "KELUAR");
  const nilai = hitungNilaiTukar(baris, harga);
  const tanpaHarga = nilai.ok ? [] : nilai.itemIds.map((id) => barangById.get(id)?.nama ?? id);
  const setara = nilai.ok ? periksaNilaiTukar(nilai.nilai).ok : false;
  const arah = nilai.ok ? arahSelisih(nilai.nilai.selisih) : "PAS";
  const lebihStok = keluar.some((b) => b.qty > tersediaUntuk(barangById.get(b.itemId), b.variantSku));
  const lengkap = masuk.length > 0 && keluar.length > 0 && nilai.ok && setara && !lebihStok;

  const kirim = () =>
    mulai(async () => {
      let hasil: Awaited<ReturnType<typeof ajukanTukarAction>>;
      try {
        hasil = await ajukanTukarAction({ storeId: toko.id, baris, catatan: catatan.trim() || null, idempotencyKey: kunci });
      } catch {
        // Aksi server yang tidak terjangkau melempar — itu sinyal, bukan isian.
        // Isian dan kuncinya tetap: menekan Kirim lagi aman.
        toast.error(t("jaringan"));
        return;
      }
      if (hasil.ok) {
        toast.success(t("terkirim", { docNo: hasil.docNo }));
        router.replace("/pwa/tukar");
        router.refresh();
        return;
      }
      if (hasil.kode === "SELISIH_NILAI") {
        toast.error(td(hasil.selisih > 0 ? "selisihPesanan" : "selisihRetur", { nilai: formatIDR(Math.abs(hasil.selisih)) }));
      } else {
        toast.error(td(`err.${hasil.kode}`));
      }
    });

  const daftar = (arahBaris: ArahTukar, isi: BarisTukar[]) => (
    <section className="beranda-kartu space-y-3" aria-labelledby={`tukar-${arahBaris}`}>
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
          {arahBaris === "MASUK" ? (
            <ArrowDownToLine className="h-4 w-4" aria-hidden />
          ) : (
            <ArrowUpFromLine className="h-4 w-4" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`tukar-${arahBaris}`} className="beranda-judul">
            {arahBaris === "MASUK" ? t("masukJudul") : t("keluarJudul")}
          </h2>
          <p className="text-xs text-muted-foreground">{arahBaris === "MASUK" ? t("masukPetunjuk") : t("keluarPetunjuk")}</p>
        </div>
      </div>

      {isi.length === 0 ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          {arahBaris === "MASUK" ? t("kosongMasuk") : t("kosongKeluar")}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {isi.map((b) => {
            const barang = barangById.get(b.itemId);
            const nama = namaBaris(barang, b.itemId, b.variantSku);
            const stok = tersediaUntuk(barang, b.variantSku);
            const batas = arahBaris === "KELUAR" ? Math.min(stok, BATAS_QTY_TUKAR) : BATAS_QTY_TUKAR;
            return (
              <li key={kunciBaris(b)} className="flex min-h-14 items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-tight">{nama}</p>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span className="tabular-nums">{barang?.harga ? formatIDR(barang.harga) : t("hargaBelumDiset")}</span>
                    {arahBaris === "KELUAR" ? (
                      <span className={cn(b.qty > stok && "font-medium text-destructive")}>
                        {stok > 0 ? t("stokTersedia", { n: stok }) : t("stokHabis")}
                      </span>
                    ) : null}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-lg"
                    disabled={sibuk}
                    onClick={() => ubahQty(b, b.qty - 1)}
                    aria-label={b.qty <= 1 ? t("hapus", { nama }) : t("kurangi", { nama })}
                  >
                    {b.qty <= 1 ? <Trash2 className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                  </Button>
                  <span className="w-7 text-center text-sm font-semibold tabular-nums">{b.qty}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-lg"
                    disabled={sibuk || b.qty >= batas}
                    onClick={() => ubahQty(b, b.qty + 1)}
                    aria-label={t("tambahi", { nama })}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Button type="button" variant="outline" className="w-full" disabled={sibuk} onClick={() => setPilih(arahBaris)}>
        <Plus className="h-4 w-4" aria-hidden />
        {t("tambah")}
      </Button>
    </section>
  );

  return (
    <>
      {/* Perbandingan nilai menempel di atas: salesman melihatnya berubah sambil
          menambah barang, tanpa bertabrakan dengan menu bawah. */}
      <div
        className="sticky top-0 z-10 -mx-4 border-b bg-background/95 px-4 py-2 backdrop-blur"
        role="status"
        aria-live="polite"
      >
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <span className="block text-xs text-muted-foreground">{t("nilaiMasuk")}</span>
            <span className="block text-sm font-semibold tabular-nums">{nilai.ok ? formatIDR(nilai.nilai.masuk) : "—"}</span>
          </div>
          <div>
            <span className="block text-xs text-muted-foreground">{t("nilaiKeluar")}</span>
            <span className="block text-sm font-semibold tabular-nums">{nilai.ok ? formatIDR(nilai.nilai.keluar) : "—"}</span>
          </div>
          <div>
            <span className="block text-xs text-muted-foreground">{t("selisih")}</span>
            <span
              className={cn(
                "block text-sm font-semibold tabular-nums",
                nilai.ok && setara && masuk.length > 0 && keluar.length > 0 && "text-emerald-700 dark:text-emerald-400",
                nilai.ok && !setara && "text-destructive",
              )}
            >
              {!nilai.ok || masuk.length === 0 || keluar.length === 0
                ? "—"
                : setara
                  ? t("setara")
                  : formatIDR(Math.abs(nilai.nilai.selisih))}
            </span>
          </div>
        </div>
      </div>

      {daftar("MASUK", masuk)}
      {daftar("KELUAR", keluar)}

      {tanpaHarga.length > 0 ? (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t("hargaKosongPeringatan", { nama: tanpaHarga.join(", ") })}
        </p>
      ) : nilai.ok && !setara ? (
        <p role="alert" className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          {td(arah === "LEWAT_RETUR" ? "selisihRetur" : "selisihPesanan", { nilai: formatIDR(Math.abs(nilai.nilai.selisih)) })}
        </p>
      ) : null}

      <section className="beranda-kartu space-y-2">
        <Label htmlFor="tukar-catatan">{t("catatanLabel")}</Label>
        <Textarea
          id="tukar-catatan"
          value={catatan}
          rows={3}
          maxLength={BATAS_TEKS_TUKAR}
          placeholder={t("catatanPetunjuk")}
          onChange={(e) => setCatatan(e.target.value)}
          disabled={sibuk}
        />
      </section>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        {t("bukanRetur")}
      </p>

      <Button type="button" size="lg" className="w-full" disabled={!lengkap || sibuk} onClick={kirim}>
        {sibuk ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
        {sibuk ? t("mengirim") : t("kirim")}
      </Button>
      {!lengkap && (masuk.length === 0 || keluar.length === 0) ? (
        <p className="text-center text-xs text-muted-foreground">{t("lengkapiDulu")}</p>
      ) : null}

      <PilihBarangSheet
        arah={pilih}
        onTutup={() => setPilih(null)}
        bahan={bahan}
        baris={baris}
        onTambah={tambah}
      />
    </>
  );
}
