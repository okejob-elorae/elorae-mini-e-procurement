'use client';

import { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  setupPin,
  getPinAttempts,
  getLastSensitiveAccess,
  adminForcePinReset,
  getUsersForAdmin,
} from '@/app/actions/security/pin-auth';
import { changePassword } from '@/app/actions/security/change-password';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import { Loader2, Shield, History, UserX, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { formatDisplayDateTime } from '@/lib/date-only';
import { TombolBantuan } from '@/components/bantuan/TombolBantuan';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { alasanPinBelum, alasanSandiBelum, SANDI_MIN_KEAMANAN } from "./alasan-keamanan";

export default function SecuritySettingsPage() {
  const locale = useLocale() as 'en' | 'id';
  const t = useTranslations('security');
  const tCommon = useTranslations("common");
  const { data: session, status } = useSession();
  const router = useRouter();

  const actionLabel = (action: string) => {
    try {
      return t(`actions.${action}` as any);
    } catch {
      return action;
    }
  };
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [attempts, setAttempts] = useState<Awaited<ReturnType<typeof getPinAttempts>>>([]);
  const [lastAccess, setLastAccess] = useState<Awaited<ReturnType<typeof getLastSensitiveAccess>>>([]);
  const [users, setUsers] = useState<Awaited<ReturnType<typeof getUsersForAdmin>>>([]);
  const [resetTargetId, setResetTargetId] = useState('');
  const [resetting, setResetting] = useState(false);
  const [konfirmasiReset, setKonfirmasiReset] = useState(false);
  // Nama orang yang PIN-nya akan diatur ulang, dibekukan saat dialog dibuka — tetap terbaca selama dialog menutup.
  const [namaReset, setNamaReset] = useState("");

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
      return;
    }
    if (!session?.user?.id) return;
    getPinAttempts().then(setAttempts);
    getLastSensitiveAccess().then(setLastAccess);
    getUsersForAdmin().then(setUsers);
  }, [status, session?.user?.id, router]);

  const handleSetPin = async () => {
    if (!session?.user?.id) return;
    if (newPin.length < 4 || newPin.length > 6) {
      toast.error(t('pinLengthError'));
      return;
    }
    if (newPin !== confirmPin) {
      toast.error(t('pinMismatch'));
      return;
    }
    setSaving(true);
    try {
      const result = await setupPin(newPin, currentPin || undefined);
      if (result.success) {
        toast.success(result.messageKey ? t(result.messageKey) : result.message);
        setCurrentPin('');
        setNewPin('');
        setConfirmPin('');
        getPinAttempts().then(setAttempts);
        getLastSensitiveAccess().then(setLastAccess);
      } else {
        toast.error(result.messageKey ? t(result.messageKey) : result.message);
      }
    } catch {
      toast.error(t('pinSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!session?.user?.id) return;
    if (newPassword.length < SANDI_MIN_KEAMANAN) {
      toast.error(t('passwordMinLength8'));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t('passwordMismatch'));
      return;
    }
    setSavingPassword(true);
    try {
      const result = await changePassword(currentPassword, newPassword);
      if (result.success) {
        toast.success(t('passwordUpdated'));
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        await signOut({ callbackUrl: '/login' });
      } else {
        toast.error(t(result.messageKey));
      }
    } catch {
      toast.error(t('changePasswordFailed'));
    } finally {
      setSavingPassword(false);
    }
  };

  const handleForceReset = async () => {
    if (!session?.user?.id || !resetTargetId) return;
    setResetting(true);
    try {
      const result = await adminForcePinReset(resetTargetId);
      if (result.success) {
        toast.success(result.messageKey ? t(result.messageKey) : result.message);
        setResetTargetId('');
      } else {
        toast.error(result.messageKey ? t(result.messageKey) : result.message);
      }
    } catch {
      toast.error(t('resetPinFailed'));
    } finally {
      setResetting(false);
    }
  };

  const alasanSandi = alasanSandiBelum({ lama: currentPassword, baru: newPassword, ulang: confirmPassword });
  const alasanPin = alasanPinBelum({ baru: newPin, ulang: confirmPin });

  // Sama dengan penjaga di server: izin, bukan kolom peran lama.
  const isAdmin = hasPermission(session?.user?.permissions ?? [], PERMISSIONS.SETTINGS_SECURITY_MANAGE);

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <TombolBantuan judul={t('title')} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            {t('changePassword')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-1 max-w-md">
            <div className="space-y-2">
              <Label htmlFor="current-password">{t('currentPasswordLabel')}</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">{t('newPasswordLabel')}</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">{t('confirmPasswordLabel')}</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={handleChangePassword} disabled={savingPassword || alasanSandi !== null}>
                {savingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : t('savePassword')}
              </Button>
              {alasanSandi ? (
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  {t(`belum.${alasanSandi}`, { min: SANDI_MIN_KEAMANAN })}
                </p>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            {t("setPinV2")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-1 max-w-md">
            <div className="space-y-2">
              <Label htmlFor="current-pin">{t("currentPinLabelV2")}</Label>
              <Input
                id="current-pin"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={currentPin}
                onChange={(e) => setCurrentPin((e.target?.value ?? '').replace(/\D/g, ''))}
                placeholder="****"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-pin">{t('newPinLabel')}</Label>
              <Input
                id="new-pin"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={newPin}
                onChange={(e) => setNewPin((e.target?.value ?? '').replace(/\D/g, ''))}
                placeholder="****"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-pin">{t('confirmPinLabel')}</Label>
              <Input
                id="confirm-pin"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={confirmPin}
                onChange={(e) => setConfirmPin((e.target?.value ?? '').replace(/\D/g, ''))}
                placeholder="****"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={handleSetPin} disabled={saving || alasanPin !== null}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t('savePin')}
              </Button>
              {alasanPin ? (
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  {t(`belum.${alasanPin}`)}
                </p>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            {t('lastAccessTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {lastAccess.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('noHistory')}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {lastAccess.map((a) => (
                <li key={a.action}>
                  <span className="font-medium">{actionLabel(a.action)}</span>
                  {' — '}
                  {formatDisplayDateTime(a.at, locale)}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('attemptsTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md overflow-auto max-h-[280px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('attemptsTableTime')}</TableHead>
                  <TableHead>{t('attemptsTableAction')}</TableHead>
                  <TableHead>{t('attemptsTableStatus')}</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attempts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-sm">{formatDisplayDateTime(a.createdAt, locale)}</TableCell>
                    <TableCell>{actionLabel(a.action)}</TableCell>
                    <TableCell>{a.success ? t('success') : t('failed')}</TableCell>
                    <TableCell className="text-muted-foreground">{a.ipAddress ?? '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {attempts.length === 0 && (
            <p className="text-muted-foreground text-sm py-4">{t('noHistory')}</p>
          )}
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserX className="h-5 w-5" />
              {t("forceResetTitleV2")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 items-end">
            <SearchableCombobox
              options={users.map((u) => ({
                value: u.id,
                label: `${u.name || u.email} (${u.email})`,
              }))}
              value={resetTargetId}
              onValueChange={setResetTargetId}
              placeholder={t('selectUser')}
              triggerClassName="w-[280px]"
            />
            <Button variant="destructive" onClick={() => {
                const target = users.find((u) => u.id === resetTargetId);
                setNamaReset(target ? target.name || target.email : "");
                setKonfirmasiReset(true);
              }} disabled={!resetTargetId || resetting}>
              {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : t("resetPinV2")}
            </Button>
            {!resetTargetId ? (
              <p className="self-center text-xs text-muted-foreground">{t("belum.resetUser")}</p>
            ) : null}
          </CardContent>
        </Card>
      )}

      <AlertDialog open={konfirmasiReset} onOpenChange={(buka) => !resetting && setKonfirmasiReset(buka)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("resetConfirmTitle", { nama: namaReset })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("resetConfirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={resetting}
              onClick={(e) => {
                e.preventDefault();
                void handleForceReset().finally(() => setKonfirmasiReset(false));
              }}
            >
              {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : t("resetPinV2")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
