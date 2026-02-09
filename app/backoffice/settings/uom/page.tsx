'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { createUOM, getUOMs, createUOMConversion, getUOMConversions } from '@/app/actions/uom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const uomSchema = z.object({
  code: z.string().min(1).max(10),
  nameId: z.string().min(1),
  nameEn: z.string().min(1),
  description: z.string().optional(),
});

const conversionSchema = z.object({
  fromUomId: z.string().uuid(),
  toUomId: z.string().uuid(),
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
  const [uoms, setUOMs] = useState<UOM[]>([]);
  const [conversions, setConversions] = useState<Conversion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUOMDialogOpen, setIsUOMDialogOpen] = useState(false);
  const [isConversionDialogOpen, setIsConversionDialogOpen] = useState(false);

  const {
    register: registerUOM,
    handleSubmit: handleSubmitUOM,
    reset: resetUOM,
    formState: { errors: errorsUOM, isSubmitting: isSubmittingUOM },
  } = useForm<UOMFormData>({
    resolver: zodResolver(uomSchema),
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
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [uomsData, conversionsData] = await Promise.all([
        getUOMs(),
        getUOMConversions(),
      ]);
      setUOMs(uomsData);
      setConversions(conversionsData);
    } catch (error) {
      toast.error('Failed to load UOM data');
    } finally {
      setIsLoading(false);
    }
  };

  const onSubmitUOM = async (data: UOMFormData) => {
    try {
      await createUOM(data);
      toast.success('UOM created successfully');
      setIsUOMDialogOpen(false);
      resetUOM();
      fetchData();
    } catch (error: any) {
      toast.error(error.message || 'Failed to create UOM');
    }
  };

  const onSubmitConversion = async (data: ConversionFormData) => {
    try {
      if (data.fromUomId === data.toUomId) {
        toast.error('From and To UOM cannot be the same');
        return;
      }
      await createUOMConversion(data);
      toast.success('Conversion created successfully');
      setIsConversionDialogOpen(false);
      resetConversion();
      fetchData();
    } catch (error: any) {
      toast.error(error.message || 'Failed to create conversion');
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Unit of Measure (UOM)</h1>
          <p className="text-muted-foreground">
            Manage units of measure and conversions
          </p>
        </div>
        <Dialog open={isUOMDialogOpen} onOpenChange={setIsUOMDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New UOM
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New UOM</DialogTitle>
              <DialogDescription>
                Add a new unit of measure to the system
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
                  <Label htmlFor="nameId">Name (Indonesia) *</Label>
                  <Input id="nameId" {...registerUOM('nameId')} />
                  {errorsUOM.nameId && (
                    <p className="text-sm text-destructive">{errorsUOM.nameId.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nameEn">Name (English) *</Label>
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
                  onClick={() => setIsUOMDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmittingUOM}>
                  {isSubmittingUOM && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Create UOM
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* UOM List */}
        <Card>
          <CardHeader>
            <CardTitle>Units of Measure</CardTitle>
            <CardDescription>All active UOMs in the system</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name (ID)</TableHead>
                  <TableHead>Name (EN)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {uoms.map((uom) => (
                  <TableRow key={uom.id}>
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
                <CardTitle>UOM Conversions</CardTitle>
                <CardDescription>Conversion factors between UOMs</CardDescription>
              </div>
              <Dialog open={isConversionDialogOpen} onOpenChange={setIsConversionDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Conversion
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create UOM Conversion</DialogTitle>
                    <DialogDescription>
                      Define conversion factor between two UOMs
                    </DialogDescription>
                  </DialogHeader>
                  <form
                    onSubmit={handleSubmitConversion(onSubmitConversion)}
                    className="space-y-4"
                  >
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="fromUomId">From UOM *</Label>
                        <Select
                          value={watchConversion('fromUomId')}
                          onValueChange={(value) => setValueConversion('fromUomId', value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select UOM" />
                          </SelectTrigger>
                          <SelectContent>
                            {uoms.map((uom) => (
                              <SelectItem key={uom.id} value={uom.id}>
                                {uom.code} - {uom.nameId}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {errorsConversion.fromUomId && (
                          <p className="text-sm text-destructive">
                            {errorsConversion.fromUomId.message}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="toUomId">To UOM *</Label>
                        <Select
                          value={watchConversion('toUomId')}
                          onValueChange={(value) => setValueConversion('toUomId', value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select UOM" />
                          </SelectTrigger>
                          <SelectContent>
                            {uoms.map((uom) => (
                              <SelectItem key={uom.id} value={uom.id}>
                                {uom.code} - {uom.nameId}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
                        Cancel
                      </Button>
                      <Button type="submit" disabled={isSubmittingConversion}>
                        {isSubmittingConversion && (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        )}
                        Create Conversion
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
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead className="text-right">Factor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {conversions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      No conversions defined
                    </TableCell>
                  </TableRow>
                ) : (
                  conversions.map((conv) => (
                    <TableRow key={conv.id}>
                      <TableCell>
                        {conv.fromUom.code} - {conv.fromUom.nameId}
                      </TableCell>
                      <TableCell>
                        {conv.toUom.code} - {conv.toUom.nameId}
                      </TableCell>
                      <TableCell className="text-right">
                        {Number(conv.factor).toLocaleString('id-ID', {
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
    </div>
  );
}
