'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Plus, Eye, Loader2, CheckCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { toast } from 'sonner';
import { getVendorReturns, processReturn } from '@/app/actions/vendor-returns';

type VendorReturnRow = Awaited<ReturnType<typeof getVendorReturns>>[number];

export default function VendorReturnsPage() {
  const { data: session } = useSession();
  const [returns, setReturns] = useState<VendorReturnRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('__all__');
  const [processingId, setProcessingId] = useState<string | null>(null);

  const fetchReturns = async () => {
    setIsLoading(true);
    try {
      const data = await getVendorReturns({
        status: statusFilter === '__all__' ? undefined : statusFilter
      });
      setReturns(data);
    } catch {
      toast.error('Failed to load vendor returns');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReturns();
  }, [statusFilter]);

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Vendor Returns</h1>
        <div className="flex gap-2">
          <Select
            value={statusFilter}
            onValueChange={setStatusFilter}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="PROCESSED">Processed</SelectItem>
            </SelectContent>
          </Select>
          <Link href="/backoffice/vendor-returns/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Return
            </Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Returns</CardTitle>
        </CardHeader>
        <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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
                    {returns.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                          No vendor returns found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      returns.map((r) => (
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
                              variant={r.status === 'PROCESSED' ? 'default' : 'secondary'}
                            >
                              {r.status === 'PROCESSED' ? (
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
                            <div className="flex gap-2">
                              <Link href={`/backoffice/vendor-returns/${r.id}`}>
                                <Button variant="ghost" size="sm">
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </Link>
                              {r.status === 'DRAFT' && (
                                <Button
                                  size="sm"
                                  onClick={() => handleProcess(r.id)}
                                  disabled={processingId === r.id}
                                >
                                  {processingId === r.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    'Process'
                                  )}
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
        </CardContent>
      </Card>
    </div>
  );
}
