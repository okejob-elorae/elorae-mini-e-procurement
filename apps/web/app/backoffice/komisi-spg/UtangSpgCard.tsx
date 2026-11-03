"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { HandCoins, Loader2 } from "lucide-react";
import {
  batalkanPenerimaanUtangSpgAction,
  catatPenerimaanUtangSpgAction,
  catatSisaSpgBerhentiAction,
  periksaPenerimaanUtangSpgAction,
  revisiPenerimaanUtangSpgAction,
  terapkanKoreksiPlusSesudahAkhirAction,
} from "@/app/actions/spg-komisi-utang";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { Textarea } from "@/components/ui/textarea";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { formatIDR } from "@/lib/sales-orders/format";
import type { BarisUtangSpgKantor } from "@/lib/spg/utang-queries";

/** Disalin dari `CARA_BAYAR_UTANG_SPG` — nilainya tidak diimpor ke peramban. */
const CARA = ["tunai", "transfer"] as const;
const NADA: Record<string, StatusTone> = { MENUNGGU_CEK: "waiting", TERVERIFIKASI: "settled", DIKEMBALIKAN: "attention", DIBATALKAN: "inactive" };
const hariIniWib = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
const tanggal = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });

type Pembayaran = BarisUtangSpgKantor["pembayaran"][number];

type Dialogs =
  | { jenis: "BAYAR"; o: BarisUtangSpgKantor }
  | { jenis: "PLUS"; o: BarisUtangSpgKantor }
  | { jenis: "REVISI"; o: BarisUtangSpgKantor; p: Pembayaran }
  | { jenis: "KEMBALI"; id: string; versi: number }
  | { jenis: "BATAL"; id: string }
  | null;

/**
 * Utang SPG yang berhenti (P6, P6a, P67, P68): sisa minus sesudah pembayaran terakhir dicatat
 * menjadi utang, koreksi plus mengimbangi utang dulu lalu dibayarkan, uang yang diterima dicatat
 * MENUNGGU_CEK dan baru mengurangi utang sesudah diperiksa orang lain. Tombol = izin aksinya:
 * `spg_commission:pay` mencatat/membayar, memperbaiki penerimaan yang dikembalikan pemeriksa (lalu
 * menunggu cek lagi), dan membatalkan yang belum dicek; `payments:verify` memeriksa dan membatalkan
 * yang sudah terverifikasi.
 */
