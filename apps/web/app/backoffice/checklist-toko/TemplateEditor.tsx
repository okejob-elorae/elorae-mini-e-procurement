"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowDown, ArrowLeft, ArrowUp, Info, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { simpanTemplateChecklistAction } from "@/app/actions/checklist-toko";
import {
  BATAS_CHECKLIST,
  JENIS_PERTANYAAN,
  TEMPLATE_BAWAAN,
  jenisBerskor,
  type JenisPertanyaan,
} from "@/lib/salesman/checklist-toko";
import type { TemplateChecklistLengkap } from "@/lib/salesman/checklist-queries";
import { dinamis } from "@/lib/i18n/dinamis";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Isian satu pertanyaan di penyunting. Angka disimpan sebagai teks selama diketik. */
type BarisEditor = {
  id: string;
  teks: string;
  jenis: JenisPertanyaan;
  bobot: string;
  target: string;
  wajib: boolean;
  petunjuk: string;
};

/** Radix Select tidak menerima nilai kosong. */
const SEMUA = "SEMUA";

/** Id pertanyaan baru: pendek, aman untuk JSON, stabil sesudah disimpan. */
const idBaru = () => `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const angkaSaja = (s: string) => s.replace(/\D/g, "");

export function TemplateEditor({
  awal,
  salinBawaan,
  bolehKelola,
}: {
  awal: TemplateChecklistLengkap | null;
  salinBawaan: boolean;
  bolehKelola: boolean;
}) {
  const t = useTranslations("checklistToko");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();

  const [nama, setNama] = useState(() => awal?.nama ?? (salinBawaan ? t("bawaan.nama") : ""));
  const [jenisToko, setJenisToko] = useState<string>(awal?.termsType ?? SEMUA);
  const [baris, setBaris] = useState<BarisEditor[]>(() => {
    if (awal) {
      return awal.pertanyaan.map((p) => ({
        id: p.id,
        teks: p.teks,
        jenis: p.jenis,
        bobot: jenisBerskor(p.jenis) ? String(p.bobot) : "",
        target: p.target !== null ? String(p.target) : "",
        wajib: p.wajib,
        petunjuk: p.petunjuk ?? "",
      }));
    }
    if (salinBawaan) {
      return TEMPLATE_BAWAAN.pertanyaan.map((p) => ({
        id: p.id,
        teks: td(`bawaan.${p.kunci}`),
        jenis: p.jenis,
        bobot: jenisBerskor(p.jenis) ? String(p.bobot) : "",
        target: p.target !== null ? String(p.target) : "",
        wajib: p.wajib,
        petunjuk: td(`bawaanPetunjuk.${p.kunci}`),
      }));
    }
    return [];
  });
  const [salah, setSalah] = useState<number | null>(null);

  const kunci = !bolehKelola || sibuk;
  const totalBobot = baris.reduce((s, b) => s + (jenisBerskor(b.jenis) ? Number(b.bobot) || 0 : 0), 0);

  const ubah = (i: number, sebagian: Partial<BarisEditor>) => {
    setBaris((lama) => lama.map((b, j) => (j === i ? { ...b, ...sebagian } : b)));
    if (salah === i) setSalah(null);
  };
  const pindah = (i: number, arah: -1 | 1) =>
    setBaris((lama) => {
      const j = i + arah;
      if (j < 0 || j >= lama.length) return lama;
      const baru = [...lama];
      [baru[i], baru[j]] = [baru[j], baru[i]];
      return baru;
    });
  const tambah = () =>
    setBaris((lama) => [...lama, { id: idBaru(), teks: "", jenis: "YA_TIDAK", bobot: "10", target: "", wajib: true, petunjuk: "" }]);
  const buang = (i: number) => setBaris((lama) => lama.filter((_, j) => j !== i));

  const simpan = () =>
    mulai(async () => {
      const r = await simpanTemplateChecklistAction({
        id: awal?.id ?? null,
        nama,
        termsType: jenisToko === SEMUA ? null : jenisToko,
        pertanyaan: baris.map((b) => ({
          id: b.id,
          teks: b.teks,
          jenis: b.jenis,
          bobot: jenisBerskor(b.jenis) ? Number(b.bobot) : 0,
          target: b.jenis === "ANGKA" ? Number(b.target) : null,
          wajib: b.wajib,
          petunjuk: b.petunjuk,
        })),
      });
      if (!r.ok) {
        const pesan = td(`err.${r.kode}`);
        if (r.indeks !== undefined) {
          setSalah(r.indeks);
          toast.error(t("errPertanyaan", { n: r.indeks + 1, pesan }));
          document.getElementById(`pertanyaan-${r.indeks}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        } else {
          toast.error(pesan);
        }
        return;
      }
      toast.success(t("tersimpan"));
      if (awal) router.refresh();
      else router.push(`/backoffice/checklist-toko/${r.id}`);
    });

  return (
    <div className="space-y-6">
      <div className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/backoffice/checklist-toko">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t("kembali")}
          </Link>
        </Button>
      </div>

      <PageHeader
        title={awal ? awal.nama : salinBawaan ? t("judulSalin") : t("judulBaru")}
        description={t("editorDeskripsi")}
        meta={awal ? t("dipakai", { n: awal.jumlahHasil }) : undefined}
      />

      {awal && awal.jumlahHasil > 0 ? (
        <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {t("catatanUbah")}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("bagianUmum")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="tpl-nama">{t("namaLabel")}</Label>
            <Input id="tpl-nama" value={nama} maxLength={BATAS_CHECKLIST.nama} disabled={kunci} onChange={(e) => setNama(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tpl-jenis">{t("jenisTokoLabel")}</Label>
            <Select value={jenisToko} onValueChange={setJenisToko} disabled={kunci}>
              <SelectTrigger id="tpl-jenis" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEMUA}>{t("jenisToko.SEMUA")}</SelectItem>
                <SelectItem value="PUTUS">{t("jenisToko.PUTUS")}</SelectItem>
                <SelectItem value="KONSI">{t("jenisToko.KONSI")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("jenisTokoPetunjuk")}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("bagianPertanyaan")}</CardTitle>
          <CardDescription>{t("totalBobot", { n: totalBobot })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {baris.length === 0 ? <p className="text-sm text-muted-foreground">{t("belumAdaPertanyaan")}</p> : null}
          {baris.map((b, i) => {
            const berskor = jenisBerskor(b.jenis);
            return (
              <div
                key={b.id}
                id={`pertanyaan-${i}`}
                className={cn("space-y-3 rounded-lg border p-4", salah === i && "border-destructive ring-1 ring-destructive")}
              >
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="tabular-nums">
                    {i + 1}
                  </Badge>
                  <span className="flex-1 text-sm text-muted-foreground">{td(`jenis.${b.jenis}`)}</span>
                  {bolehKelola ? (
                    <>
                      <Button type="button" variant="ghost" size="icon" aria-label={t("naik")} disabled={kunci || i === 0} onClick={() => pindah(i, -1)}>
                        <ArrowUp className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("turun")}
                        disabled={kunci || i === baris.length - 1}
                        onClick={() => pindah(i, 1)}
                      >
                        <ArrowDown className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" aria-label={t("hapusPertanyaan")} disabled={kunci} onClick={() => buang(i)}>
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`p-teks-${i}`}>{t("teksLabel")}</Label>
                  <Input
                    id={`p-teks-${i}`}
                    value={b.teks}
                    maxLength={BATAS_CHECKLIST.teks}
                    disabled={kunci}
                    onChange={(e) => ubah(i, { teks: e.target.value })}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor={`p-jenis-${i}`}>{t("jenisLabel")}</Label>
                    <Select value={b.jenis} onValueChange={(v) => ubah(i, { jenis: v as JenisPertanyaan })} disabled={kunci}>
                      <SelectTrigger id={`p-jenis-${i}`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {JENIS_PERTANYAAN.map((j) => (
                          <SelectItem key={j} value={j}>
                            {td(`jenis.${j}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {berskor ? (
                    <div className="space-y-2">
                      <Label htmlFor={`p-bobot-${i}`}>{t("bobotLabel")}</Label>
                      <Input
                        id={`p-bobot-${i}`}
                        inputMode="numeric"
                        value={b.bobot}
                        disabled={kunci}
                        onChange={(e) => ubah(i, { bobot: angkaSaja(e.target.value).slice(0, 3) })}
                      />
                    </div>
                  ) : null}
                  {b.jenis === "ANGKA" ? (
                    <div className="space-y-2">
                      <Label htmlFor={`p-target-${i}`}>{t("targetLabel")}</Label>
                      <Input
                        id={`p-target-${i}`}
                        inputMode="numeric"
                        value={b.target}
                        disabled={kunci}
                        onChange={(e) => ubah(i, { target: angkaSaja(e.target.value).slice(0, 6) })}
                      />
                    </div>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">{td(`jenisPenjelasan.${b.jenis}`)}</p>

                <div className="space-y-2">
                  <Label htmlFor={`p-petunjuk-${i}`}>{t("petunjukLabel")}</Label>
                  <Input
                    id={`p-petunjuk-${i}`}
                    value={b.petunjuk}
                    maxLength={BATAS_CHECKLIST.petunjuk}
                    placeholder={t("petunjukPetunjuk")}
                    disabled={kunci}
                    onChange={(e) => ubah(i, { petunjuk: e.target.value })}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox id={`p-wajib-${i}`} checked={b.wajib} disabled={kunci} onCheckedChange={(v) => ubah(i, { wajib: v === true })} />
                  <Label htmlFor={`p-wajib-${i}`} className="font-normal">
                    {t("wajibLabel")}
                  </Label>
                </div>
              </div>
            );
          })}

          {bolehKelola ? (
            <Button type="button" variant="outline" onClick={tambah} disabled={kunci || baris.length >= BATAS_CHECKLIST.pertanyaan}>
              <Plus className="h-4 w-4" aria-hidden />
              {t("tambahPertanyaan")}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {bolehKelola ? (
        <div className="flex justify-end">
          <Button onClick={simpan} disabled={kunci}>
            {sibuk ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            {t("simpan")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
