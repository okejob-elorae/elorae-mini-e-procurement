'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, Controller } from 'react-hook-form';
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
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { Role } from '@/lib/constants/enums';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { CategoryBadge } from '@/components/ui/category-badge';
import { PinAuthModal } from '@/components/security/PinAuthModal';
import { toast } from 'sonner';
import { queueOperation } from '@/lib/offline/db';
import { isOnline } from '@/lib/offline/sync';
import { Pagination } from '@/components/ui/pagination';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants/pagination';

interface SupplierTypeOption {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number | null;
}

type SupplierStatus = 'PENDING_APPROVAL' | 'ACTIVE' | 'REJECTED';

interface Supplier {
  id: string;
  code: string;
  name: string;
  typeId: string;
  type?: { id: string; code: string; name: string } | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  bankName: string | null;
  bankAccountEnc: string | null;
  bankAccountName: string | null;
  isActive: boolean;
  status?: SupplierStatus;
}

type Translate = ReturnType<typeof useTranslations>;

function makeSupplierSchema(t: Translate) {
  return z.object({
    code: z.string().optional(),
    name: z.string().min(1, t('nameRequired')),
    typeId: z.string().min(1, t('typeRequired')),
    address: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email(t('invalidEmail')).optional().or(z.literal('')),
    bankName: z.string().optional(),
    bankAccount: z.string().optional(),
    bankAccountName: z.string().optional(),
  });
}

type SupplierForm = z.infer<ReturnType<typeof makeSupplierSchema>>;

