'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
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
  saveJubelioPushDefaults,
  type JubelioPushDefaultsInput,
  type JubelioPushDefaultsState,
} from '@/app/actions/jubelio-push-defaults';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, RefreshCw, Cloud } from 'lucide-react';
import { toast } from 'sonner';

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export default function JubelioSettingsPage() {
  const { status } = useSession();
  const router = useRouter();
  const [tokenState, setTokenState] = useState<JubelioTokenState | null>(null);
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
  const [isSavingDefaults, setIsSavingDefaults] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
      return;
    }
    if (status !== 'authenticated') return;

    getJubelioTokenState()
      .then(setTokenState)
      .catch((err: Error) => toast.error(`Failed to load token state: ${err.message}`))
      .finally(() => setIsLoadingState(false));
  }, [status, router]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    getJubelioPushDefaults()
      .then((d) => {
        setDefaults(d);
        const { id: _id, updatedAt: _u, updatedById: _b, ...input } = d;
        void _id; void _u; void _b;
        setDefaultsDraft(input);
      })
      .catch((err: Error) => toast.error(`Failed to load defaults: ${err.message}`))
      .finally(() => setIsLoadingDefaults(false));
  }, [status]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const state = await refreshJubelioToken();
      setTokenState(state);
      toast.success('Jubelio token refreshed');
    } catch (err) {
      toast.error(`Refresh failed: ${(err as Error).message}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRequestDelete = () => {
    const n = Number(groupIdInput.trim());
    if (!Number.isFinite(n) || n <= 0) {
      toast.error('Enter a valid Jubelio item_group_id');
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
      toast.success(`Deleted group ${r.jubelioGroupId} + ${r.deletedMappings} local mapping(s)`);
      setGroupIdInput('');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSaveDefaults = async () => {
    if (!defaultsDraft) return;
    setIsSavingDefaults(true);
    try {
      const saved = await saveJubelioPushDefaults(defaultsDraft);
      setDefaults(saved);
      toast.success('Push defaults saved');
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
      const action = dryRun ? 'preview' : 'sync';
      toast.success(
        `${action}: ${created} create, ${updated} update, ${skipped} skip, ${errors} error`,
      );
    } catch (err) {
      toast.error(`Sync failed: ${(err as Error).message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <h1 className="text-2xl font-bold">Jubelio integration</h1>

      <Card>
        <CardHeader>
          <CardTitle>Session token</CardTitle>
          <CardDescription>
            Token managed by apps/api. Refresh credentials read from JUBELIO_USER / JUBELIO_PASS env.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoadingState ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading status...
            </div>
          ) : tokenState ? (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <dt className="text-muted-foreground">Has token</dt>
              <dd>{tokenState.hasToken ? 'yes' : 'no'}</dd>
              <dt className="text-muted-foreground">Last refresh</dt>
              <dd>{formatTimestamp(tokenState.updatedAt)}</dd>
              <dt className="text-muted-foreground">Expires</dt>
              <dd>{formatTimestamp(tokenState.expiresAt)}</dd>
              <dt className="text-muted-foreground">Expires in</dt>
              <dd>
                {tokenState.expiresInSeconds != null
                  ? `${Math.round(tokenState.expiresInSeconds / 60)} min`
                  : '—'}
              </dd>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No token state</p>
          )}

          <Button onClick={handleRefresh} disabled={isRefreshing} size="sm">
            {isRefreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh token now
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Catalog sync</CardTitle>
          <CardDescription>
            Pull Jubelio items, map to ERP catalog drafts, upsert Items + JubelioProductMapping.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button
              onClick={() => handleSync(true)}
              disabled={isSyncing}
              size="sm"
              variant="outline"
            >
              {isSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Cloud className="mr-2 h-4 w-4" />}
              Preview sync (dry run)
            </Button>
            <Button onClick={() => handleSync(false)} disabled={isSyncing} size="sm">
              {isSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Cloud className="mr-2 h-4 w-4" />}
              Import catalog
            </Button>
          </div>

          {lastSync && (
            <div className="rounded border p-3 text-sm space-y-2">
              <div className="font-medium">
                Last run: {lastSync.dryRun ? 'dry run' : 'applied'}
              </div>
              <dl className="grid grid-cols-4 gap-2">
                <dt className="text-muted-foreground">Created</dt>
                <dd>{lastSync.summary.created}</dd>
                <dt className="text-muted-foreground">Updated</dt>
                <dd>{lastSync.summary.updated}</dd>
                <dt className="text-muted-foreground">Skipped</dt>
                <dd>{lastSync.summary.skipped}</dd>
                <dt className="text-muted-foreground">Errors</dt>
                <dd>{lastSync.summary.errors}</dd>
              </dl>
              {lastSync.summary.warnings.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-muted-foreground">
                    {lastSync.summary.warnings.length} warning(s)
                  </summary>
                  <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground space-y-1">
                    {lastSync.summary.warnings.slice(0, 20).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                    {lastSync.summary.warnings.length > 20 && (
                      <li>…and {lastSync.summary.warnings.length - 20} more</li>
                    )}
                  </ul>
                </details>
              )}
              {lastSync.errors.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-destructive">
                    {lastSync.errors.length} error(s)
                  </summary>
                  <ul className="mt-2 list-disc pl-5 text-xs text-destructive space-y-1">
                    {lastSync.errors.map((e, i) => (
                      <li key={i}>
                        {e.parentSku ?? `group ${e.jubelioItemGroupId}`}: {e.message}
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
          <CardTitle>Push defaults</CardTitle>
          <CardDescription>
            Tax, account, brand, UOM, and package defaults applied to every product push.
            Match these to your Jubelio tenant configuration.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingDefaults || !defaultsDraft ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <NumField label="Sell Tax ID" value={defaultsDraft.sellTaxId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, sellTaxId: v ?? 0 })} />
              <NumField label="Buy Tax ID" value={defaultsDraft.buyTaxId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, buyTaxId: v ?? 0 })} />
              <NumField label="Sales Acct ID" value={defaultsDraft.salesAcctId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, salesAcctId: v ?? 0 })} />
              <NumField label="COGS Acct ID" value={defaultsDraft.cogsAcctId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, cogsAcctId: v ?? 0 })} />
              <NumField label="Inventory Acct ID" value={defaultsDraft.invtAcctId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, invtAcctId: v ?? 0 })} />
              <NumField label="Purchase Acct ID (nullable)" value={defaultsDraft.purchAcctId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, purchAcctId: v })} nullable />
              <NumField label="UOM ID" value={defaultsDraft.uomId} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, uomId: v ?? 0 })} />
              <StrField label="Brand ID (nullable)" value={defaultsDraft.brandId ?? ''} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, brandId: v || null })} />
              <StrField label="Brand Name (nullable)" value={defaultsDraft.brandName ?? ''} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, brandName: v || null })} />
              <StrField label="Sell Unit" value={defaultsDraft.sellUnit} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, sellUnit: v })} />
              <StrField label="Buy Unit" value={defaultsDraft.buyUnit} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, buyUnit: v })} />
              <NumField label="Package Weight (g)" value={defaultsDraft.packageWeight} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, packageWeight: v ?? 0 })} />
              <NumField label="Buy Price (default)" value={defaultsDraft.buyPrice} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, buyPrice: v ?? 0 })} />
              <NumField label="Re-order Point" value={defaultsDraft.rop} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, rop: v ?? 0 })} />
              <NumField label="Store Priority Treshold" value={defaultsDraft.storePriorityQtyTreshold} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, storePriorityQtyTreshold: v ?? 0 })} />
              <BoolField label="Sell This" value={defaultsDraft.sellThis} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, sellThis: v })} />
              <BoolField label="Buy This" value={defaultsDraft.buyThis} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, buyThis: v })} />
              <BoolField label="Stock This" value={defaultsDraft.stockThis} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, stockThis: v })} />
              <BoolField label="Dropship This" value={defaultsDraft.dropshipThis} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, dropshipThis: v })} />
              <BoolField label="Is Active (default)" value={defaultsDraft.isActive} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, isActive: v })} />
              <BoolField label="Use Single Image Set" value={defaultsDraft.useSingleImageSet} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, useSingleImageSet: v })} />
              <BoolField label="Use Serial Number" value={defaultsDraft.useSerialNumber} onChange={(v) => setDefaultsDraft({ ...defaultsDraft, useSerialNumber: v })} />
            </div>
          )}
        </CardContent>
        <CardContent className="flex items-center justify-between border-t pt-4">
          <p className="text-xs text-muted-foreground">
            {defaults ? `Last saved ${new Date(defaults.updatedAt).toLocaleString()}` : '—'}
          </p>
          <Button onClick={() => void handleSaveDefaults()} disabled={isSavingDefaults || !defaultsDraft}>
            {isSavingDefaults ? 'Saving…' : 'Save defaults'}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Test cleanup</CardTitle>
          <CardDescription>
            Delete a Jubelio product (whole item_group) for testing. This removes the live
            marketplace listing AND drops local JubelioProductMapping rows pointing at the group.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium">Jubelio item_group_id</label>
              <input
                type="number"
                min="1"
                value={groupIdInput}
                onChange={(e) => setGroupIdInput(e.target.value)}
                placeholder="e.g. 12345"
                className="block w-full rounded border bg-background px-3 py-2 text-sm"
                disabled={isDeleting || pendingDeleteId !== null}
              />
            </div>
            <Button
              variant="destructive"
              onClick={handleRequestDelete}
              disabled={isDeleting || pendingDeleteId !== null}
            >
              {isDeleting ? 'Deleting…' : 'Delete from Jubelio'}
            </Button>
          </div>
          {pendingDeleteId !== null && (
            <div className="rounded border border-destructive/50 bg-destructive/5 p-3 text-sm">
              <p className="mb-2 font-medium text-destructive">
                Remove group_id {pendingDeleteId} from Jubelio? This deletes the live marketplace
                listing and local mapping rows. This cannot be undone.
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" onClick={() => void handleConfirmDelete()}>
                  Yes, delete
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPendingDeleteId(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NumField({ label, value, onChange, nullable }: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  nullable?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      <input
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
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      <input
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
