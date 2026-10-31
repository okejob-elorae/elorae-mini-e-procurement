"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, Landmark, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { simpanTarifPajakAction } from "@/app/actions/kreatif-pajak";
import { angkaTitik, rupiahTeks } from "@/lib/creative/angka-konten";
import { bacaAngka } from "@/lib/creative/angka-masuk";
import { hitungPph, TARIF_PAJAK_BAWAAN, validasiTarifPajak, type TarifPajakKreatif } from "@/lib/creative/pph";

let kunciBerikut = 1;

const keTeks = (n: number) => String(n).replace(".", ",");

function dariTarif(t: TarifPajakKreatif) {
  return {
    porsi: keTeks(t.pph21.porsiDppPersen),
    tambah21: keTeks(t.pph21.tambahanTanpaNpwpPersen),
    lapisan: t.pph21.lapisan.map((l) => ({ kunci: kunciBerikut++, sampai: l.sampai === null ? "" : angkaTitik(l.sampai), persen: keTeks(l.persen) })),
    tarif23: keTeks(t.pph23.tarifPersen),
    tambah23: keTeks(t.pph23.tambahanTanpaNpwpPersen),
  };
}

const CONTOH = 10_000_000;

/**
 * Tarif PPh fee KOL (Kreatif → Pengaturan). Semua angka adalah BAWAAN yang
 * wajib dikonfirmasi konsultan pajak. Menyimpan menghitung ulang termin yang
 * belum dibayar; termin yang sudah dibayar tetap memakai tarif saat dibayar.
 */
