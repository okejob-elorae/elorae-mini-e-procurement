"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeftRight, CalendarDays, Check, Loader2, X } from "lucide-react";
import { ajukanTukarShiftAction, batalkanTukarShiftAction, jawabTukarShiftAction, type HasilTukarAksi } from "@/app/actions/spg-shift";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { KeteranganKirim } from "@/app/pwa/KeteranganKirim";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { MAKS_ALASAN_TUKAR, type StatusTukar } from "@/lib/spg/shift";
import type { DataJadwalSpgHp, SelRingkas, TukarHp } from "@/lib/spg/shift-queries";
import { cn } from "@/lib/utils";

const TIDAK = "__tidak__";

const NADA: Record<StatusTukar, string> = {
  MENUNGGU_REKAN: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  MENUNGGU_KANTOR: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  DISETUJUI: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  DITOLAK_REKAN: "bg-muted text-muted-foreground",
  DITOLAK: "bg-destructive/10 text-destructive",
  DIBATALKAN: "bg-muted text-muted-foreground",
};

/**
 * Jadwal kerja SPG: 14 hari mulai hari ini (hari ini disorot), shift sendiri
 * dan rekan setoko, dan tukar shift. Mengajukan tukar membuka lembar bawah;
 * kunci kiriman dibuat sekali setiap lembar dibuka, jadi ketukan ulang
 * sesudah jawaban hilang tidak membuat ajuan kedua.
 */
