"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, RotateCcw, Scissors } from "lucide-react";
import { tandaiSalesDipotongAction } from "@/app/actions/barang-hilang";
import { tandaiBebanReturDipotongAction, tandaiKelebihanReturDikembalikanAction } from "@/app/actions/store-returns";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { bacaIsianRupiah, BATAS_TEKS_HILANG, keSen, tulisIsianRupiah } from "@/lib/spg/hilang";
import { formatIDR } from "@/lib/sales-orders/format";

/** Yang ditandai: beban barang hilang, selisih retur dipotong, atau kelebihan potongan retur dikembalikan. */
export type JenisTandaiPotong = "HILANG" | "RETUR" | "KEMBALI";

type HasilTandai = { ok: true; nilai: number } | { ok: false; code: string };

/**
 * Laporan komisi salesman: kantor menandai beban barang hilang (bagian SALES)
 * atau selisih retur yang dibebankan ke sales (P22) sudah dipotong dari komisi
 * bulan ini — atau, untuk selisih retur yang barangnya ketemu sesudah dipotong,
 * kelebihannya sudah dikembalikan (jalur ini MENUNGGU JAWABAN P87: dengan bawaan yang
 * disetujui pemilik kelebihannya selalu nol, jadi tombolnya tidak pernah tampil —
 * lihat `lib/receivables/potong-beban-retur.ts`). Penggajian salesman belum ada di
 * sistem, jadi uangnya berpindah di luar dan dicatat di sini. Satu kunci per
 * formulir (klik ganda aman). Beban barang hilang dibagikan ke beban terlama dulu.
 */
export function TandaiDipotongDialog({
  jenis = "HILANG",
  salesmanId,
  nama,
  bulan,
  bulanLabel,
  sisa,
  saran,
  maksPotongPersen = 0,
}: {
  jenis?: JenisTandaiPotong;
  salesmanId: string;
  nama: string;
  bulan: string;
  bulanLabel: string;
  /** Batas atas jumlahnya: sisa beban (HILANG/RETUR) atau kelebihan potongan (KEMBALI). */
  sisa: number;
  saran: number;
  /** Hanya beban barang hilang yang punya batas persen per pembayaran. */
  maksPotongPersen?: number;
}) {
  const hilang = jenis === "HILANG";
  const kembali = jenis === "KEMBALI";
  const t = useTranslations(hilang ? "komisiSalesmanHilang" : "komisiSalesmanRetur");
  const td = dinamis(t);
  const router = useRouter();
  const [buka, setBuka] = useState(false);
  const [sibuk, mulai] = useTransition();
  const [kunci, setKunci] = useState(() => newLocalId());
  const [jumlah, setJumlah] = useState(saran > 0 ? tulisIsianRupiah(saran) : "");
  const [catatan, setCatatan] = useState("");

  const angka = bacaIsianRupiah(jumlah);
  const kurang =
    angka === null || angka <= 0
      ? t("kurangJumlah")
      : keSen(angka) > keSen(sisa)
        ? td(kembali ? "melebihiKelebihan" : "melebihiSisa", { sisa: formatIDR(sisa) })
        : null;

  const tandai = async (jumlahRp: number): Promise<HasilTandai> => {
    const isian = { salesmanId, bulan, jumlah: jumlahRp, kunci, catatan: catatan.trim() || null };
    if (jenis === "RETUR") return tandaiBebanReturDipotongAction(isian);
    if (jenis === "KEMBALI") return tandaiKelebihanReturDikembalikanAction(isian);
    const r = await tandaiSalesDipotongAction(isian);
    return r.ok ? { ok: true, nilai: r.dipotong } : r;
  };

  const kirim = () =>
    mulai(async () => {
      if (angka === null) return;
      let r: HasilTandai;
      try {
        r = await tandai(angka);
      } catch {
        toast.error(t("err.NETWORK"));
        return;
      }
      if (!r.ok) {
        toast.error(td(`err.${r.code}`));
        return;
      }
      toast.success(td(kembali ? "okKembali" : "ok", { nilai: formatIDR(r.nilai), nama }));
      setBuka(false);
      setKunci(newLocalId());
      setCatatan("");
      router.refresh();
    });

  return (
    <Dialog
      open={buka}
      onOpenChange={(o) => {
        setBuka(o);
        if (o) setJumlah(saran > 0 ? tulisIsianRupiah(saran) : "");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="mt-1">
          {kembali ? <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> : <Scissors className="mr-1.5 h-3.5 w-3.5" />}
          {td(kembali ? "tombolKembali" : "tombol")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{td(kembali ? "judulKembali" : "judul", { nama })}</DialogTitle>
          <DialogDescription>
            {td(kembali ? "deskripsiKembali" : "deskripsi", { bulan: bulanLabel, sisa: formatIDR(sisa), persen: maksPotongPersen })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`potong-${jenis}-${salesmanId}`}>{td(kembali ? "jumlahKembali" : "jumlah")}</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Rp</span>
              <Input
                id={`potong-${jenis}-${salesmanId}`}
                inputMode="decimal"
                value={jumlah}
                onChange={(e) => setJumlah(e.target.value.replace(/[^\d.,]/g, "").slice(0, 20))}
                className="w-44 text-right tabular-nums"
                aria-invalid={kurang !== null}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {saran > 0 ? t("saran", { nilai: formatIDR(saran) }) : td(kembali ? "tanpaSaranKembali" : "tanpaSaran", { sisa: formatIDR(sisa) })}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`potong-catatan-${jenis}-${salesmanId}`}>{t("catatan")}</Label>
            <Textarea id={`potong-catatan-${jenis}-${salesmanId}`} value={catatan} maxLength={BATAS_TEKS_HILANG} onChange={(e) => setCatatan(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
          {kurang ? <p className="text-xs text-muted-foreground sm:mr-auto">{kurang}</p> : null}
          <Button onClick={kirim} disabled={sibuk || kurang !== null}>
            {sibuk ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {td(kembali ? "simpanKembali" : "simpan")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
