"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { GripVertical, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusPill } from "@/components/ui/status-pill";
import { HantuSeret } from "@/components/gerak/HantuSeret";
import { ATRIBUT_BUTIR, atributDaftar, useSeretUrut } from "@/components/gerak/useSeretUrut";
import { lajuGulir } from "@/lib/gerak/seret-urut";
import { dinamis } from "@/lib/i18n/dinamis";
import type { BarisKolaborasi, JumlahTahap } from "@/lib/creative/kolaborasi-queries";
import {
  isJalurKeluar,
  JALUR_KELUAR,
  jenisPindah,
  TAHAP_BERJALAN,
  tujuanPindah,
  type Tahap,
} from "@/lib/creative/tahap";
import { cn } from "@/lib/utils";
import { subKol, TenggatSingkat, UmurTahap } from "./bagian";
import { RUTE_KOLABORASI } from "./TabelKolaborasi";
import type { SasaranPindah } from "./usePindahTahap";

/** Tujuan seret di luar kolom berjalan: selesai dan tiga jalur keluar. */
const ZONA_AKHIR: readonly Tahap[] = ["SELESAI", ...JALUR_KELUAR];

/** Jangan mulai menyeret dari tautan, tombol, atau menu di dalam kartu — biar klik tetap klik. */
const BUKAN_PEGANGAN = "a,button,input,select,textarea,[role=menuitem]";

/**
 * Papan kolaborasi: satu kolom per tahap berjalan, kartu bisa diseret dengan
 * pointer event (mouse dan jari — pegangan ⠿ untuk jari). Maju langsung
 * disimpan (optimistis, dikembalikan bila server menolak); mundur dan keluar
 * meminta alasan dulu (lewat `onPindah`). Kolom yang tidak sah untuk kartu
 * yang dibawa tidak menyala dan tidak menerima lepasan. Setiap kartu juga
 * punya menu "Pindah ke…" sebagai jalan papan ketik.
 */