export function JadwalSpgHpClient({ namaToko, data }: { namaToko: string; data: DataJadwalSpgHp }) {
  const t = useTranslations("jadwalSpg");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();

  // Lembar ajukan tukar.
  const [bukaAjukan, setBukaAjukan] = useState(false);
  const [kunci, setKunci] = useState("");
  const [hari, setHari] = useState("");
  const [rekanId, setRekanId] = useState("");
  const [hariRekan, setHariRekan] = useState(TIDAK);
  const [alasan, setAlasan] = useState("");

  // Tolak ajuan masuk / batalkan ajuan sendiri.
  const [tolakUntuk, setTolakUntuk] = useState<TukarHp | null>(null);
  const [alasanTolak, setAlasanTolak] = useState("");
  const [batalUntuk, setBatalUntuk] = useState<TukarHp | null>(null);

  const teksSel = (s: SelRingkas | null, izin?: string | null) => {
    if (izin) return t("hp.izin", { jenis: td(`jenisIzin.${izin}`) });
    if (!s) return t("hp.belumDijadwalkan");
    if (s.kind === "LIBUR") return t("libur");
    return `${s.label} ${s.mulai ?? ""}–${s.selesai ?? ""}`;
  };
  const teksSelatau = (s: SelRingkas | null) => (s ? teksSel(s) : t("libur"));

  const hariKerjaSaya = data.hari.filter((h) => h.saya?.kind === "KERJA");
  const rekan = data.rekan.find((r) => r.id === rekanId) ?? null;
  const hariKerjaRekan = rekan ? data.hari.filter((h) => h.rekan.find((r) => r.userId === rekan.id)?.sel?.kind === "KERJA") : [];
  const orangPada = (userId: string, day: string) => data.hari.find((h) => h.day === day)?.rekan.find((r) => r.userId === userId) ?? null;
  const selRekan = (day: string) => orangPada(rekanId, day)?.sel ?? null;
  const selSaya = (day: string) => data.hari.find((h) => h.day === day)?.saya ?? null;
  const labelHari = (day: string) => data.hari.find((h) => h.day === day)?.label ?? day;

  const bisaAjukan = data.rekan.length > 0 && hariKerjaSaya.length > 0;
  const kurang = !hari ? t("hp.kurangHari") : !rekanId ? t("hp.kurangRekan") : !alasan.trim() ? t("hp.kurangAlasan") : null;

  const teksGalat = (r: Extract<HasilTukarAksi, { ok: false }>) => td(`errTukar.${r.code}`);

  const bukaLembar = () => {
    setKunci(newLocalId());
    setHari(hariKerjaSaya[0]?.day ?? "");
    setRekanId(data.rekan.length === 1 ? data.rekan[0].id : "");
    setHariRekan(TIDAK);
    setAlasan("");
    setBukaAjukan(true);
  };

  const kirimAjuan = () => {
    if (kurang) return;
    mulai(async () => {
      const r = await ajukanTukarShiftAction({
        day: hari,
        partnerId: rekanId,
        partnerDay: hariRekan === TIDAK ? null : hariRekan,
        alasan,
        idempotencyKey: kunci,
      });
      if (!r.ok) {
        toast.error(teksGalat(r));
        return;
      }
      toast.success(t("hp.ajuanTerkirim", { nama: rekan?.nama ?? "" }));
      setBukaAjukan(false);
      router.refresh();
    });
  };

  const jawab = (s: TukarHp, setuju: boolean, alasanTeks?: string) =>
    mulai(async () => {
      const r = await jawabTukarShiftAction({ swapId: s.id, setuju, alasan: alasanTeks });
      if (!r.ok) {
        toast.error(teksGalat(r));
        return;
      }
      toast.success(setuju ? t("hp.andaSetuju") : t("hp.andaTolak"));
      setTolakUntuk(null);
      router.refresh();
    });

  const batalkan = (s: TukarHp) =>
    mulai(async () => {
      const r = await batalkanTukarShiftAction({ swapId: s.id });
      if (!r.ok) {
        toast.error(teksGalat(r));
        return;
      }
      toast.success(t("hp.ajuanDibatalkan"));
      setBatalUntuk(null);
      router.refresh();
    });

  /** Rincian satu ajuan: setiap hari, isi sel kedua orang sekarang. */
  const rincianTukar = (s: TukarHp) => {
    const namaPengaju = s.peran === "PENGAJU" ? t("hp.anda") : s.pengaju;
    const namaRekan = s.peran === "REKAN" ? t("hp.anda") : s.rekan;
    return (
      <ul className="space-y-1.5 text-sm">
        {s.sel.map((x) => (
          <li key={x.day}>
            <span className="font-medium">{x.label}</span>
            <span className="block text-muted-foreground">
              {namaPengaju}: {teksSel(x.pengaju)} · {namaRekan}: {teksSel(x.rekan)}
            </span>
          </li>
        ))}
      </ul>
    );
  };

  // Pratinjau di lembar ajukan: isi sel bertukar, sel kosong menjadi libur.
  const pratinjau = hari && rekan
    ? [hari, ...(hariRekan !== TIDAK && hariRekan !== hari ? [hariRekan] : [])].sort().map((day) => ({
        day,
        saya: teksSelatau(selRekan(day)),
        rekan: teksSelatau(selSaya(day)),
      }))
    : [];

  return (
    <div className="space-y-4 p-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <TautanKembali cadangan="/pwa/spg/lainnya" />
      </Button>

      <header>
        <h1 className="text-2xl font-bold">{t("hp.judul")}</h1>
        <p className="text-sm text-muted-foreground">{namaToko}</p>
      </header>

      {data.masuk.length > 0 ? (
        <section className="beranda-kartu space-y-3">
          <h2 className="beranda-judul">{t("hp.masukJudul", { count: data.masuk.length })}</h2>
          {data.masuk.map((s) => (
            <div key={s.id} className="space-y-2 rounded-lg border p-3">
              <p className="font-medium">{t("hp.memintaTukar", { nama: s.pengaju })}</p>
              {rincianTukar(s)}
              {s.alasan ? <p className="text-sm">{t("hp.alasanDari", { alasan: s.alasan })}</p> : null}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setAlasanTolak("");
                    setTolakUntuk(s);
                  }}
                  disabled={sibuk}
                >
                  <X className="h-4 w-4" aria-hidden />
                  {t("tolak")}
                </Button>
                <Button onClick={() => jawab(s, true)} disabled={sibuk}>
                  {sibuk ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                  {t("hp.setuju")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t("hp.setujuCatatan")}</p>
            </div>
          ))}
        </section>
      ) : null}

      <div className="space-y-1">
        <Button className="w-full" size="lg" onClick={bukaLembar} disabled={!bisaAjukan || sibuk}>
          <ArrowLeftRight className="h-4 w-4" aria-hidden />
          {t("hp.ajukanTukar")}
        </Button>
        <KeteranganKirim teks={bisaAjukan ? null : data.rekan.length === 0 ? t("hp.tanpaRekan") : t("hp.tanpaShift")} />
      </div>

      {data.keluar.length > 0 ? (
        <section className="beranda-kartu space-y-3">
          <h2 className="beranda-judul">{t("hp.keluarJudul")}</h2>
          {data.keluar.map((s) => (
            <div key={s.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{t("hp.denganRekan", { nama: s.rekan })}</p>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", NADA[s.status])}>{td(`statusTukar.${s.status}`)}</span>
              </div>
              {rincianTukar(s)}
              <Button variant="outline" className="w-full" onClick={() => setBatalUntuk(s)} disabled={sibuk}>
                {t("hp.batalkanAjuan")}
              </Button>
            </div>
          ))}
        </section>
      ) : null}

      <section className="beranda-kartu beranda-kartu-daftar">
        <h2 className="beranda-judul px-4 pt-3">{t("hp.duaMinggu")}</h2>
        <ul className="mt-2 divide-y border-t">
          {data.hari.map((h) => (
            <li key={h.day} className={cn("space-y-1 px-4 py-3", h.hariIni && "bg-primary/10")} aria-current={h.hariIni ? "date" : undefined}>
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="font-medium">{h.label}</span>
                {h.hariIni ? <Badge>{t("hariIniLencana")}</Badge> : null}
              </div>
              <p className={cn("text-sm", h.saya?.kind === "KERJA" && !h.izin ? "font-semibold" : "text-muted-foreground")}>
                {teksSel(h.saya, h.izin)}
              </p>
              {h.rekan.length > 0 ? (
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {h.rekan.map((r) => (
                    <li key={r.userId}>
                      {r.nama}: {r.izin ? t("hp.izinRekan") : teksSel(r.sel)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {data.riwayat.length > 0 ? (
        <section className="beranda-kartu space-y-3">
          <h2 className="beranda-judul">{t("hp.riwayatJudul")}</h2>
          <ul className="divide-y">
            {data.riwayat.map((s) => (
              <li key={s.id} className="space-y-1 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {s.peran === "PENGAJU" ? t("hp.denganRekan", { nama: s.rekan }) : t("hp.dariRekan", { nama: s.pengaju })}
                  </span>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", NADA[s.status])}>{td(`statusTukar.${s.status}`)}</span>
                </div>
                <p className="text-muted-foreground">
                  {s.dayLabel}
                  {s.partnerDayLabel && s.partnerDay !== s.day ? ` · ${s.partnerDayLabel}` : ""}
                </p>
                {s.catatan ? <p className="text-muted-foreground">{t("hp.catatan", { catatan: s.catatan })}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Sheet open={bukaAjukan} onOpenChange={(o) => !sibuk && setBukaAjukan(o)}>
        <SheetContent side="bottom" className="flex max-h-[90vh] flex-col gap-0 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <SheetHeader>
            <SheetTitle>{t("hp.ajukanTukar")}</SheetTitle>
            <SheetDescription>{t("hp.ajukanPenjelasan")}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-4 overflow-y-auto px-4">
            <div className="space-y-2">
              <Label htmlFor="tukar-hari">{t("hp.hariAnda")}</Label>
              <Select value={hari} onValueChange={setHari} disabled={sibuk}>
                <SelectTrigger id="tukar-hari" className="w-full">
                  <SelectValue placeholder={t("hp.pilihHari")} />
                </SelectTrigger>
                <SelectContent>
                  {hariKerjaSaya.map((h) => (
                    <SelectItem key={h.day} value={h.day}>
                      {h.label} — {teksSel(h.saya)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tukar-rekan">{t("hp.rekan")}</Label>
              <Select
                value={rekanId}
                onValueChange={(v) => {
                  setRekanId(v);
                  setHariRekan(TIDAK);
                }}
                disabled={sibuk}
              >
                <SelectTrigger id="tukar-rekan" className="w-full">
                  <SelectValue placeholder={t("hp.pilihRekan")} />
                </SelectTrigger>
                <SelectContent>
                  {data.rekan.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.nama}
                      {hari ? ` — ${orangPada(r.id, hari)?.izin ? t("hp.izinRekan") : teksSel(orangPada(r.id, hari)?.sel ?? null)}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {rekan ? (
              <div className="space-y-2">
                <Label htmlFor="tukar-hari-rekan">{t("hp.hariRekan", { nama: rekan.nama })}</Label>
                <Select value={hariRekan} onValueChange={setHariRekan} disabled={sibuk}>
                  <SelectTrigger id="tukar-hari-rekan" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TIDAK}>{t("hp.tanpaTukarBalik")}</SelectItem>
                    {hariKerjaRekan.map((h) => (
                      <SelectItem key={h.day} value={h.day}>
                        {h.label} — {teksSel(selRekan(h.day))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="tukar-alasan">{t("hp.alasan")}</Label>
              <Textarea
                id="tukar-alasan"
                value={alasan}
                onChange={(e) => setAlasan(e.target.value.slice(0, MAKS_ALASAN_TUKAR))}
                rows={3}
                placeholder={t("hp.alasanContoh")}
                disabled={sibuk}
              />
            </div>

            {pratinjau.length > 0 && rekan ? (
              <div className="space-y-1 rounded-lg border p-3 text-sm">
                <p className="font-medium">{t("hp.sesudahDisetujui")}</p>
                <ul className="space-y-1">
                  {pratinjau.map((p) => (
                    <li key={p.day}>
                      <span className="font-medium">{labelHari(p.day)}</span>
                      <span className="block text-muted-foreground">
                        {t("hp.anda")}: {p.saya} · {rekan.nama}: {p.rekan}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">{t("hp.alurTukar")}</p>
              </div>
            ) : null}
          </div>
          <div className="space-y-2 border-t px-4 pt-3">
            <Button className="w-full" size="lg" onClick={kirimAjuan} disabled={sibuk || kurang !== null}>
              {sibuk ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("hp.kirimAjuan")}
            </Button>
            <KeteranganKirim teks={kurang} />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={tolakUntuk !== null} onOpenChange={(o) => !o && !sibuk && setTolakUntuk(null)}>
        <SheetContent side="bottom" className="flex max-h-[90vh] flex-col gap-0 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <SheetHeader>
            <SheetTitle>{t("hp.tolakJudul")}</SheetTitle>
            <SheetDescription>{tolakUntuk ? t("hp.memintaTukar", { nama: tolakUntuk.pengaju }) : null}</SheetDescription>
          </SheetHeader>
          <div className="space-y-2 px-4">
            <Label htmlFor="tolak-alasan">{t("hp.alasanTolak")}</Label>
            <Textarea
              id="tolak-alasan"
              value={alasanTolak}
              onChange={(e) => setAlasanTolak(e.target.value.slice(0, MAKS_ALASAN_TUKAR))}
              rows={3}
              disabled={sibuk}
            />
          </div>
          <div className="px-4 pt-3">
            <Button variant="destructive" className="w-full" size="lg" onClick={() => tolakUntuk && jawab(tolakUntuk, false, alasanTolak)} disabled={sibuk}>
              {sibuk ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("hp.tolakAjuan")}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={batalUntuk !== null} onOpenChange={(o) => !o && !sibuk && setBatalUntuk(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("hp.batalJudul")}</AlertDialogTitle>
            <AlertDialogDescription>{batalUntuk ? t("hp.batalIsi", { nama: batalUntuk.rekan, hari: batalUntuk.dayLabel }) : null}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>{t("hp.jangan")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                if (batalUntuk) batalkan(batalUntuk);
              }}
              disabled={sibuk}
            >
              {t("hp.batalkanAjuan")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
