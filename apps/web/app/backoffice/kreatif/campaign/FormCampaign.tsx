"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RentangTanggalInput } from "@/components/ui/rentang-tanggal-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { simpanCampaignAction } from "@/app/actions/kreatif-campaign";
import { bacaAngka, bacaBilanganBulat } from "@/lib/creative/angka-masuk";
import { SEMUA_STATUS_CAMPAIGN, STATUS_CAMPAIGN_BAWAAN, type StatusCampaignKol } from "@/lib/creative/campaign-aturan";
import { dinamis } from "@/lib/i18n/dinamis";

/** Isi formulir campaign (mode ubah). Tanggal "YYYY-MM-DD". */
export type AwalCampaign = {
  id: string;
  name: string;
  brand: string | null;
  product: string | null;
  objective: string | null;
  startDate: string | null;
  endDate: string | null;
  anggaran: number | null;
  targetKol: number | null;
  targetContent: number | null;
  targetViews: number | null;
  status: StatusCampaignKol;
  brief: string | null;
  note: string | null;
  arsip: boolean;
};

const KODE_DIKENAL = ["NAMA_WAJIB", "TIDAK_DITEMUKAN", "PERIODE_TIDAK_VALID", "ANGKA_TIDAK_VALID", "STATUS_TIDAK_VALID", "TANPA_AKSES", "GAGAL"];

