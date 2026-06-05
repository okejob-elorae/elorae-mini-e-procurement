'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { DataCoverageBar } from '@/components/forecast/data-coverage-bar';
import {
  deleteSalesHistoryImport,
  getDataCoverage,
  getSalesHistoryImports,
  importSalesHistory,
  type DataCoverage,
  type SalesHistoryImportSummary,
} from '@/app/actions/forecast';

const MONTHS = [
  { value: 1, label: 'Januari' },
  { value: 2, label: 'Februari' },
  { value: 3, label: 'Maret' },
  { value: 4, label: 'April' },
  { value: 5, label: 'Mei' },
  { value: 6, label: 'Juni' },
  { value: 7, label: 'Juli' },
  { value: 8, label: 'Agustus' },
  { value: 9, label: 'September' },
  { value: 10, label: 'Oktober' },
  { value: 11, label: 'November' },
  { value: 12, label: 'Desember' },
];

function yearOptions(): number[] {
  const current = new Date().getFullYear();
  return [current - 2, current - 1, current];
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export function ForecastImportPageClient() {
  const t = useTranslations('forecast');
  const [channel, setChannel] = useState<'SHOPEE' | 'TIKTOK'>('SHOPEE');
  const [periodMonth, setPeriodMonth] = useState(String(new Date().getMonth() + 1));
  const [periodYear, setPeriodYear] = useState(String(new Date().getFullYear()));
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [imports, setImports] = useState<SalesHistoryImportSummary[]>([]);
  const [coverage, setCoverage] = useState<DataCoverage | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const historyPageSize = 10;

  const refresh = useCallback(async () => {
    const [history, cov] = await Promise.all([getSalesHistoryImports(), getDataCoverage()]);
    setImports(history);
    setCoverage(cov);
  }, []);

  useEffect(() => {
    refresh().catch((err) => toast.error(err instanceof Error ? err.message : 'Load failed'));
  }, [refresh]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(imports.length / historyPageSize));
    if (historyPage > totalPages) {
      setHistoryPage(totalPages);
    }
  }, [historyPage, imports.length]);

  const pagedImports = useMemo(() => {
    const start = (historyPage - 1) * historyPageSize;
    return imports.slice(start, start + historyPageSize);
  }, [historyPage, imports]);

  const historyTotalPages = Math.max(1, Math.ceil(imports.length / historyPageSize));

  const handleUpload = async () => {
    if (!file) {
      toast.error('Select a file');
      return;
    }
    setUploading(true);
    try {
      const base64 = await fileToBase64(file);
      const res = await importSalesHistory({
        base64,
        fileName: file.name,
        channel,
        periodMonth: Number(periodMonth),
        periodYear: Number(periodYear),
      });
      if (!res.success) {
        toast.error(res.error ?? 'Import failed');
        return;
      }
      toast.success(
        t('import.success', {
          imported: String(res.imported ?? 0),
          skipped: String(res.skipped ?? 0),
        })
      );
      setFile(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (row: SalesHistoryImportSummary) => {
    const period = `${MONTHS.find((m) => m.value === row.periodMonth)?.label ?? row.periodMonth} ${row.periodYear}`;
    if (
      !confirm(
        t('import.deleteConfirm', {
          channel: row.channel,
          period,
          count: String(row.importedRows),
        })
      )
    ) {
      return;
    }
    const res = await deleteSalesHistoryImport(row.id);
    if (!res.success) {
      toast.error(res.error ?? 'Delete failed');
      return;
    }
    toast.success('Import deleted');
    await refresh();
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/backoffice/forecast">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{t('import.title')}</h1>
          <p className="text-muted-foreground">{t('subtitle')}</p>
        </div>
      </div>

      <Card className="py-4">
        <CardHeader>
          <CardTitle>Upload</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 lg:grid-cols-12">
            <div className="grid gap-2 lg:col-span-2">
              <Label>{t('import.channel')}</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as 'SHOPEE' | 'TIKTOK')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SHOPEE">Shopee</SelectItem>
                  <SelectItem value="TIKTOK">TikTok</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2 lg:col-span-2">
              <Label>{t('import.period')} (bulan)</Label>
              <Select value={periodMonth} onValueChange={setPeriodMonth}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m) => (
                    <SelectItem key={m.value} value={String(m.value)}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2 lg:col-span-2">
              <Label>Tahun</Label>
              <Select value={periodYear} onValueChange={setPeriodYear}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions().map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2 lg:col-span-4">
              <Label>File (.xlsx)</Label>
              <Input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <div className="lg:col-span-2 flex items-end">
              <Button onClick={handleUpload} disabled={uploading || !file} className="w-full">
                {uploading ? '...' : t('import.upload')}
              </Button>
            </div>
          </div>

          {file && (
            <p className="text-xs text-muted-foreground truncate">Selected: {file.name}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('import.history')}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead>Periode</TableHead>
                <TableHead>File</TableHead>
                <TableHead className="text-right">Imported</TableHead>
                <TableHead className="text-right">Skipped</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedImports.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.channel}</TableCell>
                  <TableCell>
                    {row.periodMonth}/{row.periodYear}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">{row.fileName}</TableCell>
                  <TableCell className="text-right">{row.importedRows.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{row.skippedRows.toLocaleString()}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(row)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            page={historyPage}
            totalPages={historyTotalPages}
            onPageChange={setHistoryPage}
            totalCount={imports.length}
            pageSize={historyPageSize}
          />
        </CardContent>
      </Card>

      {coverage && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>{t('import.coverage')}</span>
              <span className="text-sm font-normal text-muted-foreground">
                {coverage.hasMinimumForSeasonal ?
                  t('import.seasonalReady')
                : t('import.seasonalNotReady')}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DataCoverageBar coverage={coverage} />
            <p className="mt-4 text-sm text-muted-foreground">
              {coverage.totalArticles} articles · {coverage.totalMonthsCovered} months covered
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
