"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ListPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/ui/status-pill";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pratinjauMassalAction, simpanMassalAction } from "@/app/actions/kreatif-kol";
import { SEMUA_PLATFORM, type Platform } from "@/lib/creative/aturan";
import { BATAS_TEMPEL } from "@/lib/creative/kol-aturan";
import type { PilihanCampaign } from "@/lib/creative/campaign-queries";
import type { BarisPratinjau } from "@/lib/creative/kol-queries";
import type { AksiMassal } from "@/lib/creative/kol-writer";
import { angkaPenuh, pesanGagalKol } from "./format-kol";
import { masukkanKeCampaign } from "./sambungan-campaign";

const TANPA = "tanpa";

type Pilihan = { aksi: AksiMassal; targetId: string | null };

/** Pilihan bawaan per baris: galat/kembar dalam tempelan → lewati; sudah ada → perbarui yang pertama; lainnya → baru. */
function pilihanBawaan(b: BarisPratinjau): Pilihan {
  if (b.galat.length || b.kembarDalam !== null || !b.handle) return { aksi: "LEWATI", targetId: null };
  if (b.kembar.length) return { aksi: "PERBARUI", targetId: b.kembar[0].id };
  return { aksi: "BARU", targetId: null };
}

/**
 * "Tambah massal": tempel daftar `username, nama, pengikut[, WA, kota]`,
 * pratinjau dengan tanda kembar, pilih per baris perbarui/lewati, lalu simpan
 * seluruhnya dalam satu transaksi.
 */
