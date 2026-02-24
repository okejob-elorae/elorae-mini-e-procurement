'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  Plus, 
  Search, 
  ClipboardList, 
  Eye,
  Calendar,
  CheckCircle,
  Clock,
  XCircle,
  Play,
  Package
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Card,
  CardContent,
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
import { toast } from 'sonner';
import { getWorkOrders, issueWorkOrder, cancelWorkOrder } from '@/app/actions/production';
import { WOStatus } from '@/lib/constants/enums';
import { Pagination } from '@/components/ui/pagination';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants/pagination';

interface WorkOrder {
  id: string;
  docNumber: string;
  status: WOStatus;
  plannedQty: string;
  actualQty: string | null;
  targetDate: string | null;
  createdAt: string;
  vendor: {
    name: string;
    code: string;
  };
  _count: {
    issues: number;
    receipts: number;
  };
}

const statusLabels: Record<WOStatus, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  IN_PRODUCTION: 'In Production',
  PARTIAL: 'Partial',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled'
};

const statusColors: Record<WOStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
  ISSUED: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  IN_PRODUCTION: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  PARTIAL: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  COMPLETED: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
};

const statusIcons: Record<WOStatus, React.ReactNode> = {
  DRAFT: <Clock className="h-4 w-4" />,
  ISSUED: <Play className="h-4 w-4" />,
  IN_PRODUCTION: <Package className="h-4 w-4" />,
  PARTIAL: <CheckCircle className="h-4 w-4" />,
  COMPLETED: <CheckCircle className="h-4 w-4" />,
  CANCELLED: <XCircle className="h-4 w-4" />
};

export default function WorkOrdersPage() {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<WOStatus | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);
  const [totalCount, setTotalCount] = useState(0);

  const fetchWorkOrders = async () => {
    setIsLoading(true);
    try {
      const result = await getWorkOrders(
        { status: statusFilter || undefined },
        { page, pageSize }
      );
      if (result != null && typeof result === 'object' && 'items' in result && 'totalCount' in result) {
        setWorkOrders((result as { items: WorkOrder[] }).items);
        setTotalCount((result as { totalCount: number }).totalCount);
      } else {
        const list = (result as WorkOrder[]) ?? [];
        setWorkOrders(list);
        setTotalCount(list.length);
      }
    } catch (_error) {
      toast.error('Failed to load work orders');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  useEffect(() => {
    fetchWorkOrders();
  }, [statusFilter, page, pageSize]);

  const handleIssue = async (id: string) => {
    try {
      await issueWorkOrder(id, 'user-id'); // TODO: Get actual user ID
      toast.success('Work Order issued successfully');
      fetchWorkOrders();
    } catch (error: any) {
      toast.error(error.message || 'Failed to issue Work Order');
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm('Are you sure you want to cancel this Work Order?')) return;
    
    try {
      await cancelWorkOrder(id, 'user-id'); // TODO: Get actual user ID
      toast.success('Work Order cancelled successfully');
      fetchWorkOrders();
    } catch (error: any) {
      toast.error(error.message || 'Failed to cancel Work Order');
    }
  };

  const getCompletionPercent = (wo: WorkOrder) => {
    if (!wo.actualQty || Number(wo.plannedQty) === 0) return 0;
    return Math.min(100, Math.round((Number(wo.actualQty) / Number(wo.plannedQty)) * 100));
  };

  const filteredWOs = workOrders.filter(wo => 
    wo.docNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
    wo.vendor.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Work Orders</h1>
          <p className="text-muted-foreground">
            Manage production and track material usage
          </p>
        </div>
        <Link href="/backoffice/work-orders/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Work Order
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search WO number or vendor..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={statusFilter || '__all__'}
          onValueChange={(v) => setStatusFilter(v === '__all__' ? '' : (v as WOStatus))}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Status</SelectItem>
            {(Object.entries(statusLabels) as [WOStatus, string][]).map(([status, label]) => (
              <SelectItem key={status} value={status}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Work Orders Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Work Order List
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : filteredWOs.length === 0 ? (
            <div className="text-center py-12">
              <ClipboardList className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No work orders found</p>
            </div>
          ) : (
            <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>WO Number</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Target Date</TableHead>
                    <TableHead>Progress</TableHead>
                    <TableHead className="text-right">Issues</TableHead>
                    <TableHead className="text-right">Receipts</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredWOs.map((wo) => (
                    <TableRow key={wo.id}>
                      <TableCell className="font-medium">{wo.docNumber}</TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{wo.vendor.name}</p>
                          <p className="text-sm text-muted-foreground">{wo.vendor.code}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={statusColors[wo.status]}>
                          {statusIcons[wo.status]}
                          <span className="ml-1">{statusLabels[wo.status]}</span>
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {wo.targetDate ? (
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            {new Date(wo.targetDate).toLocaleDateString('id-ID')}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="w-32">
                          <div className="flex justify-between text-xs mb-1">
                            <span>{getCompletionPercent(wo)}%</span>
                            <span className="text-muted-foreground">
                              {Number(wo.actualQty || 0).toLocaleString()} / {Number(wo.plannedQty).toLocaleString()}
                            </span>
                          </div>
                          <Progress value={getCompletionPercent(wo)} className="h-2" />
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{wo._count.issues}</TableCell>
                      <TableCell className="text-right">{wo._count.receipts}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Link href={`/backoffice/work-orders/${wo.id}`}>
                            <Button variant="ghost" size="icon">
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                          {wo.status === 'DRAFT' && (
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => handleIssue(wo.id)}
                            >
                              Issue
                            </Button>
                          )}
                          {(wo.status === 'DRAFT' || wo.status === 'ISSUED') && (
                            <Button 
                              variant="ghost" 
                              size="sm"
                              className="text-destructive"
                              onClick={() => handleCancel(wo.id)}
                            >
                              Cancel
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination
              page={page}
              totalPages={Math.max(1, Math.ceil(totalCount / pageSize))}
              onPageChange={setPage}
              totalCount={totalCount}
              pageSize={pageSize}
            />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
