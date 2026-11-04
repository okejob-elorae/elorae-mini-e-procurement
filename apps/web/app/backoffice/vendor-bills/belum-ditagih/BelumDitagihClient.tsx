"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileQuestion, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatIDR } from "@/lib/sales-orders/format";
import type { BarisBelumDitagih, HasilBelumDitagih } from "@/lib/vendor-billing/belum-ditagih-queries";
import { tidakPerluInvoiceAction } from "@/app/actions/vendor-bill-permintaan";
import { AlasanDialog } from "./AlasanDialog";
import { MintaInvoiceDialog } from "./MintaInvoiceDialog";

const qty = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });

/** Tab "Belum ditagih": penerimaan yang belum disebut invoice, dengan permintaan dan "tidak perlu invoice" (P19, P52). */
export function BelumDitagihClient({
  hasil,
  canManage,
  telepon,
  saring,
}: {
  hasil: HasilBelumDitagih;
  canManage: boolean;
  telepon: Record<string, string | null>;
  saring: { jenis: "GRN" | "WO_STEP" | null; status: "belum" | "diminta" | "terlambat" | null; pemasok: string | null };
}) {
  const t = useTranslations("vendorBills.belumDitagih");
  const tTp = useTranslations("vendorBills.tidakPerlu");
  const router = useRouter();
  const [dipilih, setDipilih] = useState<Set<string>>(new Set());
  const [minta, setMinta] = useState(false);
  const [bebaskan, setBebaskan] = useState<BarisBelumDitagih | null>(null);

  const baris = hasil.baris;
  const terpilih = baris.filter((b) => dipilih.has(b.baris));
  const pemasokTerpilih = terpilih[0]?.supplierId ?? null;
  const bolehDipilih = (b: BarisBelumDitagih) => canManage && b.status === "BELUM_DIMINTA" && b.terhalang == null && (!pemasokTerpilih || b.supplierId === pemasokTerpilih);

  const sumberMinta = useMemo(() => {
    const per = new Map<string, { jenis: "GRN" | "WO_STEP"; id: string; baris: BarisBelumDitagih[] }>();
    for (const b of terpilih) {
      const s = per.get(b.kunci) ?? { jenis: b.jenis, id: b.id, baris: [] };
      s.baris.push(b);
      per.set(b.kunci, s);
    }
    return [...per.values()];
  }, [terpilih]);

  const href = (o: Partial<Pick<typeof saring, "jenis" | "status">>) => {
    const p = new URLSearchParams();
    p.set("tab", "belum");
    if (saring.pemasok) p.set("pemasok", saring.pemasok);
    const j = o.jenis === undefined ? saring.jenis : o.jenis;
    const s = o.status === undefined ? saring.status : o.status;
    if (j) p.set("jenis", j);
    else p.delete("jenis");
    if (s) p.set("status", s);
    else p.delete("status");
    return `/backoffice/vendor-bills/belum-ditagih?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {([null, "GRN", "WO_STEP"] as const).map((j) => (
          <Button key={j ?? "semua"} asChild size="sm" variant={saring.jenis === j ? "default" : "outline"}>
            <Link replace href={href({ jenis: j })}>
              {t(`jenis.${j ?? "SEMUA"}`)}
            </Link>
          </Button>
        ))}
        <span className="mx-1" />
        {([null, "belum", "diminta", "terlambat"] as const).map((s) => (
          <Button key={s ?? "semua"} asChild size="sm" variant={saring.status === s ? "default" : "outline"}>
            <Link replace href={href({ status: s })}>
              {t(`status.${s ?? "semua"}`)}
            </Link>
          </Button>
        ))}
      </div>

      {hasil.ringkasan.length > 0 && (
        <Card className="py-0">
          <CardContent className="py-4">
            <ul className="space-y-1 text-sm">
              {hasil.ringkasan.map((r) => (
                <li key={r.supplierId} className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">{r.supplierName}</span>
                  <span className="text-muted-foreground">
                    {t("ringkasan", { penerimaan: r.penerimaan, nilai: formatIDR(r.nilaiSen / 100) })}
                    {r.terpotong ? ` · ${t("terpotong")}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="py-0">
        <CardHeader className="pt-6">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <FileQuestion className="h-5 w-5" />
            {t("judulTabel")}
            {canManage && (
              <div className="ml-auto flex flex-wrap gap-2">
                <Button size="sm" disabled={terpilih.length === 0} onClick={() => setMinta(true)}>
                  <MessageCircle className="mr-2 h-4 w-4" />
                  {t("mintaInvoice", { count: sumberMinta.length })}
                </Button>
                {pemasokTerpilih && (
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/backoffice/vendor-bills/new?pemasok=${encodeURIComponent(pemasokTerpilih)}`}>{t("catatInvoice")}</Link>
                  </Button>
                )}
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-6">
          {baris.length === 0 ? (
            <EmptyState icon={FileQuestion} title={t("kosong")} description={t("kosongIsi")} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>{t("kolomPenerimaan")}</TableHead>
                    <TableHead>{t("kolomBarang")}</TableHead>
                    <TableHead className="text-right">{t("kolomBelum")}</TableHead>
                    <TableHead className="text-right">{t("kolomNilai")}</TableHead>
                    <TableHead>{t("kolomStatus")}</TableHead>
                    <TableHead className="w-[150px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((b) => (
                    <TableRow key={b.baris}>
                      <TableCell className="align-top">
                        <Checkbox
                          aria-label={`${b.nomor} ${b.label}`}
                          checked={dipilih.has(b.baris)}
                          disabled={!bolehDipilih(b) && !dipilih.has(b.baris)}
                          onCheckedChange={(v) =>
                            setDipilih((d) => {
                              const n = new Set(d);
                              if (v === true) n.add(b.baris);
                              else n.delete(b.baris);
                              return n;
                            })
                          }
                        />
                      </TableCell>
                      <TableCell className="align-top whitespace-normal">
                        <div className="font-medium">
                          {b.jenis === "GRN" ? (
                            <Link className="hover:underline" href={`/backoffice/inventory/grn/${b.id}`}>
                              {b.nomor}
                            </Link>
                          ) : (
                            b.nomor
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {b.supplierName} · {b.tanggal} · {t("umur", { hari: b.umurHari })}
                          {b.jenis === "GRN" ? ` · ${b.poNomor ?? t("tanpaPo")}` : ""}
                        </div>
                      </TableCell>
                      <TableCell className="align-top whitespace-normal">
                        <div>{b.label}</div>
                        <div className="flex flex-wrap gap-1 pt-1">
                          {b.hargaNol && <Badge variant="outline">{t("lencana.hargaNol")}</Badge>}
                          {b.qtyLama > 0 && <Badge variant="outline">{t("lencana.lama")}</Badge>}
                          {b.terhalang === "MENUNGGU_PEMILIK" && <Badge variant="secondary">{t("lencana.menungguPemilik")}</Badge>}
                          {b.terhalang === "MENUNGGU_KONFIRMASI" && <Badge variant="secondary">{t("lencana.menungguKonfirmasi")}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="align-top text-right">
                        {qty(b.belum)}
                        <div className="text-xs text-muted-foreground">{t("dariDiterima", { diterima: qty(b.diterima - b.diretur) })}</div>
                      </TableCell>
                      <TableCell className="align-top text-right">{b.nilaiSen == null ? t("nilaiBelumTercatat") : formatIDR(b.nilaiSen / 100)}</TableCell>
                      <TableCell className="align-top whitespace-normal">
                        {b.status === "BELUM_DIMINTA" ? (
                          <Badge variant="outline">{t("statusBaris.BELUM_DIMINTA")}</Badge>
                        ) : (
                          <Badge variant={b.status === "TERLAMBAT" ? "destructive" : "secondary"}>
                            {b.status === "TERLAMBAT" ? t("statusBaris.TERLAMBAT") : t("statusBaris.DIMINTA", { tanggal: b.diminta?.tanggal ?? "", oleh: b.diminta?.oleh ?? "" })}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        {canManage && b.terhalang == null && (
                          <Button size="sm" variant="ghost" onClick={() => setBebaskan(b)}>
                            {tTp("tombol")}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {pemasokTerpilih && (
        <MintaInvoiceDialog
          buka={minta}
          onTutup={() => {
            setMinta(false);
            setDipilih(new Set());
          }}
          supplierId={pemasokTerpilih}
          namaPemasok={terpilih[0]?.supplierName ?? ""}
          telepon={telepon[pemasokTerpilih] ?? null}
          sumber={sumberMinta.map((s) => ({ jenis: s.jenis, id: s.id }))}
          baris={terpilih.map((b) => ({
            nomor: b.poNomor ? `${b.nomor} (${b.poNomor})` : b.nomor,
            keterangan: b.label,
            tanggal: b.tanggal,
            qty: b.belum,
            nilaiSen: b.nilaiSen,
          }))}
        />
      )}

      <AlasanDialog
        buka={bebaskan != null}
        judul={tTp("dialogJudul", { nomor: bebaskan?.nomor ?? "" })}
        isi={tTp("dialogIsi")}
        tombol={tTp("tombol")}
        onTutup={() => setBebaskan(null)}
        onKirim={async (alasan) => {
          if (!bebaskan) return false;
          const r = await tidakPerluInvoiceAction({
            supplierId: bebaskan.supplierId,
            sumber: [{ jenis: bebaskan.jenis, id: bebaskan.id, itemId: bebaskan.itemId, variantSku: bebaskan.variantSku }],
            alasan,
          });
          if (!r.ok) {
            toast.error(tTp.has(`galat.${r.kode}`) ? tTp(`galat.${r.kode}`) : tTp("galat.GAGAL"));
            return false;
          }
          toast.success(tTp("dicatatToast"));
          router.refresh();
          return true;
        }}
      />
    </div>
  );
}
