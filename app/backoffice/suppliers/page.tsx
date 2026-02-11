'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import {
  Plus,
  Search,
  MoreHorizontal,
  Edit,
  Trash2,
  Eye,
  Building2,
  Phone,
  Mail,
  MapPin,
  CreditCard,
  Lock,
  Loader2,
} from 'lucide-react';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { PinAuthModal } from '@/components/security/PinAuthModal';
import { verifyPinForAction } from '@/app/actions/security/pin-auth';
import { toast } from 'sonner';
import { SupplierType } from '@/lib/constants/enums';
import { queueOperation } from '@/lib/offline/db';
import { isOnline } from '@/lib/offline/sync';

interface Supplier {
  id: string;
  code: string;
  name: string;
  type: SupplierType;
  category?: { id: string; nameId: string; nameEn: string } | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  bankName: string | null;
  bankAccountEnc: string | null;
  bankAccountName: string | null;
  isActive: boolean;
}

const supplierSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.nativeEnum(SupplierType),
  categoryId: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  bankAccountName: z.string().optional(),
});

type SupplierForm = z.infer<typeof supplierSchema>;

const supplierTypeLabels: Record<SupplierType, string> = {
  FABRIC: 'Fabric Supplier',
  ACCESSORIES: 'Accessories Supplier',
  TAILOR: 'Tailor/Production',
  OTHER: 'Other',
};

