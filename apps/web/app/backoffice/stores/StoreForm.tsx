"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown, Loader2, MapPin, Search } from "lucide-react";
import { parseCoordsPaste } from "@/lib/geo/coords";
import {
  createStoreAction,
  updateStoreAction,
  deactivateStoreAction,
  searchStorePlacesAction,
  getPlaceSearchAvailabilityAction,
  bacaBatasKreditTokoAction,
  bacaKelasTokoAction,
} from "./actions";
import type { SerpPlaceResult } from "@/lib/geo/serpapi-maps";
import type { StoreFields } from "@/lib/stores/queries";
import { DAFTAR_KELAS, type KelasToko } from "@/lib/stores/kelas-toko";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { TombolBantuan } from "@/components/bantuan/TombolBantuan";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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

const StoreMapPicker = dynamic(() => import("./StoreMapPicker"), {
  ssr: false,
  loading: () => (
    <div className="h-[280px] w-full animate-pulse rounded-md border bg-muted/40" />
  ),
});

type Props = {
  mode: "create" | "edit";
  storeId?: string;
  readOnly?: boolean;
  hideHeader?: boolean;
  initial: StoreFields & { isActive: boolean };
  /** Pilihan area; area nonaktif hanya tampil kalau toko ini masih memakainya. */
  areas: { id: string; code: string; name: string; isActive: boolean }[];
  salesmen: { id: string; nama: string }[];
};

// Radix Select tidak menerima nilai kosong.
const KOSONG = "__KOSONG__";

const angkaSaja = (s: string) => s.replace(/\D/g, "");
const kelompokRibuan = new Intl.NumberFormat("id-ID");

function SectionHeader({ title }: { title: string }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {title}
    </h3>
  );
}

