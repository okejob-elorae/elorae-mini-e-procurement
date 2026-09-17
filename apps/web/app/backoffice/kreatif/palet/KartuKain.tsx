'use client';

import { useTranslations } from 'next-intl';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { WarnaPantone } from '@/lib/creative/palet/pantone';
import { hexKeHsb } from '@/lib/creative/palet/warna';
import { EditorWarna, type ModeMasukan } from './EditorWarna';

/**
 * Saklar yang membuat palet menjadi palet sablon.
 *
 * Mati: palet bebas lima warna, untuk feed atau poster. Nyala: warna kain
 * diisi di sini, dan warna palet menjadi warna sablon di atas kain itu.
 */
export function KartuKain({
  kain,
  namaKain,
  mode,
  onMode,
  onNyala,
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
  onGantiKain: (hex: string) => void;
  onSalin: (teks: string) => void;
  katalogC: readonly WarnaPantone[];
  katalogTcx: readonly WarnaPantone[];
}) {
  const t = useTranslations('creative.palette');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('fabricTitle')}</CardTitle>
        <CardDescription>{kain ? namaKain : t('fabricOffHint')}</CardDescription>
        <CardAction className="flex items-center gap-2">
          <Label htmlFor="saklar-kain" className="text-xs text-muted-foreground">
            {t('fabricToggle')}
          </Label>
          <Switch id="saklar-kain" checked={kain !== null} onCheckedChange={onNyala} />
        </CardAction>
      </CardHeader>
      {kain && (
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
