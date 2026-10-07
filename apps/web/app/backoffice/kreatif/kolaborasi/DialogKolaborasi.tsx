"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { Textarea } from "@/components/ui/textarea";
import { buatKolaborasiAction, pilihanVarianSampelAction, ubahKolaborasiAction, type IsianKolaborasi } from "@/app/actions/kreatif-kolaborasi";
import { PemilihBarangSampel } from "@/components/kreatif/pengiriman/PemilihBarangSampel";
import type { BarisIsian } from "@/components/kreatif/pengiriman/isian-pengiriman";
import type { PilihanVarianKirim } from "@/lib/konsinyasi/varian-kirim";
import { bacaAngka } from "@/lib/creative/angka-masuk";
import { LABEL_PLATFORM, SEMUA_PLATFORM, type Platform } from "@/lib/creative/aturan";
import type { HasilCariKol, PilihanPengguna } from "@/lib/creative/kolaborasi-queries";
import type { PilihanCampaign } from "@/lib/creative/campaign-queries";
import { feeDiakui, SEMUA_JENIS_KERJA_SAMA, URUTAN_TAHAP, type JenisKerjaSama, type Tahap } from "@/lib/creative/tahap";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { PilihKol } from "./PilihKol";
import { RingkasanRiwayatKol } from "./RingkasanRiwayatKol";
import { useTeksGalatKolaborasi } from "./usePindahTahap";

const FORMAT = ["FEED", "REELS", "STORY", "VIDEO", "LIVE", "CAROUSEL"] as const;
type Format = (typeof FORMAT)[number];
type BarisDeliverableIsian = { uid: string; platform: Platform; format: Format; qty: number };

const TANPA = "__tanpa__";

/** Nilai awal untuk mode ubah (dari halaman rincian). */
export type AwalKolaborasi = {
  id: string;
  docNo: string;
  tahap: Tahap;
  kol: HasilCariKol;
  campaignId: string | null;
  jenis: JenisKerjaSama;
  fee: number;
  commissionPct: number | null;
  picId: string | null;
  plannedLiveAt: string | null;
  briefText: string | null;
  doList: string | null;
  dontList: string | null;
  deliverables: { platform: Platform; format: string; qty: number }[];
  sampel: { itemId: string; itemName: string; variantSku: string | null; qty: number }[];
};

/**
 * Dialog kolaborasi baru / ubah. KOL dipilih lewat autocomplete, lalu ringkasan
 * riwayatnya tampil sebelum memutuskan. Brief kosong mewarisi brief campaign
 * (diterapkan penulis). Mengubah fee atau jenis kerja sama sesudah tayang
 * meminta alasan.
 */