export default function SuppliersPage() {
  const { data: session } = useSession();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [decryptedBankAccount, setDecryptedBankAccount] = useState<string>('');
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [bankPinModalOpen, setBankPinModalOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deletePinModalOpen, setDeletePinModalOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
    setValue,
  } = useForm<SupplierForm>({
    resolver: zodResolver(supplierSchema),
    defaultValues: {
      type: SupplierType.FABRIC,
    },
  });

  const fetchSuppliers = async () => {
    try {
      const response = await fetch('/api/suppliers');
      if (response.ok) {
        const data = await response.json();
        setSuppliers(data);
      }
    } catch (error) {
      console.error('Failed to fetch suppliers:', error);
      toast.error('Failed to load suppliers');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSuppliers();
  }, []);

  const onSubmit = async (data: SupplierForm) => {
    try {
      if (!isOnline()) {
        // Queue for offline sync
        await queueOperation('SUPPLIER_CREATE', data);
        toast.success('Supplier queued for sync (offline mode)');
        setIsCreateDialogOpen(false);
        reset();
        return;
      }

      const response = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (response.ok) {
        toast.success('Supplier created successfully');
        setIsCreateDialogOpen(false);
        reset();
        fetchSuppliers();
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to create supplier');
      }
    } catch (_error) {
      toast.error('An error occurred');
    }
  };

  const handleDeleteClick = (id: string) => {
    if (!confirm('Are you sure you want to delete this supplier?')) return;
    setDeleteTargetId(id);
    setDeletePinModalOpen(true);
  };

  const handleDeletePinConfirm = async (pin: string) => {
    if (!session?.user?.id || !deleteTargetId) return;

    const result = await verifyPinForAction(session.user.id, pin, 'DELETE_SUPPLIER');
    if (!result.success) {
      toast.error(result.message);
      throw new Error(result.message);
    }

    try {
      const response = await fetch(`/api/suppliers/${deleteTargetId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        toast.success('Supplier deleted successfully');
        fetchSuppliers();
        setDeletePinModalOpen(false);
        setDeleteTargetId(null);
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to delete supplier');
        throw new Error(error.error);
      }
    } catch (e: any) {
      toast.error('Failed to delete supplier');
      throw e;
    }
  };

  const handleViewBankAccountConfirm = async (pin: string) => {
    if (!selectedSupplier?.id) return;

    setIsDecrypting(true);
    try {
      const response = await fetch(`/api/suppliers/${selectedSupplier.id}/decrypt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });

      if (response.ok) {
        const data = await response.json();
        setDecryptedBankAccount(data.bankAccount);
        toast.success('Bank account decrypted');
        setBankPinModalOpen(false);
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to decrypt bank account');
        throw new Error(error.error || 'Failed');
      }
    } finally {
      setIsDecrypting(false);
    }
  };

  const filteredSuppliers = suppliers.filter(
    (s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Suppliers</h1>
          <p className="text-muted-foreground">
            Manage your fabric, accessories, and production vendors
          </p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Supplier
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New Supplier</DialogTitle>
              <DialogDescription>
                Add a new supplier to your database
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Supplier Name *</Label>
                <Input id="name" {...register('name')} />
                {errors.name && (
                  <p className="text-sm text-destructive">{errors.name.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="type">Supplier Type *</Label>
                <Select
                  onValueChange={(value) => setValue('type', value as SupplierType)}
                  defaultValue={SupplierType.FABRIC}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(supplierTypeLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">Address</Label>
                <Input id="address" {...register('address')} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" {...register('phone')} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" {...register('email')} />
                  {errors.email && (
                    <p className="text-sm text-destructive">{errors.email.message}</p>
                  )}
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="text-sm font-medium mb-3">Bank Information</h4>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="bankName">Bank Name</Label>
                    <Input id="bankName" {...register('bankName')} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bankAccount">Account Number</Label>
                    <Input id="bankAccount" {...register('bankAccount')} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bankAccountName">Account Holder Name</Label>
                    <Input id="bankAccountName" {...register('bankAccountName')} />
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsCreateDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create Supplier
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search suppliers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Suppliers List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredSuppliers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No suppliers found</p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => setIsCreateDialogOpen(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add your first supplier
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredSuppliers.map((supplier) => (
            <Card key={supplier.id} className="group">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{supplier.name}</CardTitle>
                    <CardDescription>{supplier.code}</CardDescription>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          setSelectedSupplier(supplier);
                          setDecryptedBankAccount('');
                          setIsViewDialogOpen(true);
                        }}
                      >
                        <Eye className="mr-2 h-4 w-4" />
                        View Details
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <Edit className="mr-2 h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => handleDeleteClick(supplier.id)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <Badge variant={supplier.isActive ? 'default' : 'secondary'}>
                  {supplierTypeLabels[supplier.type]}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                {supplier.phone && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="h-4 w-4" />
                    {supplier.phone}
                  </div>
                )}
                {supplier.email && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Mail className="h-4 w-4" />
                    {supplier.email}
                  </div>
                )}
                {supplier.address && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    {supplier.address}
                  </div>
                )}
                {supplier.bankAccountEnc && (
                  <div className="flex items-center gap-2 text-sm">
                    <CreditCard className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">••••••••••</span>
                    <Lock className="h-3 w-3 text-muted-foreground" />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* View Supplier Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{selectedSupplier?.name}</DialogTitle>
            <DialogDescription>{selectedSupplier?.code}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground">Type</Label>
                <p className="font-medium">
                  {selectedSupplier?.type && supplierTypeLabels[selectedSupplier.type]}
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">Status</Label>
                <p className="font-medium">
                  {selectedSupplier?.isActive ? 'Active' : 'Inactive'}
                </p>
              </div>
            </div>

            {selectedSupplier?.phone && (
              <div>
                <Label className="text-muted-foreground">Phone</Label>
                <p className="font-medium">{selectedSupplier.phone}</p>
              </div>
            )}

            {selectedSupplier?.email && (
              <div>
                <Label className="text-muted-foreground">Email</Label>
                <p className="font-medium">{selectedSupplier.email}</p>
              </div>
            )}

            {selectedSupplier?.address && (
              <div>
                <Label className="text-muted-foreground">Address</Label>
                <p className="font-medium">{selectedSupplier.address}</p>
              </div>
            )}

            {selectedSupplier?.bankAccountEnc && (
              <div className="border-t pt-4">
                <Label className="text-muted-foreground">Bank Account</Label>
                <div className="mt-2 space-y-3">
                  <p className="font-medium">{selectedSupplier.bankName}</p>
                  <p className="font-medium">{selectedSupplier.bankAccountName}</p>

                  {decryptedBankAccount ? (
                    <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                      <CreditCard className="h-4 w-4" />
                      <span className="font-mono">{decryptedBankAccount}</span>
                    </div>
                  ) : (
                    <Button
                      onClick={() => setBankPinModalOpen(true)}
                      disabled={isDecrypting}
                      className="w-full"
                    >
                      {isDecrypting && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      <Lock className="mr-2 h-4 w-4" />
                      View Account Number
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <PinAuthModal
        isOpen={bankPinModalOpen}
        onClose={() => setBankPinModalOpen(false)}
        onConfirm={handleViewBankAccountConfirm}
        action="melihat nomor rekening bank"
      />
      <PinAuthModal
        isOpen={deletePinModalOpen}
        onClose={() => {
          setDeletePinModalOpen(false);
          setDeleteTargetId(null);
        }}
        onConfirm={handleDeletePinConfirm}
        action="menghapus supplier"
      />
    </div>
  );
}
