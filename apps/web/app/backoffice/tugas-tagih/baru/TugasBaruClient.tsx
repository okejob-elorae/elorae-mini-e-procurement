"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatIDR } from "@/lib/sales-orders/format";
import { dinamis } from "@/lib/i18n/dinamis";
import { buatTugasTagihAction } from "@/app/actions/tugas-tagih";
import type { BahanTugasBaru, FakturCalonTugas } from "@/lib/receivables/tugas-tagih-queries";
import type { KeadaanPiutang } from "@/lib/receivables/rules";
import { TanggalInput } from "@/components/ui/tanggal-input";

export type BahanTugasTampil = Omit<BahanTugasBaru, "fakturPerToko"> & {
  fakturPerToko: Record<string, (FakturCalonTugas & { jatuhTempoTeks: string })[]>;
};

/** Nada keadaan faktur — sama dengan layar Piutang, supaya satu faktur dibaca satu cara. */
const NADA: Record<KeadaanPiutang, StatusTone> = {
  lunas: "settled",
  klaim: "progress",
  tertahan: "attention",
  lewat: "attention",
  tt: "waiting",
  belum: "inactive",
};

export function TugasBaruClient({
  bahan,
  tokoAwal,
  hariIni,
  tenggatAwal,
}: {
  bahan: BahanTugasTampil;
  tokoAwal: string;
  /** "YYYY-MM-DD" WIB — batas bawah tenggat. */
  hariIni: string;
  tenggatAwal: string;
}) {
  const t = useTranslations("tugasTagih");
  const td = dinamis(t);
  const tr = dinamis(useTranslations("receivables"));
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const bawaanUntuk = (storeId: string) => bahan.toko.find((x) => x.id === storeId)?.petugasBawaan ?? "";
  const [storeId, setStoreId] = useState(tokoAwal);
  const [terpilih, setTerpilih] = useState<Set<string>>(new Set());
  const [petugas, setPetugas] = useState(bawaanUntuk(tokoAwal));
  const [tenggat, setTenggat] = useState(tenggatAwal);
  const [catatan, setCatatan] = useState("");

  const faktur = useMemo(() => bahan.fakturPerToko[storeId] ?? [], [bahan, storeId]);
  const bisaDipilih = faktur.filter((f) => !f.ditugaskanKe);
  const nilai = faktur.filter((f) => terpilih.has(f.id)).reduce((s, f) => s + f.sisa, 0);

  const pilihToko = (id: string) => {
    // Satu tugas = satu toko: pilihan faktur toko sebelumnya dibuang, dan petugas
    // kembali ke bawaan toko yang baru.
    setStoreId(id);
    setTerpilih(new Set());
    setPetugas(bawaanUntuk(id));
  };

  const alihkan = (id: string) =>
    setTerpilih((lama) => {
      const baru = new Set(lama);
      if (baru.has(id)) baru.delete(id);
      else baru.add(id);
      return baru;
    });

  const simpan = () => {
    startTransition(async () => {
      const h = await buatTugasTagihAction({
        storeId,
        receivableIds: [...terpilih],
        assigneeId: petugas,
        tenggat,
        catatan,
      });
      if (h.ok) {
        toast.success(t("okCreated"));
        router.push("/backoffice/tugas-tagih");
      } else {
        toast.error(td(`err_${h.kode}`));
      }
    });
  };

  const bisaSimpan = !pending && storeId !== "" && terpilih.size > 0 && petugas !== "" && tenggat >= hariIni;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/backoffice/tugas-tagih">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t("backToList")}
        </Link>
      </Button>

      <PageHeader title={t("newTitle")} description={t("newBody")} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("sectionStore")}</CardTitle>
        </CardHeader>
        <CardContent>
          <SearchableCombobox
            id="tugas-toko"
            options={bahan.toko.map((s) => ({
              value: s.id,
              label: t("storeOption", { name: s.name, count: s.jumlah, value: formatIDR(s.total) }),
            }))}
            value={storeId}
            onValueChange={pilihToko}
            placeholder={t("storePlaceholder")}
            searchPlaceholder={t("storeSearch")}
            emptyMessage={t("storeEmpty")}
            triggerClassName="w-full sm:w-[28rem]"
          />
        </CardContent>
      </Card>

      {storeId && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              {t("sectionInvoices")}
              {bisaDipilih.length > 1 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setTerpilih(new Set(bisaDipilih.map((f) => f.id)))}
                >
                  {t("selectAll")}
                </Button>
              )}
            </CardTitle>
            <p className="text-sm text-muted-foreground">{t("sectionInvoicesHint")}</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {faktur.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noOpenInvoices")}</p>
            ) : (
              faktur.map((f) => {
                const aktif = terpilih.has(f.id);
                const terkunci = f.ditugaskanKe !== null;
                const keadaan = `state${f.keadaan.charAt(0).toUpperCase()}${f.keadaan.slice(1)}`;
                return (
                  <label
                    key={f.id}
                    className={cn(
                      "flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2",
                      terkunci ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted/50",
                      aktif && "border-primary/50 bg-primary/[0.04]",
                    )}
                  >
                    <Checkbox checked={aktif} disabled={terkunci} onCheckedChange={() => alihkan(f.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{f.invoiceNo}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t("dueOn", { date: f.jatuhTempoTeks })}
                        {f.doc && ` · ${f.doc}`}
                        {terkunci && ` · ${t("alreadyAssigned", { name: f.ditugaskanKe ?? "—" })}`}
                      </span>
                    </span>
                    <StatusPill tone={NADA[f.keadaan]}>{tr(keadaan)}</StatusPill>
                    <span className="w-32 text-right text-sm font-semibold tabular-nums">{formatIDR(f.sisa)}</span>
                  </label>
                );
              })
            )}
            {terpilih.size > 0 && (
              <p className="pt-1 text-right text-sm">
                {t("selectedTotal", { count: terpilih.size, value: formatIDR(nilai) })}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {storeId && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("sectionWho")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tugas-petugas">{t("assignee")}</Label>
              {bahan.petugas.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noFieldStaff")}</p>
              ) : (
                <Select value={petugas} onValueChange={setPetugas}>
                  <SelectTrigger id="tugas-petugas" className="w-full">
                    <SelectValue placeholder={t("assigneePlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {bahan.petugas.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nama}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="text-xs text-muted-foreground">{t("assigneeDefaultHint")}</p>
              {/* Penagih faktur = pemegang toko (keputusan pemilik). Menugaskan orang lain
                  boleh: faktur di tugas ini ikut terbuka di HP-nya selama tugasnya terbuka
                  (`daftarPiutang`), dan pemegang toko tetap bisa menagihnya juga. */}
              {petugas !== "" && bawaanUntuk(storeId) !== "" && petugas !== bawaanUntuk(storeId) && (
                <p className="text-xs text-amber-700 dark:text-amber-400">{t("bukanPenagih")}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="tugas-tenggat">{t("dueDate")}</Label>
              <TanggalInput
                id="tugas-tenggat"
                min={hariIni}
                value={tenggat}
                onChange={(e) => setTenggat(e.target.value)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="tugas-catatan">{t("note")}</Label>
              <Textarea
                id="tugas-catatan"
                value={catatan}
                onChange={(e) => setCatatan(e.target.value)}
                placeholder={t("notePlaceholder")}
                rows={2}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button className="w-full sm:w-auto" disabled={!bisaSimpan} onClick={simpan}>
          {t("save")}
        </Button>
      </div>
    </div>
  );
}
