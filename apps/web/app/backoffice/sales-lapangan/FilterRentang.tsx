"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { MAKS_HARI_RENTANG, type PresetRentang } from "@/lib/salesman/metrik-lapangan";
import type { FilterRentangData } from "./bentuk";
import { RentangTanggalInput } from "@/components/ui/rentang-tanggal-input";

const PRESET: readonly Exclude<PresetRentang, "kustom">[] = ["hari", "minggu", "bulan"];

/**
 * Pilihan rentang dasbor: hari ini, minggu ini, bulan ini, atau tanggal
 * sendiri — satu pemilih rentang yang langsung dipakai begitu rentangnya
 * lengkap. Disimpan di alamat, bukan di keadaan klien, supaya rincian per
 * sales dan tombol kembali membawa rentang yang sama.
 */
export function FilterRentang({ alamat, filter }: { alamat: string; filter: FilterRentangData }) {
  const t = useTranslations("salesLapangan");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const tt = useTranslations("tanggalInput");

  const pergi = (q: string) => startTransition(() => router.push(`${alamat}?${q}`));

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("filter.presetLabel")}>
          {PRESET.map((p) => (
            <Button
              key={p}
              size="sm"
              variant={filter.preset === p ? "default" : "outline"}
              aria-pressed={filter.preset === p}
              disabled={pending}
              onClick={() => pergi(`rentang=${p}`)}
            >
              {t(`filter.preset.${p}`)}
            </Button>
          ))}
        </div>
        <div className="w-full sm:w-72">
          <Label htmlFor="rentang-kustom" className="mb-1 block text-xs text-muted-foreground">
            {tt("periode")}
          </Label>
          <RentangTanggalInput
            id="rentang-kustom"
            dari={filter.preset === "kustom" ? filter.dari : ""}
            sampai={filter.preset === "kustom" ? filter.sampai : ""}
            disabled={pending}
            maksHari={MAKS_HARI_RENTANG}
            onChange={({ dari, sampai }) =>
              pergi(dari && sampai ? `rentang=kustom&dari=${dari}&sampai=${sampai}` : "")
            }
          />
        </div>
      </div>
    </Card>
  );
}
