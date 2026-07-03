'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  const [openCell, setOpenCell] = useState<string | null>(null);

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

  const modalArticles = openCell ? (matrix.get(openCell) ?? []) : [];
  const modalAbc = openCell?.[0] ?? '';
  const modalXyz = openCell?.[1] ?? '';

  const handleSelectArticle = (parentSku: string) => {
    setOpenCell(null);
    onSelectArticle(parentSku);
  };

  return (
    <>
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
                <Card
                  key={key}
                  role="button"
                  tabIndex={0}
                  className={`cursor-pointer border transition-colors hover:opacity-90 ${cellTone(abc, xyz)}`}
                  onClick={() => setOpenCell(key)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setOpenCell(key);
                    }
                  }}
                >
                  <CardHeader className="p-3 pb-1">
                    <CardTitle className="text-xs font-mono">{key}</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {articles.length} article{articles.length !== 1 ? 's' : ''}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-1 p-3 pt-0">
                    {articles.slice(0, 5).map((a) => (
                      <p key={a.parentSku} className="truncate text-xs">
                        {a.productName}
                      </p>
                    ))}
                    {articles.length > 5 && (
                      <p className="text-xs text-muted-foreground">+{articles.length - 5} more</p>
                    )}
                    <p className="mt-2 border-t pt-2 text-[10px] text-muted-foreground">
                      {t(`recommendations.${key}` as Parameters<typeof t>[0])}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ))}
      </div>

      <Dialog open={openCell != null} onOpenChange={(open) => !open && setOpenCell(null)}>
        <DialogContent className="inset-0 flex h-screen w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-4 rounded-none border-0 p-6 sm:max-w-none">
          <DialogHeader className="shrink-0">
            <DialogTitle>
              {openCell ?
                t('matrixModal.title', {
                  key: openCell,
                  abc: t(`abc.${modalAbc}` as Parameters<typeof t>[0]),
                  xyz: t(`xyz.${modalXyz}` as Parameters<typeof t>[0]),
                })
              : ''}
            </DialogTitle>
            <DialogDescription>
              {openCell ?
                t('matrixModal.articleCount', { count: modalArticles.length })
              : ''}
              {openCell && (
                <span className="mt-1 block text-foreground/80">
                  {t(`recommendations.${openCell}` as Parameters<typeof t>[0])}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {modalArticles.length === 0 ?
            <p className="py-6 text-center text-sm text-muted-foreground">{t('matrixModal.empty')}</p>
          : <div className="min-h-0 flex-1 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>{t('matrixModal.parentSku')}</TableHead>
                    <TableHead>{t('matrixModal.product')}</TableHead>
                    <TableHead className="text-right">{t('matrixModal.avgMonthly')}</TableHead>
                    <TableHead className="text-right">{t('matrixModal.annual')}</TableHead>
                    <TableHead className="text-right">{t('matrixModal.planTarget')}</TableHead>
                    <TableHead className="text-right">{t('matrixModal.cv')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {modalArticles.map((article, idx) => (
                    <TableRow
                      key={article.id}
                      className="cursor-pointer"
                      onClick={() => handleSelectArticle(article.parentSku)}
                    >
                      <TableCell>{idx + 1}</TableCell>
                      <TableCell className="font-mono text-sm">{article.parentSku}</TableCell>
                      <TableCell>{article.productName}</TableCell>
                      <TableCell className="text-right">
                        {Math.round(article.avgMonthlyDemand).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {article.annualForecast.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {article.planTarget != null ?
                          article.planTarget.toLocaleString()
                        : t('results.noPlan')}
                      </TableCell>
                      <TableCell className="text-right">
                        {article.coefficientOfVariation.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          }
        </DialogContent>
      </Dialog>
    </>
  );
}
