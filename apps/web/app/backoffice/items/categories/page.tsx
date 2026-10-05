'use client';

import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { Plus, Pencil, Loader2, ArrowLeft, Trash2, FolderTree } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TombolBantuan } from '@/components/bantuan/TombolBantuan';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
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
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  getItemCategoriesWithUsage,
  createItemCategory,
  updateItemCategory,
  deleteItemCategory,
} from '@/app/actions/item-categories';

type Translate = ReturnType<typeof useTranslations>;

function makeSchema(t: Translate) {
  return z.object({
    name: z.string().min(1, t('nameRequired')),
    code: z.string().max(50).optional().or(z.literal('')),
    isActive: z.boolean(),
    sortOrder: z.preprocess(
      (val) => (val === '' || val === undefined ? undefined : Number(val)),
      z.number().int().optional()
    ),
  });
}

type FormData = z.infer<ReturnType<typeof makeSchema>>;

interface ItemCategoryRecord {
  id: string;
  code: string | null;
  name: string;
  isActive: boolean;
  sortOrder: number | null;
  createdAt: string;
  updatedAt: string;
  dipakai: number;
}

export default function ItemCategoriesPage() {
  const tUi = useTranslations('ui');
  const tTable = useTranslations('tableHeaders');
  const tCommon = useTranslations('common');
  const tCat = useTranslations('items.categories');
  const schema = useMemo(() => makeSchema(tCat), [tCat]);
  const [categories, setCategories] = useState<ItemCategoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ItemCategoryRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: { name: '', code: '', isActive: true, sortOrder: undefined },
  });

  const isActive = watch('isActive');

  const fetchCategories = async () => {
    setIsLoading(true);
    try {
      const list = await getItemCategoriesWithUsage();
      setCategories(
        list.map((r) => ({
          id: r.id,
          code: r.code ?? null,
          name: r.name,
          isActive: r.isActive,
          sortOrder: r.sortOrder ?? null,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          dipakai: r._count.items,
        }))
      );
    } catch (e) {
      console.error(e);
      toast.error(tCat('loadFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    reset({ name: '', code: '', isActive: true, sortOrder: undefined });
    setIsDialogOpen(true);
  };

  const openEdit = (row: ItemCategoryRecord) => {
    setEditingId(row.id);
    reset({
      name: row.name,
      code: row.code ?? '',
      isActive: row.isActive,
      sortOrder: row.sortOrder ?? undefined,
    });
    setIsDialogOpen(true);
  };

  const pesanGagal = (code: 'DUPLICATE_CODE' | 'IN_USE' | 'FAILED', count = 0, kode = '') =>
    code === 'DUPLICATE_CODE'
      ? tCat('errDuplicate', { code: kode })
      : code === 'IN_USE'
        ? tCat('errInUse', { count })
        : tCat('saveFailed');

  const onSubmit = async (data: FormData) => {
    try {
      const isian = {
        name: data.name,
        code: data.code?.trim() || undefined,
        sortOrder: data.sortOrder,
        isActive: data.isActive,
      };
      const hasil = editingId ? await updateItemCategory(editingId, isian) : await createItemCategory(isian);
      if (!hasil.ok) {
        toast.error(pesanGagal(hasil.code, hasil.count, isian.code ?? ''));
        return;
      }
      toast.success(editingId ? tCat('updatedToast') : tCat('createdToast'));
      setIsDialogOpen(false);
      fetchCategories();
    } catch (e) {
      console.error(e);
      toast.error(tCat('saveFailed'));
    }
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const hasil = await deleteItemCategory(deleteTarget.id);
      if (!hasil.ok) {
        toast.error(hasil.code === 'FAILED' ? tCat('deleteFailed') : pesanGagal(hasil.code, hasil.count));
        return;
      }
      toast.success(tCat('deletedToast'));
      setDeleteTarget(null);
      fetchCategories();
    } catch (e) {
      console.error(e);
      toast.error(tCat('deleteFailed'));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Button variant="ghost" size="icon" asChild className="mt-0.5 shrink-0">
            <Link href="/backoffice/items" aria-label={tCat('backToItems')} title={tCat('backToItems')}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-bold tracking-tight">{tCat('pageTitle')}</h1>
            <TombolBantuan judul={tCat('pageTitle')} />
          </div>
        </div>
        <Button onClick={openCreate} className="shrink-0">
          <Plus className="mr-2 h-4 w-4" />
          {tCat('newCategory')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderTree className="h-5 w-5" />
            {tCat('cardTitle')}
            {!isLoading ? (
              <span className="text-sm font-normal text-muted-foreground">
                · {tCat('count', { count: categories.length })}
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : categories.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-sm text-muted-foreground">{tCat('empty')}</p>
              <Button variant="outline" onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" />
                {tCat('newCategory')}
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tUi('name')}</TableHead>
                  <TableHead>{tUi('code')}</TableHead>
                  <TableHead>{tCat('usage')}</TableHead>
                  <TableHead className="text-center">{tCat('sort')}</TableHead>
                  <TableHead>{tTable('status')}</TableHead>
                  <TableHead className="w-[96px] text-right">{tCommon('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((row) => (
                  <TableRow key={row.id} className={cn(!row.isActive && 'text-muted-foreground')}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="font-mono text-xs">{row.code ?? '—'}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {row.dipakai > 0 ? tCat('usageCount', { count: row.dipakai }) : tCat('usageNone')}
                    </TableCell>
                    <TableCell className="text-center tabular-nums">{row.sortOrder ?? '—'}</TableCell>
                    <TableCell>
                      {row.isActive ? (
                        <Badge className="border-emerald-600/25 bg-emerald-600/10 text-emerald-700 hover:bg-emerald-600/15 dark:text-emerald-400">
                          {tCommon('active')}
                        </Badge>
                      ) : (
                        <Badge variant="outline">{tCommon('inactive')}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {/* Dua tombol yang terlihat, bukan pensil yang diam-diam
                          membuka menu. Hapus dimatikan untuk kategori yang masih
                          dipasang di item, dengan alasannya di tooltip. */}
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(row)}
                          aria-label={tCat('editAria', { name: row.name })}
                          title={tCommon('edit')}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <span title={row.dipakai > 0 ? tCat('deleteInUse', { count: row.dipakai }) : tCommon('delete')}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(row)}
                            disabled={row.dipakai > 0}
                            aria-label={
                              row.dipakai > 0
                                ? tCat('deleteInUse', { count: row.dipakai })
                                : tCat('deleteAria', { name: row.name })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? tCat('editTitle') : tCat('newCategory')}</DialogTitle>
            <DialogDescription>
              {editingId ? tCat('editDescription') : tCat('createDescription')}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{tUi('name')} *</Label>
              <Input id="name" {...register('name')} placeholder={tCat('namePlaceholder')} />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="code">{tCat('codeOptional')}</Label>
              <Input
                id="code"
                {...register('code')}
                placeholder={tCat('codePlaceholder')}
                disabled={!!editingId}
                className="font-mono"
              />
              {errors.code ? (
                <p className="text-sm text-destructive">{errors.code.message}</p>
              ) : editingId ? (
                <p className="text-xs text-muted-foreground">{tCat('codeLocked')}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="sortOrder">{tCat('sortOrderOptional')}</Label>
              <Input
                id="sortOrder"
                type="number"
                {...register('sortOrder')}
                placeholder="1"
                className="w-32"
              />
              {errors.sortOrder ? (
                <p className="text-sm text-destructive">{errors.sortOrder.message}</p>
              ) : (
                <p className="text-xs text-muted-foreground">{tCat('sortHelp')}</p>
              )}
            </div>
            <div className="flex items-start gap-3 rounded-md border p-3">
              <Switch
                id="isActive"
                checked={isActive}
                onCheckedChange={(v) => setValue('isActive', v)}
              />
              <div className="space-y-0.5">
                <Label htmlFor="isActive">{tUi('active')}</Label>
                <p className="text-xs text-muted-foreground">{tCat('activeHelp')}</p>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsDialogOpen(false)}
              >
                {tCommon('cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editingId ? tCommon('update') : tCommon('create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={() => !isDeleting && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tCat('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {tCat('deleteBodyNamed', { name: deleteTarget?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{tUi('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                onDelete();
              }}
              disabled={isDeleting}
              variant="destructive"
            >
              {isDeleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {tCommon('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
