'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, Controller } from 'react-hook-form';
import * as z from 'zod';
import {
  Plus,
  Search,
  Building2,
  CreditCard,
  Lock,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { PinAuthModal } from '@/components/security/PinAuthModal';
import { useSorotBaris } from '@/components/gerak/useSorotBaris';
import { toast } from 'sonner';
import { queueOperation } from '@/lib/offline/db';
import { isOnline } from '@/lib/offline/sync';
import { Pager } from '@/components/Pager';
import { PilihTampilan } from '@/components/tampilan/PilihTampilan';
import type { AktivitasBaris } from '@/lib/suppliers/aktivitas-queries';
import {
  ambilTampilanTersimpan,
  ingatTampilan,
  JENIS_TAMPILAN,
  kunciSimpanTampilan,
  type JenisTampilan,
} from '@/lib/tampilan/tampilan';
import { TampilanPemasok } from './TampilanPemasok';
import {
  aksiPemasok,
  alamatSaringPemasok,
  bisaDipilihDiPo,
  UKURAN_PAPAN_PEMASOK,
  type SaringPemasok,
  type StatusPersetujuanPemasok,
} from './status-pemasok';

interface SupplierTypeOption {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number | null;
}

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
  status?: StatusPersetujuanPemasok;
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

/** Nilai Select untuk "semua" — Select tidak menerima string kosong. */
const SEMUA = 'all';
const PATH = '/backoffice/suppliers';

/** Lencana persetujuan: satu tempat untuk tabel dan rincian. */
function LencanaPersetujuan({ status, t }: { status?: StatusPersetujuanPemasok; t: Translate }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  if (status === 'ACTIVE') {
    return (
      <Badge
        variant="outline"
        className="bg-green-100 text-green-800 border-green-200 dark:bg-green-900 dark:text-green-200 dark:border-green-700"
      >
        {t('approvalApproved')}
      </Badge>
    );
  }
  return (
    <Badge variant={status === 'PENDING_APPROVAL' ? 'secondary' : 'destructive'}>
      {status === 'PENDING_APPROVAL' ? t('statusPendingApproval') : t('statusRejected')}
    </Badge>
  );
}

export function SuppliersPageClient({
  awal,
  izin,
  tampilanDariAlamat,
  userId,
}: {
  awal: SaringPemasok;
  izin: string[];
  /** Alamat membawa `?tampilan=` sendiri — pilihan tersimpan di perangkat tidak dipakai. */
  tampilanDariAlamat: boolean;
  userId: string;
}) {
  const t = useTranslations('toasts');
  const tSecurity = useTranslations('security');
  const tSupplier = useTranslations('supplier');
  const tUi = useTranslations('ui');
  const supplierSchema = useMemo(() => makeSupplierSchema(tSupplier), [tSupplier]);
  const aksi = aksiPemasok(izin);
  const { data: session } = useSession();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  // Pemasok yang baru disetujui/ditolak menyala sebentar di barisnya.
  const { sorot, tandai } = useSorotBaris(
    'pemasok',
    suppliers.map((s) => ({ id: s.id, tanda: s.status ?? '' })),
  );
  const [supplierTypes, setSupplierTypes] = useState<SupplierTypeOption[]>([]);
  const [saring, setSaring] = useState<SaringPemasok>(awal);
  const [searchInput, setSearchInput] = useState(awal.cari);
  // Navigasi ke alamat lain di halaman yang sama (mis. menu samping ke daftar
  // tanpa saringan) membawa `awal` baru; ikuti alamatnya, jangan saringan lama.
  const alamatAwal = alamatSaringPemasok(PATH, awal);
  const [alamatAwalTerakhir, setAlamatAwalTerakhir] = useState(alamatAwal);
  if (alamatAwal !== alamatAwalTerakhir) {
    setAlamatAwalTerakhir(alamatAwal);
    if (alamatAwal !== alamatSaringPemasok(PATH, saring)) {
      setSaring(awal);
      setSearchInput(awal.cari);
    }
  }
  const [isLoading, setIsLoading] = useState(true);
  const [supplierDialogMode, setSupplierDialogMode] = useState<'create' | 'edit' | null>(null);
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [decryptedBankAccount, setDecryptedBankAccount] = useState<string>('');
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [bankPinModalOpen, setBankPinModalOpen] = useState(false);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<Supplier | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deletePinModalOpen, setDeletePinModalOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [isApproving, setIsApproving] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  // Ringkasan kerja per pemasok (PO, SPK, utang, terakhir, WhatsApp); null = sedang dimuat.
  const [aktivitas, setAktivitas] = useState<Record<string, AktivitasBaris> | null>(null);
  const kunciTampilan = kunciSimpanTampilan('pemasok', userId);
  const modePapan = saring.tampilan === 'papan';

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

  /** Ubah saringan dan tulis ke alamat, supaya daftar tersaring bisa dibagikan. */
  const ubahSaring = (patch: Partial<SaringPemasok>) => {
    const baru = { ...saring, ...patch };
    setSaring(baru);
    try {
      window.history.replaceState(window.history.state, '', alamatSaringPemasok(PATH, baru));
    } catch {
      // Alamat hanya kenyamanan; daftar tetap tersaring.
    }
  };

  const fetchSuppliers = async () => {
    setIsLoading(true);
    try {
      const { getSuppliers, getSupplierActivityAction } = await import('@/app/actions/suppliers');
      const status = (saring.status || undefined) as import('@/lib/constants/enums').SupplierStatus | undefined;
      const search = saring.cari.trim() || undefined;
      const json = await getSuppliers(
        { search, typeId: saring.jenis || undefined, status },
        // Papan menampilkan semua pemasok per jenis sekaligus, tidak per halaman.
        modePapan ? { page: 1, pageSize: UKURAN_PAPAN_PEMASOK } : { page: saring.page, pageSize: saring.pageSize },
      );
      let daftar: Supplier[];
      if (json != null && typeof json === 'object' && 'data' in json && 'totalCount' in json) {
        daftar = (Array.isArray(json.data) ? json.data : []) as Supplier[];
        setTotalCount(Number(json.totalCount) || 0);
      } else {
        daftar = (Array.isArray(json) ? json : []) as Supplier[];
        setTotalCount(daftar.length);
      }
      setSuppliers(daftar);
      setAktivitas(null);
      setIsLoading(false);
      // Ringkasan kerja menyusul: daftar sudah tampil, kolomnya terisi sesudahnya.
      getSupplierActivityAction(daftar.map((d) => d.id))
        .then(setAktivitas)
        .catch(() => setAktivitas({}));
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

  // Kotak cari ditunda sebentar supaya tidak memuat ulang di setiap ketukan.
  useEffect(() => {
    if (searchInput === saring.cari) return;
    const timer = setTimeout(() => ubahSaring({ cari: searchInput, page: 1 }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ubahSaring stabil secara makna
  }, [searchInput, saring.cari]);

  useEffect(() => {
    fetchSuppliers();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchSuppliers depends on filters; Tabel↔Galeri tidak memuat ulang
  }, [saring.cari, saring.jenis, saring.status, saring.page, saring.pageSize, modePapan]);

  // Tampilan yang tersimpan di perangkat ini, kecuali alamat sudah memilih sendiri.
  useEffect(() => {
    if (tampilanDariAlamat) return;
    let simpanan: Storage | null = null;
    try {
      simpanan = window.localStorage;
    } catch {
      simpanan = null;
    }
    const tersimpan = ambilTampilanTersimpan(simpanan, kunciTampilan, JENIS_TAMPILAN);
    if (tersimpan && tersimpan !== saring.tampilan) ubahSaring({ tampilan: tersimpan });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sekali saat halaman dibuka
  }, []);

  const ubahTampilan = (v: JenisTampilan) => {
    let simpanan: Storage | null = null;
    try {
      simpanan = window.localStorage;
    } catch {
      simpanan = null;
    }
    ingatTampilan(simpanan, kunciTampilan, v);
    ubahSaring({ tampilan: v, page: v === 'papan' ? 1 : saring.page });
  };

  const isSupplierFormOpen = supplierDialogMode !== null;
  const adaSaringan = Boolean(saring.cari.trim() || saring.jenis || saring.status);

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
        bankAccount: '', // Terenkripsi; kosongkan atau ketik ulang untuk mengganti
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

  const setujui = async (supplier: Supplier) => {
    setIsApproving(true);
    try {
      const { approveSupplierAction } = await import('@/app/actions/suppliers');
      await approveSupplierAction(supplier.id);
      toast.success(tSupplier('approvedToast'));
      tandai(supplier.id);
      fetchSuppliers();
    } catch {
      toast.error(tSupplier('approveFailed'));
    } finally {
      setIsApproving(false);
    }
  };

  const bukaRincian = (supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setDecryptedBankAccount('');
    setIsViewDialogOpen(true);
  };

  return (
    <div className="space-y-6">
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
            {aksi.tambah ? (
              <Button onClick={() => setSupplierDialogMode('create')}>
                <Plus className="mr-2 h-4 w-4" />
                {tSupplier('newSupplier')}
              </Button>
            ) : null}
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

      {/* Cari dan saringan — tersimpan di alamat */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[16rem] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={tSupplier('searchPlaceholder')}
            aria-label={tSupplier('searchPlaceholder')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={saring.jenis || SEMUA}
          onValueChange={(v) => ubahSaring({ jenis: v === SEMUA ? '' : v, page: 1 })}
        >
          <SelectTrigger className="w-[200px]" aria-label={tSupplier('typeFilter')}>
            <SelectValue placeholder={tSupplier('typeFilter')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA}>{tSupplier('allTypes')}</SelectItem>
            {supplierTypes.map((st) => (
              <SelectItem key={st.id} value={st.id}>
                {st.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={saring.status || SEMUA}
          onValueChange={(v) =>
            ubahSaring({ status: v === SEMUA ? '' : (v as StatusPersetujuanPemasok), page: 1 })
          }
        >
          <SelectTrigger className="w-[220px]" aria-label={tSupplier('approvalFilter')}>
            <SelectValue placeholder={tSupplier('approvalFilter')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA}>{tSupplier('allStatuses')}</SelectItem>
            <SelectItem value="PENDING_APPROVAL">{tSupplier('statusPendingApproval')}</SelectItem>
            <SelectItem value="ACTIVE">{tSupplier('approvalApproved')}</SelectItem>
            <SelectItem value="REJECTED">{tSupplier('statusRejected')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            {tSupplier('listTitle')}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({tSupplier('count', { count: totalCount })})
            </span>
          </CardTitle>
          <PilihTampilan nilai={saring.tampilan} pilihan={JENIS_TAMPILAN} onUbah={ubahTampilan} />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : suppliers.length === 0 ? (
            <EmptyState
              icon={Building2}
              title={adaSaringan ? tSupplier('emptyFilteredTitle') : tSupplier('emptyTitle')}
              description={adaSaringan ? tSupplier('emptyFilteredDescription') : tSupplier('emptyDescription')}
              action={
                aksi.tambah ? (
                  <Button variant="outline" onClick={() => setSupplierDialogMode('create')}>
                    <Plus className="mr-2 h-4 w-4" />
                    {tSupplier('newSupplier')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <TampilanPemasok
              tampilan={saring.tampilan}
              pemasok={suppliers}
              aktivitas={aktivitas}
              jenis={supplierTypes}
              izin={izin}
              sibuk={isApproving}
              sorot={sorot}
              aksi={{
                buka: (s) => bukaRincian(s as Supplier),
                setujui: (s) => void setujui(s as Supplier),
                tolak: (s) => {
                  setRejectTargetId(s.id);
                  setRejectReason('');
                },
                ubah: aksi.ubah
                  ? (s) => {
                      setEditSupplier(s as Supplier);
                      setSupplierDialogMode('edit');
                    }
                  : null,
                hapus: aksi.hapus ? (s) => setDeleteConfirmTarget(s as Supplier) : null,
              }}
            />
          )}
        </CardContent>
      </Card>

      {modePapan ? (
        totalCount > UKURAN_PAPAN_PEMASOK ? (
          <p className="text-sm text-muted-foreground">
            {tSupplier('boardTruncated', { shown: UKURAN_PAPAN_PEMASOK, total: totalCount })}
          </p>
        ) : null
      ) : (
        <Pager
          page={saring.page}
          pageSize={saring.pageSize}
          total={totalCount}
          onPageChange={(p) => ubahSaring({ page: p })}
          onPageSizeChange={(size) => ubahSaring({ pageSize: size, page: 1 })}
        />
      )}

      {/* Rincian pemasok */}
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
                <Label className="text-muted-foreground">{tSupplier('approvalLabel')}</Label>
                <div className="mt-1">
                  <LencanaPersetujuan status={selectedSupplier?.status} t={tSupplier} />
                </div>
              </div>
              <div className="col-span-2">
                <Label className="text-muted-foreground">{tSupplier('inPoLabel')}</Label>
                <p className="font-medium">
                  {bisaDipilihDiPo(selectedSupplier?.status) ? tSupplier('inPoYes') : tSupplier('notInPo')}
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

      <AlertDialog
        open={deleteConfirmTarget !== null}
        onOpenChange={(o) => !o && setDeleteConfirmTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tSupplier('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirmTarget ? tSupplier('deleteBody', { name: deleteConfirmTarget.name }) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tUi('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!deleteConfirmTarget) return;
                setDeleteTargetId(deleteConfirmTarget.id);
                setDeleteConfirmTarget(null);
                setDeletePinModalOpen(true);
              }}
            >
              {tUi('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
          <DialogFooter className="items-center">
            {!rejectReason.trim() ? (
              <p className="mr-auto text-xs text-muted-foreground">{tSupplier('rejectNeedsReason')}</p>
            ) : null}
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
                  tandai(rejectTargetId);
                  setRejectTargetId(null);
                  setRejectReason('');
                  fetchSuppliers();
                } catch {
                  toast.error(tSupplier('rejectFailed'));
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
