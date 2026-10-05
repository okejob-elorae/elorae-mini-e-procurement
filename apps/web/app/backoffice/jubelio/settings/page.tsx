'use client';

import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useLocale, useTranslations } from 'next-intl';
import {
  getJubelioTokenState,
  refreshJubelioToken,
  syncJubelioCatalog,
  type JubelioCatalogSyncResult,
  type JubelioTokenState,
} from '@/app/actions/settings/jubelio';
import { deleteJubelioProduct } from '@/app/actions/jubelio-catalog-cleanup';
import {
  getJubelioPushDefaults,
  getMarginFallbackItemCount,
  saveJubelioPushDefaults,
  type JubelioPushDefaultsInput,
  type JubelioPushDefaultsState,
} from '@/app/actions/jubelio-push-defaults';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, Loader2, RefreshCw, Cloud } from 'lucide-react';
import { toast } from 'sonner';
import { formatDisplayDateTime } from '@/lib/date-only';
import { TombolBantuan } from '@/components/bantuan/TombolBantuan';

export default function JubelioSettingsPage() {
  const t = useTranslations('jubelio.settings');
  const locale = useLocale();
  const { status } = useSession();
  const router = useRouter();
  const [tokenState, setTokenState] = useState<JubelioTokenState | null>(null);
  const [tokenLoadFailed, setTokenLoadFailed] = useState(false);
  const [isLoadingState, setIsLoadingState] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<JubelioCatalogSyncResult | null>(null);
  const [groupIdInput, setGroupIdInput] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [defaults, setDefaults] = useState<JubelioPushDefaultsState | null>(null);
  const [defaultsDraft, setDefaultsDraft] = useState<JubelioPushDefaultsInput | null>(null);
  const [isLoadingDefaults, setIsLoadingDefaults] = useState(true);
  // Kept apart from "still loading": a failed load used to leave defaultsDraft
  // null, and the card read that as loading and spun forever.
  const [defaultsLoadError, setDefaultsLoadError] = useState<string | null>(null);
  const [isSavingDefaults, setIsSavingDefaults] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
      return;
    }
    if (status !== 'authenticated') return;

    getJubelioTokenState()
      .then((state) => {
        setTokenState(state);
        setTokenLoadFailed(false);
      })
      .catch((err: Error) => {
        setTokenLoadFailed(true);
        toast.error(t('token.loadFailedToast', { message: err.message }));
      })
      .finally(() => setIsLoadingState(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t from useTranslations
  }, [status, router]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    getJubelioPushDefaults()
      .then((d) => {
        setDefaults(d);
        const { id: _id, updatedAt: _u, updatedById: _b, ...input } = d;
        void _id; void _u; void _b;
        setDefaultsDraft(input);
        setDefaultsLoadError(null);
      })
      .catch((err: Error) => {
        setDefaultsLoadError(err.message || '');
        toast.error(t('defaults.loadFailedToast', { message: err.message }));
      })
      .finally(() => setIsLoadingDefaults(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t from useTranslations
  }, [status]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const state = await refreshJubelioToken();
      setTokenState(state);
      setTokenLoadFailed(false);
      toast.success(t('token.refreshed'));
    } catch (err) {
      toast.error(t('token.refreshFailed', { message: (err as Error).message }));
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRequestDelete = () => {
    const n = Number(groupIdInput.trim());
    if (!Number.isFinite(n) || n <= 0) {
      toast.error(t('cleanup.invalidId'));
      return;
    }
    setPendingDeleteId(n);
  };

  const handleConfirmDelete = async () => {
    if (pendingDeleteId === null) return;
    setIsDeleting(true);
    setPendingDeleteId(null);
    try {
      const r = await deleteJubelioProduct(pendingDeleteId);
      toast.success(t('cleanup.deleted', { id: r.jubelioGroupId, count: r.deletedMappings }));
      setGroupIdInput('');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSaveDefaults = async () => {
    if (!defaultsDraft) return;

    const marginDiff =
      (defaults?.defaultMarginPercent ?? null) !== (defaultsDraft.defaultMarginPercent ?? null);
    const extrasDiff =
      (defaults?.defaultAdditionalCost ?? null) !== (defaultsDraft.defaultAdditionalCost ?? null);

    if (marginDiff || extrasDiff) {
      try {
        const count = await getMarginFallbackItemCount();
        const confirmText =
          count > 500
            ? t('defaults.confirmLarge', { count })
            : t('defaults.confirm', { count });
        if (!confirm(confirmText)) return;
      } catch (err) {
        toast.error(t('defaults.countFailed', { message: (err as Error).message }));
        return;
      }
    }

    setIsSavingDefaults(true);
    try {
      const saved = await saveJubelioPushDefaults(defaultsDraft);
      setDefaults(saved);
      toast.success(t('defaults.saved', { count: saved.fanOutCount }));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsSavingDefaults(false);
    }
  };

  const handleSync = async (dryRun: boolean) => {
    setIsSyncing(true);
    try {
      const result = await syncJubelioCatalog({ dryRun });
      setLastSync(result);
      const { created, updated, skipped, errors } = result.summary;
      toast.success(
        t(dryRun ? 'catalog.toastPreview' : 'catalog.toastSync', { created, updated, skipped, errors }),
      );
    } catch (err) {
      toast.error(t('catalog.syncFailed', { message: (err as Error).message }));
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <TombolBantuan judul={t('title')} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('token.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoadingState ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('token.loading')}
            </div>
          ) : tokenState ? (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <dt className="text-muted-foreground">{t('token.hasToken')}</dt>
              <dd>{tokenState.hasToken ? t('token.yes') : t('token.no')}</dd>
              <dt className="text-muted-foreground">{t('token.lastRefresh')}</dt>
              <dd>{formatDisplayDateTime(tokenState.updatedAt, locale)}</dd>
              <dt className="text-muted-foreground">{t('token.expires')}</dt>
              <dd>{formatDisplayDateTime(tokenState.expiresAt, locale)}</dd>
              <dt className="text-muted-foreground">{t('token.expiresIn')}</dt>
              <dd>
                {tokenState.expiresInSeconds != null
                  ? t('token.minutes', { count: Math.round(tokenState.expiresInSeconds / 60) })
                  : '—'}
              </dd>
            </dl>
          ) : tokenLoadFailed ? (
            <p className="text-sm text-destructive">{t('token.loadError')}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{t('token.none')}</p>
          )}

          <Button onClick={handleRefresh} disabled={isRefreshing} size="sm">
            {isRefreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {t('token.refresh')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('catalog.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => handleSync(true)}
              disabled={isSyncing}
              size="sm"
              variant="outline"
            >
              {isSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Cloud className="mr-2 h-4 w-4" />}
              {t('catalog.preview')}
            </Button>
            <Button onClick={() => handleSync(false)} disabled={isSyncing} size="sm">
              {isSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Cloud className="mr-2 h-4 w-4" />}
              {t('catalog.import')}
            </Button>
          </div>

          {lastSync && (
            <div className="rounded border p-3 text-sm space-y-2">
              <div className="font-medium">
                {t('catalog.lastRun', {
                  mode: lastSync.dryRun ? t('catalog.modeDryRun') : t('catalog.modeApplied'),
                })}
              </div>
              <dl className="grid grid-cols-4 gap-2">
                <dt className="text-muted-foreground">{t('catalog.created')}</dt>
                <dd>{lastSync.summary.created}</dd>
                <dt className="text-muted-foreground">{t('catalog.updated')}</dt>
                <dd>{lastSync.summary.updated}</dd>
                <dt className="text-muted-foreground">{t('catalog.skipped')}</dt>
                <dd>{lastSync.summary.skipped}</dd>
                <dt className="text-muted-foreground">{t('catalog.errors')}</dt>
                <dd>{lastSync.summary.errors}</dd>
              </dl>
              {lastSync.summary.warnings.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-muted-foreground">
                    {t('catalog.warnings', { count: lastSync.summary.warnings.length })}
                  </summary>
                  <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground space-y-1">
                    {lastSync.summary.warnings.slice(0, 20).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                    {lastSync.summary.warnings.length > 20 && (
                      <li>{t('catalog.moreWarnings', { count: lastSync.summary.warnings.length - 20 })}</li>
                    )}
                  </ul>
                </details>
              )}
              {lastSync.errors.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-destructive">
                    {t('catalog.errorCount', { count: lastSync.errors.length })}
                  </summary>
                  <ul className="mt-2 list-disc pl-5 text-xs text-destructive space-y-1">
                    {lastSync.errors.map((e, i) => (
                      <li key={i}>
                        {e.parentSku ?? t('catalog.group', { id: String(e.jubelioItemGroupId) })}: {e.message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('defaults.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoadingDefaults ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : !defaultsDraft ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="min-w-0 space-y-1">
                <p>{t('defaults.loadError')}</p>
                {defaultsLoadError && (
                  <p className="break-words font-mono text-xs text-muted-foreground">{defaultsLoadError}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <NumField label={t('defaults.field.sellTaxId')} value={defaultsDraft.sellTaxId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, sellTaxId: v ?? 0 })} />
              <NumField label={t('defaults.field.buyTaxId')} value={defaultsDraft.buyTaxId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, buyTaxId: v ?? 0 })} />
              <NumField label={t('defaults.field.salesAcctId')} value={defaultsDraft.salesAcctId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, salesAcctId: v ?? 0 })} />
              <NumField label={t('defaults.field.cogsAcctId')} value={defaultsDraft.cogsAcctId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, cogsAcctId: v ?? 0 })} />
              <NumField label={t('defaults.field.invtAcctId')} value={defaultsDraft.invtAcctId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, invtAcctId: v ?? 0 })} />
              <NumField label={t('defaults.field.purchAcctId')} value={defaultsDraft.purchAcctId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, purchAcctId: v })} nullable />
              <NumField label={t('defaults.field.uomId')} value={defaultsDraft.uomId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, uomId: v ?? 0 })} />
              <StrField label={t('defaults.field.brandId')} value={defaultsDraft.brandId ?? ''} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, brandId: v || null })} />
              <StrField label={t('defaults.field.brandName')} value={defaultsDraft.brandName ?? ''} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, brandName: v || null })} />
              <StrField label={t('defaults.field.sellUnit')} value={defaultsDraft.sellUnit} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, sellUnit: v })} />
              <StrField label={t('defaults.field.buyUnit')} value={defaultsDraft.buyUnit} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, buyUnit: v })} />
              <NumField label={t('defaults.field.packageWeight')} value={defaultsDraft.packageWeight} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, packageWeight: v ?? 0 })} />
              <NumField label={t('defaults.field.buyPrice')} value={defaultsDraft.buyPrice} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, buyPrice: v ?? 0 })} />
              <NumField label={t('defaults.field.defaultMarginPercent')} value={defaultsDraft.defaultMarginPercent} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, defaultMarginPercent: v ?? null })} nullable />
              <NumField label={t('defaults.field.defaultAdditionalCost')} value={defaultsDraft.defaultAdditionalCost} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, defaultAdditionalCost: v ?? null })} nullable />
              <NumField label={t('defaults.field.rop')} value={defaultsDraft.rop} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, rop: v ?? 0 })} />
              <NumField label={t('defaults.field.storePriorityQtyTreshold')} value={defaultsDraft.storePriorityQtyTreshold} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, storePriorityQtyTreshold: v ?? 0 })} />
              <BoolField label={t('defaults.field.sellThis')} value={defaultsDraft.sellThis} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, sellThis: v })} />
              <BoolField label={t('defaults.field.buyThis')} value={defaultsDraft.buyThis} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, buyThis: v })} />
              <BoolField label={t('defaults.field.stockThis')} value={defaultsDraft.stockThis} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, stockThis: v })} />
              <BoolField label={t('defaults.field.dropshipThis')} value={defaultsDraft.dropshipThis} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, dropshipThis: v })} />
              <BoolField label={t('defaults.field.isActive')} value={defaultsDraft.isActive} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, isActive: v })} />
              <BoolField label={t('defaults.field.useSingleImageSet')} value={defaultsDraft.useSingleImageSet} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, useSingleImageSet: v })} />
              <BoolField label={t('defaults.field.useSerialNumber')} value={defaultsDraft.useSerialNumber} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, useSerialNumber: v })} />
            </div>
          )}
        </CardContent>
        <CardContent className="flex items-center justify-between border-t pt-4">
          <p className="text-xs text-muted-foreground">
            {defaults ? t('defaults.lastSaved', { when: formatDisplayDateTime(defaults.updatedAt, locale) }) : '—'}
          </p>
          <Button onClick={() => void handleSaveDefaults()} disabled={isSavingDefaults || !defaultsDraft}>
            {isSavingDefaults ? t('defaults.saving') : t('defaults.save')}
          </Button>
        </CardContent>
      </Card>

      <section className="space-y-3 border-t border-destructive/30 pt-6" aria-labelledby="jubelio-danger-zone">
        <div>
          <h2 id="jubelio-danger-zone" className="flex items-center gap-2 text-lg font-semibold text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {t('danger.heading')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('danger.warning')}</p>
        </div>
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>{t('cleanup.title')}</CardTitle>
            <CardDescription>{t('cleanup.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[200px] flex-1">
                <label htmlFor="jubelio-cleanup-group-id" className="mb-1 block text-sm font-medium">{t('cleanup.groupIdLabel')}</label>
                <input
                  id="jubelio-cleanup-group-id"
                  type="number"
                  min="1"
                  value={groupIdInput}
                  onChange={(e) => setGroupIdInput(e.target.value)}
                  placeholder={t('cleanup.placeholder')}
                  className="block w-full rounded border bg-background px-3 py-2 text-sm"
                  disabled={isDeleting || pendingDeleteId !== null}
                />
              </div>
              <Button
                variant="destructive"
                onClick={handleRequestDelete}
                disabled={isDeleting || pendingDeleteId !== null}
              >
                {isDeleting ? t('cleanup.deleting') : t('cleanup.delete')}
              </Button>
            </div>
            {pendingDeleteId !== null && (
              <div className="rounded border border-destructive/50 bg-destructive/5 p-3 text-sm">
                <p className="mb-2 font-medium text-destructive">
                  {t('cleanup.confirm', { id: String(pendingDeleteId) })}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" onClick={() => void handleConfirmDelete()}>
                    {t('cleanup.yes')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setPendingDeleteId(null)}>
                    {t('cleanup.cancel')}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
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
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      <input
        id={id}
        type="number"
        value={value ?? ''}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') { if (nullable) onChange(null); else onChange(0); return; }
          const n = Number(raw);
          onChange(Number.isFinite(n) ? n : 0);
        }}
        className="block w-full rounded border bg-background px-3 py-2 text-sm"
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
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full rounded border bg-background px-3 py-2 text-sm"
      />
    </div>
  );
}

function BoolField({ label, value, onChange }: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