export function TombolMassal({ campaign }: { campaign: readonly PilihanCampaign[] }) {
  const t = useTranslations("kreatifRuang");
  const tc = useTranslations("creative");
  const router = useRouter();
  const [buka, setBuka] = useState(false);
  const [platform, setPlatform] = useState<Platform>("TIKTOK");
  const [campaignId, setCampaignId] = useState<string>(TANPA);
  const [teks, setTeks] = useState("");
  const [pratinjau, setPratinjau] = useState<BarisPratinjau[] | null>(null);
  const [pilihan, setPilihan] = useState<Record<number, Pilihan>>({});
  const [sibuk, startSibuk] = useTransition();

  const reset = () => {
    setTeks("");
    setPratinjau(null);
    setPilihan({});
    setCampaignId(TANPA);
  };

  const lihat = () => {
    startSibuk(async () => {
      const r = await pratinjauMassalAction(teks, platform);
      if (!r.ok) {
        toast.error(
          r.kode === "TERLALU_BANYAK"
            ? t("kol.massal.terlaluBanyak", { n: BATAS_TEMPEL })
            : r.kode === "TIDAK_VALID"
              ? t("kol.massal.kosong")
              : pesanGagalKol(t, r.kode),
        );
        return;
      }
      setPratinjau(r.baris);
      setPilihan(Object.fromEntries(r.baris.map((b) => [b.nomor, pilihanBawaan(b)])));
    });
  };

  const hitung = { baru: 0, perbarui: 0, lewati: 0 };
  for (const b of pratinjau ?? []) {
    const p = pilihan[b.nomor] ?? pilihanBawaan(b);
    if (p.aksi === "BARU") hitung.baru += 1;
    else if (p.aksi === "PERBARUI") hitung.perbarui += 1;
    else hitung.lewati += 1;
  }

  const simpan = () => {
    if (!pratinjau) return;
    const baris = pratinjau.map((b) => {
      const p = pilihan[b.nomor] ?? pilihanBawaan(b);
      return { handle: b.handle ?? "", nama: b.nama, pengikut: b.pengikut, wa: b.waTeks || null, kota: b.kota, aksi: p.aksi, targetId: p.targetId };
    });
    startSibuk(async () => {
      const r = await simpanMassalAction(baris, platform);
      if (!r.ok) {
        toast.error(r.kode === "TERLALU_BANYAK" ? t("kol.massal.terlaluBanyak", { n: BATAS_TEMPEL }) : pesanGagalKol(t, r.kode));
        return;
      }
      const bagian = [t("kol.massal.hasil", { baru: r.baru, diperbarui: r.diperbarui, dilewati: r.dilewati })];
      if (r.kembarBaru.length) bagian.push(t("kol.massal.kembarBaru", { n: r.kembarBaru.length }));
      if (campaignId !== TANPA && masukkanKeCampaign && r.kolIds.length) {
        const c = await masukkanKeCampaign(r.kolIds, campaignId, "PROSPEK");
        if (c.ok) bagian.push(t("kol.massal.hasilKolab", { dibuat: c.dibuat }));
        else toast.error(pesanGagalKol(t, c.kode));
      }
      toast.success(bagian.join(" · "));
      setBuka(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          // Dikosongkan saat dibuka, bukan saat ditutup — supaya isinya tidak berganti selama animasi tutup.
          reset();
          setBuka(true);
        }}
      >
        <ListPlus className="mr-1.5 h-4 w-4" />
        {t("kol.tambahMassal")}
      </Button>
      <Dialog
        open={buka}
        onOpenChange={setBuka}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t("kol.massal.judul")}</DialogTitle>
          </DialogHeader>

          {!pratinjau ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="massal-platform">{t("kol.massal.platform")}</Label>
                  <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
                    <SelectTrigger id="massal-platform" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SEMUA_PLATFORM.map((p) => (
                        <SelectItem key={p} value={p}>
                          {tc(`platform${p}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="massal-campaign">{t("kol.massal.campaign")}</Label>
                  <Select value={campaignId} onValueChange={setCampaignId} disabled={!masukkanKeCampaign || campaign.length === 0}>
                    <SelectTrigger id="massal-campaign" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TANPA}>{t("kol.massal.tanpaCampaign")}</SelectItem>
                      {campaign.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!masukkanKeCampaign && <p className="text-xs text-muted-foreground">{t("kol.massal.campaignBelumSiap")}</p>}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="massal-daftar">{t("kol.massal.daftar")}</Label>
                <Textarea
                  id="massal-daftar"
                  rows={12}
                  className="min-h-48 font-mono text-sm"
                  placeholder={t("kol.massal.daftarPh")}
                  value={teks}
                  onChange={(e) => setTeks(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("kol.massal.format")}</p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setBuka(false)}>
                  {t("kol.form.batal")}
                </Button>
                <Button onClick={lihat} disabled={sibuk || !teks.trim()}>
                  {sibuk && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  {t("kol.massal.pratinjau")}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm tabular-nums text-muted-foreground">
                {t("kol.massal.ringkas", { baru: hitung.baru, perbarui: hitung.perbarui, lewati: hitung.lewati })}
              </p>
              <div className="max-h-[55vh] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">{t("kol.massal.kolom.baris")}</TableHead>
                      <TableHead>{t("kol.massal.kolom.username")}</TableHead>
                      <TableHead>{t("kol.massal.kolom.nama")}</TableHead>
                      <TableHead className="text-right">{t("kol.massal.kolom.pengikut")}</TableHead>
                      <TableHead>{t("kol.massal.kolom.keadaan")}</TableHead>
                      <TableHead className="w-44">{t("kol.massal.kolom.aksi")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pratinjau.map((b) => {
                      const p = pilihan[b.nomor] ?? pilihanBawaan(b);
                      const target = b.kembar.find((k) => k.id === p.targetId) ?? b.kembar[0];
                      const bolehSimpan = !b.galat.length && b.kembarDalam === null && Boolean(b.handle);
                      const nilaiPilih = p.aksi === "PERBARUI" ? `P:${p.targetId}` : p.aksi;
                      return (
                        <TableRow key={b.nomor} className={p.aksi === "LEWATI" ? "opacity-60" : undefined}>
                          <TableCell className="tabular-nums text-muted-foreground">{b.nomor}</TableCell>
                          <TableCell className="font-medium">{b.handle ? `@${b.handle}` : b.handleAsli || "—"}</TableCell>
                          <TableCell className="whitespace-normal">
                            {b.nama ?? "—"}
                            {(b.waTeks || b.kota) && (
                              <span className="block text-xs text-muted-foreground">{[b.waTeks, b.kota].filter(Boolean).join(" · ")}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {target?.akunSama && b.pengikut !== null && target.akunSama.followers !== b.pengikut
                              ? t("kol.massal.pengikutJadi", { dari: angkaPenuh(target.akunSama.followers), ke: angkaPenuh(b.pengikut) })
                              : b.pengikut !== null
                                ? angkaPenuh(b.pengikut)
                                : "—"}
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            <div className="flex flex-wrap gap-1">
                              {b.galat.map((g) => (
                                <StatusPill key={g} tone="attention">
                                  {t(`kol.massal.galat.${g}`)}
                                </StatusPill>
                              ))}
                              {b.kembarDalam !== null && <StatusPill tone="inactive">{t("kol.massal.kembarDalam", { n: b.kembarDalam })}</StatusPill>}
                              {!b.galat.length && b.kembarDalam === null && b.kembar.length === 0 && (
                                <StatusPill tone="progress">{t("kol.massal.baru")}</StatusPill>
                              )}
                              {b.kembar.map((k) => (
                                <StatusPill key={k.id} tone={k.diblokir ? "attention" : "waiting"}>
                                  {t("kol.massal.sudahAda", { nama: k.nama })}
                                </StatusPill>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Select
                              value={nilaiPilih}
                              disabled={!bolehSimpan}
                              onValueChange={(v) =>
                                setPilihan((x) => ({
                                  ...x,
                                  [b.nomor]: v.startsWith("P:") ? { aksi: "PERBARUI", targetId: v.slice(2) } : { aksi: v as AksiMassal, targetId: null },
                                }))
                              }
                            >
                              <SelectTrigger className="h-8" aria-label={t("kol.massal.kolom.aksi")}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {b.kembar.length === 0 && <SelectItem value="BARU">{t("kol.massal.aksiBaru")}</SelectItem>}
                                {b.kembar.map((k) => (
                                  <SelectItem key={k.id} value={`P:${k.id}`}>
                                    {b.kembar.length > 1 ? `${t("kol.massal.aksiPerbarui")} · ${k.nama}` : t("kol.massal.aksiPerbarui")}
                                  </SelectItem>
                                ))}
                                <SelectItem value="LEWATI">{t("kol.massal.aksiLewati")}</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPratinjau(null)} disabled={sibuk}>
                  {t("kol.massal.kembali")}
                </Button>
                <Button onClick={simpan} disabled={sibuk || hitung.baru + hitung.perbarui === 0}>
                  {sibuk && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  {t("kol.massal.simpan")}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
