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
import { Loader2, Shield, History, UserX, Lock } from 'lucide-react';
import { toast } from 'sonner';

export default function SecuritySettingsPage() {
  const locale = useLocale() as 'en' | 'id';
  const t = useTranslations('security');
  const { data: session, status } = useSession();
  const router = useRouter();
  const dateLocale = locale === 'id' ? 'id-ID' : 'en-US';

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

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
      return;
    }
    if (!session?.user?.id) return;
    getPinAttempts(session.user.id).then(setAttempts);
    getLastSensitiveAccess(session.user.id).then(setLastAccess);
    getUsersForAdmin(session.user.id).then(setUsers);
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
      const result = await setupPin(session.user.id, newPin, currentPin || undefined);
      if (result.success) {
        toast.success(result.messageKey ? t(result.messageKey) : result.message);
        setCurrentPin('');
        setNewPin('');
        setConfirmPin('');
        getPinAttempts(session.user.id).then(setAttempts);
        getLastSensitiveAccess(session.user.id).then(setLastAccess);
      } else {
        toast.error(result.messageKey ? t(result.messageKey) : result.message);
      }
    } catch (_e) {
      toast.error(t('pinSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!session?.user?.id) return;
    if (newPassword.length < 6) {
      toast.error(t('passwordMinLength'));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t('passwordMismatch'));
      return;
    }
    setSavingPassword(true);
    try {
      const result = await changePassword(session.user.id, currentPassword, newPassword);
      if (result.success) {
        toast.success(t('passwordUpdated'));
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        await signOut({ callbackUrl: '/login' });
      } else {
        toast.error(t(result.messageKey));
      }
    } catch (_e) {
      toast.error(t('changePasswordFailed'));
    } finally {
      setSavingPassword(false);
    }
  };

  const handleForceReset = async () => {
    if (!session?.user?.id || !resetTargetId) return;
    setResetting(true);
    try {
      const result = await adminForcePinReset(session.user.id, resetTargetId);
      if (result.success) {
        toast.success(result.messageKey ? t(result.messageKey) : result.message);
        setResetTargetId('');
      } else {
        toast.error(result.messageKey ? t(result.messageKey) : result.message);
      }
    } catch (_e) {
      toast.error(t('resetPinFailed'));
    } finally {
      setResetting(false);
    }
  };

  const isAdmin = session?.user?.role === 'ADMIN';

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            {t('changePassword')}
          </CardTitle>
          <CardDescription>{t('changePasswordDescription')}</CardDescription>
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
            <Button
              onClick={handleChangePassword}
              disabled={
                savingPassword ||
                !currentPassword.trim() ||
                !newPassword.trim() ||
                newPassword !== confirmPassword ||
                newPassword.length < 6
              }
            >
              {savingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : t('savePassword')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            {t('setPin')}
          </CardTitle>
          <CardDescription>{t('pinCardDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-1 max-w-md">
            <div className="space-y-2">
              <Label>{t('currentPinLabel')}</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={currentPin}
                onChange={(e) => setCurrentPin((e.target?.value ?? '').replace(/\D/g, ''))}
                placeholder="****"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('newPinLabel')}</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={newPin}
                onChange={(e) => setNewPin((e.target?.value ?? '').replace(/\D/g, ''))}
                placeholder="****"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('confirmPinLabel')}</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={confirmPin}
                onChange={(e) => setConfirmPin((e.target?.value ?? '').replace(/\D/g, ''))}
                placeholder="****"
              />
            </div>
            <Button onClick={handleSetPin} disabled={saving || newPin.length < 4 || newPin !== confirmPin}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t('savePin')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            {t('lastAccessTitle')}
          </CardTitle>
          <CardDescription>{t('lastAccessDescription')}</CardDescription>
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
                  {new Date(a.at).toLocaleString(dateLocale)}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('attemptsTitle')}</CardTitle>
          <CardDescription>{t('attemptsDescription')}</CardDescription>
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
                    <TableCell className="text-sm">{new Date(a.createdAt).toLocaleString(dateLocale)}</TableCell>
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
              {t('forceResetTitle')}
            </CardTitle>
            <CardDescription>{t('resetPinDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 items-end">
            <Select value={resetTargetId} onValueChange={setResetTargetId}>
              <SelectTrigger className="w-[280px]">
                <SelectValue placeholder={t('selectUser')} />
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name || u.email} ({u.email})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="destructive" onClick={handleForceReset} disabled={!resetTargetId || resetting}>
              {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : t('resetPin')}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
