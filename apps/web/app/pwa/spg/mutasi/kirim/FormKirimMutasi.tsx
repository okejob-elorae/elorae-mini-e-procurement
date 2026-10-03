"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, CheckCircle2, CloudOff, Loader2, Minus, Plus, Search, Send, X } from "lucide-react";
import { ajukanMutasiAction } from "@/app/actions/spg-mutasi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { KeteranganKirim } from "@/app/pwa/KeteranganKirim";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { denganBatasWaktu, tanpaSinyal } from "@/lib/pwa/offline/batas-waktu";
import { antreAjuanMutasi } from "@/lib/pwa/offline/luring-antrean";
import { ikatanKunjungan, kunjunganLokalSah } from "@/lib/pwa/offline/luring-kunjungan";
import { useKunjunganLokal } from "@/lib/pwa/offline/luring-kunjungan-hook";
import { BATAS_TEKS_MUTASI, QTY_MAKS_MUTASI, type ModeSaldoMutasi } from "@/lib/spg/mutasi-aturan";
import { cn } from "@/lib/utils";
import { cocokCari, type BarisPilihan } from "../../stok/barang-pilihan";
import { KartuAjuanDiHp, kirimAntreanBilaBisa, useMutasiDiHp } from "../MutasiDiHp";
import { pesanGagalMutasi } from "../tampilan";

/** Hasil pencarian yang dirender sekaligus. */
const BATAS_HASIL = 30;

type Pilihan = BarisPilihan & { dijanjikan: number };
type Dipilih = { barang: Pilihan; qty: string };

const angka = (s: string) => (s === "" ? null : Number(s));
const sah = (s: string) => {
  const n = angka(s);
  return n !== null && Number.isInteger(n) && n >= 1 && n <= QTY_MAKS_MUTASI;
};

/** Langganan perubahan sinyal (online/offline) untuk `useSyncExternalStore`. */
function langgananSinyal(berubah: () => void): () => void {
  window.addEventListener("online", berubah);
  window.addEventListener("offline", berubah);
  return () => {
    window.removeEventListener("online", berubah);
    window.removeEventListener("offline", berubah);
  };
}

/**
 * SPG memilih toko tujuan, barang dari buku stok tokonya, dan alasannya. Saldo
 * yang ditampilkan adalah saldo buku dikurangi barang yang sudah dijanjikan ke
 * mutasi lain yang belum dikirim — angka yang sama dengan yang dinilai server.
 *
 * Tanpa sinyal (atau tanpa jawaban server, atau check-in-nya sendiri masih di
 * HP) ajuannya disimpan di HP dengan kunci yang sama dan terkirim sendiri
 * begitu ada sinyal; layar tetap di sini dan menunjukkan ajuan yang tersimpan,
 * karena halaman lain belum tentu ada di cache HP.
 */
