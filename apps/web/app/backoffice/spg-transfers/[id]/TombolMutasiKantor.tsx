"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CircleCheck, CircleX, Loader2, PackageCheck, Route, Scale, XCircle } from "lucide-react";
import {
  alihkanTujuanMutasiAction,
  batalkanMutasiKantorAction,
  putuskanSelisihMutasiAction,
  setujuiMutasiAction,
  terimaMutasiKantorAction,
  tolakMutasiAction,
} from "@/app/actions/spg-mutasi";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { dinamis } from "@/lib/i18n/dinamis";
import { BATAS_TEKS_MUTASI } from "@/lib/spg/mutasi-aturan";
import type { RincianMutasiKantor } from "@/lib/spg/mutasi-queries";
import { pesanGagalMutasi } from "@/app/pwa/spg/mutasi/tampilan";

type Mode = "setujui" | "tolak" | "batal" | "alihkan" | "selisih" | "terima";
type Hasil = { ok: true } | { ok: false; code: string; noKonsi?: string[] };

/**
 * Tombol keputusan kantor untuk satu mutasi. Tombol hanya muncul bagi yang
 * berizin; server memeriksa ulang semuanya (izin, status, aturan arah, siklus).
 * Siklus konsinyasi yang terkunci tidak menolak kantor mentah-mentah: kantor
 * ditanya dulu, dan persetujuannya tercatat di jejak mutasi.
 */