export function KartuPajakKreatif({ awal, bolehMengelola }: { awal: TarifPajakKreatif; bolehMengelola: boolean }) {
  const t = useTranslations("kreatifRuang.pajakSetelan");
  const router = useRouter();
  const [isi, setIsi] = useState(() => dariTarif(awal));
  const [menyimpan, mulai] = useTransition();

  const tarif = {
    pph21: {
      porsiDppPersen: bacaAngka(isi.porsi) ?? Number.NaN,
      tambahanTanpaNpwpPersen: bacaAngka(isi.tambah21) ?? Number.NaN,
      lapisan: isi.lapisan.map((l, i) => ({
        sampai: i === isi.lapisan.length - 1 ? null : (bacaAngka(l.sampai) ?? Number.NaN),
        persen: bacaAngka(l.persen) ?? Number.NaN,
      })),
    },
    pph23: { tarifPersen: bacaAngka(isi.tarif23) ?? Number.NaN, tambahanTanpaNpwpPersen: bacaAngka(isi.tambah23) ?? Number.NaN },
  };
  const v = validasiTarifPajak(tarif);
  const galat = new Set(v.ok ? [] : v.galat.map((g) => `${g.bagian}.${g.kunci}`));

  const simpan = () =>
    mulai(async () => {
      const r = await simpanTarifPajakAction(tarif);
      if (!r.ok) {
        toast.error(r.kode === "TIDAK_VALID" ? t("errTidakValid") : r.kode === "TANPA_AKSES" ? t("errAkses") : t("errGagal"));
        return;
      }
      toast.success(r.dihitungUlang > 0 ? t("okHitung", { n: r.dihitungUlang }) : t("ok"));
      router.refresh();
    });

  const contoh = v.ok
    ? {
        a: hitungPph(CONTOH, { jenis: "ORANG_PRIBADI", adaNpwp: true }, v.tarif).pph,
        b: hitungPph(CONTOH, { jenis: "ORANG_PRIBADI", adaNpwp: false }, v.tarif).pph,
        c: hitungPph(CONTOH, { jenis: "BADAN", adaNpwp: true }, v.tarif).pph,
      }
    : null;

  const angkaInput = (id: string, label: string, nilai: string, ubah: (s: string) => void, salah: boolean, akhiran = "%") => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input id={id} inputMode="decimal" className="w-28 tabular-nums" value={nilai} disabled={!bolehMengelola} aria-invalid={salah} onChange={(e) => ubah(e.target.value)} />
        <span className="text-sm text-muted-foreground">{akhiran}</span>
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Landmark className="h-5 w-5" aria-hidden />
          {t("judul")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300" role="note">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {t("konsultan")}
        </p>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{t("pph21")}</h3>
          <div className="flex flex-wrap gap-6">
            {angkaInput("pajak-porsi", t("porsiDpp"), isi.porsi, (s) => setIsi((x) => ({ ...x, porsi: s })), galat.has("pph21.porsiDppPersen"))}
            {angkaInput("pajak-tambah21", t("tambahan"), isi.tambah21, (s) => setIsi((x) => ({ ...x, tambah21: s })), galat.has("pph21.tambahanTanpaNpwpPersen"))}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("lapisan")}</p>
            <ol className="space-y-2">
              {isi.lapisan.map((l, i) => {
                const akhir = i === isi.lapisan.length - 1;
                return (
                  <li key={l.kunci} className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1">
                      <Label htmlFor={`lapisan-sampai-${l.kunci}`} className="text-xs text-muted-foreground">
                        {akhir ? t("lapisanAkhir") : t("lapisanSampai")}
                      </Label>
                      <Input
                        id={`lapisan-sampai-${l.kunci}`}
                        inputMode="numeric"
                        className="w-44 tabular-nums"
                        value={akhir ? "" : l.sampai}
                        placeholder={akhir ? t("lapisanSeterusnya") : ""}
                        disabled={!bolehMengelola || akhir}
                        aria-invalid={galat.has("pph21.lapisan")}
                        onChange={(e) => setIsi((x) => ({ ...x, lapisan: x.lapisan.map((y) => (y.kunci === l.kunci ? { ...y, sampai: e.target.value } : y)) }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`lapisan-persen-${l.kunci}`} className="text-xs text-muted-foreground">
                        {t("lapisanTarif")}
                      </Label>
                      <Input
                        id={`lapisan-persen-${l.kunci}`}
                        inputMode="decimal"
                        className="w-20 tabular-nums"
                        value={l.persen}
                        disabled={!bolehMengelola}
                        aria-invalid={galat.has("pph21.lapisan")}
                        onChange={(e) => setIsi((x) => ({ ...x, lapisan: x.lapisan.map((y) => (y.kunci === l.kunci ? { ...y, persen: e.target.value } : y)) }))}
                      />
                    </div>
                    {bolehMengelola && isi.lapisan.length > 1 ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("hapusLapisan", { n: i + 1 })}
                        onClick={() => setIsi((x) => ({ ...x, lapisan: x.lapisan.filter((y) => y.kunci !== l.kunci) }))}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ol>
            {bolehMengelola ? (
              <Button
                variant="outline"
                size="sm"
                disabled={isi.lapisan.length >= 10}
                onClick={() =>
                  setIsi((x) => {
                    const terakhir = x.lapisan[x.lapisan.length - 1];
                    return { ...x, lapisan: [...x.lapisan.slice(0, -1), { kunci: kunciBerikut++, sampai: "", persen: terakhir.persen }, { ...terakhir, kunci: kunciBerikut++ }] };
                  })
                }
              >
                <Plus className="h-4 w-4" aria-hidden />
                {t("tambahLapisan")}
              </Button>
            ) : null}
            {galat.has("pph21.lapisan") ? <p className="text-xs text-destructive">{t("errLapisan")}</p> : null}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{t("pph23")}</h3>
          <div className="flex flex-wrap gap-6">
            {angkaInput("pajak-tarif23", t("tarif23"), isi.tarif23, (s) => setIsi((x) => ({ ...x, tarif23: s })), galat.has("pph23.tarifPersen"))}
            {angkaInput("pajak-tambah23", t("tambahan"), isi.tambah23, (s) => setIsi((x) => ({ ...x, tambah23: s })), galat.has("pph23.tambahanTanpaNpwpPersen"))}
          </div>
        </section>

        {contoh ? (
          <p className="text-sm text-muted-foreground tabular-nums">
            {t("contoh", { bruto: rupiahTeks(CONTOH), a: rupiahTeks(contoh.a), b: rupiahTeks(contoh.b), c: rupiahTeks(contoh.c) })}
          </p>
        ) : (
          <p className="text-sm text-destructive">{t("errTidakValid")}</p>
        )}

        {bolehMengelola ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={simpan} disabled={menyimpan || !v.ok}>
              {menyimpan ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("simpan")}
            </Button>
            <Button variant="outline" disabled={menyimpan} onClick={() => setIsi(dariTarif(TARIF_PAJAK_BAWAAN))}>
              {t("bawaan")}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
