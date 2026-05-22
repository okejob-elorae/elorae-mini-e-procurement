'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import {
  getJubelioTokenState,
  refreshJubelioSessionFromEnv,
} from '@/app/actions/settings/jubelio';
import { runJubelioCatalogSync } from '@/app/actions/jubelio/catalog-sync';
import type { CatalogSyncResult } from '@/lib/jubelio/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { KeyRound, Loader2, Package } from 'lucide-react';
import { toast } from 'sonner';

const isDev = process.env.NODE_ENV === 'development';

export default function JubelioSettingsPage() {
  const t = useTranslations('settings');
  const tToasts = useTranslations('toasts');
  const { status } = useSession();
  const router = useRouter();
  const [jubelioToken, setJubelioToken] = useState<string | null>(null);
  const [jubelioTokenUpdatedAt, setJubelioTokenUpdatedAt] = useState<string | null>(null);
  const [isLoadingToken, setIsLoadingToken] = useState(true);
  const [isRefreshingSession, setIsRefreshingSession] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<CatalogSyncResult | null>(null);

  const loadTokenState = () => {
    return getJubelioTokenState()
      .then((state) => {
        setJubelioToken(state.token);
        setJubelioTokenUpdatedAt(state.updatedAt);
      })
      .catch(() => {
        toast.error(t('jubelio.loadTokenError'));
      });
  };

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
      return;
    }
    if (status !== 'authenticated') return;

    loadTokenState().finally(() => {
      setIsLoadingToken(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t from useTranslations
  }, [status, router]);

  const handleRefreshSession = async () => {
    setIsRefreshingSession(true);
    try {
      const result = await refreshJubelioSessionFromEnv();
      setJubelioToken(result.token);
      setJubelioTokenUpdatedAt(new Date().toISOString());
      toast.success(t('jubelio.refreshSuccess'));
    } catch {
      toast.error(t('jubelio.refreshFailed'));
    } finally {
      setIsRefreshingSession(false);
    }
  };

  const handleCopyToken = async () => {
    if (!jubelioToken) return;
    try {
      await navigator.clipboard.writeText(jubelioToken);
      toast.success(t('jubelio.copySuccess'));
    } catch {
      toast.error(tToasts('failed'));
    }
  };

  const runSync = async (opts: {
    dryRun: boolean;
    source: 'api' | 'snapshot';
  }) => {
    setIsSyncing(true);
    try {
      const result = await runJubelioCatalogSync({
        dryRun: opts.dryRun,
        source: opts.source,
      });
      setSyncResult(result);
      if (opts.source === 'api') {
        await loadTokenState();
      }
      toast.success(
        opts.dryRun
          ? t('jubelio.syncSummary', {
              created: result.summary.created,
              updated: result.summary.updated,
              errors: result.summary.errors,
            })
          : t('jubelio.syncSuccess')
      );
    } catch {
      toast.error(t('jubelio.syncFailed'));
    } finally {
      setIsSyncing(false);
    }
  };

  const formatTokenPreview = (token: string | null) => {
    if (!token) return t('jubelio.noTokenStored');
    if (token.length <= 12) return token;
    return `${token.slice(0, 6)}...${token.slice(-6)}`;
  };

  if (status === 'loading') {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('jubelio.title')}</h1>
        <p className="text-muted-foreground">{t('jubelio.description')}</p>
      </div>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            {t('jubelio.title')}
          </CardTitle>
          <CardDescription>{t('jubelio.sessionManagedByEnv')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border p-3">
            <p className="text-sm font-medium">{t('jubelio.tokenLabel')}</p>
            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
              {isLoadingToken ? t('jubelio.loadingToken') : formatTokenPreview(jubelioToken)}
            </p>
            {jubelioTokenUpdatedAt ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {t('jubelio.lastUpdated')}: {new Date(jubelioTokenUpdatedAt).toLocaleString()}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefreshSession}
                disabled={isRefreshingSession || isLoadingToken}
              >
                {isRefreshingSession ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t('jubelio.refreshSession')
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyToken}
                disabled={!jubelioToken || isLoadingToken}
              >
                {t('jubelio.copyToken')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="max-w-5xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            {t('jubelio.catalogSyncTitle')}
          </CardTitle>
          <CardDescription>{t('jubelio.catalogSyncDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={isSyncing}
              onClick={() => runSync({ dryRun: true, source: 'api' })}
            >
              {isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : t('jubelio.previewSync')}
            </Button>
            <Button disabled={isSyncing} onClick={() => runSync({ dryRun: false, source: 'api' })}>
              {isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : t('jubelio.importCatalog')}
            </Button>
            {isDev ? (
              <>
                <Button
                  variant="secondary"
                  disabled={isSyncing}
                  onClick={() => runSync({ dryRun: true, source: 'snapshot' })}
                >
                  {t('jubelio.previewSync')} (snapshot)
                </Button>
                <Button
                  variant="secondary"
                  disabled={isSyncing}
                  onClick={() => runSync({ dryRun: false, source: 'snapshot' })}
                >
                  {t('jubelio.importFromSnapshot')}
                </Button>
              </>
            ) : null}
          </div>

          {syncResult ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {syncResult.dryRun ? '[Dry run] ' : ''}
                {t('jubelio.syncSummary', {
                  created: syncResult.summary.created,
                  updated: syncResult.summary.updated,
                  errors: syncResult.summary.errors,
                })}
                {syncResult.summary.warnings.length > 0
                  ? ` · ${syncResult.summary.warnings.length} warning(s)`
                  : ''}
              </p>
              {syncResult.errors.length > 0 ? (
                <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm">
                  {syncResult.errors.slice(0, 5).map((err, i) => (
                    <p key={i}>
                      {err.parentSku ?? err.jubelioItemGroupId}: {err.message}
                    </p>
                  ))}
                  {syncResult.errors.length > 5 ? (
                    <p className="text-muted-foreground">+{syncResult.errors.length - 5} more</p>
                  ) : null}
                </div>
              ) : null}
              {syncResult.items.length > 0 ? (
                <div className="max-h-80 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('jubelio.colParentSku')}</TableHead>
                        <TableHead>{t('jubelio.colAction')}</TableHead>
                        <TableHead className="text-right">{t('jubelio.colVariants')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {syncResult.items.slice(0, 50).map((row) => (
                        <TableRow key={row.itemSku}>
                          <TableCell className="font-mono text-xs">
                            {row.itemSku}
                            {row.itemSku !== row.parentSku ? (
                              <span className="ml-1 text-muted-foreground">({row.parentSku})</span>
                            ) : null}
                          </TableCell>
                          <TableCell>{row.action}</TableCell>
                          <TableCell className="text-right">{row.variantCount}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {syncResult.items.length > 50 ? (
                    <p className="p-2 text-xs text-muted-foreground">
                      Showing 50 of {syncResult.items.length}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