export default function SuppliersPage() {
  const t = useTranslations('toasts');
  const tSecurity = useTranslations('security');
  const tSupplier = useTranslations('supplier');
  const tUi = useTranslations('ui');
  const supplierSchema = useMemo(() => makeSupplierSchema(tSupplier), [tSupplier]);
  const { data: session } = useSession();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierTypes, setSupplierTypes] = useState<SupplierTypeOption[]>([]);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [supplierDialogMode, setSupplierDialogMode] = useState<'create' | 'edit' | null>(null);
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [decryptedBankAccount, setDecryptedBankAccount] = useState<string>('');
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [bankPinModalOpen, setBankPinModalOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deletePinModalOpen, setDeletePinModalOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [isApproving, setIsApproving] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);
  const [totalCount, setTotalCount] = useState(0);

  const {
    register,
    handleSubmit,
    reset,
    clearErrors,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<SupplierForm>({
    resolver: zodResolver(supplierSchema),
    defaultValues: {
      typeId: '',
    },
  });

  const fetchSuppliers = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      if (typeFilter) params.set('typeId', typeFilter);
      if (statusFilter) params.set('status', statusFilter);
      const { getSuppliers } = await import('@/app/actions/suppliers');
      const json = await getSuppliers(
        {
          search: searchQuery.trim() || undefined,
          typeId: typeFilter || undefined,
          status: (statusFilter || undefined) as import('@/lib/constants/enums').SupplierStatus | undefined,
        },
        { page, pageSize }
      );
      if (json != null && typeof json === 'object' && 'data' in json && 'totalCount' in json) {
        setSuppliers((Array.isArray(json.data) ? json.data : []) as Supplier[]);
        setTotalCount(Number(json.totalCount) || 0);
      } else {
        const list = Array.isArray(json) ? json : [];
        setSuppliers(list as Supplier[]);
        setTotalCount(list.length);
      }
    } catch (error) {
      console.error('Failed to fetch suppliers:', error);
      toast.error(t('failedToLoadSuppliers'));
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSupplierTypes = async () => {
    try {
      const { listSupplierTypesAction } = await import('@/app/actions/supplier-types');
      const data = await listSupplierTypesAction({ activeOnly: true });
      const list = Array.isArray(data) ? data : (data as { data?: unknown[] })?.data;
      setSupplierTypes((Array.isArray(list) ? list : []) as SupplierTypeOption[]);
    } catch (e) {
      console.error('Failed to fetch supplier types:', e);
    }
  };

  useEffect(() => {
    fetchSupplierTypes();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, typeFilter, statusFilter]);

  useEffect(() => {
    fetchSuppliers();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchSuppliers depends on filters
  }, [page, pageSize, searchQuery, typeFilter, statusFilter]);

  const isSupplierFormOpen = supplierDialogMode !== null;

  useEffect(() => {
    if (supplierDialogMode === 'create') {
      reset({
        code: '',
        name: '',
        typeId: supplierTypes[0]?.id ?? '',
        address: '',
        phone: '',
        email: '',
        bankName: '',
        bankAccount: '',
        bankAccountName: '',
      });
      clearErrors();
    } else if (supplierDialogMode === 'edit' && editSupplier) {
      reset({
        code: editSupplier.code,
        name: editSupplier.name,
        typeId: editSupplier.typeId,
        address: editSupplier.address ?? '',
        phone: editSupplier.phone ?? '',
        email: editSupplier.email ?? '',
        bankName: editSupplier.bankName ?? '',
        bankAccount: '', // Encrypted; leave blank or user re-enters to change
        bankAccountName: editSupplier.bankAccountName ?? '',
      });
      clearErrors();
    }
  }, [supplierDialogMode, editSupplier, supplierTypes, reset, clearErrors]);

  const onSubmit = async (data: SupplierForm) => {
    const isEdit = !!editSupplier;
    try {
      if (!isOnline()) {
        if (isEdit) {
          toast.error(t('editingNotAvailableOffline'));
          return;
        }
        await queueOperation('SUPPLIER_CREATE', data);
        toast.success(t('supplierQueuedForSync'));
        setSupplierDialogMode(null);
        setEditSupplier(null);
        reset();
        return;
      }

      const {
        createSupplierAction,
        updateSupplierAction,
      } = await import('@/app/actions/suppliers');
      try {
        if (isEdit) {
          await updateSupplierAction(editSupplier!.id, data);
        } else {
          await createSupplierAction(data);
        }
        toast.success(isEdit ? t('supplierUpdatedSuccessfully') : t('supplierCreatedSuccessfully'));
        setSupplierDialogMode(null);
        setEditSupplier(null);
        reset();
        fetchSuppliers();
        return;
      } catch (actionError: unknown) {
        const error =
          actionError instanceof Error
            ? { error: actionError.message, details: undefined }
            : { error: t('anErrorOccurred'), details: undefined };
        const details = error?.details as Array<{ path: (string | number)[]; message: string }> | undefined;
        const formKeys: (keyof SupplierForm)[] = [
          'code', 'name', 'typeId', 'address', 'phone', 'email',
          'bankName', 'bankAccount', 'bankAccountName',
        ];
        if (Array.isArray(details) && details.length > 0) {
          details.forEach((issue) => {
            const field = issue.path[0];
            if (typeof field === 'string' && formKeys.includes(field as keyof SupplierForm)) {
              setError(field as keyof SupplierForm, {
                type: 'server',
                message: issue.message,
              });
            }
          });
          toast.error(t('pleaseFixErrorsBelow'));
        } else {
          toast.error(error.error || (isEdit ? t('failedToUpdateSupplier') : t('failedToCreateSupplier')));
        }
      }
    } catch {
      toast.error(t('anErrorOccurred'));
    }
  };

  const handleDeleteClick = (id: string) => {
    if (!confirm(tSupplier('deleteConfirm'))) return;
    setDeleteTargetId(id);
    setDeletePinModalOpen(true);
  };

  const handleDeletePinConfirm = async (pin: string) => {
    if (!session?.user?.id || !deleteTargetId) return;

    // PIN diperiksa di server oleh aksi hapus itu sendiri.
    const { deleteSupplierAction } = await import('@/app/actions/suppliers');
    const deleteResult = await deleteSupplierAction(deleteTargetId, pin);
    if (!deleteResult.success) {
      const msg =
        'securityMessageKey' in deleteResult
          ? tSecurity(deleteResult.securityMessageKey)
          : t(deleteResult.messageKey);
      toast.error(msg);
      throw new Error(msg);
    }
    toast.success(t('supplierDeletedSuccessfully'));
    fetchSuppliers();
    setDeletePinModalOpen(false);
    setDeleteTargetId(null);
  };

  const handleViewBankAccountConfirm = async (pin: string) => {
    if (!selectedSupplier?.id) return;

    setIsDecrypting(true);
    try {
      const { decryptSupplierBankAction } = await import('@/app/actions/suppliers');
      const data = await decryptSupplierBankAction(selectedSupplier.id, pin);
      setDecryptedBankAccount(data.bankAccount);
      toast.success(t('bankAccountDecrypted'));
      setBankPinModalOpen(false);
    } finally {
      setIsDecrypting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title={tSupplier('pageTitle')}
        actions={
          <Dialog
            open={isSupplierFormOpen}
            onOpenChange={(open) => {
              if (open) {
                setSupplierDialogMode('create');
              } else {
                setSupplierDialogMode(null);
                setEditSupplier(null);
              }
            }}
          >
            <Button onClick={() => setSupplierDialogMode('create')}>
              <Plus className="mr-2 h-4 w-4" />
              {tSupplier('newSupplier')}
            </Button>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {supplierDialogMode === 'edit' ? tSupplier('editSupplier') : tSupplier('createSupplier')}
                </DialogTitle>
                <DialogDescription>
                  {supplierDialogMode === 'edit'
                    ? tSupplier('editDescription')
                    : tSupplier('createDescription')}
                </DialogDescription>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  clearErrors();
                  handleSubmit(onSubmit)(e);
                }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="code">{tSupplier('codeOptional')}</Label>
                  <Input
                    id="code"
                    {...register('code')}
                    placeholder={tSupplier('codePlaceholder')}
                    aria-invalid={!!errors.code}
                    className={errors.code ? 'border-destructive focus-visible:ring-destructive/20' : ''}
                  />
                  {errors.code && (
                    <p className="text-sm text-destructive" role="alert">
                      {errors.code.message}
                    </p>
                  )}
                </div>
    
                <div className="space-y-2">
                  <Label htmlFor="name">{tSupplier('name')} *</Label>
                  <Input
                    id="name"
                    {...register('name')}
                    aria-invalid={!!errors.name}
                    className={errors.name ? 'border-destructive focus-visible:ring-destructive/20' : ''}
                  />
                  {errors.name && (
                    <p className="text-sm text-destructive" role="alert">
                      {errors.name.message}
                    </p>
                  )}
                </div>
    
                <div className="space-y-2">
                  <Label htmlFor="typeId">{tSupplier('type')} *</Label>
                  <Controller
                    name="typeId"
                    control={control}
                    render={({ field }) => (
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger
                          id="typeId"
                          aria-invalid={!!errors.typeId}
                          className={errors.typeId ? 'border-destructive focus-visible:ring-destructive/20' : ''}
                        >
                          <SelectValue placeholder={tSupplier('selectType')} />
                        </SelectTrigger>
                        <SelectContent>
                          {supplierTypes.map((st) => (
                            <SelectItem key={st.id} value={st.id}>
                              {st.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {errors.typeId && (
                    <p className="text-sm text-destructive" role="alert">
                      {errors.typeId.message}
                    </p>
                  )}
                </div>
    
                <div className="space-y-2">
                  <Label htmlFor="address">{tSupplier('address')}</Label>
                  <Input
                    id="address"
                    {...register('address')}
                    aria-invalid={!!errors.address}
                    className={errors.address ? 'border-destructive focus-visible:ring-destructive/20' : ''}
                  />
                  {errors.address && (
                    <p className="text-sm text-destructive" role="alert">
                      {errors.address.message}
                    </p>
                  )}
                </div>
    
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone">{tSupplier('phone')}</Label>
                    <Input
                      id="phone"
                      {...register('phone')}
                      aria-invalid={!!errors.phone}
                      className={errors.phone ? 'border-destructive focus-visible:ring-destructive/20' : ''}
                    />
                    {errors.phone && (
                      <p className="text-sm text-destructive" role="alert">
                        {errors.phone.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">{tSupplier('email')}</Label>
                    <Input
                      id="email"
                      type="email"
                      {...register('email')}
                      aria-invalid={!!errors.email}
                      className={errors.email ? 'border-destructive focus-visible:ring-destructive/20' : ''}
                    />
                    {errors.email && (
                      <p className="text-sm text-destructive" role="alert">
                        {errors.email.message}
                      </p>
                    )}
                  </div>
                </div>
    
                <div className="border-t pt-4">
                  <h4 className="text-sm font-medium mb-3">{tSupplier('bankInfo')}</h4>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="bankName">{tSupplier('bankName')}</Label>
                      <Input
                        id="bankName"
                        {...register('bankName')}
                        aria-invalid={!!errors.bankName}
                        className={errors.bankName ? 'border-destructive focus-visible:ring-destructive/20' : ''}
                      />
                      {errors.bankName && (
                        <p className="text-sm text-destructive" role="alert">
                          {errors.bankName.message}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bankAccount">{tSupplier('accountNumber')}</Label>
                      <Input
                        id="bankAccount"
                        {...register('bankAccount')}
                        aria-invalid={!!errors.bankAccount}
                        className={errors.bankAccount ? 'border-destructive focus-visible:ring-destructive/20' : ''}
                      />
                      {errors.bankAccount && (
                        <p className="text-sm text-destructive" role="alert">
                          {errors.bankAccount.message}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bankAccountName">{tSupplier('bankAccountName')}</Label>
                      <Input
                        id="bankAccountName"
                        {...register('bankAccountName')}
                        aria-invalid={!!errors.bankAccountName}
                        className={errors.bankAccountName ? 'border-destructive focus-visible:ring-destructive/20' : ''}
                      />
                      {errors.bankAccountName && (
                        <p className="text-sm text-destructive" role="alert">
                          {errors.bankAccountName.message}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
    
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setSupplierDialogMode(null);
                      setEditSupplier(null);
                    }}
                  >
                    {tUi('cancel')}
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {supplierDialogMode === 'edit' ? tSupplier('updateButton') : tSupplier('createButton')}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {/* Search and filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={tSupplier('searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={typeFilter ?? 'all'}
          onValueChange={(v) => setTypeFilter(v === 'all' ? null : v)}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder={tSupplier('typeFilter')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{tSupplier('allTypes')}</SelectItem>
            {supplierTypes.map((st) => (
              <SelectItem key={st.id} value={st.id}>
                {st.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={statusFilter ?? 'all'}
          onValueChange={(v) => setStatusFilter(v === 'all' ? null : v)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={tSupplier('statusFilter')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{tSupplier('allStatuses')}</SelectItem>
            <SelectItem value="PENDING_APPROVAL">{tSupplier('statusPendingApproval')}</SelectItem>
            <SelectItem value="ACTIVE">{tSupplier('statusActive')}</SelectItem>
            <SelectItem value="REJECTED">{tSupplier('statusRejected')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Suppliers List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : suppliers.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Building2}
              title={
                searchQuery.trim() || typeFilter || statusFilter
                  ? tSupplier('emptyFilteredTitle')
                  : tSupplier('emptyTitle')
              }
              description={
                searchQuery.trim() || typeFilter || statusFilter
                  ? tSupplier('emptyFilteredDescription')
                  : tSupplier('emptyDescription')
              }
              action={
                <Button variant="outline" onClick={() => setSupplierDialogMode('create')}>
                  <Plus className="mr-2 h-4 w-4" />
                  {tSupplier('newSupplier')}
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {suppliers.map((supplier) => (
            <Card key={supplier.id} className="group">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{supplier.name}</CardTitle>
                    <CardDescription>{supplier.code}</CardDescription>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={tSupplier('cardMenu', { name: supplier.name })}
                        title={tSupplier('cardMenu', { name: supplier.name })}
                      >
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
                        {tSupplier('viewDetails')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setEditSupplier(supplier);
                          setSupplierDialogMode('edit');
                        }}
                      >
                        <Edit className="mr-2 h-4 w-4" />
                        {tUi('edit')}
                      </DropdownMenuItem>
                      {supplier.status === 'PENDING_APPROVAL' &&
                        (session?.user as { role?: string })?.role === Role.ADMIN && (
                          <>
                            <DropdownMenuItem
                              onClick={async () => {
                                setIsApproving(true);
                                try {
                                  const { approveSupplierAction } = await import('@/app/actions/suppliers');
                                  await approveSupplierAction(supplier.id);
                                  toast.success(tSupplier('approvedToast'));
                                  fetchSuppliers();
                                } finally {
                                  setIsApproving(false);
                                }
                              }}
                              disabled={isApproving}
                            >
                              <CheckCircle className="mr-2 h-4 w-4" />
                              {tSupplier('approve')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => {
                                setRejectTargetId(supplier.id);
                                setRejectReason('');
                              }}
                            >
                              <XCircle className="mr-2 h-4 w-4" />
                              {tSupplier('reject')}
                            </DropdownMenuItem>
                          </>
                        )}
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => handleDeleteClick(supplier.id)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {tUi('delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  <CategoryBadge label={supplier.type?.name} />
                  {supplier.status && (
                    <Badge
                      variant={
                        supplier.status === 'ACTIVE'
                          ? 'outline'
                          : supplier.status === 'PENDING_APPROVAL'
                            ? 'secondary'
                            : 'destructive'
                      }
                      className={
                        supplier.status === 'ACTIVE'
                          ? 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900 dark:text-green-200 dark:border-green-700'
                          : undefined
                      }
                    >
                      {supplier.status === 'PENDING_APPROVAL'
                        ? tSupplier('statusPending')
                        : supplier.status === 'ACTIVE'
                          ? tSupplier('statusActive')
                          : tSupplier('statusRejected')}
                    </Badge>
                  )}
                </div>
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
        <Pagination
          page={page}
          totalPages={Math.max(1, Math.ceil(totalCount / pageSize))}
          onPageChange={setPage}
          totalCount={totalCount}
          pageSize={pageSize}
        />
        </>
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
                <Label className="text-muted-foreground">{tSupplier('typeFilter')}</Label>
                <p className="font-medium">
                  {selectedSupplier?.type?.name ?? '—'}
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">{tSupplier('statusFilter')}</Label>
                <p className="font-medium">
                  {selectedSupplier?.isActive ? tUi('active') : tUi('inactive')}
                </p>
              </div>
            </div>

            {selectedSupplier?.phone && (
              <div>
                <Label className="text-muted-foreground">{tSupplier('phone')}</Label>
                <p className="font-medium">{selectedSupplier.phone}</p>
              </div>
            )}

            {selectedSupplier?.email && (
              <div>
                <Label className="text-muted-foreground">{tSupplier('email')}</Label>
                <p className="font-medium">{selectedSupplier.email}</p>
              </div>
            )}

            {selectedSupplier?.address && (
              <div>
                <Label className="text-muted-foreground">{tSupplier('address')}</Label>
                <p className="font-medium">{selectedSupplier.address}</p>
              </div>
            )}

            {selectedSupplier?.bankAccountEnc && (
              <div className="border-t pt-4">
                <Label className="text-muted-foreground">{tSupplier('bankAccount')}</Label>
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
                      {tSupplier('viewAccountNumber')}
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
        action={tSupplier('pinActionViewBank')}
      />
      <PinAuthModal
        isOpen={deletePinModalOpen}
        onClose={() => {
          setDeletePinModalOpen(false);
          setDeleteTargetId(null);
        }}
        onConfirm={handleDeletePinConfirm}
        action={tSupplier('pinActionDelete')}
      />

      <Dialog
        open={rejectTargetId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRejectTargetId(null);
            setRejectReason('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tSupplier('rejectTitle')}</DialogTitle>
            <DialogDescription>{tSupplier('rejectDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="reject-reason">{tSupplier('rejectReason')} *</Label>
              <Textarea
                id="reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder={tSupplier('rejectReasonPlaceholder')}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejectTargetId(null);
                setRejectReason('');
              }}
            >
              {tUi('cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || isApproving}
              onClick={async () => {
                if (!rejectTargetId || !rejectReason.trim()) return;
                setIsApproving(true);
                try {
                  const { rejectSupplierAction } = await import('@/app/actions/suppliers');
                  await rejectSupplierAction(rejectTargetId, rejectReason.trim());
                  toast.success(tSupplier('rejectedToast'));
                  setRejectTargetId(null);
                  setRejectReason('');
                  fetchSuppliers();
                } finally {
                  setIsApproving(false);
                }
              }}
            >
              {tSupplier('reject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
