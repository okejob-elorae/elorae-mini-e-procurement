'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, LayoutGrid } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  UI_THEMES,
  applyUITheme,
  readStoredUITheme,
  storeUITheme,
  type UIThemeId,
} from '@/lib/theme/ui-themes';

/**
 * Each card previews its own theme rather than describing it.
 *
 * The preview is a miniature of what the theme actually does — three stacked
 * rows and a card edge, drawn with that theme's own radius, row height and
 * shadow, hardcoded per id. It cannot inherit the live tokens, because then
 * every card would look identical to whichever theme is currently on.
 */
const PREVIEW: Record<UIThemeId, { radius: string; rowH: string; gap: string; shadow: string }> = {
  padat: { radius: '3px', rowH: '7px', gap: '3px', shadow: 'none' },
  seimbang: { radius: '6px', rowH: '9px', gap: '5px', shadow: '0 1px 2px rgb(0 0 0 / 0.12)' },
  lapang: { radius: '11px', rowH: '13px', gap: '8px', shadow: '0 3px 10px -3px rgb(0 0 0 / 0.25)' },
  studio: { radius: '1px', rowH: '10px', gap: '5px', shadow: 'none' },
};

export function UIThemePicker({
  onPickAccent,
}: {
  /** Applies the theme's recommended Pantone seed through the existing picker path. */
  onPickAccent?: (seed: { tcx: string; name: string; hex: string }) => void;
}) {
  const t = useTranslations('settings.uiThemes');
  const [active, setActive] = useState<UIThemeId | null>(null);

  useEffect(() => {
    // Read after mount: localStorage is not available while rendering on the
    // server, and the init script has already painted the right theme by now.
    setActive(readStoredUITheme());
  }, []);

  const pick = (id: UIThemeId) => {
    applyUITheme(id);
    storeUITheme(id);
    setActive(id);
    const theme = UI_THEMES.find((x) => x.id === id);
    if (theme && onPickAccent) onPickAccent(theme.seed);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LayoutGrid className="h-5 w-5" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {UI_THEMES.map((theme) => {
            const p = PREVIEW[theme.id];
            const selected = active === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => pick(theme.id)}
                aria-pressed={selected}
                className={cn(
                  'flex flex-col gap-2.5 rounded-lg border p-3 text-left transition-colors',
                  selected
                    ? 'border-primary ring-1 ring-primary/40'
                    : 'border-border hover:bg-muted/60',
                )}
              >
                <span
                  className="flex flex-col justify-center border bg-muted/40 px-2"
                  style={{
                    borderRadius: p.radius,
                    boxShadow: p.shadow,
                    gap: p.gap,
                    height: '58px',
                  }}
                  aria-hidden
                >
                  {[0.9, 0.65, 0.4].map((w, i) => (
                    <span
                      key={i}
                      style={{
                        height: p.rowH,
                        width: `${w * 100}%`,
                        borderRadius: `calc(${p.radius} / 2)`,
                        backgroundColor: i === 0 ? theme.seed.hex : 'var(--muted-foreground)',
                        opacity: i === 0 ? 0.9 : 0.28,
                      }}
                    />
                  ))}
                </span>

                <span className="flex items-center gap-1.5">
                  <span className="text-sm font-medium">{t(theme.nameKey as never)}</span>
                  {selected && <Check className="h-3.5 w-3.5 text-primary" aria-hidden />}
                </span>
                <span className="text-xs leading-snug text-muted-foreground">
                  {t(theme.noteKey as never)}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {t('currentAccent', { name: theme.seed.name })}
                </span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