export function PapanKolaborasi({
  baris,
  jumlah,
  hariIni,
  bolehMengelola,
  tahapDari,
  onPindah,
}: {
  baris: BarisKolaborasi[];
  jumlah: JumlahTahap;
  hariIni: string;
  bolehMengelola: boolean;
  tahapDari: (id: string, asli: Tahap) => Tahap;
  onPindah: (sasaran: SasaranPindah[], ke: Tahap) => void;
}) {
  const t = useTranslations("kreatifRuang");
  const tk = dinamis(t);
  const papanRef = useRef<HTMLDivElement>(null);

  const seret = useSeretUrut<SasaranPindah>({
    nonaktif: !bolehMengelola,
    bolehLepas: (data, daftar) => jenisPindah(data.tahap, daftar as Tahap) !== null,
    onLepas: (data, s) => {
      const ke = s.daftar as Tahap;
      if (ke !== data.tahap) onPindah([data], ke);
    },
  });

  // Gulir mendatar sendiri saat kartu dibawa ke tepi kiri/kanan papan.
  const sesiRef = useRef(seret.sesi);
  useEffect(() => {
    sesiRef.current = seret.sesi;
  });
  const menyeret = seret.sesi !== null;
  useEffect(() => {
    if (!menyeret) return;
    let bingkai = 0;
    const langkah = () => {
      const s = sesiRef.current;
      const el = papanRef.current;
      if (s && el) {
        const r = el.getBoundingClientRect();
        const v = lajuGulir(s.x, r.left, r.right);
        if (v !== 0) el.scrollLeft += v;
      }
      bingkai = requestAnimationFrame(langkah);
    };
    bingkai = requestAnimationFrame(langkah);
    return () => cancelAnimationFrame(bingkai);
  }, [menyeret]);

  const { perKolom, hitung } = useMemo(() => {
    const perKolom = new Map<Tahap, BarisKolaborasi[]>();
    const hitung: Record<string, number> = { ...jumlah.perTahap };
    for (const b of baris) {
      const kini = tahapDari(b.id, b.tahap);
      if (kini !== b.tahap) {
        hitung[b.tahap] = (hitung[b.tahap] ?? 0) - 1;
        hitung[kini] = (hitung[kini] ?? 0) + 1;
      }
      if (isJalurKeluar(kini) || kini === "SELESAI") continue;
      const d = perKolom.get(kini) ?? [];
      d.push(b);
      perKolom.set(kini, d);
    }
    return { perKolom, hitung };
  }, [baris, jumlah.perTahap, tahapDari]);

  const sasaranAktif = seret.sesi?.sasaran?.daftar ?? null;
  const dibawa = seret.sesi?.data ?? null;

  return (
    <>
      <div ref={papanRef} className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-3" role="list">
        {TAHAP_BERJALAN.map((tahap) => {
          const kartu = perKolom.get(tahap) ?? [];
          const menyala = sasaranAktif === tahap;
          // Tahap kosong diciutkan jadi strip sempit (nama + 0) supaya kolom yang berisi
          // tidak terdorong ke luar layar; strip itu tetap tempat lepas seretan.
          if (kartu.length === 0 && (hitung[tahap] ?? 0) === 0) {
            return (
              <section
                key={tahap}
                {...atributDaftar(tahap)}
                role="listitem"
                aria-label={`${tk(`tahap.${tahap}`)} (0)`}
                title={t("kolaborasi.papan.kosongJudul", { tahap: tk(`tahap.${tahap}`) })}
                className={cn(
                  "flex w-11 shrink-0 flex-col items-center gap-2 rounded-lg border border-dashed bg-muted/20 py-2",
                  "motion-safe:transition-colors",
                  menyala && "border-primary bg-primary/5 ring-2 ring-primary/40",
                )}
              >
                <span className="rounded-full bg-background px-1.5 text-xs tabular-nums text-muted-foreground">0</span>
                <span className="text-xs text-muted-foreground [writing-mode:vertical-rl]">{tk(`tahap.${tahap}`)}</span>
              </section>
            );
          }
          return (
            <section
              key={tahap}
              {...atributDaftar(tahap)}
              role="listitem"
              aria-label={`${tk(`tahap.${tahap}`)} (${hitung[tahap] ?? 0})`}
              className={cn(
                "flex w-64 shrink-0 flex-col rounded-lg border bg-muted/30",
                "motion-safe:transition-colors",
                menyala && "border-primary bg-primary/5 ring-2 ring-primary/40",
              )}
            >
              <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
                <span className="truncate text-sm font-medium">{tk(`tahap.${tahap}`)}</span>
                <span className="rounded-full bg-background px-2 text-xs tabular-nums text-muted-foreground">
                  {hitung[tahap] ?? 0}
                </span>
              </header>
              <div className="flex max-h-[68vh] min-h-24 flex-col gap-2 overflow-y-auto p-2">
                {kartu.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">{t("kolaborasi.papan.kosong")}</p>
                ) : (
                  kartu.map((b) => {
                    const sasaran: SasaranPindah = { id: b.id, tahap: tahapDari(b.id, b.tahap), kolNama: b.kol.name };
                    const pegangan = seret.pegangan(sasaran);
                    return (
                      <article
                        key={b.id}
                        {...ATRIBUT_BUTIR}
                        onPointerDown={(e) => {
                          if ((e.target as HTMLElement).closest(BUKAN_PEGANGAN)) return;
                          pegangan.onPointerDown(e);
                        }}
                        onClickCapture={pegangan.onClickCapture}
                        className={cn(
                          "rounded-md border bg-card p-2.5 shadow-xs",
                          bolehMengelola && "cursor-grab active:cursor-grabbing",
                          dibawa?.id === b.id && "opacity-50 motion-safe:scale-[0.98] motion-safe:transition-transform",
                        )}
                      >
                        <div className="flex items-start gap-1.5">
                          {bolehMengelola ? (
                            <span
                              className="mt-0.5 -ml-1 flex h-6 w-5 shrink-0 touch-none items-center justify-center text-muted-foreground"
                              aria-hidden
                              title={t("kolaborasi.papan.pegangan", { kol: b.kol.name })}
                            >
                              <GripVertical className="h-4 w-4" />
                            </span>
                          ) : null}
                          <div className="min-w-0 flex-1">
                            <Link
                              href={`${RUTE_KOLABORASI}/${b.id}`}
                              draggable={false}
                              className="block truncate text-sm font-medium hover:underline"
                            >
                              {b.kol.name}
                            </Link>
                            {subKol(b.kol) ? <p className="truncate text-xs text-muted-foreground">{subKol(b.kol)}</p> : null}
                            {/* Nomor kolaborasi + campaign: dua kolaborasi KOL yang sama tetap bisa dibedakan. */}
                            <p className="truncate text-xs text-muted-foreground">
                              <span className="tabular-nums">{b.docNo}</span> · {b.campaign ? b.campaign.name : t("kolaborasi.detail.tanpaCampaign")}
                            </p>
                            {b.kol.diblokir ? (
                              <StatusPill tone="attention" className="mt-1">
                                {t("kolaborasi.diblokir")}
                              </StatusPill>
                            ) : null}
                          </div>
                          {bolehMengelola ? <MenuPindah sasaran={sasaran} onPindah={onPindah} /> : null}
                        </div>
                        <div className="mt-2 flex items-end justify-between gap-2 text-xs">
                          <UmurTahap hari={b.umurHari} merah={b.umurMerah && sasaran.tahap === b.tahap} />
                          <div className="text-right">
                            <TenggatSingkat tenggat={b.tenggat} hariIni={hariIni} />
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}

        <section className="flex w-56 shrink-0 flex-col gap-2 rounded-lg border border-dashed p-2" aria-label={t("kolaborasi.papan.zonaJudul")}>
          <p className="px-1 text-sm font-medium">{t("kolaborasi.papan.zonaJudul")}</p>
          {ZONA_AKHIR.map((tahap) => (
            <div
              key={tahap}
              {...atributDaftar(tahap)}
              className={cn(
                "flex min-h-14 flex-col justify-center rounded-md border bg-background px-3 py-2 text-sm",
                "motion-safe:transition-colors",
                sasaranAktif === tahap &&
                  (isJalurKeluar(tahap)
                    ? "border-destructive bg-destructive/10 ring-2 ring-destructive/40"
                    : "border-primary bg-primary/5 ring-2 ring-primary/40"),
              )}
            >
              <span className={cn("font-medium", isJalurKeluar(tahap) && "text-destructive")}>{tk(`tahap.${tahap}`)}</span>
              <span className="text-xs text-muted-foreground">
                {dibawa ? t("kolaborasi.papan.lepas") : `${hitung[tahap] ?? 0}`}
              </span>
            </div>
          ))}
        </section>
      </div>

      <HantuSeret
        sesi={seret.sesi}
        label={dibawa?.kolNama ?? ""}
        keterangan={sasaranAktif ? t("kolaborasi.papan.ke", { tahap: tk(`tahap.${sasaranAktif}`) }) : null}
      />
    </>
  );
}

function MenuPindah({ sasaran, onPindah }: { sasaran: SasaranPindah; onPindah: (s: SasaranPindah[], ke: Tahap) => void }) {
  const t = useTranslations("kreatifRuang");
  const tk = dinamis(t);
  const tujuan = tujuanPindah(sasaran.tahap);
  const jalan = tujuan.filter((x) => !isJalurKeluar(x));
  const keluar = tujuan.filter((x) => isJalurKeluar(x));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="-mr-1 -mt-1 h-7 w-7 shrink-0"
          aria-label={t("kolaborasi.papan.pindahKeAria", { kol: sasaran.kolNama })}
          title={t("kolaborasi.papan.pindahKe")}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
        {jalan.map((x) => (
          <DropdownMenuItem key={x} onSelect={() => onPindah([sasaran], x)}>
            {tk(`tahap.${x}`)}
          </DropdownMenuItem>
        ))}
        {keluar.length ? <DropdownMenuSeparator /> : null}
        {keluar.map((x) => (
          <DropdownMenuItem key={x} variant="destructive" onSelect={() => onPindah([sasaran], x)}>
            {tk(`tahap.${x}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
