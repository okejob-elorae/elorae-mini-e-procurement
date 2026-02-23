'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Plus, Loader2, CheckCircle, Clock, MoreHorizontal, Eye, Pencil, Trash2, Search, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { getVendorReturns, processReturn, deleteVendorReturn } from '@/app/actions/vendor-returns';

interface SupplierOption {
  id: string;
  code: string;
  name: string;
}

type VendorReturnRow = Awaited<ReturnType<typeof getVendorReturns>>[number];

export default function VendorReturnsPage() {
  const { data: session } = useSession();
  const [returns, setReturns] = useState<VendorReturnRow[]>([]);
  const [vendors, setVendors] = useState<SupplierOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('__all__');
  const [vendorFilter, setVendorFilter] = useState<string>('__all__');
  const [searchQuery, setSearchQuery] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchReturns = async () => {
    setIsLoading(true);
    try {
      const data = await getVendorReturns({
        status: statusFilter === '__all__' ? undefined : statusFilter,
        vendorId: vendorFilter === '__all__' ? undefined : vendorFilter,
        search: searchQuery.trim() || undefined
      });
      setReturns(data);
    } catch {
      toast.error('Failed to load vendor returns');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const loadVendors = async () => {
      try {
        const res = await fetch('/api/suppliers');
        if (res.ok) {
          const data = await res.json();
          setVendors((data as SupplierOption[]) || []);
        }
      } catch {
        // non-blocking
      }
    };
    loadVendors();
  }, []);

  useEffect(() => {
    fetchReturns();
  }, [statusFilter, vendorFilter, searchQuery]);

  const handleProcess = async (id: string) => {
    if (!session?.user?.id) return;
    setProcessingId(id);
    try {
      await processReturn(id, session.user.id);
      toast.success('Return processed');
      fetchReturns();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to process');
    } finally {
      setProcessingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!session?.user?.id) return;
    if (!confirm('Are you sure you want to delete this return?')) return;
    setDeletingId(id);
    try {
      await deleteVendorReturn(id, session.user.id);
      toast.success('Return deleted');
      fetchReturns();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Vendor Returns</h1>
          <p className="text-muted-foreground">
            Manage returns to vendors and track stock impact
          </p>
        </div>
        <Link href="/backoffice/vendor-returns/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Return
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search doc # or vendor..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={vendorFilter}
          onValueChange={setVendorFilter}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Vendor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All vendors</SelectItem>
            {vendors.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.code} – {v.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={setStatusFilter}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Status</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="PROCESSED">Processed</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Vendor Return List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Vendor Return List
          </CardTitle>
        </CardHeader>
        <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : returns.length === 0 ? (
              <div className="text-center py-12">
                <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No vendor returns found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Doc #</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Work Order</TableHead>
                      <TableHead className="text-right">Total Value</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {returns.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">{r.docNumber}</TableCell>
                          <TableCell>
                            {(r.vendor as { name?: string; code?: string })?.name ?? r.vendorId}
                          </TableCell>
                          <TableCell>
                            {r.wo
                              ? (
                                  <Link
                                    href={`/backoffice/work-orders/${(r.wo as { id: string }).id}`}
                                    className="text-primary hover:underline"
                                  >
                                    {(r.wo as { docNumber?: string }).docNumber}
                                  </Link>
                                )
                              : '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            {Number(r.totalValue).toLocaleString(undefined, {
                              minimumFractionDigits: 2
                            })}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                r.status === 'COMPLETED'
                                  ? 'default'
                                  : r.status === 'PROCESSED'
                                    ? 'secondary'
                                    : 'outline'
                              }
                            >
                              {r.status === 'COMPLETED' || r.status === 'PROCESSED' ? (
                                <CheckCircle className="mr-1 h-3 w-3" />
                              ) : (
                                <Clock className="mr-1 h-3 w-3" />
                              )}
                              {r.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {r.createdAt instanceof Date
                              ? r.createdAt.toLocaleDateString()
                              : new Date(r.createdAt).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild>
                                  <Link href={`/backoffice/vendor-returns/${r.id}`}>
                                    <Eye className="mr-2 h-4 w-4" />
                                    View
                                  </Link>
                                </DropdownMenuItem>
                                {r.status === 'DRAFT' && (
                                  <>
                                    <DropdownMenuItem asChild>
                                      <Link href={`/backoffice/vendor-returns/${r.id}/edit`}>
                                        <Pencil className="mr-2 h-4 w-4" />
                                        Edit
                                      </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => handleProcess(r.id)}
                                      disabled={processingId === r.id}
                                    >
                                      {processingId === r.id ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                      ) : null}
                                      Process
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className="text-destructive"
                                      onClick={() => handleDelete(r.id)}
                                      disabled={deletingId === r.id}
                                    >
                                      {deletingId === r.id ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                      ) : (
                                        <Trash2 className="mr-2 h-4 w-4" />
                                      )}
                                      {deletingId === r.id ? 'Deleting...' : 'Delete'}
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            )}
        </CardContent>
      </Card>
    </div>
  );
}