export function TombolMutasiKantor({
  rincian: r,
  bolehPutuskan,
  bolehTerima,
  milikSendiri,
}: {
  rincian: RincianMutasiKantor;
  bolehPutuskan: boolean;
  bolehTerima: boolean;
  milikSendiri: boolean;
}) {
  const t = useTranslations("spgMutasi");
  const td = dinamis(t);
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [mode, setMode] = useState<Mode | null>(null);
  const [teks, setTeks] = useState("");
  const [tujuanBaru, setTujuanBaru] = useState("");
  const [keputusan, setKeputusan] = useState<"HILANG" | "KEMBALI">("HILANG");
  const [jumlah, setJumlah] = useState<Record<string, string>>({});
  const [terkunci, setTerkunci] = useState<string[] | null>(null);

  const tutup = () => {
    setMode(null);
    setTeks("");
    setTujuanBaru("");
    setKeputusan("HILANG");
    setTerkunci(null);
  };

  const buka = (m: Mode) => {
    if (m === "terima") setJumlah(Object.fromEntries(r.baris.map((b) => [b.id, String(b.qty)])));
    setMode(m);
  };

  const jalankan = (aksi: (setujuSiklusTerkunci: boolean) => Promise<Hasil>, sukses: string, setujuSiklusTerkunci = false) =>
    mulai(async () => {
      let h: Hasil;
      try {
        h = await aksi(setujuSiklusTerkunci);
      } catch {
        toast.error(t("err.NETWORK"));
        return;
      }
      if (!h.ok && h.code === "SIKLUS_TERKUNCI" && !setujuSiklusTerkunci) {
        // Tanya dulu; jawabannya dikirim ulang bersama aksi yang sama.
        setTerkunci(h.noKonsi ?? []);
        return;
      }
      if (!h.ok) {
        toast.error(pesanGagalMutasi(h, td));
        if (h.code === "SUDAH_DIPUTUSKAN" || h.code === "SUDAH_DITERIMA" || h.code === "KIRIMAN_TIDAK_DITEMUKAN") router.refresh();
        return;
      }
      toast.success(sukses);
      tutup();
      router.refresh();
    });

  const angka = (s: string | undefined) => (s === undefined || s === "" ? null : Number(s));
  const terimaSah = r.baris.every((b) => {
    const n = angka(jumlah[b.id]);
    return n !== null && Number.isInteger(n) && n >= 0 && n <= b.qty;
  });

  const aksiMode = (m: Mode): ((setuju: boolean) => Promise<Hasil>) => {
    switch (m) {
      case "setujui":
        return () => setujuiMutasiAction({ transferId: r.id, teks: teks.trim() || undefined });
      case "tolak":
        return () => tolakMutasiAction({ transferId: r.id, teks: teks.trim() });
      case "batal":
        return () => batalkanMutasiKantorAction({ transferId: r.id, teks: teks.trim() });
      case "alihkan":
        return () => alihkanTujuanMutasiAction({ transferId: r.id, toStoreId: tujuanBaru, teks: teks.trim() });
      case "selisih":
        return (setuju) => putuskanSelisihMutasiAction({ transferId: r.id, keputusan, teks: teks.trim(), setujuSiklusTerkunci: setuju });
      case "terima":
        return (setuju) =>
          terimaMutasiKantorAction({
            transferId: r.id,
            sumber: r.terimaKantor ?? "MUTASI",
            diterima: r.baris.map((b) => ({ lineId: b.id, qtyReceived: Number(jumlah[b.id]) })),
            catatan: teks.trim() || undefined,
            setujuSiklusTerkunci: setuju,
          });
    }
  };

  const kirim = (setuju = false) => {
    if (!mode) return;
    jalankan(aksiMode(mode), td(`kantor.ok.${mode}`, { docNo: r.docNo }), setuju);
  };

  const tampilSetujui = bolehPutuskan && !milikSendiri && r.status === "DIAJUKAN";
  const tampilBatal = bolehPutuskan && (r.status === "DIAJUKAN" || r.status === "DISETUJUI" || r.status === "DIKIRIM");
  const tampilAlihkan = bolehPutuskan && r.status === "DIKIRIM";
  const tampilSelisih = bolehPutuskan && r.selisihStatus === "TERBUKA";
  const tampilTerima = bolehTerima && r.terimaKantor !== null;
  if (!tampilSetujui && !tampilBatal && !tampilAlihkan && !tampilSelisih && !tampilTerima) return null;

  const wajibTeks = mode === "tolak" || mode === "batal" || mode === "alihkan" || mode === "selisih";
  const bisaKirim =
    !pending &&
    (!wajibTeks || teks.trim().length > 0) &&
    (mode !== "alihkan" || tujuanBaru !== "") &&
    (mode !== "terima" || terimaSah);

  return (
    <>
      <span className="inline-flex flex-wrap gap-2">
        {tampilSetujui ? (
          <>
            <Button disabled={pending} onClick={() => buka("setujui")}>
              <CircleCheck className="h-4 w-4" />
              {t("kantor.tombol.setujui")}
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => buka("tolak")}>
              <CircleX className="h-4 w-4" />
              {t("kantor.tombol.tolak")}
            </Button>
          </>
        ) : null}
        {tampilTerima ? (
          <Button disabled={pending} onClick={() => buka("terima")}>
            <PackageCheck className="h-4 w-4" />
            {r.terimaKantor === "MUTASI_KEMBALI" ? t("kantor.tombol.terimaKembali") : t("kantor.tombol.terima")}
          </Button>
        ) : null}
        {tampilSelisih ? (
          <Button disabled={pending} onClick={() => buka("selisih")}>
            <Scale className="h-4 w-4" />
            {t("kantor.tombol.selisih")}
          </Button>
        ) : null}
        {tampilAlihkan ? (
          <Button variant="outline" disabled={pending} onClick={() => buka("alihkan")}>
            <Route className="h-4 w-4" />
            {t("kantor.tombol.alihkan")}
          </Button>
        ) : null}
        {tampilBatal ? (
          <Button variant="ghost" disabled={pending} onClick={() => buka("batal")}>
            <XCircle className="h-4 w-4" />
            {r.status === "DIKIRIM" ? t("kantor.tombol.batalKembali") : t("kantor.tombol.batal")}
          </Button>
        ) : null}
      </span>

      <Dialog open={mode !== null && terkunci === null} onOpenChange={(v) => (v || pending ? undefined : tutup())}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{mode ? td(`kantor.dialog.${mode}.judul`) : ""}</DialogTitle>
            <DialogDescription>
              {mode === "batal" && r.status === "DIKIRIM"
                ? t("kantor.dialog.batal.isiKembali", { docNo: r.docNo })
                : mode
                  ? td(`kantor.dialog.${mode}.isi`, { docNo: r.docNo, asal: r.asal.name, tujuan: r.tujuan.name })
                  : ""}
            </DialogDescription>
          </DialogHeader>

          {mode === "alihkan" ? (
            <div className="space-y-2">
              <Label htmlFor="mutasi-alihkan">{t("kantor.dialog.alihkan.tujuanBaru")}</Label>
              {r.pilihanTujuan.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("kantor.dialog.alihkan.tanpaPilihan")}</p>
              ) : (
                <Select value={tujuanBaru} onValueChange={setTujuanBaru} disabled={pending}>
                  <SelectTrigger id="mutasi-alihkan" className="w-full">
                    <SelectValue placeholder={t("kantor.dialog.alihkan.pilih")} />
                  </SelectTrigger>
                  <SelectContent>
                    {r.pilihanTujuan.map((x) => (
                      <SelectItem key={x.id} value={x.id}>
                        {x.punyaSpg ? x.name : t("kantor.dialog.alihkan.tanpaSpg", { nama: x.name })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          ) : null}

          {mode === "selisih" ? (
            <div className="space-y-2">
              <Label>{t("kantor.dialog.selisih.keputusan")}</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {(["HILANG", "KEMBALI"] as const).map((k) => (
                  <Button
                    key={k}
                    type="button"
                    variant={keputusan === k ? "default" : "outline"}
                    aria-pressed={keputusan === k}
                    className="h-auto flex-col items-start gap-0.5 whitespace-normal px-3 py-2 text-left"
                    onClick={() => setKeputusan(k)}
                    disabled={pending}
                  >
                    <span className="font-medium">{td(`kantor.selisih.${k}`)}</span>
                    <span className="text-xs font-normal opacity-80">{td(`kantor.dialog.selisih.arti.${k}`)}</span>
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          {mode === "terima" ? (
            <div className="space-y-2">
              <p className="text-sm">{t("kantor.dialog.terima.petunjuk")}</p>
              <ul className="divide-y rounded-md border">
                {r.baris.map((b) => {
                  const n = angka(jumlah[b.id]);
                  const salah = n === null || !Number.isInteger(n) || n < 0 || n > b.qty;
                  return (
                    <li key={b.id} className="flex items-center gap-3 px-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{b.productName}</span>
                        <span className="block text-xs text-muted-foreground">{t("rincian.dikirimQty", { qty: b.qty })}</span>
                      </span>
                      <Input
                        value={jumlah[b.id] ?? ""}
                        onChange={(e) => setJumlah((lama) => ({ ...lama, [b.id]: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
                        inputMode="numeric"
                        aria-label={t("kantor.dialog.terima.jumlahUntuk", { nama: b.productName })}
                        aria-invalid={salah || undefined}
                        disabled={pending}
                        className="w-20 text-center tabular-nums"
                      />
                    </li>
                  );
                })}
              </ul>
              {!terimaSah ? <p className="text-xs text-destructive">{t("kantor.dialog.terima.salah")}</p> : null}
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor={`mutasi-teks-${r.id}`}>
              {mode ? td(`kantor.dialog.${mode}.label`) : ""}
              {wajibTeks ? <span className="ml-1 text-destructive">*</span> : null}
            </Label>
            <Textarea id={`mutasi-teks-${r.id}`} value={teks} maxLength={BATAS_TEKS_MUTASI} rows={3} onChange={(e) => setTeks(e.target.value)} disabled={pending} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={tutup} disabled={pending}>
              {t("kantor.kembali")}
            </Button>
            <Button variant={mode === "tolak" || mode === "batal" ? "destructive" : "default"} disabled={!bisaKirim} onClick={() => kirim(false)}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {mode ? td(`kantor.dialog.${mode}.tombol`) : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={terkunci !== null} onOpenChange={(v) => (!v && !pending ? setTerkunci(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("kantor.terkunci.judul")}</AlertDialogTitle>
            <AlertDialogDescription>{t("kantor.terkunci.isi", { siklus: (terkunci ?? []).join(", ") })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("kantor.kembali")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                kirim(true);
              }}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("kantor.terkunci.lanjut")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