export function FormKirimMutasi({
  storeId,
  kunjunganServer,
  namaToko,
  aktif,
  modeSaldo,
  sudahCheckIn: sudahCheckInServer,
  bukuAda,
  tujuan,
  pilihan,
}: {
  /** Toko tetap SPG — dari server. Kunci kunjungan yang berjalan di HP. */
  storeId: string;
  /** Kunjungan berjalan di toko ini menurut server (halaman bisa dari cache). */
  kunjunganServer: { id: string; checkinAtMs: number } | null;
  namaToko: string;
  aktif: boolean;
  modeSaldo: ModeSaldoMutasi;
  sudahCheckIn: boolean;
  bukuAda: boolean;
  tujuan: { id: string; name: string; punyaSpg: boolean; langsung: boolean }[];
  pilihan: Pilihan[];
}) {
  const t = useTranslations("spgMutasi");
  const td = dinamis(t);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Check-in tanpa sinyal juga sah untuk mengajukan: ajuannya diantrekan dan
  // terkirim sesudah check-in-nya.
  const { kunjungan: lokal } = useKunjunganLokal(storeId, { segarkanSaatTerkirim: true });
  const sudahCheckIn = sudahCheckInServer || kunjunganLokalSah(lokal);
  // Tanpa sinyal sekarang? Snapshot server `false`: halaman dari cache yang
  // dihidrasi tanpa sinyal tidak berbeda markup-nya dari render server.
  const luring = useSyncExternalStore(langgananSinyal, tanpaSinyal, () => false);
  const { data: diHp, pernahAda } = useMutasiDiHp(storeId);
  // Ajuan yang baru saja disimpan di HP (kuncinya) — layar menunjukkannya.
  const [tersimpan, setTersimpan] = useState<string | null>(null);
  // Satu kunci per formulir: kiriman ulang sesudah jawaban server hilang tidak
  // membuat mutasi ganda, dan antrean HP mengirimnya dengan kunci yang sama.
  // Diganti hanya sesudah berhasil atau tersimpan di HP.
  const [kunciKirim, setKunciKirim] = useState(() => newLocalId());
  const [tujuanId, setTujuanId] = useState("");
  const [cari, setCari] = useState("");
  const [dipilih, setDipilih] = useState<Dipilih[]>([]);
  const [alasan, setAlasan] = useState("");

  const sudahDipilih = useMemo(() => new Set(dipilih.map((d) => d.barang.kunci)), [dipilih]);
  const tersedia = (b: Pilihan) => b.stok - b.dijanjikan;

  const { hasil, cocokTotal } = useMemo(() => {
    const q = cari.trim();
    // Tanpa kata kunci: barang yang paling banyak di rak dulu — biasanya itulah yang dipindah.
    const daftar = q ? pilihan.filter((p) => cocokCari(p, q)) : [...pilihan].filter((p) => p.stok > 0).sort((a, b) => b.stok - a.stok);
    return { hasil: daftar.slice(0, BATAS_HASIL), cocokTotal: daftar.length };
  }, [pilihan, cari]);

  const tambah = (barang: Pilihan) => {
    if (sudahDipilih.has(barang.kunci)) return;
    setDipilih((lama) => [...lama, { barang, qty: "1" }]);
  };
  const ubahQty = (kunci: string, qty: string) => setDipilih((lama) => lama.map((d) => (d.barang.kunci === kunci ? { ...d, qty } : d)));
  const hapus = (kunci: string) => setDipilih((lama) => lama.filter((d) => d.barang.kunci !== kunci));

  const tujuanTerpilih = tujuan.find((x) => x.id === tujuanId) ?? null;
  const melebihi = dipilih.filter((d) => sah(d.qty) && Number(d.qty) > tersedia(d.barang));
  const totalPcs = dipilih.reduce((n, d) => n + (angka(d.qty) ?? 0), 0);

  // Kekurangan PERTAMA menurut urutan isian formulir — kalimat di bawah tombol.
  const kurang: string | null = !sudahCheckIn
    ? t("kirim.kurang.checkIn")
    : !tujuanId
      ? t("kirim.kurang.tujuan")
      : dipilih.length === 0
        ? t("kirim.kurang.barang")
        : !dipilih.every((d) => sah(d.qty))
          ? t("kirim.kurang.jumlah")
          : modeSaldo === "TOLAK" && melebihi.length > 0
            ? t("kirim.kurang.saldo")
            : !alasan.trim()
              ? t("kirim.kurang.alasan")
              : null;

  const kosongkan = () => {
    setKunciKirim(newLocalId());
    setTujuanId("");
    setCari("");
    setDipilih([]);
    setAlasan("");
  };

  /**
   * Simpan ke antrean HP. Aturan arah, toko tujuan, dan saldo dinilai server
   * saat terkirim, per waktu ajuan ini.
   */
  const simpanDiHp = async (ikatan: { visitId: string | null; visitClientId: string | null }, waktu: number) => {
    const tujuanIni = tujuan.find((x) => x.id === tujuanId);
    try {
      await antreAjuanMutasi({
        localId: kunciKirim,
        storeId,
        toStoreId: tujuanId,
        tujuanNama: tujuanIni?.name ?? "",
        langsung: tujuanIni?.langsung ?? false,
        alasan: alasan.trim(),
        baris: dipilih.map((d) => ({
          itemId: d.barang.itemId,
          variantSku: d.barang.variantSku,
          qty: Number(d.qty),
          productName: d.barang.varian ? `${d.barang.nama} — ${d.barang.varian}` : d.barang.nama,
        })),
        waktu,
        visitId: ikatan.visitId,
        visitClientId: ikatan.visitClientId,
      });
    } catch {
      toast.error(t("luring.gagalSimpan"));
      return;
    }
    toast.success(t("luring.tersimpanToast", { toko: tujuanIni?.name ?? "" }));
    setTersimpan(kunciKirim);
    kosongkan();
    // Tertahan hanya karena check-in-nya masih di HP: coba kirim sekarang juga.
    kirimAntreanBilaBisa();
  };

  const kirim = () => {
    const ikatan = ikatanKunjungan(kunjunganServer, lokal);
    startTransition(async () => {
      // Waktu ajuan = saat tombol ditekan, bukan saat antrean terkirim.
      const waktu = Date.now();
      // Check-in yang masih di HP: server belum mengenal kunjungannya.
      if (!ikatan || tanpaSinyal() || ikatan.visitClientId) {
        if (ikatan) await simpanDiHp(ikatan, waktu);
        else toast.error(td("err.NO_ACTIVE_VISIT"));
        return;
      }
      let res: Awaited<ReturnType<typeof ajukanMutasiAction>>;
      try {
        res = await denganBatasWaktu(
          ajukanMutasiAction({
            toStoreId: tujuanId,
            alasan: alasan.trim(),
            baris: dipilih.map((d) => ({ itemId: d.barang.itemId, variantSku: d.barang.variantSku, qty: Number(d.qty) })),
            idempotencyKey: kunciKirim,
          }),
        );
      } catch {
        // Sinyal putus / tidak ada jawaban: antrekan dengan kunci yang sama —
        // kalau ternyata sudah sampai, antrean hanya mendapat mutasi yang ada.
        await simpanDiHp(ikatan, waktu);
        return;
      }
      if (!res.ok) {
        toast.error(pesanGagalMutasi(res, td));
        return;
      }
      setKunciKirim(newLocalId());
      toast.success(res.status === "DISETUJUI" ? t("kirim.okLangsung", { docNo: res.docNo }) : t("kirim.okDiajukan", { docNo: res.docNo }));
      router.replace(`/pwa/spg/mutasi/${res.id}`);
    });
  };

  const kembali = (
    <Button variant="ghost" size="sm" asChild className="-ml-2">
      <TautanKembali cadangan="/pwa/spg/mutasi" />
    </Button>
  );

  if (tersimpan) {
    const ajuan = diHp.ajuan.find((a) => a.localId === tersimpan) ?? null;
    // Pernah terbaca di HP lalu hilang: sudah terkirim. Belum pernah terbaca: baru dimuat.
    const sampai = !ajuan && pernahAda.has(tersimpan);
    return (
      <div className="space-y-4 p-4">
        {kembali}
        <header className="space-y-1">
          <h1 className="text-2xl font-bold">{sampai ? t("luring.sudahSampaiJudul") : t("luring.tersimpanJudul")}</h1>
          <p className="text-sm text-muted-foreground">{sampai ? t("luring.sudahSampaiIsi") : t("luring.tersimpanIsi")}</p>
        </header>
        {ajuan ? (
          <KartuAjuanDiHp
            ajuan={ajuan}
            kirim={diHp.kirim.find((k) => k.ajuanLocalId === ajuan.localId) ?? null}
            ikatan={ikatanKunjungan(kunjunganServer, lokal)}
          />
        ) : sampai ? (
          <section className="beranda-kartu flex items-start gap-3" role="status">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
            </span>
            <p className="min-w-0 text-sm">{t("luring.sudahSampaiKartu")}</p>
          </section>
        ) : null}
        <div className="grid gap-2">
          <Button asChild variant="outline" className="h-auto min-h-11 w-full whitespace-normal py-2">
            <Link href="/pwa/spg/mutasi">{t("luring.keDaftar")}</Link>
          </Button>
          <Button type="button" variant="ghost" className="h-auto min-h-11 w-full whitespace-normal py-2" onClick={() => setTersimpan(null)}>
            {t("luring.ajukanLagi")}
          </Button>
        </div>
      </div>
    );
  }

  if (!aktif || !bukuAda) {
    return (
      <div className="space-y-4 p-4">
        {kembali}
        <section className="beranda-kartu space-y-3">
          <h1 className="text-lg font-semibold leading-tight">{aktif ? t("kirim.tanpaBukuJudul") : t("kirim.nonaktifJudul")}</h1>
          <p className="text-sm text-muted-foreground">{aktif ? t("kirim.tanpaBukuIsi") : t("nonaktif")}</p>
          {aktif ? (
            <Button asChild className="w-full">
              <Link href="/pwa/spg/opname">{t("kirim.keOpname")}</Link>
            </Button>
          ) : null}
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {kembali}

      <header>
        <h1 className="text-2xl font-bold">{t("kirim.judul")}</h1>
        <p className="text-sm text-muted-foreground">{t("kirim.subjudul", { toko: namaToko })}</p>
      </header>

      <section className="space-y-2">
        <Label htmlFor="mutasi-tujuan">{t("kirim.tujuan")}</Label>
        {tujuan.length === 0 ? (
          <p className="beranda-kartu text-sm text-muted-foreground">{t("kirim.tanpaTujuan")}</p>
        ) : (
          <Select value={tujuanId} onValueChange={setTujuanId} disabled={pending}>
            <SelectTrigger id="mutasi-tujuan" className="w-full">
              <SelectValue placeholder={t("kirim.pilihTujuan")} />
            </SelectTrigger>
            <SelectContent>
              {tujuan.map((x) => (
                <SelectItem key={x.id} value={x.id}>
                  {x.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {tujuanTerpilih ? (
          <p className="text-xs text-muted-foreground">
            {tujuanTerpilih.langsung ? t("kirim.langsung") : t("kirim.perluSetuju")}
            {tujuanTerpilih.punyaSpg ? "" : ` ${t("kirim.tanpaSpg")}`}
          </p>
        ) : null}
      </section>

      <section className="space-y-2" aria-labelledby="judul-cari-mutasi">
        <h2 id="judul-cari-mutasi" className="beranda-judul px-1">
          {cari.trim() ? t("kirim.hasilCari") : t("kirim.terbanyak")}
        </h2>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder={t("kirim.cari")}
            aria-label={t("kirim.cari")}
            className="pl-9"
          />
        </div>
        <div className="beranda-kartu beranda-kartu-daftar">
          {hasil.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">{cari.trim() ? t("kirim.tidakCocok") : t("kirim.rakKosong")}</p>
          ) : (
            <ul className="divide-y">
              {hasil.map((p) => {
                const ada = sudahDipilih.has(p.kunci);
                const sisa = tersedia(p);
                return (
                  <li key={p.kunci}>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => tambah(p)}
                      disabled={ada || pending}
                      aria-label={ada ? t("kirim.sudahDitambah", { nama: p.nama }) : t("kirim.tambah", { nama: p.nama })}
                      className="h-auto min-h-14 w-full justify-start gap-3 rounded-none px-4 py-2 text-left whitespace-normal disabled:opacity-100"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium leading-tight">{p.nama}</span>
                        <span className="block truncate text-xs font-normal text-muted-foreground">
                          {[p.varian, p.kode].filter(Boolean).join(" · ")}
                        </span>
                        <span className={cn("block text-xs font-normal tabular-nums text-muted-foreground", sisa <= 0 && "text-destructive")}>
                          {p.dijanjikan > 0 ? t("kirim.saldoJanji", { saldo: p.stok, janji: p.dijanjikan }) : t("kirim.saldo", { saldo: p.stok })}
                        </span>
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
        {cocokTotal > hasil.length ? <p className="px-1 text-xs text-muted-foreground">{t("kirim.lebihBanyak", { tampil: hasil.length, total: cocokTotal })}</p> : null}
      </section>

      <section className="space-y-2" aria-labelledby="judul-dipilih-mutasi">
        <h2 id="judul-dipilih-mutasi" className="beranda-judul px-1">
          {t("kirim.dipilihJudul", { baris: dipilih.length, pcs: totalPcs })}
        </h2>
        {dipilih.length === 0 ? (
          <p className="beranda-kartu text-sm text-muted-foreground">{t("kirim.dipilihKosong")}</p>
        ) : (
          <div className="beranda-kartu beranda-kartu-daftar">
            <ul className="divide-y">
              {dipilih.map((d) => {
                const n = angka(d.qty);
                const salah = !sah(d.qty);
                const lebih = !salah && (n ?? 0) > tersedia(d.barang);
                return (
                  <li key={d.barang.kunci} className={cn("space-y-2 px-4 py-3", lebih && "bg-amber-500/10")}>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium leading-tight">{d.barang.nama}</p>
                        <p className="truncate text-xs text-muted-foreground">{[d.barang.varian, d.barang.kode].filter(Boolean).join(" · ")}</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => hapus(d.barang.kunci)}
                        disabled={pending}
                        aria-label={t("kirim.hapus", { nama: d.barang.nama })}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      {salah ? (
                        <p className="mr-auto text-xs text-destructive">{t("kirim.jumlahSalah")}</p>
                      ) : lebih ? (
                        <p className={cn("mr-auto text-xs font-medium", modeSaldo === "TOLAK" ? "text-destructive" : "text-amber-700 dark:text-amber-300")}>
                          {t("kirim.melebihi", { tersedia: tersedia(d.barang) })}
                        </p>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => ubahQty(d.barang.kunci, String(Math.max(1, (n ?? 1) - 1)))}
                        disabled={pending || n === null || n <= 1}
                        aria-label={t("kirim.kurangi", { nama: d.barang.nama })}
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <Input
                        value={d.qty}
                        onChange={(e) => ubahQty(d.barang.kunci, e.target.value.replace(/\D/g, "").slice(0, 5))}
                        inputMode="numeric"
                        aria-label={t("kirim.jumlahUntuk", { nama: d.barang.nama })}
                        aria-invalid={salah || undefined}
                        disabled={pending}
                        className="w-20 text-center tabular-nums"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => ubahQty(d.barang.kunci, String(Math.min(QTY_MAKS_MUTASI, (n ?? 0) + 1)))}
                        disabled={pending || (n !== null && n >= QTY_MAKS_MUTASI)}
                        aria-label={t("kirim.tambahSatu", { nama: d.barang.nama })}
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
        {melebihi.length > 0 && modeSaldo === "PERINGATAN" ? <p className="px-1 text-xs text-amber-700 dark:text-amber-300">{t("kirim.peringatanSaldo")}</p> : null}
      </section>

      <div className="space-y-2">
        <Label htmlFor="mutasi-alasan">{t("kirim.alasan")}</Label>
        <Textarea
          id="mutasi-alasan"
          value={alasan}
          onChange={(e) => setAlasan(e.target.value.slice(0, BATAS_TEKS_MUTASI))}
          placeholder={t("kirim.alasanContoh")}
          rows={2}
          disabled={pending}
        />
      </div>

      <div className="space-y-2">
        <Button className="w-full" size="lg" disabled={kurang !== null || pending} onClick={kirim}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
          {t("kirim.ajukan", { pcs: totalPcs })}
        </Button>
        <KeteranganKirim teks={kurang} />
        {luring ? (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <CloudOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{t("luring.catatanAjuan")}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
