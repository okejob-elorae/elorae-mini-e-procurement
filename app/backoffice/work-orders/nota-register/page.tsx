'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  getMaterialIssuesForCMTRegister,
  getMaterialIssueForPrint
} from '@/app/actions/production';

type RegisterRow = Awaited<ReturnType<typeof getMaterialIssuesForCMTRegister>>[number];

export default function NotaRegisterPage() {
  const [issues, setIssues] = useState<RegisterRow[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string; code: string }[]>([]);
  const [vendorId, setVendorId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [issueType, setIssueType] = useState<'FABRIC' | 'ACCESSORIES' | ''>('');
  const [isLoading, setIsLoading] = useState(false);
  const [printIssueId, setPrintIssueId] = useState<string | null>(null);
  const [printData, setPrintData] = useState<Awaited<ReturnType<typeof getMaterialIssueForPrint>>>(null);

  useEffect(() => {
    fetch('/api/suppliers?sync=true')
      .then((r) => r.json())
      .then((data: { id: string; name: string; code: string }[]) => setSuppliers(data ?? []))
      .catch(() => toast.error('Failed to load suppliers'));
  }, []);

  const loadIssues = async () => {
    setIsLoading(true);
    try {
      const filters: { vendorId?: string; dateFrom?: Date; dateTo?: Date; issueType?: 'FABRIC' | 'ACCESSORIES' } = {};
      if (vendorId) filters.vendorId = vendorId;
      if (dateFrom) filters.dateFrom = new Date(dateFrom);
      if (dateTo) filters.dateTo = new Date(dateTo);
      if (issueType) filters.issueType = issueType;
      const data = await getMaterialIssuesForCMTRegister(filters);
      setIssues(data);
    } catch {
      toast.error('Failed to load issues');
    } finally {
      setIsLoading(false);
    }
  };

  const openPrint = (issueId: string) => {
    setPrintIssueId(issueId);
    setPrintData(null);
  };
  const closePrint = () => {
    setPrintIssueId(null);
    setPrintData(null);
  };
  useEffect(() => {
    if (!printIssueId) return;
    getMaterialIssueForPrint(printIssueId)
      .then(setPrintData)
      .catch(() => toast.error('Failed to load for print'));
  }, [printIssueId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/backoffice/work-orders">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Register Nota ke CMT</h1>
          <p className="text-muted-foreground">Daftar pengiriman material (nota) ke CMT</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
          <CardDescription>Vendor (CMT), tanggal, dan tipe issue</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4 items-end">
          <div className="space-y-2">
            <Label>Vendor (CMT)</Label>
            <Select value={vendorId || '_'} onValueChange={(v) => setVendorId(v === '_' ? '' : v)}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Semua" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_">Semua</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Dari</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Sampai</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Tipe</Label>
            <Select value={issueType || '_'} onValueChange={(v) => setIssueType(v === '_' ? '' : (v as 'FABRIC' | 'ACCESSORIES'))}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Semua" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_">Semua</SelectItem>
                <SelectItem value="FABRIC">FABRIC</SelectItem>
                <SelectItem value="ACCESSORIES">ACCESSORIES</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={loadIssues} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Load'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daftar Nota</CardTitle>
          <CardDescription>{issues.length} issue(s)</CardDescription>
        </CardHeader>
        <CardContent>
          {issues.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">Pilih filter dan klik Load, atau belum ada data.</p>
          ) : (
            <div className="border rounded-md overflow-auto max-h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Doc #</TableHead>
                    <TableHead>WO</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Total Cost</TableHead>
                    <TableHead className="w-[80px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {issues.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.docNumber}</TableCell>
                      <TableCell>{row.woDocNumber}</TableCell>
                      <TableCell>{row.vendorName}</TableCell>
                      <TableCell>{row.issueType}</TableCell>
                      <TableCell>{new Date(row.issuedAt).toLocaleDateString('id-ID')}</TableCell>
                      <TableCell className="text-right">{row.totalCost.toLocaleString()}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => openPrint(row.id)}>
                          <Printer className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!printIssueId} onOpenChange={(open) => !open && closePrint()}>
        <DialogContent className="max-w-lg no-print">
          <style
            dangerouslySetInnerHTML={{
              __html: `@media print { .no-print { display: none !important; } }`,
            }}
          />
          <DialogHeader>
            <DialogTitle>Nota ke CMT</DialogTitle>
          </DialogHeader>
          {printData ? (
            <div className="space-y-4">
              <div className="text-sm space-y-1">
                <p><span className="text-muted-foreground">Doc:</span> {printData.docNumber}</p>
                <p><span className="text-muted-foreground">WO:</span> {printData.woDocNumber}</p>
                <p><span className="text-muted-foreground">Vendor:</span> {printData.vendorName}</p>
                <p><span className="text-muted-foreground">Date:</span> {new Date(printData.issuedAt).toLocaleDateString('id-ID')}</p>
                <p><span className="text-muted-foreground">Type:</span> {printData.issueType}</p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>UOM</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {printData.lines.map((line, i) => (
                    <TableRow key={i}>
                      <TableCell>{line.itemName}</TableCell>
                      <TableCell className="text-right">{line.qty.toLocaleString()}</TableCell>
                      <TableCell>{line.uomCode}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="font-semibold">Total cost: {printData.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
              <div className="flex gap-2 no-print">
                <Button variant="outline" onClick={closePrint}>Close</Button>
                <Button onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print</Button>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">Loading...</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
