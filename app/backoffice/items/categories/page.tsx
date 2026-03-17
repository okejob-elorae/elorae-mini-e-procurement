'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { Plus, Pencil, Loader2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  getItemCategories,
  createItemCategory,
  updateItemCategory,
  deleteItemCategory,
} from '@/app/actions/item-categories';

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  code: z.string().max(50).optional().or(z.literal('')),
  isActive: z.boolean(),
  sortOrder: z.preprocess(
    (val) => (val === '' || val === undefined ? undefined : Number(val)),
    z.number().int().optional()
  ),
});

type FormData = z.infer<typeof schema>;

interface ItemCategoryRecord {
  id: string;
  code: string | null;
  name: string;
  isActive: boolean;
  sortOrder: number | null;
  createdAt: string;
  updatedAt: string;
}

export default function ItemCategoriesPage() {
  const t = useTranslations('items');
  const tCommon = useTranslations('common');
  const [categories, setCategories] = useState<ItemCategoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
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
      const list = await getItemCategories(false);
      setCategories(
        list.map((r) => ({
          id: r.id,
          code: r.code ?? null,
          name: r.name,
          isActive: r.isActive,
          sortOrder: r.sortOrder ?? null,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        }))
      );
    } catch (e) {
      console.error(e);
      toast.error('Failed to load item categories');
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

  const onSubmit = async (data: FormData) => {
    try {
      if (editingId) {
        await updateItemCategory(editingId, {
          name: data.name,
          code: data.code?.trim() || undefined,
          sortOrder: data.sortOrder,
          isActive: data.isActive,
        });
        toast.success(tCommon('update') + ' OK');
      } else {
        await createItemCategory({
          name: data.name,
          code: data.code?.trim() || undefined,
          sortOrder: data.sortOrder,
          isActive: data.isActive,
        });
        toast.success(tCommon('create') + ' OK');
      }
      setIsDialogOpen(false);
      fetchCategories();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save');
    }
  };

  const onDelete = async () => {
    if (!deleteId) return;
    setIsDeleting(true);
    try {
      await deleteItemCategory(deleteId);
      toast.success(tCommon('delete') + ' OK');
      setDeleteId(null);
      fetchCategories();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to delete');
    } finally {
      setIsDeleting(false);
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
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild className="shrink-0">
          <Link href="/backoffice/items">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')} – Category</h1>
          <p className="text-muted-foreground">
            Manage item categories. Categories can be assigned to items for grouping.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Categories</CardTitle>
              <CardDescription>Add, edit, or remove item categories. Categories in use cannot be deleted.</CardDescription>
            </div>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <Button variant="outline" size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4 mr-2" />
                New category
              </Button>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingId ? 'Edit category' : 'New category'}</DialogTitle>
                  <DialogDescription>
                    {editingId ? 'Update name, code, and status.' : 'Add a new item category.'}
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name *</Label>
                    <Input id="name" {...register('name')} placeholder="e.g. Cotton" />
                    {errors.name && (
                      <p className="text-sm text-destructive">{errors.name.message}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="code">Code (optional)</Label>
                    <Input
                      id="code"
                      {...register('code')}
                      placeholder="e.g. COTTON"
                      disabled={!!editingId}
                    />
                    {errors.code && (
                      <p className="text-sm text-destructive">{errors.code.message}</p>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="isActive"
                      checked={isActive}
                      onCheckedChange={(v) => setValue('isActive', v)}
                    />
                    <Label htmlFor="isActive">Active</Label>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sortOrder">Sort order (optional)</Label>
                    <Input
                      id="sortOrder"
                      type="number"
                      {...register('sortOrder')}
                      placeholder="1"
                    />
                    {errors.sortOrder && (
                      <p className="text-sm text-destructive">{errors.sortOrder.message}</p>
                    )}
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
          </div>
        </CardHeader>
        <CardContent>
          {categories.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">No categories yet. Create one to get started.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Sort</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[80px]">{tCommon('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{row.code ?? '—'}</TableCell>
                    <TableCell>{row.sortOrder ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={row.isActive ? 'default' : 'secondary'}>
                        {row.isActive ? tCommon('active') : tCommon('inactive')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <span className="sr-only">Open menu</span>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(row)}>
                            {tCommon('edit')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setDeleteId(row.id)}
                          >
                            {tCommon('delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteId} onOpenChange={() => !isDeleting && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete category?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Categories that are assigned to items cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
