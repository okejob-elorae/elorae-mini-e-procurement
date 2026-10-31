"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowRight, Coins, Loader2, Plus, Trash2 } from "lucide-react";
import { simpanSkemaKomisi } from "@/app/actions/settings/salesman-komisi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DASAR_KOMISI,
  TINGKAT_MAKS,
  validasiSkemaKomisi,
  type AturanPeringkat,
  type DasarKomisi,
  type SkemaKomisi,
} from "@/lib/salesman/komisi";
import { cn } from "@/lib/utils";

/**
 * Pengaturan → Salesman → Komisi: skema insentif dan papan peringkat.
 *
 * Validasinya SAMA dengan aksi simpan (`validasiSkemaKomisi`), jadi tombol
 * Simpan hanya menyala untuk isian yang juga akan diterima server. Angka yang
 * tampil di HP salesman adalah perkiraan dari skema ini; yang dibayar tetap
 * keputusan kantor.
 */

/** "1,5" dan "1.5" sama-sama 1,5 — orang Indonesia mengetik koma. Kosong → null. */
function bacaPersen(teks: string): number | null {
  const t = teks.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}
const saringPersen = (s: string) => s.replace(/[^\d.,]/g, "").slice(0, 6);

type BarisTingkat = { kunci: number; capaian: string; tarif: string };

