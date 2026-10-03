"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, ExternalLink, ImageOff, MapPin, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { dinamis } from "@/lib/i18n/dinamis";
import { BATAS_USULAN, validasiPersetujuan, type GalatPersetujuan } from "@/lib/stores/usulan-toko";
import { setujuiUsulanTokoAction, tolakUsulanTokoAction } from "@/app/actions/store-proposals";
import { lencanaStatus } from "../UsulanTokoListClient";

type Status = "PENDING" | "APPROVED" | "REJECTED";

type Usulan = {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  contactName: string | null;
  termsType: "PUTUS" | "KONSI" | null;
  area: string | null;
  lat: number | null;
  lng: number | null;
  photoUrl: string | null;
  note: string | null;
  status: Status;
  pengusul: string | null;
  diajukan: string;
  reviewer: string | null;
  diputuskan: string | null;
  reviewNote: string | null;
  store: { id: string; code: string; name: string } | null;
};

type Kandidat = {
  jenis: "TOKO" | "USULAN";
  id: string;
  code: string | null;
  name: string;
  address: string;
  aktif: boolean;
  namaMirip: boolean;
  jarakMeter: number | null;
};

type Formulir = {
  area: { id: string; code: string; name: string }[];
  salesmen: { id: string; nama: string }[];
  saranKode: string;
  groupId: string | null;
  salesmanId: string | null;
};

// Radix Select tidak menerima nilai kosong.
const KOSONG = "__KOSONG__";

const angkaSaja = (s: string) => s.replace(/\D/g, "");

/** Kolom formulir tempat setiap galat ditampilkan. */
const KOLOM: Record<GalatPersetujuan, string> = {
  NAMA_WAJIB: "name",
  NAMA_TERLALU_PANJANG: "name",
  ALAMAT_WAJIB: "address",
  ALAMAT_TERLALU_PANJANG: "address",
  TELEPON_TIDAK_SAH: "phone",
  KONTAK_TERLALU_PANJANG: "contactName",
  JENIS_TIDAK_SAH: "termsType",
  JENIS_WAJIB: "termsType",
  KODE_WAJIB: "code",
  KODE_TERLALU_PANJANG: "code",
  TEMPO_TIDAK_SAH: "paymentTempo",
  MARGIN_TIDAK_SAH: "marginPercent",
};

