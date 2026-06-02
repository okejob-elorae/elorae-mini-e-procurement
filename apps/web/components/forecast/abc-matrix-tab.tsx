'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ForecastResultDetail } from '@/app/actions/forecast';

const ABC_ROWS = ['A', 'B', 'C'] as const;
const XYZ_COLS = ['X', 'Y', 'Z'] as const;

function cellTone(abc: string, xyz: string): string {
  const key = `${abc}${xyz}`;
  if (['AX', 'AY', 'BX'].includes(key)) return 'bg-green-50 border-green-200 dark:bg-green-950/30';
  if (['AZ', 'BY', 'CX'].includes(key)) return 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30';
  return 'bg-red-50 border-red-200 dark:bg-red-950/30';
}

interface AbcMatrixTabProps {
  results: ForecastResultDetail[];
  onSelectArticle: (parentSku: string) => void;
}

export function ForecastAbcMatrixTab({ results, onSelectArticle }: AbcMatrixTabProps) {
  const t = useTranslations('forecast');

  const matrix = useMemo(() => {
    const map = new Map<string, ForecastResultDetail[]>();
    for (const abc of ABC_ROWS) {
      for (const xyz of XYZ_COLS) {
        map.set(`${abc}${xyz}`, []);
      }
    }
    for (const r of results) {
      const key = `${r.abcClass}${r.xyzClass}`;
      map.get(key)?.push(r);
    }
    return map;
  }, [results]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-2 text-center text-sm font-medium">
        <div />
        {XYZ_COLS.map((xyz) => (
          <div key={xyz}>
            {xyz} ({t(`xyz.${xyz}`)})
          </div>
        ))}
      </div>

      {ABC_ROWS.map((abc) => (
        <div key={abc} className="grid grid-cols-4 gap-2">
          <div className="flex items-center font-medium">
            {abc} ({t(`abc.${abc}`)})
          </div>
          {XYZ_COLS.map((xyz) => {
            const key = `${abc}${xyz}`;
            const articles = matrix.get(key) ?? [];
            return (
              <Card key={key} className={`border ${cellTone(abc, xyz)}`}>
                <CardHeader className="p-3 pb-1">
                  <CardTitle className="text-xs font-mono">{key}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {articles.length} article{articles.length !== 1 ? 's' : ''}
                  </p>
                </CardHeader>
                <CardContent className="p-3 pt-0 space-y-1">
                  {articles.slice(0, 5).map((a) => (
                    <button
                      key={a.parentSku}
                      type="button"
                      className="block w-full text-left text-xs hover:underline truncate"
                      onClick={() => onSelectArticle(a.parentSku)}
                    >
                      {a.productName}
                    </button>
                  ))}
                  {articles.length > 5 && (
                    <p className="text-xs text-muted-foreground">+{articles.length - 5} more</p>
                  )}
                  <p className="text-[10px] text-muted-foreground pt-2 border-t mt-2">
                    {t(`recommendations.${key}` as Parameters<typeof t>[0])}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ))}
    </div>
  );
}
