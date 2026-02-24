'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  getDocNumberConfigs,
  updateDocNumberConfig,
  type DocNumberConfigRow,
} from '@/app/actions/settings/doc-numbers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { DocType } from '@prisma/client';

const DOC_TYPES: DocType[] = ['PO', 'GRN', 'WO', 'ADJ', 'RET', 'ISSUE', 'RECEIPT'];

const DOC_TYPE_LABELS: Record<DocType, string> = {
  PO: 'Purchase Order',
  GRN: 'Goods Receipt',
  WO: 'Work Order',
  ADJ: 'Stock Adjustment',
  RET: 'Vendor Return',
  ISSUE: 'Material Issue',
  RECEIPT: 'FG Receipt',
};

export default function DocumentNumbersSettingsPage() {
  const t = useTranslations('documents');
  const tToasts = useTranslations('toasts');
  const { data: session, status } = useSession();
  const router = useRouter();
  const [configs, setConfigs] = useState<DocNumberConfigRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingType, setSavingType] = useState<DocType | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
      return;
    }
    getDocNumberConfigs()
      .then(setConfigs)
      .catch(() => toast.error(t('loadError')))
      .finally(() => setIsLoading(false));
  }, [status, router]);

  const [edits, setEdits] = useState<Record<string, { prefix: string; resetPeriod: string; padding: string }>>({});

  const getEdit = (docType: DocType) =>
    edits[docType] ?? {
      prefix: configs.find((c) => c.docType === docType)?.prefix ?? '',
      resetPeriod: configs.find((c) => c.docType === docType)?.resetPeriod ?? 'YEARLY',
      padding: String(configs.find((c) => c.docType === docType)?.padding ?? 4),
    };

  const setEdit = (docType: DocType, field: string, value: string) => {
    setEdits((prev) => ({
      ...prev,
      [docType]: {
        ...getEdit(docType),
        [field]: value,
      },
    }));
  };

  const handleSave = async (docType: DocType) => {
    if (!session?.user?.id) return;
    const e = getEdit(docType);
    const padding = parseInt(e.padding, 10);
    if (isNaN(padding) || padding < 1 || padding > 8) {
      toast.error(tToasts('paddingMustBe1To8'));
      return;
    }
    setSavingType(docType);
    try {
      await updateDocNumberConfig(docType, {
        prefix: e.prefix.trim() || DOC_TYPE_LABELS[docType].slice(0, 2).toUpperCase() + '/',
        resetPeriod: e.resetPeriod as 'YEARLY' | 'MONTHLY' | 'NEVER',
        padding,
      });
      toast.success(tToasts('saved'));
      const next = await getDocNumberConfigs();
      setConfigs(next);
      setEdits((prev) => {
        const u = { ...prev };
        delete u[docType];
        return u;
      });
    } catch {
      toast.error(tToasts('failedToSave'));
    } finally {
      setSavingType(null);
    }
  };

  if (status === 'loading' || isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('pageTitle')}</h1>
        <p className="text-muted-foreground">{t('pageDescription')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Config</CardTitle>
          <CardDescription>{t('tableDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('documentType')}</TableHead>
                <TableHead>{t('prefix')}</TableHead>
                <TableHead>{t('resetPeriod')}</TableHead>
                <TableHead>{t('padding')}</TableHead>
                <TableHead className="w-[100px]">Last #</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DOC_TYPES.map((docType) => {
                const c = configs.find((x) => x.docType === docType);
                const e = getEdit(docType);
                return (
                  <TableRow key={docType}>
                    <TableCell className="font-medium">
                      {DOC_TYPE_LABELS[docType]}
                    </TableCell>
                    <TableCell>
                      <Input
                        value={e.prefix}
                        onChange={(ev) => setEdit(docType, 'prefix', ev.target.value)}
                        placeholder="PO/"
                        className="max-w-[120px]"
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={e.resetPeriod}
                        onValueChange={(v) => setEdit(docType, 'resetPeriod', v)}
                      >
                        <SelectTrigger className="w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="YEARLY">Yearly</SelectItem>
                          <SelectItem value="MONTHLY">Monthly</SelectItem>
                          <SelectItem value="NEVER">Never</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={1}
                        max={8}
                        value={e.padding}
                        onChange={(ev) => setEdit(docType, 'padding', ev.target.value)}
                        className="w-20"
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {c?.lastNumber ?? '-'}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        onClick={() => handleSave(docType)}
                        disabled={savingType === docType}
                      >
                        {savingType === docType ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          t('save')
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
