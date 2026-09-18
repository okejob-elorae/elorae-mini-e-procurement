'use client';

import { useTranslations } from 'next-intl';
import { Copy, Lock, LockOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { WarnaPantone } from '@/lib/production-colors/palet/pantone';
import { hexKeHsb } from '@/lib/production-colors/palet/warna';
import { EditorWarna, type ModeMasukan } from './EditorWarna';
import { tintaDi } from './BarisSablon';

/**
 * Saklar yang membuat palet menjadi palet sablon.
 *
 * Mati: palet bebas lima warna, untuk feed atau poster. Nyala: warna kain
 * diisi di sini, dan warna palet menjadi warna sablon di atas kain itu.
 *
 * Kain bisa dikunci: ia patokan semua saran dan keterbacaan, jadi selama
 * terkunci penyuntingnya diganti tampilan baca-saja dan saklarnya dimatikan.
 */
export function KartuKain({
  kain,
  namaKain,
  mode,
  onMode,
  onNyala,
  terkunci,
  onKunci,
  onGantiKain,
  onSalin,
  katalogC,
  katalogTcx,
}: {
  kain: string | null;
  namaKain: string;
  mode: ModeMasukan;
  onMode: (mode: ModeMasukan) => void;
  onNyala: (nyala: boolean) => void;
  terkunci: boolean;
  onKunci: () => void;
  onGantiKain: (hex: string) => void;
  onSalin: (teks: string) => void;
  katalogC: readonly WarnaPantone[];
  katalogTcx: readonly WarnaPantone[];
}) {
  const t = useTranslations('productionPalette');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('fabricTitle')}</CardTitle>
        <CardDescription>{kain ? namaKain : t('fabricOffHint')}</CardDescription>
        <CardAction className="flex items-center gap-2">
          {kain && (
            <Button
              type="button"
              variant={terkunci ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={terkunci}
              title={terkunci ? t('fabricUnlock') : t('fabricLockHint')}
              onClick={onKunci}
            >
              {terkunci ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
              {terkunci ? t('fabricLockedLabel') : t('fabricLock')}
            </Button>
          )}
          <Label htmlFor="saklar-kain" className="text-xs text-muted-foreground">
            {t('fabricToggle')}
          </Label>
          <Switch id="saklar-kain" checked={kain !== null} disabled={terkunci} onCheckedChange={onNyala} />
        </CardAction>
      </CardHeader>
      {kain && terkunci && (
        <CardContent>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
            <span
              aria-hidden
              className="flex size-12 shrink-0 items-center justify-center rounded-md ring-1 ring-inset ring-black/15"
              style={{ background: kain, color: tintaDi(kain) }}
            >
              <Lock className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{namaKain}</p>
              <p className="font-mono text-xs uppercase text-muted-foreground">{kain}</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => onSalin(kain.toUpperCase())}>
              <Copy className="h-3.5 w-3.5" />
              {t('copyHex', { hex: kain.toUpperCase() })}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('fabricLockedHint')}</p>
        </CardContent>
      )}
      {kain && !terkunci && (
        <CardContent>
          <EditorWarna
            label={t('fabricLabel')}
            hex={kain}
            hsb={hexKeHsb(kain)}
            mode={mode}
            onMode={onMode}
            onGantiHex={onGantiKain}
            onSalin={onSalin}
            katalogC={katalogC}
            katalogTcx={katalogTcx}
          />
        </CardContent>
      )}
    </Card>
  );
}
