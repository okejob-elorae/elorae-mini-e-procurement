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
} from "./actions";
import type { SerpPlaceResult } from "@/lib/geo/serpapi-maps";
import type { StoreFields } from "@/lib/stores/queries";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

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
};

function SectionHeader({ title }: { title: string }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {title}
    </h3>
  );
}

export function StoreForm({ mode, storeId, readOnly = false, hideHeader = false, initial }: Props) {
  const t = useTranslations("stores.form");
  const tErr = useTranslations("stores.errors");
  const tRoot = useTranslations("stores");
  const tSection = useTranslations("stores.form.sections");
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
          setSearchError(t("searchNoApiKey"));
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
    // Mirrors the termsType onValueChange handler below: a store that was already KONSI when
    // this form loaded (so the handler never fired) can still carry a stored priceDiscountPercent
    // — the field the KONSI branch hides is the only control that could clear it, so submit must
    // normalise it itself or the writer's assertValidPriceDiscount rejects an unrelated edit.
    const payload: StoreFields = { ...form, priceDiscountPercent: form.termsType === "KONSI" ? null : form.priceDiscountPercent };
    startTransition(async () => {
      const result =
        mode === "create"
          ? await createStoreAction(payload)
          : await updateStoreAction(storeId!, payload);
      if (!result.ok) {
        if (result.code === "code_unique") setError(tErr("codeUnique"));
        else if (result.code === "forbidden") setError(tErr("forbidden"));
        else if (result.code === "not_found") setError(tErr("notFound"));
        else if (result.code === "has_consignment_stock") setError(tErr("hasConsignmentStock"));
        else if (result.code === "invalid_price_discount") setError(tErr("invalidPriceDiscount"));
        else if (result.code === "konsi_discount_not_allowed") setError(tErr("discountNotAllowedForKonsi"));
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

  async function onDeactivate() {
    if (!storeId) return;
    if (!confirm(t("deactivateConfirm"))) return;
    startTransition(async () => {
      const result = await deactivateStoreAction(storeId);
      if (!result.ok) {
        setError(result.message);
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
          <h1 className="text-2xl font-bold">{tRoot(mode === "create" ? "new" : "edit")}</h1>
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
                <p className="text-xs text-muted-foreground">{t("searchNoApiKey")}</p>
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
                onValueChange={(v) => {
                  const next = v as "PUTUS" | "KONSI";
                  setForm((prev) => ({
                    ...prev,
                    termsType: next,
                    /* A discount only applies to PUTUS pricing — drop any leftover value from
                     * local state so a switch-then-save can never carry one into the writer. */
                    priceDiscountPercent: next === "PUTUS" ? prev.priceDiscountPercent : null,
                  }));
                }}
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

          <div className="grid gap-4 sm:grid-cols-2">
            {form.termsType === "PUTUS" ? (
              <div className="space-y-1.5">
                <Label htmlFor="priceDiscountPercent">{t("priceDiscountPercent")}</Label>
                <Input
                  id="priceDiscountPercent"
                  disabled={pending || readOnly}
                  type="number"
                  step="0.01"
                  value={form.priceDiscountPercent ?? ""}
                  onChange={(e) =>
                    update(
                      "priceDiscountPercent",
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground self-end pb-2">{t("priceDiscountPercentKonsiNotice")}</p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="creditLimit">{t("creditLimit")}</Label>
              <Input
                id="creditLimit"
                disabled={pending || readOnly}
                type="number"
                min={0}
                step="1000"
                value={form.creditLimit ?? ""}
                onChange={(e) =>
                  update("creditLimit", e.target.value === "" ? null : Number(e.target.value))
                }
                placeholder={t("creditLimitPlaceholder")}
              />
              <p className="text-xs text-muted-foreground">{t("creditLimitHint")}</p>
            </div>
          </div>
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
                onClick={onDeactivate}
                disabled={pending}
                className="ml-auto"
              >
                {t("deactivate")}
              </Button>
            )}
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
