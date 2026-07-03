'use client';

import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
  const maxQty = Math.max(...monthlyForecast, 1);

  return (
    <TableRow className="bg-muted/20 hover:bg-muted/20">
      <TableCell colSpan={8} className="p-4">
        <p className="mb-3 text-xs font-medium text-muted-foreground">
          Monthly forecast — {parentSku}
        </p>
        <div className="grid grid-cols-6 gap-2 md:grid-cols-12">
          {MONTHS.map((label, i) => (
            <div key={label} className="space-y-1 text-center text-xs">
              <div className="font-medium">{label}</div>
              <div>{monthlyForecast[i]?.toLocaleString() ?? 0}</div>
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
  const maxQty = Math.max(...monthlyForecast, 1);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead className="text-right">Forecast</TableHead>
          <TableHead>Seasonal Index</TableHead>
          <TableHead className="w-[40%]">Bar</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {MONTHS.map((label, i) => (
          <TableRow key={label}>
            <TableCell>{label}</TableCell>
            <TableCell className="text-right">{monthlyForecast[i]?.toLocaleString() ?? 0}</TableCell>
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
