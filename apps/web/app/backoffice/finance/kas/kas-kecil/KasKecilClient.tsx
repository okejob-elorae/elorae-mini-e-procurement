"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Loader2, PiggyBank, Plus, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatRupiah } from "@/lib/format/rupiah";
import { labelTanggal } from "@/lib/tanggal-isian";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { persenTerpakai, type PengaturanKasKecil } from "@/lib/finance/kas/kas-kecil";
import type { KeadaanKasKecil } from "@/lib/finance/kas/kas-kecil-writer";
import type { RekeningKasBank } from "@/lib/finance/pajak/setoran-queries";
import { isiUlangKasKecilAction, simpanKasKecilAction } from "@/app/actions/finance-kas";
import { TAUTAN_DOKUMEN } from "@/app/backoffice/purchase-orders/tautan-dokumen";
import { pesanGalatKas } from "../_bersama/pesan-kas";

type Props = { dana: KeadaanKasKecil[]; pengaturan: PengaturanKasKecil; rekening: RekeningKasBank[]; bolehKelola: boolean };
type IsianDana = { kunci: string; akunId: string; danaTetap: string; pemegang: string; rekeningSumberId: string };
const TANPA = "__tanpa__";

export function KasKecilClient({ dana, pengaturan, rekening, bolehKelola }: Props) {
  const t = useTranslations("financeKas");
  const locale = useLocale();
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [aturBuka, setAturBuka] = useState(false);
  const [isian, setIsian] = useState<IsianDana[]>([]);
  const [isiUlang, setIsiUlang] = useState<KeadaanKasKecil | null>(null);
  const [sumber, setSumber] = useState("");
  const [kunci, setKunci] = useState(() => newLocalId());
  const pesan = (r: { kode: string; peran?: string; baris?: number }) => pesanGalatKas(t as unknown as Parameters<typeof pesanGalatKas>[0], r);

  const bukaAtur = () => {
    setIsian(
      pengaturan.dana.length
        ? pengaturan.dana.map((d) => ({ kunci: newLocalId(), akunId: d.akunId, danaTetap: String(d.danaTetap), pemegang: d.pemegang ?? "", rekeningSumberId: d.rekeningSumberId ?? TANPA }))
        : [{ kunci: newLocalId(), akunId: "", danaTetap: "", pemegang: "", rekeningSumberId: TANPA }],
    );
    setAturBuka(true);
  };

  const simpanAtur = () =>
    mulai(async () => {
      const r = await simpanKasKecilAction({
        dana: isian.filter((d) => d.akunId).map((d) => ({ akunId: d.akunId, danaTetap: d.danaTetap, pemegang: d.pemegang || null, rekeningSumberId: d.rekeningSumberId === TANPA ? null : d.rekeningSumberId })),
      });
      if (!r.ok) {
        const kode = r.kode === "TANPA_AKSES" || r.kode === "GAGAL" ? r.kode : `KK_${r.kode}`;
        return void toast.error(pesan({ kode, baris: "baris" in r ? r.baris : undefined }));
      }
      toast.success(t("kasKecil.tersimpan"));
      setAturBuka(false);
      router.refresh();
    });

  const lakukanIsiUlang = () =>
    mulai(async () => {
      if (!isiUlang) return;
      const r = await isiUlangKasKecilAction({ akunId: isiUlang.akunId, rekeningSumberId: sumber || null, idempotencyKey: kunci });
      if (!r.ok) return void toast.error(pesan(r));
      toast.success(t("kasKecil.terisi", { nomor: r.nomor, nilai: formatRupiah(r.jumlah) }));
      setKunci(newLocalId());
      setIsiUlang(null);
      router.refresh();
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("kasKecil.judul")}
        actions={
          <>
            <Link href="/backoffice/finance/kas">
              <Button variant="outline">
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("kembali")}
              </Button>
            </Link>
            {bolehKelola && (
              <Button variant="outline" onClick={bukaAtur}>
                <Settings2 className="mr-2 h-4 w-4" />
                {t("kasKecil.atur")}
              </Button>
            )}
          </>
        }
      />

      {dana.length === 0 ? (
        <Card className="py-0">
          <CardContent className="py-6">
            <EmptyState icon={PiggyBank} title={t("kasKecil.kosong")} description={bolehKelola ? t("kasKecil.kosongIsi") : undefined} />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {dana.map((d) => (
            <Card key={d.akunId} className="py-0">
              <CardHeader className="pt-6">
                <CardTitle className="flex items-center gap-2 text-base">
                  <PiggyBank className="h-5 w-5" />
                  {d.akunNama} ({d.akunKode})
                </CardTitle>
                {d.pemegang && <p className="text-sm text-muted-foreground">{t("kasKecil.pemegang", { nama: d.pemegang })}</p>}
              </CardHeader>
              <CardContent className="space-y-3 pb-6 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("kasKecil.danaTetap")}</span>
                  <span className="tabular-nums">{formatRupiah(d.danaTetap)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("kasKecil.saldo")}</span>
                  <span className="font-semibold tabular-nums">{formatRupiah(d.saldo)}</span>
                </div>
                <Progress value={persenTerpakai(d.danaTetap, d.saldo)} aria-label={t("kasKecil.terpakaiPersen", { persen: persenTerpakai(d.danaTetap, d.saldo) })} />
                <p className="text-xs text-muted-foreground">
                  {t("kasKecil.terpakai", { nilai: formatRupiah(d.terpakaiSejakIsi), jumlah: d.jumlahBkkSejakIsi })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {d.isiUlangTerakhir ? t("kasKecil.isiTerakhir", { nomor: d.isiUlangTerakhir.nomor, tanggal: labelTanggal(d.isiUlangTerakhir.tanggal, locale), nilai: formatRupiah(d.isiUlangTerakhir.jumlah) }) : t("kasKecil.belumPernahIsi")}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {bolehKelola && (
                    <Link href={`/backoffice/finance/kas/baru?jenis=OUT`}>
                      <Button variant="outline" size="sm">
                        {t("kasKecil.catatPengeluaran")}
                      </Button>
                    </Link>
                  )}
                  <Link href={`/backoffice/finance/kas?rekening=${encodeURIComponent(d.akunId)}`} className={`${TAUTAN_DOKUMEN} self-center text-xs`}>
                    {t("kasKecil.lihatVoucher")}
                  </Link>
                </div>
                {bolehKelola && (
                  <div className="space-y-1 pt-1">
                    <Button
                      size="sm"
                      disabled={d.isiUlang <= 0}
                      onClick={() => {
                        setSumber(d.rekeningSumberId ?? "");
                        setIsiUlang(d);
                      }}
                    >
                      {t("kasKecil.isiUlang", { nilai: formatRupiah(d.isiUlang) })}
                    </Button>
                    {d.isiUlang <= 0 && <p className="text-xs text-muted-foreground">{t("kasKecil.tidakPerluIsi")}</p>}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={aturBuka} onOpenChange={(v) => !pending && setAturBuka(v)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("kasKecil.atur")}</DialogTitle>
            <DialogDescription>{t("kasKecil.aturIsi")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {isian.map((d, i) => (
              <div key={d.kunci} className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">{t("kasKecil.akun")}</Label>
                  <Select value={d.akunId} onValueChange={(v) => setIsian((xs) => xs.map((x, j) => (j === i ? { ...x, akunId: v } : x)))}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("form.pilihRekening")} />
                    </SelectTrigger>
                    <SelectContent>
                      {rekening.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.nama} ({r.kode})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("kasKecil.danaTetap")}</Label>
                  <Input inputMode="decimal" value={d.danaTetap} onChange={(e) => setIsian((xs) => xs.map((x, j) => (j === i ? { ...x, danaTetap: e.target.value } : x)))} className="text-right tabular-nums" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("kasKecil.pemegangLabel")}</Label>
                  <Input value={d.pemegang} maxLength={100} onChange={(e) => setIsian((xs) => xs.map((x, j) => (j === i ? { ...x, pemegang: e.target.value } : x)))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("kasKecil.sumber")}</Label>
                  <div className="flex gap-2">
                    <Select value={d.rekeningSumberId} onValueChange={(v) => setIsian((xs) => xs.map((x, j) => (j === i ? { ...x, rekeningSumberId: v } : x)))}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={TANPA}>{t("kasKecil.sumberDipilihNanti")}</SelectItem>
                        {rekening
                          .filter((r) => r.id !== d.akunId)
                          .map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.nama} ({r.kode})
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="ghost" size="icon" onClick={() => setIsian((xs) => xs.filter((_, j) => j !== i))} aria-label={t("kasKecil.hapusDana")}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setIsian((xs) => [...xs, { kunci: newLocalId(), akunId: "", danaTetap: "", pemegang: "", rekeningSumberId: TANPA }])}>
              <Plus className="mr-1 h-4 w-4" />
              {t("kasKecil.tambahDana")}
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAturBuka(false)} disabled={pending}>
              {t("tutup")}
            </Button>
            <Button onClick={simpanAtur} disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("simpan")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isiUlang != null} onOpenChange={(v) => !pending && !v && setIsiUlang(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("kasKecil.isiUlangJudul")}</DialogTitle>
            <DialogDescription>{isiUlang ? t("kasKecil.isiUlangIsi", { nilai: formatRupiah(isiUlang.isiUlang), akun: isiUlang.akunNama }) : null}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>{t("kasKecil.sumber")}</Label>
            <Select value={sumber} onValueChange={setSumber}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("form.pilihRekening")} />
              </SelectTrigger>
              <SelectContent>
                {rekening
                  .filter((r) => r.id !== isiUlang?.akunId)
                  .map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.nama} ({r.kode})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsiUlang(null)} disabled={pending}>
              {t("tutup")}
            </Button>
            <Button onClick={lakukanIsiUlang} disabled={pending || !sumber}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("kasKecil.isiUlangTombol")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
