'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
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
import { Pagination } from '@/components/ui/pagination';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants/pagination';

const schema = z.object({
  code: z.string().min(1, 'Code is required').max(50),
  name: z.string().min(1, 'Name is required'),
  isActive: z.boolean(),
  // Coerce empty string from number input to undefined so validation passes
  sortOrder: z.preprocess(
    (val) => (val === '' || val === undefined ? undefined : Number(val)),
    z.number().int().optional()
  ),
});

type FormData = z.infer<typeof schema>;

interface SupplierTypeRecord {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number | null;
  createdAt: string;
  updatedAt: string;
}

export default function SupplierTypesPage() {
  const tSupplierTypes = useTranslations('supplierTypes');
  const [types, setTypes] = useState<SupplierTypeRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
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
    defaultValues: { code: '', name: '', isActive: true, sortOrder: undefined },
  });

  const isActive = watch('isActive');

  const fetchTypes = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      const res = await fetch(`/api/supplier-types?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const json = await res.json();
      if (json != null && typeof json === 'object' && 'data' in json && 'totalCount' in json) {
        setTypes(Array.isArray(json.data) ? json.data : []);
        setTotalCount(Number(json.totalCount) || 0);
      } else {
        const list = Array.isArray(json) ? json : [];
        setTypes(list);
        setTotalCount(list.length);
      }
    } catch (e) {
      console.error(e);
      toast.error('Failed to load supplier types');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTypes();
  }, [page, pageSize]);

  const openCreate = () => {
    setEditingId(null);
    reset({ code: '', name: '', isActive: true, sortOrder: undefined });
    setIsDialogOpen(true);
  };

  const openEdit = (row: SupplierTypeRecord) => {
    setEditingId(row.id);
    reset({
      code: row.code,
      name: row.name,
      isActive: row.isActive,
      sortOrder: row.sortOrder ?? undefined,
    });
    setIsDialogOpen(true);
  };

  const onSubmit = async (data: FormData) => {
    try {
      if (editingId) {
        const res = await fetch(`/api/supplier-types/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Update failed');
        }
        toast.success('Supplier type updated');
      } else {
        const res = await fetch('/api/supplier-types', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Create failed');
        }
        toast.success('Supplier type created');
      }
      setIsDialogOpen(false);
      fetchTypes();
    } catch (e: any) {
      toast.error(e.message || 'Failed to save');
    }
  };

  const onDelete = async () => {
    if (!deleteId) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/supplier-types/${deleteId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Delete failed');
      }
      toast.success('Supplier type deleted');
      setDeleteId(null);
      fetchTypes();
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete');
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
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Supplier Types</h1>
        <p className="text-muted-foreground">
          Manage supplier type master data. Types are used when creating or editing suppliers.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Types</CardTitle>
              <CardDescription>{tSupplierTypes('cardDescription')}</CardDescription>
            </div>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <Button variant="outline" size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4 mr-2" />
                New type
              </Button>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingId ? 'Edit supplier type' : 'New supplier type'}</DialogTitle>
                  <DialogDescription>
                    {editingId ? 'Update code, name, and status.' : 'Add a new supplier type.'}
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="code">Code *</Label>
                    <Input
                      id="code"
                      {...register('code')}
                      placeholder="e.g. FABRIC"
                      disabled={!!editingId}
                    />
                    {errors.code && (
                      <p className="text-sm text-destructive">{errors.code.message}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="name">Name *</Label>
                    <Input id="name" {...register('name')} placeholder="e.g. Fabric" />
                    {errors.name && (
                      <p className="text-sm text-destructive">{errors.name.message}</p>
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
                      Cancel
                    </Button>
                    <Button type="submit" disabled={isSubmitting}>
                      {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      {editingId ? 'Update' : 'Create'}
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
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Sort</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No supplier types yet. Add one to get started.
                  </TableCell>
                </TableRow>
              ) : (
                types.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.code}</TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell>{row.sortOrder ?? '—'}</TableCell>
                    <TableCell>
                      {row.isActive ? (
                        <Badge variant="secondary">Active</Badge>
                      ) : (
                        <Badge variant="outline">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <span className="sr-only">Open menu</span>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(row)}>
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setDeleteId(row.id)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <Pagination
            page={page}
            totalPages={Math.max(1, Math.ceil(totalCount / pageSize))}
            onPageChange={setPage}
            totalCount={totalCount}
            pageSize={pageSize}
          />
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete supplier type?</AlertDialogTitle>
            <AlertDialogDescription>
              This type can only be deleted if no suppliers use it. Are you sure?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
