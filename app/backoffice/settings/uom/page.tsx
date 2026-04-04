'use client';

import { useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useLocale, useTranslations } from 'next-intl';
import {
  createUOM,
  updateUOM,
  getUOMs,
  createUOMConversion,
  deleteUOMConversion,
  getUOMConversions,
} from '@/app/actions/uom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const uomSchema = z.object({
  code: z.string().min(1).max(10),
  nameId: z.string().min(1),
  nameEn: z.string().min(1),
  description: z.string().optional(),
});

const conversionSchema = z.object({
  fromUomId: z.string().min(1, 'Select From UOM'),
  toUomId: z.string().min(1, 'Select To UOM'),
  factor: z.number().positive(),
});

type UOMFormData = z.infer<typeof uomSchema>;
type ConversionFormData = z.infer<typeof conversionSchema>;

interface UOM {
  id: string;
  code: string;
  nameId: string;
  nameEn: string;
  description: string | null;
  isActive: boolean;
}

interface Conversion {
  id: string;
  fromUomId: string;
  toUomId: string;
  factor: number;
  fromUom: {
    id: string;
    code: string;
    nameId: string;
    nameEn: string;
  };
  toUom: {
    id: string;
    code: string;
    nameId: string;
    nameEn: string;
  };
}

export default function UOMPage() {
  const locale = useLocale() as 'en' | 'id';
  const t = useTranslations('uom');
  const tCommon = useTranslations('common');
  const tPlaceholders = useTranslations('placeholders');
  const tToasts = useTranslations('toasts');
  const [uoms, setUOMs] = useState<UOM[]>([]);
  const [conversions, setConversions] = useState<Conversion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUOMDialogOpen, setIsUOMDialogOpen] = useState(false);
  const [editingUom, setEditingUom] = useState<UOM | null>(null);
  const [isConversionDialogOpen, setIsConversionDialogOpen] = useState(false);
  const [deleteConversionId, setDeleteConversionId] = useState<string | null>(null);
  const [isDeletingConversion, setIsDeletingConversion] = useState(false);
  const pendingConversionDeleteRef = useRef<string | null>(null);

  const displayName = (u: { nameId: string; nameEn: string }) => (locale === 'en' ? u.nameEn : u.nameId);
  const numberLocale = locale === 'id' ? 'id-ID' : 'en-US';

  const {
    register: registerUOM,
    handleSubmit: handleSubmitUOM,
    reset: resetUOM,
    formState: { errors: errorsUOM, isSubmitting: isSubmittingUOM },
  } = useForm<UOMFormData>({
    resolver: zodResolver(uomSchema),
    defaultValues: { code: '', nameId: '', nameEn: '', description: '' },
  });

  const {
    register: registerConversion,
    handleSubmit: handleSubmitConversion,
    reset: resetConversion,
    watch: watchConversion,
    setValue: setValueConversion,
    formState: { errors: errorsConversion, isSubmitting: isSubmittingConversion },
  } = useForm<ConversionFormData>({
    resolver: zodResolver(conversionSchema),
  });

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchData on mount only
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [uomsData, conversionsData] = await Promise.all([
        getUOMs(),
        getUOMConversions(),
      ]);
      setUOMs(uomsData);
      setConversions(conversionsData.map((c) => ({ ...c, factor: Number(c.factor) })));
    } catch {
      toast.error(tToasts('failedToLoadUOMData'));
    } finally {
      setIsLoading(false);
    }
  };

  const onSubmitUOM = async (data: UOMFormData) => {
    try {
      if (editingUom) {
        await updateUOM({ id: editingUom.id, ...data });
        toast.success(tToasts('uomUpdatedSuccessfully'));
      } else {
        await createUOM(data);
        toast.success(tToasts('uomCreatedSuccessfully'));
      }
      setIsUOMDialogOpen(false);
      setEditingUom(null);
      resetUOM();
      fetchData();
    } catch (error: any) {
      toast.error(
        error.message ||
          (editingUom ? tToasts('failedToUpdateUOM') : tToasts('failedToCreateUOM')),
      );
    }
  };

  const onSubmitConversion = async (data: ConversionFormData) => {
    try {
      if (data.fromUomId === data.toUomId) {
        toast.error(tToasts('fromAndToUOMCannotBeSame'));
        return;
      }
      await createUOMConversion(data);
      toast.success(tToasts('conversionCreatedSuccessfully'));
      setIsConversionDialogOpen(false);
      resetConversion();
      fetchData();
    } catch (error: any) {
      toast.error(error.message || tToasts('failedToCreateConversion'));
    }
  };

  const conversionPendingDelete = deleteConversionId
    ? conversions.find((c) => c.id === deleteConversionId)
    : undefined;

  const onConfirmDeleteConversion = async () => {
    const id = pendingConversionDeleteRef.current;
    if (!id) return;
    pendingConversionDeleteRef.current = null;
    setIsDeletingConversion(true);
    try {
      await deleteUOMConversion(id);
      toast.success(tToasts('conversionDeletedSuccessfully'));
      setDeleteConversionId(null);
      fetchData();
    } catch (error: any) {
      toast.error(error.message || tToasts('failedToDeleteConversion'));
    } finally {
      setIsDeletingConversion(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
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

      <div className="grid gap-6 lg:grid-cols-2">
        {/* UOM List */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{t('unitsTitle')}</CardTitle>
                <CardDescription>{t('unitsDescription')}</CardDescription>
              </div>
              <Dialog
                open={isUOMDialogOpen}
                onOpenChange={(open) => {
                  setIsUOMDialogOpen(open);
                  if (!open) setEditingUom(null);
                }}
              >
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingUom(null);
                    resetUOM({ code: '', nameId: '', nameEn: '', description: '' });
                    setIsUOMDialogOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {locale === 'en' ? 'New UOM' : 'UOM Baru'}
                </Button>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>
                      {editingUom
                        ? t('editUOMTitle')
                        : locale === 'en'
                          ? 'Create New UOM'
                          : 'Buat UOM Baru'}
                    </DialogTitle>
                    <DialogDescription>
                      {editingUom
                        ? t('editUOMDescription')
                        : locale === 'en'
                          ? 'Add a new unit of measure to the system'
                          : 'Tambahkan unit ukur baru ke sistem'}
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleSubmitUOM(onSubmitUOM)} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="code">Code *</Label>
                      <Input
                        id="code"
                        {...registerUOM('code')}
                        placeholder="YD, PCS, MTR, KG"
                        maxLength={10}
                      />
                      {errorsUOM.code && (
                        <p className="text-sm text-destructive">{errorsUOM.code.message}</p>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="nameId">{t('nameId')} *</Label>
                        <Input id="nameId" {...registerUOM('nameId')} />
                        {errorsUOM.nameId && (
                          <p className="text-sm text-destructive">{errorsUOM.nameId.message}</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="nameEn">{t('nameEn')} *</Label>
                        <Input id="nameEn" {...registerUOM('nameEn')} />
                        {errorsUOM.nameEn && (
                          <p className="text-sm text-destructive">{errorsUOM.nameEn.message}</p>
                        )}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="description">Description</Label>
                      <Textarea
                        id="description"
                        {...registerUOM('description')}
                        rows={3}
                      />
                    </div>
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setIsUOMDialogOpen(false);
                          setEditingUom(null);
                        }}
                      >
                        {tCommon('cancel')}
                      </Button>
                      <Button type="submit" disabled={isSubmittingUOM}>
                        {isSubmittingUOM && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        {editingUom ? tCommon('update') : locale === 'en' ? 'Create UOM' : 'Buat UOM'}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[52px]">{tCommon('actions')}</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>{t('nameId')}</TableHead>
                  <TableHead>{t('nameEn')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {uoms.map((uom) => (
                  <TableRow key={uom.id}>
                    <TableCell className="p-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          setEditingUom(uom);
                          resetUOM({
                            code: uom.code,
                            nameId: uom.nameId,
                            nameEn: uom.nameEn,
                            description: uom.description ?? '',
                          });
                          setIsUOMDialogOpen(true);
                        }}
                        aria-label={t('editUOM')}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                    <TableCell className="font-medium">{uom.code}</TableCell>
                    <TableCell>{uom.nameId}</TableCell>
                    <TableCell>{uom.nameEn}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Conversions */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{t('conversionsTitle')}</CardTitle>
                <CardDescription>{t('conversionsDescription')}</CardDescription>
              </div>
              <Dialog open={isConversionDialogOpen} onOpenChange={setIsConversionDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    {locale === 'en' ? 'Add Conversion' : 'Tambah Konversi'}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{locale === 'en' ? 'Create UOM Conversion' : 'Buat Konversi UOM'}</DialogTitle>
                    <DialogDescription>
                      {locale === 'en' ? 'Define conversion factor between two UOMs' : 'Tentukan faktor konversi antara dua UOM'}
                    </DialogDescription>
                  </DialogHeader>
                  <form
                    onSubmit={handleSubmitConversion(onSubmitConversion)}
                    className="space-y-4"
                  >
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="fromUomId">From UOM *</Label>
                        <SearchableCombobox
                          options={uoms.map((uom) => ({
                            value: uom.id,
                            label: `${uom.code} – ${displayName(uom)}`,
                          }))}
                          value={watchConversion('fromUomId')}
                          onValueChange={(value) => setValueConversion('fromUomId', value)}
                          placeholder={tPlaceholders('selectUOM')}
                        />
                        {errorsConversion.fromUomId && (
                          <p className="text-sm text-destructive">
                            {errorsConversion.fromUomId.message}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="toUomId">To UOM *</Label>
                        <SearchableCombobox
                          options={uoms.map((uom) => ({
                            value: uom.id,
                            label: `${uom.code} – ${displayName(uom)}`,
                          }))}
                          value={watchConversion('toUomId')}
                          onValueChange={(value) => setValueConversion('toUomId', value)}
                          placeholder={tPlaceholders('selectUOM')}
                        />
                        {errorsConversion.toUomId && (
                          <p className="text-sm text-destructive">
                            {errorsConversion.toUomId.message}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="factor">Conversion Factor *</Label>
                      <Input
                        id="factor"
                        type="number"
                        step="0.000001"
                        min="0"
                        {...registerConversion('factor', { valueAsNumber: true })}
                        placeholder="e.g., 25 (1 Roll = 25 Yards)"
                      />
                      {errorsConversion.factor && (
                        <p className="text-sm text-destructive">
                          {errorsConversion.factor.message}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Multiply From UOM by this factor to get To UOM
                      </p>
                    </div>
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setIsConversionDialogOpen(false)}
                      >
                        {tCommon('cancel')}
                      </Button>
                      <Button type="submit" disabled={isSubmittingConversion}>
                        {isSubmittingConversion && (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        )}
                        {locale === 'en' ? 'Create Conversion' : 'Buat Konversi'}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[52px]">{tCommon('actions')}</TableHead>
                  <TableHead>{locale === 'en' ? 'From' : 'Dari'}</TableHead>
                  <TableHead>{locale === 'en' ? 'To' : 'Ke'}</TableHead>
                  <TableHead className="text-right">{locale === 'en' ? 'Factor' : 'Faktor'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {conversions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      {t('noConversions')}
                    </TableCell>
                  </TableRow>
                ) : (
                  conversions.map((conv) => (
                    <TableRow key={conv.id}>
                      <TableCell className="p-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => {
                            pendingConversionDeleteRef.current = conv.id;
                            setDeleteConversionId(conv.id);
                          }}
                          aria-label={t('deleteConversion')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                      <TableCell>
                        {conv.fromUom.code} – {displayName(conv.fromUom)}
                      </TableCell>
                      <TableCell>
                        {conv.toUom.code} – {displayName(conv.toUom)}
                      </TableCell>
                      <TableCell className="text-right">
                        {Number(conv.factor).toLocaleString(numberLocale, {
                          maximumFractionDigits: 6,
                        })}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <AlertDialog
        open={!!deleteConversionId}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteConversionId(null);
            pendingConversionDeleteRef.current = null;
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConversionTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {conversionPendingDelete
                ? t('deleteConversionDescription', {
                    from: `${conversionPendingDelete.fromUom.code} – ${displayName(conversionPendingDelete.fromUom)}`,
                    to: `${conversionPendingDelete.toUom.code} – ${displayName(conversionPendingDelete.toUom)}`,
                  })
                : t('deleteConversionDescriptionFallback')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingConversion}>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void onConfirmDeleteConversion()}
              disabled={isDeletingConversion}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingConversion ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                tCommon('delete')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