/** Formulir campaign baru / ubah. Campaign tidak pernah dihapus — diarsipkan. */
export function FormCampaign({ buka, onBuka, awal }: { buka: boolean; onBuka: (b: boolean) => void; awal?: AwalCampaign | null }) {
  return (
    <Dialog open={buka} onOpenChange={onBuka}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        {buka ? <IsiForm key={awal?.id ?? "baru"} awal={awal ?? null} onTutup={() => onBuka(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function IsiForm({ awal, onTutup }: { awal: AwalCampaign | null; onTutup: () => void }) {
  const t = useTranslations("kreatifRuang.campaign");
  const te = dinamis(useTranslations("kreatifRuang.campaign.err"));
  const router = useRouter();
  const [menyimpan, mulai] = useTransition();
  const [nama, setNama] = useState(awal?.name ?? "");
  const [brand, setBrand] = useState(awal?.brand ?? "");
  const [produk, setProduk] = useState(awal?.product ?? "");
  const [tujuan, setTujuan] = useState(awal?.objective ?? "");
  const [periode, setPeriode] = useState({ dari: awal?.startDate ?? "", sampai: awal?.endDate ?? "" });
  const [budget, setBudget] = useState(awal?.anggaran != null ? String(awal.anggaran) : "");
  const [targetKol, setTargetKol] = useState(awal?.targetKol != null ? String(awal.targetKol) : "");
  const [targetKonten, setTargetKonten] = useState(awal?.targetContent != null ? String(awal.targetContent) : "");
  const [targetViews, setTargetViews] = useState(awal?.targetViews != null ? String(awal.targetViews) : "");
  const [status, setStatus] = useState<StatusCampaignKol>(awal?.status ?? STATUS_CAMPAIGN_BAWAAN);
  const [brief, setBrief] = useState(awal?.brief ?? "");
  const [catatan, setCatatan] = useState(awal?.note ?? "");
  const [arsip, setArsip] = useState(awal?.arsip ?? false);
  const [coba, setCoba] = useState(false);

  const budgetAngka = budget.trim() ? bacaAngka(budget) : null;
  const kolAngka = targetKol.trim() ? bacaBilanganBulat(targetKol) : null;
  const kontenAngka = targetKonten.trim() ? bacaBilanganBulat(targetKonten) : null;
  const viewsAngka = targetViews.trim() ? bacaBilanganBulat(targetViews) : null;
  const budgetSalah = budget.trim() !== "" && (budgetAngka === null || budgetAngka < 0);
  const kolSalah = targetKol.trim() !== "" && (kolAngka === null || kolAngka < 0);
  const kontenSalah = targetKonten.trim() !== "" && (kontenAngka === null || kontenAngka < 0);
  const viewsSalah = targetViews.trim() !== "" && (viewsAngka === null || viewsAngka < 0);

  const simpan = () => {
    setCoba(true);
    if (!nama.trim()) {
      toast.error(te("NAMA_WAJIB"));
      return;
    }
    if (budgetSalah || kolSalah || kontenSalah || viewsSalah) {
      toast.error(te("ANGKA_TIDAK_VALID"));
      return;
    }
    mulai(async () => {
      const r = await simpanCampaignAction(awal?.id ?? null, {
        name: nama,
        brand,
        product: produk,
        objective: tujuan,
        startDate: periode.dari || null,
        endDate: periode.sampai || null,
        budget: budgetAngka,
        targetKol: kolAngka,
        targetContent: kontenAngka,
        targetViews: viewsAngka,
        status,
        brief,
        note: catatan,
        arsip: awal ? arsip : false,
      });
      if (!r.ok) {
        toast.error(te(KODE_DIKENAL.includes(r.kode) ? r.kode : "GAGAL"));
        return;
      }
      toast.success(awal ? t("ok.disimpan") : t("ok.dibuat", { nama: nama.trim() }));
      onTutup();
      if (awal) router.refresh();
      else router.push(`/backoffice/kreatif/campaign/${r.id}`);
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{awal ? t("form.judulUbah") : t("form.judulBaru")}</DialogTitle>
        <DialogDescription className="sr-only">{t("form.nama")}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="cmp-nama">{t("form.nama")} *</Label>
          <Input
            id="cmp-nama"
            value={nama}
            onChange={(e) => setNama(e.target.value)}
            placeholder={t("form.namaContoh")}
            maxLength={200}
            aria-invalid={coba && !nama.trim()}
            autoFocus
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cmp-brand">{t("form.brand")}</Label>
            <Input id="cmp-brand" value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cmp-produk">{t("form.produk")}</Label>
            <Input id="cmp-produk" value={produk} onChange={(e) => setProduk(e.target.value)} maxLength={200} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cmp-tujuan">{t("form.objective")}</Label>
          <Input id="cmp-tujuan" value={tujuan} onChange={(e) => setTujuan(e.target.value)} placeholder={t("form.objectivePlaceholder")} />
        </div>
        <div className="grid gap-4 sm:grid-cols-[11rem_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor="cmp-status">{t("form.status")}</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as StatusCampaignKol)}>
              <SelectTrigger id="cmp-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEMUA_STATUS_CAMPAIGN.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`keadaan.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cmp-periode">{t("form.periode")}</Label>
            <RentangTanggalInput
              id="cmp-periode"
              dari={periode.dari}
              sampai={periode.sampai}
              onChange={(r) => setPeriode(r)}
              pilihanCepat={false}
              bolehTerbuka
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="cmp-budget">{t("form.budget")}</Label>
            <Input
              id="cmp-budget"
              inputMode="decimal"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="10jt"
              aria-invalid={budgetSalah}
              className="tabular-nums"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cmp-kol">{t("form.targetKol")}</Label>
            <Input id="cmp-kol" inputMode="numeric" value={targetKol} onChange={(e) => setTargetKol(e.target.value)} aria-invalid={kolSalah} className="tabular-nums" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cmp-konten">{t("form.targetKonten")}</Label>
            <Input
              id="cmp-konten"
              inputMode="numeric"
              value={targetKonten}
              onChange={(e) => setTargetKonten(e.target.value)}
              aria-invalid={kontenSalah}
              className="tabular-nums"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cmp-views">{t("form.targetViews")}</Label>
            <Input
              id="cmp-views"
              inputMode="decimal"
              value={targetViews}
              onChange={(e) => setTargetViews(e.target.value)}
              placeholder="1jt"
              aria-invalid={viewsSalah}
              className="tabular-nums"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cmp-brief">{t("form.brief")}</Label>
          <Textarea id="cmp-brief" rows={6} value={brief} onChange={(e) => setBrief(e.target.value)} />
          <p className="text-xs text-muted-foreground">{t("form.briefPetunjuk")}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cmp-catatan">{t("form.catatan")}</Label>
          <Textarea id="cmp-catatan" rows={2} value={catatan} onChange={(e) => setCatatan(e.target.value)} />
        </div>
        {awal ? (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={arsip} onCheckedChange={(v) => setArsip(v === true)} />
            {t("form.arsip")}
          </label>
        ) : null}
      </div>
      <DialogFooter className="mt-2">
        <Button variant="outline" onClick={onTutup} disabled={menyimpan}>
          {t("form.batal")}
        </Button>
        <Button onClick={simpan} disabled={menyimpan}>
          {menyimpan ? t("form.menyimpan") : t("form.simpan")}
        </Button>
      </DialogFooter>
    </>
  );
}
