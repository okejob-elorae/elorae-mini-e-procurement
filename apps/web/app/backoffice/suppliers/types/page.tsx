'use client';

import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Loader2, Trash2, Tags } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
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
import { gayaKeping } from '@/lib/ui/warna-kode';
import { CategoryBadge } from '@/components/ui/category-badge';
import { PemilihWarna } from '@/components/ui/pemilih-warna';
import { warnaOtomatisKategori } from '@/lib/ui/category-color';
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
import { Pagination } from '@/components/ui/pagination';
import { cn } from '@/lib/utils';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants/pagination';
import type { HasilJenisPemasok } from '@/app/actions/supplier-types';

type Translate = ReturnType<typeof useTranslations>;

function makeSchema(t: Translate) {
  return z.object({
    code: z.string().min(1, t('codeRequired')).max(50),
    name: z.string().min(1, t('nameRequired')),
    // Warna jenis pilihan pemilik ("#rrggbb"); null = otomatis. Dipilih lewat PemilihWarna.
    color: z.string().nullable(),
    isActive: z.boolean(),
    // Coerce empty string from number input to undefined so validation passes
    sortOrder: z.preprocess(
      (val) => (val === '' || val === undefined ? undefined : Number(val)),
      z.number().int().optional()
    ),
  });
}

type FormData = z.infer<ReturnType<typeof makeSchema>>;

interface SupplierTypeRecord {
  id: string;
  code: string;
  name: string;
  color: string | null;
  isActive: boolean;
  sortOrder: number | null;
  createdAt: string;
  updatedAt: string;
  _count?: { suppliers: number };
}