export function StoreForm({ mode, storeId, readOnly = false, hideHeader = false, initial, areas, salesmen }: Props) {
  const t = useTranslations("stores.form");
  const tErr = useTranslations("stores.errors");
  const tRoot = useTranslations("stores");
  const tSection = useTranslations("stores.form.sections");
  const tKredit = useTranslations("stores.kredit");
  const tKelas = useTranslations("kelasToko.form");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [pasteOk, setPasteOk] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [placeSearchConfigured, setPlaceSearchConfigured] = useState<boolean | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [placeResults, setPlaceResults] = useState<SerpPlaceResult[]>([]);
  const searchSeqRef = useRef(0);

  const [form, setForm] = useState<StoreFields>(initial);
  /*
   * Batas kredit yang belum ikut di `initial` (halaman pemanggil belum
   * mengirimnya) dibaca sendiri. Selama belum terbaca kolomnya dikunci dan
   * nilainya `undefined` — penyimpanan membiarkan batas tersimpan apa adanya.
   */
  const [kreditTerbaca, setKreditTerbaca] = useState(mode === "create" || initial.creditLimit !== undefined);

  useEffect(() => {
    if (kreditTerbaca || !storeId) return;
    let batal = false;
    void bacaBatasKreditTokoAction(storeId).then((r) => {
      if (batal || !r.ok || !r.data) return;
      const batas = r.data;
      setForm((prev) => ({ ...prev, creditLimit: batas.creditLimit, maxOpenInvoices: batas.maxOpenInvoices }));
      setKreditTerbaca(true);
    });
    return () => {
      batal = true;
    };
  }, [kreditTerbaca, storeId]);

  /*
   * Kelas toko: sama dengan batas kredit — kalau halaman pemanggil belum
   * mengirimnya, dibaca sendiri, dan selama belum terbaca pemilihnya dikunci
   * dan nilainya `undefined` (penyimpanan tidak mengubah kelas tersimpan).
   * Jarak kunjungan tiap kelas ikut dibaca supaya pilihannya menyebut harinya.
   */
  const perluBacaKelas = mode === "edit" && initial.storeClass === undefined;
  const [kelasTerbaca, setKelasTerbaca] = useState(!perluBacaKelas);
  const [jarakKelas, setJarakKelas] = useState<{ jarakHari: Record<KelasToko, number>; batasUmum: number } | null>(null);

  useEffect(() => {
    let batal = false;
    void bacaKelasTokoAction(perluBacaKelas ? storeId ?? null : null).then((r) => {
      if (batal || !r.ok || !r.data) return;
      const d = r.data;
      setJarakKelas({ jarakHari: d.jarakHari, batasUmum: d.batasUmum });
      if (perluBacaKelas) {
        setForm((prev) => ({ ...prev, storeClass: d.storeClass }));
        setKelasTerbaca(true);
      }
    });
    return () => {
      batal = true;
    };
  }, [perluBacaKelas, storeId]);

  useEffect(() => {
    let cancelled = false;
    void getPlaceSearchAvailabilityAction().then((r) => {
      if (!cancelled) setPlaceSearchConfigured(r.configured);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function update<K extends keyof StoreFields>(key: K, value: StoreFields[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function applyParsedCoords(raw: string): boolean {
    const parsed = parseCoordsPaste(raw);
    if (!parsed) {
      setPasteError(t("pasteCoordsInvalid"));
      setPasteOk(null);
      return false;
    }
    setPasteError(null);
    setPasteOk(t("pasteCoordsApplied", { lat: parsed.lat, lng: parsed.lng }));
    setForm((prev) => ({ ...prev, lat: parsed.lat, lng: parsed.lng }));
    return true;
  }

  function applyPaste() {
    applyParsedCoords(paste);
  }

  async function onSearchPlaces() {
    setSearchError(null);
    setPlaceResults([]);
    const q = (form.address.trim() || form.name.trim()).trim();
    if (!q) {
      setSearchError(t("searchEmptyQuery"));
      return;
    }
    const seq = ++searchSeqRef.current;
    setSearching(true);
    try {
      const result = await searchStorePlacesAction({
        q,
        lat: form.lat,
        lng: form.lng,
      });
      if (seq !== searchSeqRef.current) return;
      if (!result.ok) {
        if (result.code === "NO_API_KEY") {
          setPlaceSearchConfigured(false);
          setSearchError(t("searchNoApiKeyV2"));
        } else if (result.code === "FORBIDDEN") {
          setSearchError(tErr("forbidden"));
        } else if (result.code === "EMPTY_QUERY") {
          setSearchError(t("searchEmptyQuery"));
        } else if (result.code === "RATE_LIMITED") {
          setSearchError(t("searchRateLimited"));
        } else {
          setSearchError(t("searchUpstream"));
        }
        return;
      }
      setPlaceResults(result.results);
      if (result.results.length === 0) {
        setSearchError(t("searchNoResults"));
      }
    } finally {
      if (seq === searchSeqRef.current) setSearching(false);
    }
  }

  function pickPlace(place: SerpPlaceResult) {
    setForm((prev) => ({
      ...prev,
      lat: place.lat,
      lng: place.lng,
      address: place.address || prev.address || place.title,
    }));
    setPlaceResults([]);
    setSearchError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result =
        mode === "create"
          ? await createStoreAction(form)
          : await updateStoreAction(storeId!, form);
      if (!result.ok) {
        if (result.code === "code_unique") setError(tErr("codeUnique"));
        else if (result.code === "forbidden") setError(tErr("forbidden"));
        else if (result.code === "not_found") setError(tErr("notFound"));
        else if (result.code === "invalid_ref") setError(tErr("invalidRef"));
        else setError(result.message);
        return;
      }
      if (mode === "create" && result.data?.id) {
        router.push(`/backoffice/stores/${result.data.id}`);
      } else if (mode === "edit" && storeId) {
        router.push(`/backoffice/stores/${storeId}`);
      } else {
        router.push("/backoffice/stores");
      }
      router.refresh();
    });
  }

  const [konfirmasiNonaktif, setKonfirmasiNonaktif] = useState(false);

  async function onDeactivate() {
    if (!storeId) return;
    setKonfirmasiNonaktif(false);
    startTransition(async () => {
      const result = await deactivateStoreAction(storeId);
      if (!result.ok) {
        if (result.code === "forbidden") setError(tErr("forbidden"));
        else if (result.code === "not_found") setError(tErr("notFound"));
        else setError(result.message);
        return;
      }
      router.push("/backoffice/stores");
      router.refresh();
    });
  }

  const searchDisabled =
    pending || readOnly || searching || placeSearchConfigured === false;

  return (
    <div className="space-y-4">
      {!hideHeader && (
        <>
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-bold">{tRoot(mode === "create" ? "new" : "edit")}</h1>
            <TombolBantuan judul={tRoot(mode === "create" ? "new" : "edit")} />
          </div>
          {readOnly && <p className="text-sm text-muted-foreground">{tRoot("readOnlyBanner")}</p>}
        </>
      )}
      <form onSubmit={submit} className="space-y-6">
        {error && <div className="text-sm text-destructive">{error}</div>}

        {/* 1. Who is this store */}
        <section className="space-y-4">
          <SectionHeader title={tSection("identity")} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="code">{t("code")}</Label>
              <Input
                id="code"
                required
                disabled={pending || readOnly}
                value={form.code}
                onChange={(e) => update("code", e.target.value)}
                placeholder="STR-001"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">{t("name")}</Label>
              <Input
                id="name"
                required
                disabled={pending || readOnly}
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
              />
            </div>
          </div>
        </section>

        <Separator />

        {/* 1b. Area dan sales yang memegangnya — dirotasi di sini atau massal
            dari daftar toko; setiap perubahan pemegang tercatat di jejak. */}
        <section className="space-y-4">
          <SectionHeader title={tSection("assignment")} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="groupId">{t("area")}</Label>
              <Select
                value={form.groupId ?? KOSONG}
                onValueChange={(v) => update("groupId", v === KOSONG ? null : v)}
                disabled={pending || readOnly}
              >
                <SelectTrigger id="groupId" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={KOSONG}>{t("areaNone")}</SelectItem>
                  {areas
                    .filter((a) => a.isActive || a.id === form.groupId)
                    .map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="salesmanId">{t("salesman")}</Label>
              <Select
                value={form.salesmanId ?? KOSONG}
                onValueChange={(v) => update("salesmanId", v === KOSONG ? null : v)}
                disabled={pending || readOnly}
              >
                <SelectTrigger id="salesmanId" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={KOSONG}>{t("salesmanNone")}</SelectItem>
                  {salesmen.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.nama}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("salesmanHint")}</p>
            </div>
          </div>
          {/* Kelas toko menentukan seberapa sering sales diingatkan datang. */}
          <div className="space-y-1.5 sm:max-w-[calc(50%-0.5rem)]">
            <Label htmlFor="storeClass">{tKelas("label")}</Label>
            <Select
              value={kelasTerbaca ? (form.storeClass ?? KOSONG) : ""}
              onValueChange={(v) => update("storeClass", v === KOSONG ? null : (v as KelasToko))}
              disabled={pending || readOnly || !kelasTerbaca}
            >
              <SelectTrigger id="storeClass" className="w-full">
                <SelectValue placeholder={tKelas("memuat")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={KOSONG}>
                  {jarakKelas ? tKelas("tanpa", { days: jarakKelas.batasUmum }) : tKelas("tanpaTanpaHari")}
                </SelectItem>
                {DAFTAR_KELAS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {jarakKelas
                      ? tKelas("opsi", { kelas: k, days: jarakKelas.jarakHari[k] })
                      : tKelas("opsiTanpaHari", { kelas: k })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{tKelas("bantuan")}</p>
          </div>
        </section>

        <Separator />

        {/* 2. People to call */}
        <section className="space-y-4">
          <SectionHeader title={tSection("contact")} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="phone">{t("phone")}</Label>
              <Input
                id="phone"
                disabled={pending || readOnly}
                value={form.phone ?? ""}
                onChange={(e) => update("phone", e.target.value || null)}
                inputMode="tel"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contactName">{t("contactName")}</Label>
              <Input
                id="contactName"
                disabled={pending || readOnly}
                value={form.contactName ?? ""}
                onChange={(e) => update("contactName", e.target.value || null)}
              />
            </div>
          </div>
        </section>

        <Separator />

        {/* 3. Address + map pin + check-in radius */}
        <section className="space-y-4">
          <SectionHeader title={tSection("location")} />
          <p className="text-xs text-muted-foreground">{t("mapHint")}</p>

          <div className="space-y-1.5">
            <Label htmlFor="address">{t("address")}</Label>
            <Textarea
              id="address"
              required
              disabled={pending || readOnly}
              value={form.address}
              onChange={(e) => update("address", e.target.value)}
              rows={3}
              placeholder={t("addressPlaceholder")}
            />
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={searchDisabled || placeSearchConfigured === null}
                onClick={() => void onSearchPlaces()}
              >
                {searching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                {t("searchOnMap")}
              </Button>
              {placeSearchConfigured === false && (
                <p className="text-xs text-muted-foreground">{t("searchNoApiKeyV2")}</p>
              )}
            </div>
            {searchError && <p className="text-sm text-destructive">{searchError}</p>}
            {placeResults.length > 0 && (
              <ul className="rounded-md border divide-y max-h-56 overflow-auto">
                {placeResults.map((p) => (
                  <li key={p.placeId ?? `${p.title}-${p.lat}-${p.lng}`}>
                    <button
                      type="button"
                      disabled={readOnly}
                      className="w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors"
                      onClick={() => pickPlace(p)}
                    >
                      <div className="flex items-start gap-2">
                        <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{p.title}</p>
                          {p.address && (
                            <p className="text-xs text-muted-foreground line-clamp-2">{p.address}</p>
                          )}
                          {p.rating !== null && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {t("searchRating", { rating: p.rating })}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <StoreMapPicker
              lat={form.lat}
              lng={form.lng}
              radiusMeters={form.checkinRadiusMeters}
              readOnly={readOnly || pending}
              onChange={({ lat, lng }) => {
                setForm((prev) => ({ ...prev, lat, lng }));
              }}
            />
            {form.lat !== null && form.lng !== null && (
              <p className="text-xs font-mono text-muted-foreground">
                {form.lat.toFixed(6)}, {form.lng.toFixed(6)}
              </p>
            )}
          </div>

          <div className="space-y-1.5 max-w-xs">
            <Label htmlFor="checkinRadiusMeters">{t("checkinRadius")}</Label>
            <Input
              id="checkinRadiusMeters"
              disabled={pending || readOnly}
              type="number"
              min={0}
              value={form.checkinRadiusMeters ?? ""}
              onChange={(e) =>
                update(
                  "checkinRadiusMeters",
                  e.target.value === "" ? null : Number(e.target.value),
                )
              }
              placeholder={t("checkinRadiusPlaceholder")}
            />
            <p className="text-xs text-muted-foreground">{t("checkinRadiusHint")}</p>
          </div>

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="gap-1 px-0">
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                />
                {t("advancedCoords")}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-2">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="lat">{t("lat")}</Label>
                  <Input
                    id="lat"
                    disabled={pending || readOnly}
                    type="number"
                    step="0.0000001"
                    value={form.lat ?? ""}
                    onChange={(e) =>
                      update("lat", e.target.value === "" ? null : Number(e.target.value))
                    }
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lng">{t("lng")}</Label>
                  <Input
                    id="lng"
                    disabled={pending || readOnly}
                    type="number"
                    step="0.0000001"
                    value={form.lng ?? ""}
                    onChange={(e) =>
                      update("lng", e.target.value === "" ? null : Number(e.target.value))
                    }
                    className="font-mono"
                  />
                </div>
              </div>
              <div className="flex gap-2 items-start">
                <Input
                  id="pasteCoords"
                  disabled={pending || readOnly}
                  placeholder={t("pasteCoordsHint")}
                  value={paste}
                  onChange={(e) => {
                    setPaste(e.target.value);
                    setPasteError(null);
                    setPasteOk(null);
                  }}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData("text");
                    if (!text.trim()) return;
                    window.setTimeout(() => {
                      if (applyParsedCoords(text)) {
                        setPaste(text.trim());
                      }
                    }, 0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyPaste();
                    }
                  }}
                  className="flex-1"
                />
                <Button type="button" variant="outline" onClick={applyPaste} disabled={readOnly}>
                  {t("pasteCoords")}
                </Button>
              </div>
              {pasteError && <div className="text-sm text-destructive">{pasteError}</div>}
              {pasteOk && <div className="text-sm text-muted-foreground">{pasteOk}</div>}
            </CollapsibleContent>
          </Collapsible>
        </section>

        <Separator />

        {/* 4. Commercial terms */}
        <section className="space-y-4">
          <SectionHeader title={tSection("terms")} />
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="termsType">{t("termsType")}</Label>
              <Select
                disabled={pending || readOnly}
                value={form.termsType}
                onValueChange={(v) => update("termsType", v as "PUTUS" | "KONSI")}
              >
                <SelectTrigger id="termsType" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PUTUS">{t("termsPutus")}</SelectItem>
                  <SelectItem value="KONSI">{t("termsKonsi")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="paymentTempo">{t("paymentTempo")}</Label>
              <Input
                id="paymentTempo"
                required
                disabled={pending || readOnly}
                type="number"
                min={0}
                value={form.paymentTempo}
                onChange={(e) => update("paymentTempo", Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="marginPercent">{t("marginPercent")}</Label>
              <Input
                id="marginPercent"
                disabled={pending || readOnly}
                type="number"
                step="0.01"
                value={form.marginPercent ?? ""}
                onChange={(e) =>
                  update("marginPercent", e.target.value === "" ? null : Number(e.target.value))
                }
              />
            </div>
          </div>

          {/* Menentukan boleh-tidaknya potongan PPh 23 di BKM. Milik admin, bukan
              sales — mengubahnya mengubah berapa yang boleh dipotong dari tagihan. */}
          <div className="flex items-start gap-3 rounded-lg border p-3">
            <Switch
              id="isPkp"
              disabled={pending || readOnly}
              checked={form.isPkp}
              onCheckedChange={(v) => update("isPkp", v)}
            />
            <div className="space-y-0.5">
              <Label htmlFor="isPkp" className="cursor-pointer">
                {t("isPkp")}
              </Label>
              <p className="text-xs text-muted-foreground">{t("isPkpHint")}</p>
            </div>
          </div>

          {/* PPN tagihan konsinyasi: hanya toko KONSI. Dibekukan ke siklus saat angkanya dikunci. */}
          {form.termsType === "KONSI" ? (
            <div className="flex items-start gap-3 rounded-lg border p-3">
              <Switch
                id="consignmentVat"
                disabled={pending || readOnly}
                checked={form.consignmentVat ?? false}
                onCheckedChange={(v) => update("consignmentVat", v)}
              />
              <Label htmlFor="consignmentVat" className="cursor-pointer">
                {t("consignmentVat")}
              </Label>
            </div>
          ) : null}

          {/* Batas kredit hanya bermakna untuk toko PUTUS — konsinyasi tidak punya piutang. */}
          {form.termsType === "PUTUS" ? (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{tKredit("judul")}</p>
                <p className="text-xs text-muted-foreground">{tKredit("penjelasan")}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="creditLimit">{tKredit("batasNilai")}</Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      Rp
                    </span>
                    <Input
                      id="creditLimit"
                      type="text"
                      inputMode="numeric"
                      className="pl-9 text-right tabular-nums"
                      disabled={pending || readOnly || !kreditTerbaca}
                      value={
                        form.creditLimit === null || form.creditLimit === undefined
                          ? ""
                          : kelompokRibuan.format(form.creditLimit)
                      }
                      placeholder={kreditTerbaca ? tKredit("kosong") : tKredit("memuat")}
                      onChange={(e) => {
                        const digit = angkaSaja(e.target.value).slice(0, 13);
                        update("creditLimit", digit === "" ? null : Number(digit));
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">{tKredit("bantuan")}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="maxOpenInvoices">{tKredit("maksFaktur")}</Label>
                  <Input
                    id="maxOpenInvoices"
                    type="text"
                    inputMode="numeric"
                    className="tabular-nums"
                    disabled={pending || readOnly || !kreditTerbaca}
                    value={form.maxOpenInvoices === null || form.maxOpenInvoices === undefined ? "" : String(form.maxOpenInvoices)}
                    placeholder={kreditTerbaca ? tKredit("kosong") : tKredit("memuat")}
                    onChange={(e) => {
                      const digit = angkaSaja(e.target.value).slice(0, 5);
                      update("maxOpenInvoices", digit === "" ? null : Number(digit));
                    }}
                  />
                  <p className="text-xs text-muted-foreground">{tKredit("bantuan")}</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{tKredit("konsi")}</p>
          )}
        </section>

        <Separator />

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending}>
              {t("save")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (mode === "edit" && storeId) router.push(`/backoffice/stores/${storeId}`);
                else router.push("/backoffice/stores");
              }}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            {mode === "edit" && initial.isActive && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => setKonfirmasiNonaktif(true)}
                disabled={pending}
                className="ml-auto"
              >
                {t("deactivate")}
              </Button>
            )}
            <AlertDialog open={konfirmasiNonaktif} onOpenChange={setKonfirmasiNonaktif}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("deactivate")}</AlertDialogTitle>
                  <AlertDialogDescription>{t("deactivateConfirm")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => void onDeactivate()}>
                    {t("deactivate")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
        {readOnly && (
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/backoffice/stores">{t("back")}</Link>
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