export function DetailUsulanClient({
  usulan,
  kandidat,
  bolehKelola,
  formulir,
}: {
  usulan: Usulan;
  kandidat: Kandidat[];
  bolehKelola: boolean;
  formulir: Formulir | null;
}) {
  const t = useTranslations("storeProposals");
  const td = dinamis(t);

  const baris: { label: string; nilai: ReactNode }[] = [
    { label: t("fieldName"), nilai: usulan.name },
    { label: t("fieldAddress"), nilai: <span className="whitespace-pre-line">{usulan.address}</span> },
    { label: t("fieldPhone"), nilai: usulan.phone ?? "—" },
    { label: t("fieldContact"), nilai: usulan.contactName ?? "—" },
    { label: t("fieldType"), nilai: usulan.termsType ? td(`type_${usulan.termsType}`) : t("typeUnknown") },
    { label: t("fieldArea"), nilai: usulan.area ?? t("typeUnknown") },
    {
      label: t("fieldLocation"),
      nilai:
        usulan.lat !== null && usulan.lng !== null ? (
          <a
            href={`https://www.google.com/maps?q=${usulan.lat},${usulan.lng}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            <MapPin className="h-3.5 w-3.5" />
            {t("openMap")}
            <span className="tabular-nums text-muted-foreground">
              ({usulan.lat.toFixed(6)}, {usulan.lng.toFixed(6)})
            </span>
          </a>
        ) : (
          <span className="text-muted-foreground">{t("noLocation")}</span>
        ),
    },
    { label: t("fieldNote"), nilai: usulan.note ? <span className="whitespace-pre-line">{usulan.note}</span> : "—" },
    { label: t("fieldProposer"), nilai: usulan.pengusul ?? t("unknownUser") },
    { label: t("fieldProposedAt"), nilai: usulan.diajukan },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href="/backoffice/stores/usulan">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            {t("backToList")}
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{usulan.name}</h1>
          <Badge variant={lencanaStatus(usulan.status)}>{td(`status_${usulan.status}`)}</Badge>
        </div>
        <p className="text-muted-foreground">{t("title")}</p>
      </div>

      {usulan.status !== "PENDING" ? (
        <Card>
          <CardContent className="space-y-2 py-4 text-sm">
            <p className="font-medium">
              {td(`decided_${usulan.status}`, { name: usulan.reviewer ?? t("unknownUser"), date: usulan.diputuskan ?? "—" })}
            </p>
            {usulan.status === "REJECTED" && usulan.reviewNote ? (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">{t("rejectReasonShown", { reason: usulan.reviewNote })}</p>
            ) : null}
            {usulan.status === "APPROVED" ? (
              usulan.store ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/backoffice/stores/${usulan.store.id}`}>
                    <Store className="h-4 w-4" />
                    {t("openCreatedStore", { code: usulan.store.code })}
                  </Link>
                </Button>
              ) : (
                <p className="text-muted-foreground">{t("storeGone")}</p>
              )
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("sectionProposal")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {usulan.photoUrl ? (
                <a href={usulan.photoUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={usulan.photoUrl} alt={t("photo")} className="max-h-80 w-full bg-muted object-contain" />
                </a>
              ) : (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ImageOff className="h-4 w-4" />
                  {t("noPhoto")}
                </p>
              )}
              <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[180px_1fr]">
                {baris.map((b) => (
                  <div key={b.label} className="contents">
                    <dt className="text-muted-foreground">{b.label}</dt>
                    <dd className="min-w-0 break-words">{b.nilai}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <Card className={kandidat.length > 0 ? "border-amber-500/50" : undefined}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {kandidat.length > 0 ? <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" /> : null}
                {t("dupTitle")}
              </CardTitle>
              <p className="text-xs text-muted-foreground">{t("dupBody")}</p>
            </CardHeader>
            <CardContent>
              {kandidat.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("dupNone")}</p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {kandidat.map((k) => (
                    <li key={`${k.jenis}-${k.id}`} className="flex items-start gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">{k.name}</span>
                          {k.code ? <span className="font-mono text-xs text-muted-foreground">{k.code}</span> : null}
                          <Badge variant={k.jenis === "TOKO" ? "outline" : "secondary"}>
                            {k.jenis === "TOKO" ? t("dupStore") : t("dupProposal")}
                          </Badge>
                          {!k.aktif ? <Badge variant="outline">{t("dupInactive")}</Badge> : null}
                        </div>
                        <p className="line-clamp-2 text-xs text-muted-foreground">{k.address}</p>
                        <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                          {[k.namaMirip ? t("dupName") : null, k.jarakMeter !== null ? t("dupNear", { meter: k.jarakMeter }) : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <Button asChild variant="ghost" size="sm" className="shrink-0">
                        <Link href={k.jenis === "TOKO" ? `/backoffice/stores/${k.id}` : `/backoffice/stores/usulan/${k.id}`}>
                          {t("dupOpen")}
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          {usulan.status === "PENDING" ? (
            formulir && bolehKelola ? (
              <FormulirPersetujuan usulan={usulan} formulir={formulir} />
            ) : (
              <Card>
                <CardContent className="py-4 text-sm text-muted-foreground">{t("readOnly")}</CardContent>
              </Card>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FormulirPersetujuan({ usulan, formulir }: { usulan: Usulan; formulir: Formulir }) {
  const t = useTranslations("storeProposals");
  const td = dinamis(t);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(usulan.name);
  const [address, setAddress] = useState(usulan.address);
  const [phone, setPhone] = useState(usulan.phone ?? "");
  const [contactName, setContactName] = useState(usulan.contactName ?? "");
  const [code, setCode] = useState(formulir.saranKode);
  const [termsType, setTermsType] = useState<"PUTUS" | "KONSI" | "">(usulan.termsType ?? "");
  const [groupId, setGroupId] = useState(formulir.groupId ?? "");
  const [salesmanId, setSalesmanId] = useState(formulir.salesmanId ?? "");
  const [tempo, setTempo] = useState("0");
  const [isPkp, setIsPkp] = useState(false);
  const [margin, setMargin] = useState("");
  const [sudahCoba, setSudahCoba] = useState(false);
  const [bukaSetuju, setBukaSetuju] = useState(false);
  const [bukaTolak, setBukaTolak] = useState(false);
  const [alasan, setAlasan] = useState("");

  const masukan = {
    name,
    address,
    phone,
    contactName,
    code,
    termsType,
    groupId,
    salesmanId,
    paymentTempo: tempo === "" ? Number.NaN : Number(tempo),
    isPkp,
    marginPercent: margin.trim() === "" ? null : Number(margin.replace(",", ".")),
  };
  const periksa = validasiPersetujuan(masukan);
  const galat = new Map<string, GalatPersetujuan>();
  if (sudahCoba && !periksa.ok) for (const g of periksa.galat) if (!galat.has(KOLOM[g])) galat.set(KOLOM[g], g);
  const pesan = (kolom: string) => {
    const g = galat.get(kolom);
    return g ? <p className="text-xs text-destructive">{td(`err_${g}`)}</p> : null;
  };

  function mintaSetuju() {
    setSudahCoba(true);
    if (!periksa.ok) {
      toast.error(td(`err_${periksa.galat[0]}`));
      return;
    }
    setBukaSetuju(true);
  }

  function setujui() {
    startTransition(async () => {
      try {
        const hasil = await setujuiUsulanTokoAction(usulan.id, masukan);
        if (hasil.ok) {
          toast.success(t("okApproved"));
          setBukaSetuju(false);
          router.push(`/backoffice/stores/${hasil.storeId}`);
          return;
        }
        setBukaSetuju(false);
        toast.error(td(`err_${hasil.code}`));
        if (hasil.code === "SUDAH_DIPUTUSKAN") router.refresh();
      } catch {
        toast.error(t("errGeneric"));
      }
    });
  }

  function tolak() {
    const isi = alasan.trim();
    if (!isi) return;
    startTransition(async () => {
      try {
        const hasil = await tolakUsulanTokoAction(usulan.id, isi);
        if (hasil.ok) {
          toast.success(t("okRejected"));
          setBukaTolak(false);
          setAlasan("");
          router.refresh();
          return;
        }
        toast.error(td(`err_${hasil.code}`));
        if (hasil.code === "SUDAH_DIPUTUSKAN") {
          setBukaTolak(false);
          router.refresh();
        }
      } catch {
        toast.error(t("errGeneric"));
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("approveTitle")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("approveBody")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ut-code">
            {t("code")}
            <span className="ml-1 text-destructive">*</span>
          </Label>
          <Input id="ut-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={BATAS_USULAN.kode} className="font-mono" disabled={pending} />
          {pesan("code") ?? <p className="text-xs text-muted-foreground">{t("codeHint")}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ut-name">
            {t("fieldName")}
            <span className="ml-1 text-destructive">*</span>
          </Label>
          <Input id="ut-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={BATAS_USULAN.nama} disabled={pending} />
          {pesan("name")}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ut-address">
            {t("fieldAddress")}
            <span className="ml-1 text-destructive">*</span>
          </Label>
          <Textarea id="ut-address" value={address} onChange={(e) => setAddress(e.target.value)} rows={2} maxLength={BATAS_USULAN.alamat} disabled={pending} />
          {pesan("address")}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ut-phone">{t("fieldPhone")}</Label>
            <Input id="ut-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={32} disabled={pending} />
            {pesan("phone")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ut-contact">{t("fieldContact")}</Label>
            <Input id="ut-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} maxLength={BATAS_USULAN.kontak} disabled={pending} />
            {pesan("contactName")}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ut-type">
            {t("type")}
            <span className="ml-1 text-destructive">*</span>
          </Label>
          <Select value={termsType} onValueChange={(v) => setTermsType(v as "PUTUS" | "KONSI")} disabled={pending}>
            <SelectTrigger id="ut-type" className="w-full">
              <SelectValue placeholder={t("typePlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PUTUS">{t("type_PUTUS")}</SelectItem>
              <SelectItem value="KONSI">{t("type_KONSI")}</SelectItem>
            </SelectContent>
          </Select>
          {pesan("termsType")}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ut-area">{t("area")}</Label>
            <Select value={groupId || KOSONG} onValueChange={(v) => setGroupId(v === KOSONG ? "" : v)} disabled={pending}>
              <SelectTrigger id="ut-area" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={KOSONG}>{t("areaNone")}</SelectItem>
                {formulir.area.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ut-holder">{t("holder")}</Label>
            <Select value={salesmanId || KOSONG} onValueChange={(v) => setSalesmanId(v === KOSONG ? "" : v)} disabled={pending}>
              <SelectTrigger id="ut-holder" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={KOSONG}>{t("holderNone")}</SelectItem>
                {formulir.salesmen.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.nama}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("holderHint")}</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ut-tempo">{t("tempo")}</Label>
            <Input
              id="ut-tempo"
              inputMode="numeric"
              value={tempo}
              onChange={(e) => setTempo(angkaSaja(e.target.value).slice(0, 3))}
              className="tabular-nums"
              disabled={pending}
            />
            {pesan("paymentTempo")}
          </div>
          {termsType === "KONSI" ? (
            <div className="space-y-1.5">
              <Label htmlFor="ut-margin">{t("margin")}</Label>
              <Input
                id="ut-margin"
                inputMode="decimal"
                value={margin}
                onChange={(e) => setMargin(e.target.value.replace(/[^\d.,]/g, "").slice(0, 6))}
                className="tabular-nums"
                disabled={pending}
              />
              {pesan("marginPercent") ?? <p className="text-xs text-muted-foreground">{t("marginHint")}</p>}
            </div>
          ) : null}
        </div>

        <div className="flex items-start gap-3 rounded-lg border p-3">
          <Switch id="ut-pkp" checked={isPkp} onCheckedChange={setIsPkp} disabled={pending} />
          <div className="space-y-0.5">
            <Label htmlFor="ut-pkp" className="cursor-pointer">
              {t("pkp")}
            </Label>
            <p className="text-xs text-muted-foreground">{t("pkpHint")}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button onClick={mintaSetuju} disabled={pending}>
            {t("approve")}
          </Button>
          <Button variant="outline" className="text-destructive" onClick={() => setBukaTolak(true)} disabled={pending}>
            {t("reject")}
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={bukaSetuju} onOpenChange={setBukaSetuju}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("approveConfirmTitle", { code: code.trim() })}</AlertDialogTitle>
            <AlertDialogDescription>{t("approveConfirmBody", { name: name.trim() })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                // Dialog ditutup sendiri sesudah hasilnya jelas, bukan saat diklik.
                e.preventDefault();
                setujui();
              }}
            >
              {t("approve")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={bukaTolak}
        onOpenChange={(o) => {
          setBukaTolak(o);
          if (!o) setAlasan("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("rejectTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("rejectBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="ut-alasan">{t("rejectReason")}</Label>
            <Textarea
              id="ut-alasan"
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              placeholder={t("rejectPlaceholder")}
              rows={3}
              maxLength={BATAS_USULAN.alasan}
              disabled={pending}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending || !alasan.trim()}
              onClick={(e) => {
                e.preventDefault();
                tolak();
              }}
            >
              {t("reject")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