export default function SupplierTypesPage() {
  const tUi = useTranslations('ui');
  const tTable = useTranslations('tableHeaders');
  const tSupplierTypes = useTranslations('supplierTypes');
  const schema = useMemo(() => makeSchema(tSupplierTypes), [tSupplierTypes]);
  const [types, setTypes] = useState<SupplierTypeRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SupplierTypeRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);
  const [totalCount, setTotalCount] = useState(0);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: { code: '', name: '', color: null, isActive: true, sortOrder: undefined },
  });

  const isActive = watch('isActive');
  const warna = watch('color');
  const namaKetik = watch('name');
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const fetchTypes = async () => {
    setIsLoading(true);
    try {
      const { listSupplierTypesAction } = await import('@/app/actions/supplier-types');
      const json = await listSupplierTypesAction({ page, pageSize, withUsage: true });
      if (json != null && typeof json === 'object' && 'data' in json && 'totalCount' in json) {
        setTypes((Array.isArray(json.data) ? json.data : []) as unknown as SupplierTypeRecord[]);
        setTotalCount(Number(json.totalCount) || 0);
      } else {
        const list = Array.isArray(json) ? json : [];
        setTypes(list as unknown as SupplierTypeRecord[]);
        setTotalCount(list.length);
      }
    } catch (e) {
      console.error(e);
      toast.error(tSupplierTypes('loadFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTypes();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchTypes depends on pagination
  }, [page, pageSize]);

  const pesanGagal = (h: Exclude<HasilJenisPemasok, { ok: true }>, kode?: string) =>
    h.code === 'DUPLICATE_CODE'
      ? tSupplierTypes('errDuplicate', { code: kode ?? '' })
      : h.code === 'IN_USE'
        ? tSupplierTypes('errInUse', { count: h.count ?? 0 })
        : tSupplierTypes('saveFailed');

  const openCreate = () => {
    setEditingId(null);
    reset({ code: '', name: '', color: null, isActive: true, sortOrder: undefined });
    setIsDialogOpen(true);
  };

  const openEdit = (row: SupplierTypeRecord) => {
    setEditingId(row.id);
    reset({
      code: row.code,
      name: row.name,
      color: row.color ?? null,
      isActive: row.isActive,
      sortOrder: row.sortOrder ?? undefined,
    });
    setIsDialogOpen(true);
  };

  const onSubmit = async (data: FormData) => {
    try {
      const {
        createSupplierTypeAction,
        updateSupplierTypeAction,
      } = await import('@/app/actions/supplier-types');
      const hasil = editingId
        ? await updateSupplierTypeAction(editingId, data)
        : await createSupplierTypeAction(data);
      if (!hasil.ok) {
        toast.error(pesanGagal(hasil, data.code.trim().toUpperCase()));
        return;
      }
      toast.success(editingId ? tSupplierTypes('updatedToast') : tSupplierTypes('createdToast'));
      setIsDialogOpen(false);
      fetchTypes();
    } catch (e) {
      console.error(e);
      toast.error(tSupplierTypes('saveFailed'));
    }
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const { deleteSupplierTypeAction } = await import('@/app/actions/supplier-types');
      const hasil = await deleteSupplierTypeAction(deleteTarget.id);
      if (!hasil.ok) {
        toast.error(hasil.code === 'FAILED' ? tSupplierTypes('deleteFailed') : pesanGagal(hasil));
        return;
      }
      toast.success(tSupplierTypes('deletedToast'));
      setDeleteTarget(null);
      fetchTypes();
    } catch (e) {
      console.error(e);
      toast.error(tSupplierTypes('deleteFailed'));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={tSupplierTypes('pageTitle')}
        actions={
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            {tSupplierTypes('newType')}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tags className="h-5 w-5" />
            {tSupplierTypes('cardTitle')}
            {!isLoading ? (
              <span className="text-sm font-normal text-muted-foreground">
                · {tSupplierTypes('count', { count: totalCount })}
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : types.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-sm text-muted-foreground">{tSupplierTypes('empty')}</p>
              <Button variant="outline" onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" />
                {tSupplierTypes('newType')}
              </Button>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tUi('code')}</TableHead>
                    <TableHead>{tUi('name')}</TableHead>
                    <TableHead>{tSupplierTypes('usage')}</TableHead>
                    {/* Urutan di tengah: angka satu digit yang rata kanan
                        menempel ke label status di sebelahnya. */}
                    <TableHead className="text-center">{tSupplierTypes('sort')}</TableHead>
                    <TableHead>{tTable('status')}</TableHead>
                    <TableHead className="w-[96px] text-right">{tUi('actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {types.map((row) => {
                    const dipakai = row._count?.suppliers ?? 0;
                    return (
                      <TableRow key={row.id} className={cn(!row.isActive && 'text-muted-foreground')}>
                        <TableCell>
                          {/* Warna diturunkan dari teks kodenya sendiri, jadi kode
                              yang sama selalu berwarna sama di layar mana pun —
                              dan kodenya tetap tertulis, jadi warnanya penanda,
                              bukan satu-satunya pembeda. */}
                          <span
                            className="keping-kode inline-flex rounded-md px-2 py-0.5 font-mono text-xs font-semibold"
                            style={gayaKeping(row.code)}
                          >
                            {row.code}
                          </span>
                        </TableCell>
                        <TableCell>
                          {/* Tampil persis seperti lencananya di daftar pemasok — dengan warna pilihan bila ada. */}
                          <CategoryBadge label={row.name} warna={row.color} />
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {dipakai > 0 ? tSupplierTypes('usageCount', { count: dipakai }) : tSupplierTypes('usageNone')}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">{row.sortOrder ?? '—'}</TableCell>
                        <TableCell>
                          {row.isActive ? (
                            <Badge className="border-emerald-600/25 bg-emerald-600/10 text-emerald-700 hover:bg-emerald-600/15 dark:text-emerald-400">
                              {tUi('active')}
                            </Badge>
                          ) : (
                            <Badge variant="outline">{tUi('inactive')}</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {/* Dua tombol yang terlihat, bukan pensil yang diam-diam
                              membuka menu. Hapus dimatikan untuk jenis yang masih
                              dipakai, dengan alasannya di tooltip — bukan ditawarkan
                              lalu ditolak sesudah diklik. */}
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEdit(row)}
                              aria-label={tSupplierTypes('editAria', { name: row.name })}
                              title={tUi('edit')}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <span title={dipakai > 0 ? tSupplierTypes('deleteInUse', { count: dipakai }) : tUi('delete')}>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setDeleteTarget(row)}
                                disabled={dipakai > 0}
                                aria-label={
                                  dipakai > 0
                                    ? tSupplierTypes('deleteInUse', { count: dipakai })
                                    : tSupplierTypes('deleteAria', { name: row.name })
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {/* Paginasi hanya kalau memang ada halaman kedua — "Halaman 1
                  dari 1" dengan dua tombol mati hanya menambah kebisingan. */}
              {totalPages > 1 ? (
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  onPageChange={setPage}
                  totalCount={totalCount}
                  pageSize={pageSize}
                />
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? tSupplierTypes('editTitle') : tSupplierTypes('createTitle')}</DialogTitle>
            <DialogDescription>
              {editingId ? tSupplierTypes('editDescription') : tSupplierTypes('createDescription')}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code">{tUi('code')} *</Label>
              <Input
                id="code"
                {...register('code')}
                placeholder={tSupplierTypes('codePlaceholder')}
                disabled={!!editingId}
                className="font-mono uppercase"
              />
              {errors.code ? (
                <p className="text-sm text-destructive">{errors.code.message}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {editingId ? tSupplierTypes('codeLocked') : tSupplierTypes('codeHelp')}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">{tUi('name')} *</Label>
              <Input id="name" {...register('name')} placeholder={tSupplierTypes('namePlaceholder')} />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>{tSupplierTypes('color')}</Label>
              <div className="flex flex-wrap items-center gap-3">
                <PemilihWarna
                  nilai={warna}
                  bawaan={warnaOtomatisKategori(namaKetik)}
                  label={tSupplierTypes('color')}
                  onPilih={(hex) => setValue('color', hex, { shouldDirty: true })}
                />
                <CategoryBadge label={namaKetik || tSupplierTypes('colorPreview')} warna={warna} />
              </div>
              <p className="text-xs text-muted-foreground">{tSupplierTypes('colorHelp')}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sortOrder">{tSupplierTypes('sortOrder')}</Label>
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
                <p className="text-xs text-muted-foreground">{tSupplierTypes('sortHelp')}</p>
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
                <p className="text-xs text-muted-foreground">{tSupplierTypes('activeHelp')}</p>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsDialogOpen(false)}
              >
                {tUi('cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editingId ? tSupplierTypes('updateButton') : tUi('create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tSupplierTypes('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {tSupplierTypes('deleteBodyNamed', { name: deleteTarget?.name ?? '', code: deleteTarget?.code ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tUi('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Tetap terbuka sampai hasilnya datang: kalau ditolak, alasannya
                // tampil dengan dialog yang masih menyebut jenis yang dimaksud.
                e.preventDefault();
                onDelete();
              }}
              disabled={isDeleting}
              variant="destructive"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : tUi('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
