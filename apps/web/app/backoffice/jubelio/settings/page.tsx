"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import {
  getJubelioTokenState,
  refreshJubelioToken,
  syncJubelioCatalog,
  type JubelioCatalogSyncResult,
  type JubelioTokenState,
} from "@/app/actions/settings/jubelio";
import { deleteJubelioProduct } from "@/app/actions/jubelio-catalog-cleanup";
import {
  getJubelioPushDefaults,
  getMarginFallbackItemCount,
  saveJubelioPushDefaults,
  type JubelioPushDefaultsInput,
  type JubelioPushDefaultsState,
} from "@/app/actions/jubelio-push-defaults";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
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
import { AlertTriangle, Loader2, RefreshCw, Cloud } from "lucide-react";
import { toast } from "sonner";
import { formatDisplayDateTime } from "@/lib/date-only";
import type { GagalJubelio } from "../galat-jubelio";
import { RincianGalat, usePesanGalatJubelio } from "../RincianGalat";

export default function JubelioSettingsPage() {
  const t = useTranslations("jubelio.settings");
  const pesanGalat = usePesanGalatJubelio();
  const locale = useLocale();
  const { status } = useSession();
  const router = useRouter();
  const [tokenState, setTokenState] = useState<JubelioTokenState | null>(null);
  // Galat muat tampil di kartunya sendiri, bukan toast (dulu toast bertumpuk tiap render ulang).
  const [tokenGagal, setTokenGagal] = useState<GagalJubelio | null>(null);
  const [isLoadingState, setIsLoadingState] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<JubelioCatalogSyncResult | null>(null);
  const [syncGagal, setSyncGagal] = useState<GagalJubelio | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [groupIdInput, setGroupIdInput] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [defaults, setDefaults] = useState<JubelioPushDefaultsState | null>(null);
  const [defaultsDraft, setDefaultsDraft] = useState<JubelioPushDefaultsInput | null>(null);
  const [isLoadingDefaults, setIsLoadingDefaults] = useState(true);
  const [defaultsGagal, setDefaultsGagal] = useState<GagalJubelio | null>(null);
  const [isSavingDefaults, setIsSavingDefaults] = useState(false);
  // Jumlah barang yang akan dihitung ulang; tidak null = dialog konfirmasi terbuka.
  const [fanOutCount, setFanOutCount] = useState<number | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }
    if (status !== "authenticated") return;

    let batal = false;
    void getJubelioTokenState()
      .then((r) => {
        if (batal) return;
        if (r.ok) {
          setTokenState(r.data);
          setTokenGagal(null);
        } else {
          setTokenGagal(r);
        }
      })
      .finally(() => {
        if (!batal) setIsLoadingState(false);
      });
    return () => {
      batal = true;
    };
  }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated") return;
    let batal = false;
    void getJubelioPushDefaults()
      .then((r) => {
        if (batal) return;
        if (!r.ok) {
          setDefaultsGagal(r);
          return;
        }
        setDefaults(r.data);
        const { id: _id, updatedAt: _u, updatedById: _b, ...input } = r.data;
        void _id; void _u; void _b;
        setDefaultsDraft(input);
        setDefaultsGagal(null);
      })
      .finally(() => {
        if (!batal) setIsLoadingDefaults(false);
      });
    return () => {
      batal = true;
    };
  }, [status]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const r = await refreshJubelioToken();
      if (r.ok) {
        setTokenState(r.data);
        setTokenGagal(null);
        toast.success(t("token.refreshed"));
      } else {
        toast.error(pesanGalat(r));
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRequestDelete = () => {
    const n = Number(groupIdInput.trim());
    if (!Number.isInteger(n) || n <= 0) {
      toast.error(t("cleanup.invalidId"));
      return;
    }
    setPendingDeleteId(n);
  };

  const handleConfirmDelete = async () => {
    if (pendingDeleteId === null) return;
    const id = pendingDeleteId;
    setIsDeleting(true);
    setPendingDeleteId(null);
    try {
      const r = await deleteJubelioProduct(id);
      if (r.ok) {
        toast.success(t("cleanup.deleted", { id: r.data.jubelioGroupId, count: r.data.deletedMappings }));
        setGroupIdInput("");
      } else {
        toast.error(pesanGalat(r));
      }
    } finally {
      setIsDeleting(false);
    }
  };

  const simpanBawaan = async () => {
    if (!defaultsDraft) return;
    setFanOutCount(null);
    setIsSavingDefaults(true);
    try {
      const r = await saveJubelioPushDefaults(defaultsDraft);
      if (r.ok) {
        setDefaults(r.data);
        toast.success(t("defaults.saved", { count: r.data.fanOutCount }));
      } else {
        toast.error(pesanGalat(r));
      }
    } finally {
      setIsSavingDefaults(false);
    }
  };

  const handleSaveDefaults = async () => {
    if (!defaultsDraft) return;

    const marginDiff =
      (defaults?.defaultMarginPercent ?? null) !== (defaultsDraft.defaultMarginPercent ?? null);
    const extrasDiff =
      (defaults?.defaultAdditionalCost ?? null) !== (defaultsDraft.defaultAdditionalCost ?? null);

    if (!marginDiff && !extrasDiff) {
      await simpanBawaan();
      return;
    }
    // Margin/biaya berubah → harga barang dihitung ulang; minta konfirmasi dengan jumlahnya.
    const r = await getMarginFallbackItemCount();
    if (!r.ok) {
      toast.error(pesanGalat(r));
      return;
    }
    setFanOutCount(r.data);
  };

  const handleSync = async (dryRun: boolean) => {
    setImportOpen(false);
    setIsSyncing(true);
    try {
      const r = await syncJubelioCatalog({ dryRun });
      if (!r.ok) {
        setSyncGagal(r);
        toast.error(pesanGalat(r));
        return;
      }
      setSyncGagal(null);
      setLastSync(r.data);
      const { created, updated, skipped, errors } = r.data.summary;
      toast.success(
        t(dryRun ? "catalog.toastPreview" : "catalog.toastSync", { created, updated, skipped, errors }),
      );
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("token.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoadingState ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("token.loading")}
              </div>
            ) : tokenState ? (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <dt className="text-muted-foreground">{t("token.hasToken")}</dt>
                <dd>{tokenState.hasToken ? t("token.yes") : t("token.no")}</dd>
                <dt className="text-muted-foreground">{t("token.lastRefresh")}</dt>
                <dd>{formatDisplayDateTime(tokenState.updatedAt, locale)}</dd>
                <dt className="text-muted-foreground">{t("token.expires")}</dt>
                <dd>{formatDisplayDateTime(tokenState.expiresAt, locale)}</dd>
                <dt className="text-muted-foreground">{t("token.expiresIn")}</dt>
                <dd>
                  {tokenState.expiresInSeconds != null
                    ? t("token.minutes", { count: Math.round(tokenState.expiresInSeconds / 60) })
                    : "—"}
                </dd>
              </dl>
            ) : tokenGagal ? (
              <RincianGalat gagal={tokenGagal} />
            ) : (
              <p className="text-sm text-muted-foreground">{t("token.none")}</p>
            )}

            <Button onClick={() => void handleRefresh()} disabled={isRefreshing} size="sm">
              {isRefreshing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {t("token.refresh")}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("catalog.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void handleSync(true)}
                disabled={isSyncing}
                size="sm"
                variant="outline"
              >
                {isSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Cloud className="mr-2 h-4 w-4" />}
                {t("catalog.preview")}
              </Button>
              <Button onClick={() => setImportOpen(true)} disabled={isSyncing} size="sm">
                {isSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Cloud className="mr-2 h-4 w-4" />}
                {t("catalog.import")}
              </Button>
            </div>

            {syncGagal && <RincianGalat gagal={syncGagal} />}

            {lastSync && (
              <div className="space-y-2 rounded border p-3 text-sm">
                <div className="font-medium">
                  {t("catalog.lastRun", {
                    mode: lastSync.dryRun ? t("catalog.modeDryRun") : t("catalog.modeApplied"),
                  })}
                </div>
                <dl className="grid grid-cols-4 gap-2">
                  <dt className="text-muted-foreground">{t("catalog.created")}</dt>
                  <dd>{lastSync.summary.created}</dd>
                  <dt className="text-muted-foreground">{t("catalog.updated")}</dt>
                  <dd>{lastSync.summary.updated}</dd>
                  <dt className="text-muted-foreground">{t("catalog.skipped")}</dt>
                  <dd>{lastSync.summary.skipped}</dd>
                  <dt className="text-muted-foreground">{t("catalog.errors")}</dt>
                  <dd>{lastSync.summary.errors}</dd>
                </dl>
                {lastSync.summary.warnings.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-muted-foreground">
                      {t("catalog.warnings", { count: lastSync.summary.warnings.length })}
                    </summary>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                      {lastSync.summary.warnings.slice(0, 20).map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                      {lastSync.summary.warnings.length > 20 && (
                        <li>{t("catalog.moreWarnings", { count: lastSync.summary.warnings.length - 20 })}</li>
                      )}
                    </ul>
                  </details>
                )}
                {lastSync.errors.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-destructive">
                      {t("catalog.errorCount", { count: lastSync.errors.length })}
                    </summary>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-destructive">
                      {lastSync.errors.map((e, i) => (
                        <li key={i}>
                          {e.parentSku ?? t("catalog.group", { id: String(e.jubelioItemGroupId) })}: {e.message}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("defaults.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoadingDefaults ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : !defaultsDraft ? (
            defaultsGagal ? (
              <RincianGalat gagal={defaultsGagal} />
            ) : (
              <p className="text-sm text-muted-foreground">{t("defaults.loadError")}</p>
            )
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <NumField label={t("defaults.field.sellTaxId")} value={defaultsDraft.sellTaxId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, sellTaxId: v ?? 0 })} />
              <NumField label={t("defaults.field.buyTaxId")} value={defaultsDraft.buyTaxId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, buyTaxId: v ?? 0 })} />
              <NumField label={t("defaults.field.salesAcctId")} value={defaultsDraft.salesAcctId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, salesAcctId: v ?? 0 })} />
              <NumField label={t("defaults.field.cogsAcctId")} value={defaultsDraft.cogsAcctId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, cogsAcctId: v ?? 0 })} />
              <NumField label={t("defaults.field.invtAcctId")} value={defaultsDraft.invtAcctId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, invtAcctId: v ?? 0 })} />
              <NumField label={t("defaults.field.purchAcctId")} value={defaultsDraft.purchAcctId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, purchAcctId: v })} nullable />
              <NumField label={t("defaults.field.uomId")} value={defaultsDraft.uomId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, uomId: v ?? 0 })} />
              <StrField label={t("defaults.field.brandId")} value={defaultsDraft.brandId ?? ""} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, brandId: v || null })} />
              <StrField label={t("defaults.field.brandName")} value={defaultsDraft.brandName ?? ""} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, brandName: v || null })} />
              <StrField label={t("defaults.field.sellUnit")} value={defaultsDraft.sellUnit} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, sellUnit: v })} />
              <StrField label={t("defaults.field.buyUnit")} value={defaultsDraft.buyUnit} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, buyUnit: v })} />
              <NumField label={t("defaults.field.packageWeight")} value={defaultsDraft.packageWeight} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, packageWeight: v ?? 0 })} />
              <NumField label={t("defaults.field.buyPrice")} value={defaultsDraft.buyPrice} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, buyPrice: v ?? 0 })} />
              <NumField label={t("defaults.field.defaultMarginPercent")} value={defaultsDraft.defaultMarginPercent} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, defaultMarginPercent: v ?? null })} nullable />
              <NumField label={t("defaults.field.defaultAdditionalCost")} value={defaultsDraft.defaultAdditionalCost} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, defaultAdditionalCost: v ?? null })} nullable />
              <NumField label={t("defaults.field.rop")} value={defaultsDraft.rop} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, rop: v ?? 0 })} />
              <NumField label={t("defaults.field.storePriorityQtyTreshold")} value={defaultsDraft.storePriorityQtyTreshold} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, storePriorityQtyTreshold: v ?? 0 })} />
              <BoolField label={t("defaults.field.sellThis")} value={defaultsDraft.sellThis} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, sellThis: v })} />
              <BoolField label={t("defaults.field.buyThis")} value={defaultsDraft.buyThis} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, buyThis: v })} />
              <BoolField label={t("defaults.field.stockThis")} value={defaultsDraft.stockThis} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, stockThis: v })} />
              <BoolField label={t("defaults.field.dropshipThis")} value={defaultsDraft.dropshipThis} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, dropshipThis: v })} />
              <BoolField label={t("defaults.field.isActive")} value={defaultsDraft.isActive} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, isActive: v })} />
              <BoolField label={t("defaults.field.useSingleImageSet")} value={defaultsDraft.useSingleImageSet} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, useSingleImageSet: v })} />
              <BoolField label={t("defaults.field.useSerialNumber")} value={defaultsDraft.useSerialNumber} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, useSerialNumber: v })} />
            </div>
          )}
        </CardContent>
        <CardContent className="flex items-center justify-between border-t pt-4">
          <p className="text-xs text-muted-foreground">
            {defaults ? t("defaults.lastSaved", { when: formatDisplayDateTime(defaults.updatedAt, locale) }) : "—"}
          </p>
          <Button onClick={() => void handleSaveDefaults()} disabled={isSavingDefaults || !defaultsDraft}>
            {isSavingDefaults ? t("defaults.saving") : t("defaults.save")}
          </Button>
        </CardContent>
      </Card>

      <section className="space-y-3 border-t border-destructive/30 pt-6" aria-labelledby="jubelio-danger-zone">
        <div>
          <h2 id="jubelio-danger-zone" className="flex items-center gap-2 text-lg font-semibold text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {t("danger.heading")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("danger.warning")}</p>
        </div>
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>{t("cleanup.title")}</CardTitle>
            <CardDescription>{t("cleanup.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[200px] max-w-sm flex-1 space-y-1">
                <Label htmlFor="jubelio-cleanup-group-id">{t("cleanup.groupIdLabel")}</Label>
                <Input
                  id="jubelio-cleanup-group-id"
                  type="number"
                  min="1"
                  value={groupIdInput}
                  onChange={(e) => setGroupIdInput(e.target.value)}
                  placeholder={t("cleanup.placeholder")}
                  disabled={isDeleting}
                />
              </div>
              <Button variant="destructive" onClick={handleRequestDelete} disabled={isDeleting}>
                {isDeleting ? t("cleanup.deleting") : t("cleanup.delete")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <AlertDialog open={importOpen} onOpenChange={setImportOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("catalog.importConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("catalog.importConfirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cleanup.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(ev) => {
                ev.preventDefault();
                void handleSync(false);
              }}
            >
              {t("catalog.importConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={fanOutCount !== null}
        onOpenChange={(open) => {
          if (!open) setFanOutCount(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("defaults.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {fanOutCount !== null && fanOutCount > 500
                ? t("defaults.confirmLarge", { count: fanOutCount })
                : t("defaults.confirm", { count: fanOutCount ?? 0 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cleanup.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(ev) => {
                ev.preventDefault();
                void simpanBawaan();
              }}
            >
              {t("defaults.confirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cleanup.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("cleanup.confirm", { id: String(pendingDeleteId ?? "") })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cleanup.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(ev) => {
                ev.preventDefault();
                void handleConfirmDelete();
              }}
            >
              {t("cleanup.yes")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function NumField({ label, value, onChange, nullable }: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  nullable?: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        value={value ?? ""}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") { if (nullable) onChange(null); else onChange(0); return; }
          const n = Number(raw);
          onChange(Number.isFinite(n) ? n : 0);
        }}
      />
    </div>
  );
}

function StrField({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function BoolField({ label, value, onChange }: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2 self-end pb-2">
      <Checkbox id={id} checked={value} onCheckedChange={(v) => onChange(v === true)} />
      <Label htmlFor={id} className="font-medium">{label}</Label>
    </div>
  );
}