export function UtangSpgCard({ baris, bolehBayar, bolehVerifikasi }: { baris: BarisUtangSpgKantor[]; bolehBayar: boolean; bolehVerifikasi: boolean }) {
  const t = useTranslations("komisiSpg.utang");
  const td = dinamis(useTranslations("komisiSpg.utang"));
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [kunci, setKunci] = useState(() => newLocalId());
  const [jumlah, setJumlah] = useState("");
  const [cara, setCara] = useState<(typeof CARA)[number]>("transfer");
  const [tgl, setTgl] = useState(hariIniWib());
  const [catatan, setCatatan] = useState("");
  const [foto, setFoto] = useState<File | null>(null);

  const buka = (d: NonNullable<Dialogs>) => {
    // Perbaikan penerimaan yang dikembalikan mulai dari isian lamanya; yang lain dari kosong.
    const lama = d.jenis === "REVISI" ? d.p : null;
    setJumlah(lama ? String(lama.jumlah) : "");
    setCara(lama && (CARA as readonly string[]).includes(lama.cara) ? (lama.cara as (typeof CARA)[number]) : "transfer");
    setTgl(lama ? lama.tanggal : hariIniWib());
    setCatatan(lama?.catatan ?? "");
    setFoto(null);
    setDialog(d);
  };

  const jalankan = (kerja: () => Promise<{ ok: boolean; code?: string }>, pesan: string, gantiKunci = false) =>
    mulai(async () => {
      try {
        const r = await kerja();
        if (!r.ok) {
          toast.error(td(`err.${r.code}`));
          if (r.code === "ANGKA_BERUBAH" || r.code === "STATUS_BERUBAH") router.refresh();
          return;
        }
        toast.success(pesan);
        setDialog(null);
        if (gantiKunci) setKunci(newLocalId());
        router.refresh();
      } catch {
        // Jawaban hilang: kuncinya tetap, simpan ulang tidak mencatat dua kali.
        toast.error(td("err.GAGAL"));
      }
    });

  const formulir = (isi: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(isi)) f.set(k, v);
    if (foto) f.set("foto", foto);
    return f;
  };

  return (
    <Card id="utang">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HandCoins className="h-5 w-5" aria-hidden />
          {t("judul")}
        </CardTitle>
        <CardDescription>{t("isi")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {baris.length === 0 ? <p className="text-sm text-muted-foreground">{t("kosong")}</p> : null}
        {baris.map((o) => (
          <div key={o.spgUserId} className="space-y-3 rounded-md border p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium">
                {o.nama}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {t("berhenti", { toko: o.toko ?? "—", tanggal: tanggal(`${o.berhentiPada}T00:00:00+07:00`) })}
                </span>
              </p>
              <p className="text-sm tabular-nums">{t("sisa", { jumlah: formatIDR(o.sisaUtang) })}</p>
            </div>

            {!o.akhirDibayar ? <p className="text-xs text-muted-foreground">{o.adaBarisBelumDibayar ? t("belumAkhir") : t("belumAkhirKosong")}</p> : null}

            {o.utang.length > 0 ? (
              <ul className="divide-y rounded-md border text-sm">
                {o.utang.map((u) => (
                  <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0">
                      {td(`jenis.${u.jenis}`)} · {u.catatan || u.sumber}
                      <span className="block text-xs text-muted-foreground">{t("dibuat", { tanggal: tanggal(u.dibuat) })}</span>
                    </span>
                    <span className="text-right tabular-nums">
                      {formatIDR(u.jumlah)}
                      <span className="block text-xs text-muted-foreground">{u.lunas ? t("lunas") : t("sisaBaris", { jumlah: formatIDR(u.sisa) })}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            {o.belumDicatat.jumlah > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
                <span>{t("belumDicatat", { jumlah: formatIDR(o.belumDicatat.jumlah) })}</span>
                {bolehBayar ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={sibuk}
                    onClick={() => jalankan(() => catatSisaSpgBerhentiAction({ spgUserId: o.spgUserId, jumlahDiharapkan: o.belumDicatat.jumlah, kunci }), t("okDicatat"), true)}
                  >
                    {t("catatUtang")}
                  </Button>
                ) : null}
              </div>
            ) : null}

            {o.jumlahPlus > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <span>{t("plusMenunggu", { jumlah: formatIDR(o.jumlahPlus) })}</span>
                {bolehBayar ? (
                  <Button size="sm" variant="outline" disabled={sibuk || o.belumDicatat.jumlah > 0} onClick={() => buka({ jenis: "PLUS", o })}>
                    {t("bayarPlus")}
                  </Button>
                ) : null}
              </div>
            ) : null}

            {o.pembayaran.length > 0 ? (
              <ul className="divide-y rounded-md border text-sm">
                {o.pembayaran.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0">
                      <span className="tabular-nums">{formatIDR(p.jumlah)}</span> · {td(`cara.${p.cara}`)} · {tanggal(p.tanggal)}
                      <span className="block text-xs text-muted-foreground">{t("dicatatOleh", { nama: p.pencatat })}</span>
                      {p.catatanKembali ? <span className="block text-xs text-destructive">{p.catatanKembali}</span> : null}
                    </span>
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <StatusPill tone={NADA[p.status] ?? "inactive"}>{td(`status.${p.status}`)}</StatusPill>
                      {p.status === "MENUNGGU_CEK" && bolehVerifikasi ? (
                        <>
                          <Button
                            size="sm"
                            disabled={sibuk}
                            onClick={() => jalankan(() => periksaPenerimaanUtangSpgAction({ id: p.id, versi: p.versi, keputusan: "TERVERIFIKASI" }), t("okVerifikasi"))}
                          >
                            {t("verifikasi")}
                          </Button>
                          <Button size="sm" variant="outline" disabled={sibuk} onClick={() => buka({ jenis: "KEMBALI", id: p.id, versi: p.versi })}>
                            {t("kembalikan")}
                          </Button>
                        </>
                      ) : null}
                      {p.status === "DIKEMBALIKAN" && bolehBayar ? (
                        <Button size="sm" variant="outline" disabled={sibuk} onClick={() => buka({ jenis: "REVISI", o, p })}>
                          {t("revisi")}
                        </Button>
                      ) : null}
                      {(p.status === "MENUNGGU_CEK" || p.status === "DIKEMBALIKAN") && bolehBayar ? (
                        <Button size="sm" variant="ghost" disabled={sibuk} onClick={() => buka({ jenis: "BATAL", id: p.id })}>
                          {t("batalkan")}
                        </Button>
                      ) : p.status === "TERVERIFIKASI" && bolehVerifikasi ? (
                        <Button size="sm" variant="ghost" disabled={sibuk} onClick={() => buka({ jenis: "BATAL", id: p.id })}>
                          {t("batalkan")}
                        </Button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            {bolehBayar && o.sisaUtang - o.menungguCek > 0 ? (
              <Button size="sm" variant="outline" disabled={sibuk} onClick={() => buka({ jenis: "BAYAR", o })}>
                {t("catatPenerimaan")}
              </Button>
            ) : null}
          </div>
        ))}
      </CardContent>

      <Dialog open={dialog !== null} onOpenChange={(v) => !v && !sibuk && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog ? td(`dialog.${dialog.jenis}.judul`) : ""}</DialogTitle>
            <DialogDescription>
              {dialog?.jenis === "BAYAR"
                ? t("dialog.BAYAR.isi", { jumlah: formatIDR(dialog.o.sisaUtang - dialog.o.menungguCek) })
                : dialog?.jenis === "REVISI"
                  ? t("dialog.REVISI.isi", { jumlah: formatIDR(dialog.o.sisaUtang - dialog.o.menungguCek), catatan: dialog.p.catatanKembali ?? "" })
                : dialog?.jenis === "PLUS"
                  ? t("dialog.PLUS.isi", { jumlah: formatIDR(dialog.o.jumlahPlus), utang: formatIDR(dialog.o.sisaUtang) })
                  : dialog
                    ? td(`dialog.${dialog.jenis}.isi`)
                    : ""}
            </DialogDescription>
          </DialogHeader>
          {dialog?.jenis === "BAYAR" || dialog?.jenis === "PLUS" || dialog?.jenis === "REVISI" ? (
            <div className="space-y-4">
              {dialog.jenis === "BAYAR" || dialog.jenis === "REVISI" ? (
                <div className="space-y-2">
                  <Label htmlFor="utang-jumlah">{t("jumlah")}</Label>
                  <Input id="utang-jumlah" inputMode="decimal" value={jumlah} onChange={(e) => setJumlah(e.target.value.replace(/[^\d.]/g, ""))} />
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="utang-cara">{t("caraLabel")}</Label>
                <Select value={cara} onValueChange={(v) => setCara(v as (typeof CARA)[number])}>
                  <SelectTrigger id="utang-cara">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CARA.map((c) => (
                      <SelectItem key={c} value={c}>
                        {td(`cara.${c}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="utang-tgl">{t("tanggal")}</Label>
                <TanggalInput id="utang-tgl" value={tgl} max={hariIniWib()} required onChange={(e) => setTgl(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="utang-foto">{t("foto")}</Label>
                <Input id="utang-foto" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} />
              </div>
              {dialog.jenis === "BAYAR" || dialog.jenis === "REVISI" ? (
                <div className="space-y-2">
                  <Label htmlFor="utang-catatan">{t("catatan")}</Label>
                  <Textarea id="utang-catatan" rows={2} maxLength={500} value={catatan} onChange={(e) => setCatatan(e.target.value)} />
                </div>
              ) : null}
            </div>
          ) : dialog ? (
            <div className="space-y-2">
              <Label htmlFor="utang-alasan">{t("alasan")}</Label>
              <Textarea id="utang-alasan" rows={3} maxLength={500} value={catatan} onChange={(e) => setCatatan(e.target.value)} />
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" disabled={sibuk} onClick={() => setDialog(null)}>
              {t("tutup")}
            </Button>
            <Button
              disabled={
                sibuk ||
                !dialog ||
                ((dialog.jenis === "BAYAR" || dialog.jenis === "REVISI") && !(Number(jumlah) > 0)) ||
                ((dialog.jenis === "BAYAR" || dialog.jenis === "PLUS" || dialog.jenis === "REVISI") && !tgl) ||
                ((dialog.jenis === "KEMBALI" || dialog.jenis === "BATAL") && !catatan.trim())
              }
              onClick={() => {
                const d = dialog;
                if (!d) return;
                if (d.jenis === "BAYAR") {
                  jalankan(
                    () => catatPenerimaanUtangSpgAction(formulir({ spgUserId: d.o.spgUserId, jumlah, cara, diterimaPada: tgl, catatan, kunci })),
                    t("okPenerimaan"),
                    true,
                  );
                } else if (d.jenis === "REVISI") {
                  // Foto baru hanya kalau dipilih; tanpa itu foto lamanya tetap.
                  jalankan(
                    () =>
                      revisiPenerimaanUtangSpgAction(
                        formulir({ id: d.p.id, versi: String(d.p.versi), spgUserId: d.o.spgUserId, jumlah, cara, diterimaPada: tgl, catatan }),
                      ),
                    t("okRevisi"),
                  );
                } else if (d.jenis === "PLUS") {
                  jalankan(
                    () =>
                      terapkanKoreksiPlusSesudahAkhirAction(
                        formulir({ spgUserId: d.o.spgUserId, jumlahDiharapkan: String(d.o.jumlahPlus), cara, dibayarPada: tgl, kunci }),
                      ),
                    t("okPlus"),
                    true,
                  );
                } else if (d.jenis === "KEMBALI") {
                  jalankan(() => periksaPenerimaanUtangSpgAction({ id: d.id, versi: d.versi, keputusan: "DIKEMBALIKAN", catatan }), t("okKembali"));
                } else {
                  jalankan(() => batalkanPenerimaanUtangSpgAction({ id: d.id, alasan: catatan }), t("okBatal"));
                }
              }}
            >
              {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {dialog ? td(`dialog.${dialog.jenis}.tombol`) : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