export function KomisiCard({
  bolehUbah,
  skema,
  peringkat,
  salesman,
}: {
  bolehUbah: boolean;
  skema: SkemaKomisi;
  peringkat: AturanPeringkat;
  salesman: { id: string; nama: string }[];
}) {
  const t = useTranslations("komisiSalesman.kartu");
  const tToasts = useTranslations("toasts");
  const locale = useLocale();
  const router = useRouter();
  const [sibuk, mulai] = useTransition();

  const tulis = (n: number) => (locale === "en" ? String(n) : String(n).replace(".", ","));

  const [aktif, setAktif] = useState(skema.aktif);
  const [dasar, setDasar] = useState<DasarKomisi>(skema.dasar);
  const [tarif, setTarif] = useState(tulis(skema.tarifPersen));
  const [penagih, setPenagih] = useState(tulis(skema.bagianPenagihPersen));
  const [tingkat, setTingkat] = useState<BarisTingkat[]>(() =>
    skema.tingkat.map((x, i) => ({ kunci: i, capaian: tulis(x.capaianPersen), tarif: tulis(x.tarifPersen) })),
  );
  const [kunciBerikut, setKunciBerikut] = useState(skema.tingkat.length);
  const [khusus, setKhusus] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(skema.perSalesman).map(([id, v]) => [id, tulis(v)])),
  );
  const [tampilkanNama, setTampilkanNama] = useState(peringkat.tampilkanNama);

  // Salesman yang punya tarif khusus tapi tidak lagi terdaftar tetap tampil —
  // kalau disembunyikan, tarifnya diam di skema tanpa bisa dihapus.
  const barisSalesman = useMemo(() => {
    const dikenal = new Set(salesman.map((s) => s.id));
    return [
      ...salesman,
      ...Object.keys(skema.perSalesman)
        .filter((id) => !dikenal.has(id))
        .map((id) => ({ id, nama: t("salesmanTakTerdaftar") })),
    ];
  }, [salesman, skema.perSalesman, t]);

  const draf = useMemo(() => {
    const perSalesman: Record<string, number> = {};
    for (const [id, v] of Object.entries(khusus)) {
      const n = bacaPersen(v);
      if (n !== null) perSalesman[id] = n;
    }
    return {
      aktif,
      dasar,
      tarifPersen: bacaPersen(tarif),
      tingkat: tingkat.map((x) => ({ capaianPersen: bacaPersen(x.capaian), tarifPersen: bacaPersen(x.tarif) })),
      bagianPenagihPersen: bacaPersen(penagih),
      perSalesman,
    };
  }, [aktif, dasar, tarif, tingkat, penagih, khusus]);

  const sah = validasiSkemaKomisi(draf);
  const berubah =
    JSON.stringify(sah) !== JSON.stringify(skema) || tampilkanNama !== peringkat.tampilkanNama;
  const nonaktif = !bolehUbah || sibuk;

  const simpan = () =>
    mulai(async () => {
      if (!sah) return;
      const r = await simpanSkemaKomisi({ skema: sah, peringkat: { tampilkanNama } });
      if (!r.ok) {
        toast.error(r.code === "INVALID" ? t("errInvalid") : t("errForbidden"));
        return;
      }
      toast.success(tToasts("saved"));
      router.refresh();
    });

  const tambahTingkat = () => {
    setTingkat((d) => [...d, { kunci: kunciBerikut, capaian: "", tarif: "" }]);
    setKunciBerikut((k) => k + 1);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="h-5 w-5" />
          {t("judul")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="komisi-aktif">{t("aktif")}</Label>
            <p className="text-xs text-muted-foreground">{t("aktifIsi")}</p>
          </div>
          <Switch id="komisi-aktif" checked={aktif} onCheckedChange={setAktif} disabled={nonaktif} />
        </div>

        <div className="space-y-2">
          <Label id="komisi-dasar">{t("dasar")}</Label>
          <div role="radiogroup" aria-labelledby="komisi-dasar" className="grid gap-2 sm:grid-cols-2">
            {DASAR_KOMISI.map((d) => (
              <Button
                key={d}
                type="button"
                role="radio"
                aria-checked={dasar === d}
                variant="outline"
                disabled={nonaktif}
                onClick={() => setDasar(d)}
                className={cn(
                  "h-auto flex-col items-start gap-1 whitespace-normal py-3 text-left",
                  dasar === d && "border-primary bg-primary/5 ring-1 ring-primary",
                )}
              >
                <span className="font-semibold">{t(`dasar${d}`)}</span>
                <span className="text-xs font-normal text-muted-foreground">{t(`dasar${d}Isi`)}</span>
              </Button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="komisi-tarif">{t("tarifDasar")}</Label>
            <div className="relative">
              <Input
                id="komisi-tarif"
                type="text"
                inputMode="decimal"
                className="pr-8 text-right tabular-nums"
                value={tarif}
                onChange={(e) => setTarif(saringPersen(e.target.value))}
                disabled={nonaktif}
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
            </div>
            <p className="text-xs text-muted-foreground">{t("tarifDasarIsi")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="komisi-penagih">{t("bagianPenagih")}</Label>
            <div className="relative">
              <Input
                id="komisi-penagih"
                type="text"
                inputMode="decimal"
                className="pr-8 text-right tabular-nums"
                value={penagih}
                onChange={(e) => setPenagih(saringPersen(e.target.value))}
                disabled={nonaktif}
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {dasar === "TERTAGIH" ? t("bagianPenagihIsi") : t("bagianPenagihTakBerlaku")}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">{t("tingkat")}</p>
              <p className="text-xs text-muted-foreground">{t("tingkatIsi")}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={tambahTingkat}
              disabled={nonaktif || tingkat.length >= TINGKAT_MAKS}
            >
              <Plus className="h-4 w-4" />
              {t("tambahTingkat")}
            </Button>
          </div>
          {tingkat.length === 0 ? (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{t("tanpaTingkat")}</p>
          ) : (
            <ul className="space-y-2">
              {tingkat.map((x, i) => (
                <li key={x.kunci} className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label htmlFor={`tingkat-capaian-${x.kunci}`} className="text-xs">
                      {t("capaianMin")}
                    </Label>
                    <div className="relative w-32">
                      <Input
                        id={`tingkat-capaian-${x.kunci}`}
                        type="text"
                        inputMode="decimal"
                        className="pr-8 text-right tabular-nums"
                        value={x.capaian}
                        placeholder="100"
                        onChange={(e) =>
                          setTingkat((d) => d.map((y, j) => (j === i ? { ...y, capaian: saringPersen(e.target.value) } : y)))
                        }
                        disabled={nonaktif}
                      />
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                    </div>
                  </div>
                  <ArrowRight className="mb-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
                  <div className="space-y-1">
                    <Label htmlFor={`tingkat-tarif-${x.kunci}`} className="text-xs">
                      {t("tarifTingkat")}
                    </Label>
                    <div className="relative w-32">
                      <Input
                        id={`tingkat-tarif-${x.kunci}`}
                        type="text"
                        inputMode="decimal"
                        className="pr-8 text-right tabular-nums"
                        value={x.tarif}
                        placeholder="1,5"
                        onChange={(e) =>
                          setTingkat((d) => d.map((y, j) => (j === i ? { ...y, tarif: saringPersen(e.target.value) } : y)))
                        }
                        disabled={nonaktif}
                      />
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("hapusTingkat")}
                    title={t("hapusTingkat")}
                    onClick={() => setTingkat((d) => d.filter((_, j) => j !== i))}
                    disabled={nonaktif}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2">
          <div>
            <p className="text-sm font-medium">{t("tarifKhusus")}</p>
            <p className="text-xs text-muted-foreground">{t("tarifKhususIsi")}</p>
          </div>
          {barisSalesman.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("tanpaSalesman")}</p>
          ) : (
            <div className="max-h-80 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead>{t("kolomSalesman")}</TableHead>
                    <TableHead className="w-40 text-right">{t("kolomTarif")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {barisSalesman.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="whitespace-normal">{s.nama}</TableCell>
                      <TableCell>
                        <div className="relative ml-auto w-32">
                          <Input
                            aria-label={t("tarifKhususUntuk", { name: s.nama })}
                            type="text"
                            inputMode="decimal"
                            className="pr-8 text-right tabular-nums"
                            value={khusus[s.id] ?? ""}
                            placeholder={tarif || "—"}
                            onChange={(e) => setKhusus((d) => ({ ...d, [s.id]: saringPersen(e.target.value) }))}
                            disabled={nonaktif}
                          />
                          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="peringkat-nama">{t("peringkatNama")}</Label>
            <p className="text-xs text-muted-foreground">{t("peringkatNamaIsi")}</p>
          </div>
          <Switch id="peringkat-nama" checked={tampilkanNama} onCheckedChange={setTampilkanNama} disabled={nonaktif} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {!bolehUbah ? t("hanyaBaca") : sah ? t("perkiraanSaja") : t("isianTakSah")}{" "}
            <Link
              href="/backoffice/laporan/komisi-salesman"
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              {t("bukaLaporan")}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </p>
          <Button onClick={simpan} disabled={nonaktif || !sah || !berubah}>
            {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : t("simpan")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
