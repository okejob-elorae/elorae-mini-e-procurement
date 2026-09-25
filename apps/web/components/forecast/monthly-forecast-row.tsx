'use client';

import { useTranslations } from 'next-intl';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const MONTH_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

interface MonthlyForecastRowProps {
  parentSku: string;
  monthlyForecast: number[];
  seasonalIndices: number[];
}

export function MonthlyForecastRow({
  parentSku,
  monthlyForecast,
  seasonalIndices,
}: MonthlyForecastRowProps) {
  const t = useTranslations('forecast');
  const maxQty = Math.max(...monthlyForecast, 1);

  return (
    <TableRow className="bg-muted/20 hover:bg-muted/20">
      <TableCell colSpan={8} className="p-4">
        <p className="mb-3 text-xs font-medium text-muted-foreground">
          {t('monthly.title', { sku: parentSku })}
        </p>
        <div className="grid grid-cols-6 gap-2 md:grid-cols-12">
          {MONTH_NUMBERS.map((month, i) => (
            <div key={month} className="space-y-1 text-center text-xs">
              <div className="font-medium">{t(`monthsShort.${month}`)}</div>
              <div>{monthlyForecast[i]?.toLocaleString('id-ID') ?? 0}</div>
              <Progress value={((monthlyForecast[i] ?? 0) / maxQty) * 100} className="h-1" />
              <div className="text-muted-foreground">SI {(seasonalIndices[i] ?? 1).toFixed(2)}</div>
            </div>
          ))}
        </div>
      </TableCell>
    </TableRow>
  );
}

export function MonthlyForecastTable({
  monthlyForecast,
  seasonalIndices,
}: {
  monthlyForecast: number[];
  seasonalIndices: number[];
}) {
  const t = useTranslations('forecast');
  const maxQty = Math.max(...monthlyForecast, 1);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('monthly.month')}</TableHead>
          <TableHead className="text-right">{t('monthly.forecast')}</TableHead>
          <TableHead>{t('monthly.seasonalIndex')}</TableHead>
          <TableHead className="w-[40%]">{t('monthly.bar')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {MONTH_NUMBERS.map((month, i) => (
          <TableRow key={month}>
            <TableCell>{t(`monthsShort.${month}`)}</TableCell>
            <TableCell className="text-right">{monthlyForecast[i]?.toLocaleString('id-ID') ?? 0}</TableCell>
            <TableCell>{(seasonalIndices[i] ?? 1).toFixed(2)}</TableCell>
            <TableCell>
              <Progress value={((monthlyForecast[i] ?? 0) / maxQty) * 100} className="h-2" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
