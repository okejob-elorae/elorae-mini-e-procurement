"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { RentangTanggalInput } from "@/components/ui/rentang-tanggal-input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { dinamis } from "@/lib/i18n/dinamis";
import type { StatusPromoKonter } from "@/lib/spg/promo-konter-kantor";
import type { DaftarPromoKantor, LaporanDiskonManual, LaporanPemakaian } from "@/lib/spg/promo-konter-kantor-queries";
import { cn } from "@/lib/utils";
import { DaftarPromoKonter } from "./DaftarPromoKonter";
import { DiskonManualKonter } from "./DiskonManualKonter";
import { PemakaianPromoKonter } from "./PemakaianPromoKonter";

export type TabPromoKonter = "daftar" | "pemakaian" | "manual";
const TAB: readonly TabPromoKonter[] = ["daftar", "pemakaian", "manual"];

/**
 * Promo konter SPG — kantor. Tab, saringan status, dan rentang tanggal tinggal
 * di alamat; berpindah dengan `replace` dalam SATU navigasi (dua dorongan
 * berurutan saling menimpa).
 */
export function PromoKonterPageClient({
  tab,
  status,
  dari,
  sampai,
  bolehUbah,
  daftar,
  pemakaian,
  manual,
}: {
  tab: TabPromoKonter;
  status: StatusPromoKonter | null;
  dari: string;
  sampai: string;
  bolehUbah: boolean;
  daftar: DaftarPromoKantor | null;
  pemakaian: LaporanPemakaian | null;
  manual: LaporanDiskonManual | null;
}) {
  const t = useTranslations("promoKonter");
  const td = dinamis(t);
  const router = useRouter();
  const [pindah, mulaiPindah] = useTransition();

  const ke = (ubah: { tab?: TabPromoKonter; status?: StatusPromoKonter | null; dari?: string; sampai?: string }) => {
    const q = new URLSearchParams();
    const tb = ubah.tab ?? tab;
    if (tb !== "daftar") q.set("tab", tb);
    if (tb === "daftar") {
      const s = ubah.status !== undefined ? ubah.status : status;
      if (s) q.set("status", s);
    } else {
      q.set("dari", ubah.dari ?? dari);
      q.set("sampai", ubah.sampai ?? sampai);
    }
    const qs = q.toString();
    mulaiPindah(() => router.replace(qs ? `/backoffice/promo-konter?${qs}` : "/backoffice/promo-konter", { scroll: false }));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        meta={!bolehUbah ? <span className="text-amber-700 dark:text-amber-400">{t("hanyaLihat")}</span> : undefined}
        actions={
          bolehUbah ? (
            <Button asChild>
              <Link href="/backoffice/promo-konter/baru">
                <Plus className="mr-2 h-4 w-4" />
                {t("buat")}
              </Link>
            </Button>
          ) : undefined
        }
      />

      <Tabs value={tab} onValueChange={(v) => ke({ tab: v as TabPromoKonter })} className="overflow-x-auto">
        <TabsList>
          {TAB.map((k) => (
            <TabsTrigger key={k} value={k} disabled={pindah}>
              {td(`tab.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {tab !== "daftar" ? (
        <div className="space-y-1.5 sm:max-w-sm">
          <Label htmlFor="rentang-promo-konter">{t("rentang")}</Label>
          <RentangTanggalInput
            id="rentang-promo-konter"
            required
            dari={dari}
            sampai={sampai}
            disabled={pindah}
            onChange={(r) => {
              if (r.dari && r.sampai) ke({ dari: r.dari, sampai: r.sampai });
            }}
          />
        </div>
      ) : null}

      <div className={cn("transition-opacity", pindah && "opacity-60")} aria-busy={pindah}>
        {tab === "daftar" && daftar ? (
          <DaftarPromoKonter data={daftar} status={status} bolehUbah={bolehUbah} onStatus={(s) => ke({ status: s })} />
        ) : null}
        {tab === "pemakaian" && pemakaian ? <PemakaianPromoKonter data={pemakaian} /> : null}
        {tab === "manual" && manual ? <DiskonManualKonter data={manual} /> : null}
      </div>
    </div>
  );
}