export function DialogKolaborasi({
  buka,
  onBuka,
  campaigns,
  pics,
  awal,
  campaignAwal,
  picAwal,
}: {
  buka: boolean;
  onBuka: (b: boolean) => void;
  campaigns: PilihanCampaign[];
  pics: PilihanPengguna[];
  /** Ada = mode ubah. */
  awal?: AwalKolaborasi | null;
  /** Mode baru: campaign yang sudah terpilih (mis. dari rincian campaign). */
  campaignAwal?: string | null;
  /** Mode baru: PIC bawaan (pengguna yang sedang masuk). */
  picAwal?: string | null;
}) {
  return (
    <Dialog open={buka} onOpenChange={onBuka}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        {buka ? (
          <IsiDialog
            key={awal?.id ?? "baru"}
            onTutup={() => onBuka(false)}
            campaigns={campaigns}
            pics={pics}
            awal={awal ?? null}
            campaignAwal={campaignAwal ?? null}
            picAwal={picAwal ?? null}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function IsiDialog({
  onTutup,
  campaigns,
  pics,
  awal,
  campaignAwal,
  picAwal,
}: {
  onTutup: () => void;
  campaigns: PilihanCampaign[];
  pics: PilihanPengguna[];
  awal: AwalKolaborasi | null;
  campaignAwal: string | null;
  picAwal: string | null;
}) {
  const t = useTranslations("kreatifRuang");
  const tk = dinamis(t);
  const galat = useTeksGalatKolaborasi();
  const router = useRouter();
  const [menyimpan, mulai] = useTransition();
  const mode = awal ? "ubah" : "baru";

  const [kol, setKol] = useState<HasilCariKol | null>(awal?.kol ?? null);
  const [campaignId, setCampaignId] = useState<string>(awal?.campaignId ?? campaignAwal ?? "");
  const [jenis, setJenis] = useState<JenisKerjaSama>(awal?.jenis ?? "BARTER");
  const [fee, setFee] = useState(awal ? String(awal.fee || "") : "");
  const [komisi, setKomisi] = useState(awal?.commissionPct != null ? String(awal.commissionPct) : "");
  const [picId, setPicId] = useState<string>(awal?.picId ?? picAwal ?? "");
  const [tahap, setTahap] = useState<Tahap>("PROSPEK");
  const [rencanaTayang, setRencanaTayang] = useState(awal?.plannedLiveAt ?? "");
  const [brief, setBrief] = useState(awal?.briefText ?? "");
  const [doList, setDoList] = useState(awal?.doList ?? "");
  const [dontList, setDontList] = useState(awal?.dontList ?? "");
  const [deliverables, setDeliverables] = useState<BarisDeliverableIsian[]>(
    (awal?.deliverables ?? []).map((d) => ({
      uid: newLocalId(),
      platform: d.platform,
      format: ((FORMAT as readonly string[]).includes(d.format) ? d.format : "REELS") as Format,
      qty: d.qty,
    })),
  );
  // Rencana sampel per varian memakai pemilih yang sama dengan pengiriman sampel
  // (stok tersedia per ukuran terlihat). Rencana tidak menggerakkan stok.
  const [sampel, setSampel] = useState<BarisIsian[]>(
    (awal?.sampel ?? []).map((s) => ({
      uid: newLocalId(),
      itemId: s.itemId,
      itemName: s.itemName,
      variantSku: s.variantSku,
      variantLabel: s.variantSku,
      qty: s.qty,
      bervarian: Boolean(s.variantSku),
    })),
  );
  const [varianSampel, setVarianSampel] = useState<Record<string, PilihanVarianKirim>>({});
  const tambahVarian = (itemId: string, p: PilihanVarianKirim) => setVarianSampel((l) => ({ ...l, [itemId]: p }));

  // Mode ubah: pilihan varian barang yang sudah direncanakan dimuat sekali.
  const itemAwal = [...new Set((awal?.sampel ?? []).map((s) => s.itemId))].join(",");
  useEffect(() => {
    if (!itemAwal) return;
    let batal = false;
    for (const itemId of itemAwal.split(",")) {
      pilihanVarianSampelAction(itemId)
        .then((r) => {
          if (batal || !r.ok) return;
          setVarianSampel((l) => ({ ...l, [itemId]: r.pilihan }));
          setSampel((l) =>
            l.map((b) => {
              if (b.itemId !== itemId) return b;
              const v = r.pilihan.varian.find((x) => x.sku === b.variantSku);
              return { ...b, variantLabel: v?.label ?? b.variantLabel, bervarian: r.pilihan.perluVarian || r.pilihan.varian.length > 0 };
            }),
          );
        })
        .catch(() => undefined);
    }
    return () => {
      batal = true;
    };
  }, [itemAwal]);
  const [alasan, setAlasan] = useState("");
  const [cobaSimpan, setCobaSimpan] = useState(false);

  const feeAngka = fee.trim() ? bacaAngka(fee) : 0;
  const komisiAngka = komisi.trim() ? bacaAngka(komisi) : null;
  const feeSah = feeAngka !== null && feeAngka >= 0;
  const komisiSah = komisiAngka === null || (komisiAngka >= 0 && komisiAngka <= 100);
  const butuhAlasan =
    awal !== null &&
    feeDiakui(awal.tahap) &&
    ((feeSah && Math.round((feeAngka ?? 0) * 100) !== Math.round(awal.fee * 100)) || jenis !== awal.jenis);
  const campaignTerpilih = campaigns.find((c) => c.id === campaignId);
  const pilihanCampaign = campaigns.filter((c) => !c.arsip || c.id === campaignId);

  const simpan = () => {
    setCobaSimpan(true);
    if (!kol) {
      toast.error(t("kolaborasi.form.pilihKolDulu"));
      return;
    }
    if (!feeSah || !komisiSah) {
      toast.error(galat("TIDAK_VALID"));
      return;
    }
    if (butuhAlasan && !alasan.trim()) {
      toast.error(t("kolaborasi.form.alasanUbahWajib"));
      return;
    }
    const isi: IsianKolaborasi = {
      campaignId: campaignId || null,
      jenis,
      fee: feeAngka ?? 0,
      commissionPct: komisiAngka,
      picId: picId || null,
      plannedLiveAt: rencanaTayang || null,
      briefText: brief,
      doList,
      dontList,
      deliverables: deliverables.filter((d) => d.qty > 0).map(({ platform, format, qty }) => ({ platform, format, qty })),
      sampel: sampel.map((s) => ({ itemId: s.itemId, variantSku: s.variantSku, qty: s.qty })),
    };
    mulai(async () => {
      if (mode === "baru") {
        const r = await buatKolaborasiAction({ ...isi, kolId: kol.id, tahap });
        if (!r.ok) {
          toast.error(galat(r.kode));
          return;
        }
        toast.success(t("kolaborasi.ok.dibuat", { docNo: r.docNo }));
        onTutup();
        router.push(`/backoffice/kreatif/kolaborasi/${r.id}`);
        return;
      }
      const r = await ubahKolaborasiAction(awal!.id, isi, butuhAlasan ? alasan.trim() : null);
      if (!r.ok) {
        toast.error(r.detail === "fee_dibayar" ? t("kolaborasi.errDetail.fee_dibayar") : galat(r.kode));
        return;
      }
      toast.success(t("kolaborasi.ok.diubah"));
      onTutup();
      router.refresh();
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{mode === "baru" ? t("kolaborasi.form.judulBaru") : t("kolaborasi.form.judulUbah", { docNo: awal!.docNo })}</DialogTitle>
        <DialogDescription className="sr-only">{t("kolaborasi.form.bagianKerjaSama")}</DialogDescription>
      </DialogHeader>

      <div className="space-y-6">
        <section className="space-y-2">
          <Label>{t("kolaborasi.form.kol")}</Label>
          {mode === "baru" ? (
            <PilihKol nilai={kol} onPilih={setKol} invalid={cobaSimpan && !kol} />
          ) : (
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium">{kol?.name}</p>
          )}
          {kol ? <RingkasanRiwayatKol kolId={kol.id} /> : null}
        </section>

        <section className="space-y-4">
          <h3 className="text-sm font-semibold">{t("kolaborasi.form.bagianKerjaSama")}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="kol-campaign">{t("kolaborasi.form.campaign")}</Label>
              <Select value={campaignId || TANPA} onValueChange={(v) => setCampaignId(v === TANPA ? "" : v)}>
                <SelectTrigger id="kol-campaign" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TANPA}>{t("kolaborasi.form.tanpaCampaign")}</SelectItem>
                  {pilihanCampaign.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {mode === "baru" ? (
              <div className="space-y-1.5">
                <Label htmlFor="kol-tahap">{t("kolaborasi.form.tahapAwal")}</Label>
                <Select value={tahap} onValueChange={(v) => setTahap(v as Tahap)}>
                  <SelectTrigger id="kol-tahap" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {URUTAN_TAHAP.map((x) => (
                      <SelectItem key={x} value={x}>
                        {tk(`tahap.${x}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="kol-pic">{t("kolaborasi.form.pic")}</Label>
                <PilihPic id="kol-pic" nilai={picId} onPilih={setPicId} pics={pics} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="kol-jenis">{t("kolaborasi.form.jenis")}</Label>
              <Select value={jenis} onValueChange={(v) => setJenis(v as JenisKerjaSama)}>
                <SelectTrigger id="kol-jenis" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEMUA_JENIS_KERJA_SAMA.map((j) => (
                    <SelectItem key={j} value={j}>
                      {tk(`jenis.${j}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="kol-fee">{t("kolaborasi.form.fee")}</Label>
                <Input
                  id="kol-fee"
                  inputMode="decimal"
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                  placeholder="0"
                  aria-invalid={cobaSimpan && !feeSah}
                  className="tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kol-komisi">{t("kolaborasi.form.komisi")}</Label>
                <Input
                  id="kol-komisi"
                  inputMode="decimal"
                  value={komisi}
                  onChange={(e) => setKomisi(e.target.value)}
                  placeholder="0"
                  aria-invalid={cobaSimpan && !komisiSah}
                  className="tabular-nums"
                />
              </div>
            </div>
            {mode === "baru" ? (
              <div className="space-y-1.5">
                <Label htmlFor="kol-pic">{t("kolaborasi.form.pic")}</Label>
                <PilihPic id="kol-pic" nilai={picId} onPilih={setPicId} pics={pics} />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="kol-tayang">{t("kolaborasi.form.rencanaTayang")}</Label>
              <TanggalInput id="kol-tayang" value={rencanaTayang} onChange={(e) => setRencanaTayang(e.target.value)} />
            </div>
          </div>
          {butuhAlasan ? (
            <div className="space-y-1.5 rounded-md border border-amber-600/30 bg-amber-500/10 p-3">
              <Label htmlFor="kol-alasan">{t("kolaborasi.form.alasanUbah")}</Label>
              <p className="text-xs text-amber-900 dark:text-amber-200">{t("kolaborasi.form.alasanUbahWajib")}</p>
              <Textarea id="kol-alasan" rows={2} value={alasan} onChange={(e) => setAlasan(e.target.value)} maxLength={1000} />
            </div>
          ) : null}
        </section>

        <section className="space-y-4">
          <h3 className="text-sm font-semibold">{t("kolaborasi.form.bagianBrief")}</h3>
          <div className="space-y-1.5">
            <Label htmlFor="kol-brief">{t("kolaborasi.form.brief")}</Label>
            <Textarea
              id="kol-brief"
              rows={4}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder={campaignTerpilih?.brief ? t("kolaborasi.form.briefWarisan") : undefined}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="kol-do">{t("kolaborasi.form.doList")}</Label>
              <Textarea id="kol-do" rows={3} value={doList} onChange={(e) => setDoList(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kol-dont">{t("kolaborasi.form.dontList")}</Label>
              <Textarea id="kol-dont" rows={3} value={dontList} onChange={(e) => setDontList(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t("kolaborasi.form.deliverable")}</Label>
            {deliverables.map((d) => (
              <div key={d.uid} className="flex flex-wrap items-center gap-2">
                <Select
                  value={d.platform}
                  onValueChange={(v) => setDeliverables((l) => l.map((x) => (x.uid === d.uid ? { ...x, platform: v as Platform } : x)))}
                >
                  <SelectTrigger className="w-36" aria-label={t("kolaborasi.form.platform")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEMUA_PLATFORM.map((p) => (
                      <SelectItem key={p} value={p}>
                        {LABEL_PLATFORM[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={d.format}
                  onValueChange={(v) => setDeliverables((l) => l.map((x) => (x.uid === d.uid ? { ...x, format: v as Format } : x)))}
                >
                  <SelectTrigger className="w-32" aria-label={t("kolaborasi.form.format")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FORMAT.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f.charAt(0) + f.slice(1).toLowerCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={Number.isFinite(d.qty) ? d.qty : ""}
                  onChange={(e) => setDeliverables((l) => l.map((x) => (x.uid === d.uid ? { ...x, qty: Number(e.target.value) } : x)))}
                  className="w-20"
                  aria-label={t("kolaborasi.form.qty")}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("kolaborasi.form.hapusBaris")}
                  onClick={() => setDeliverables((l) => l.filter((x) => x.uid !== d.uid))}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeliverables((l) => [...l, { uid: newLocalId(), platform: kol?.platform ?? "INSTAGRAM", format: "REELS", qty: 1 }])}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t("kolaborasi.form.tambahDeliverable")}
            </Button>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t("kolaborasi.form.sampel")}</h3>
          <PemilihBarangSampel baris={sampel} onChange={setSampel} varian={varianSampel} onVarian={tambahVarian} disabled={menyimpan} />
        </section>
      </div>

      <DialogFooter className="mt-2">
        <Button type="button" variant="outline" onClick={onTutup} disabled={menyimpan}>
          {t("kolaborasi.form.batal")}
        </Button>
        <Button type="button" onClick={simpan} disabled={menyimpan}>
          {menyimpan ? t("kolaborasi.form.menyimpan") : t("kolaborasi.form.simpan")}
        </Button>
      </DialogFooter>
    </>
  );
}

function PilihPic({ id, nilai, onPilih, pics }: { id: string; nilai: string; onPilih: (v: string) => void; pics: PilihanPengguna[] }) {
  const t = useTranslations("kreatifRuang.kolaborasi.form");
  return (
    <Select value={nilai || TANPA} onValueChange={(v) => onPilih(v === TANPA ? "" : v)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={TANPA}>{t("tanpaPic")}</SelectItem>
        {pics.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

