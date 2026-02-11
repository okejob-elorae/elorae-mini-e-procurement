'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { SENSITIVE_ACTIONS } from '@/app/actions/security/pin-constants';
import {
  setupPin,
  getPinAttempts,
  getLastSensitiveAccess,
  adminForcePinReset,
  getUsersForAdmin,
} from '@/app/actions/security/pin-auth';
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
import { Loader2, Shield, History, UserX } from 'lucide-react';
import { toast } from 'sonner';

const ACTION_LABELS: Record<string, string> = {
  VIEW_BANK_ACCOUNT: 'View bank account',
  STOCK_ADJUSTMENT: 'Stock adjustment',
  VOID_DOCUMENT: 'Void document',
  EDIT_POSTED_PO: 'Edit posted PO',
  DELETE_SUPPLIER: 'Delete supplier',
};

export default function SecuritySettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [saving, setSaving] = useState(false);
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
      toast.error('PIN harus 4–6 digit');
      return;
    }
    if (newPin !== confirmPin) {
      toast.error('PIN baru dan konfirmasi tidak sama');
      return;
    }
    setSaving(true);
    try {
      const result = await setupPin(session.user.id, newPin, currentPin || undefined);
      if (result.success) {
        toast.success(result.message);
        setCurrentPin('');
        setNewPin('');
        setConfirmPin('');
        getPinAttempts(session.user.id).then(setAttempts);
        getLastSensitiveAccess(session.user.id).then(setLastAccess);
      } else {
        toast.error(result.message);
      }
    } catch (_e) {
      toast.error('Gagal menyimpan PIN');
    } finally {
      setSaving(false);
    }
  };

  const handleForceReset = async () => {
    if (!session?.user?.id || !resetTargetId) return;
    setResetting(true);
    try {
      const result = await adminForcePinReset(session.user.id, resetTargetId);
      if (result.success) {
        toast.success(result.message);
        setResetTargetId('');
      } else {
        toast.error(result.message);
      }
    } catch (_e) {
      toast.error('Gagal reset PIN');
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
        <h1 className="text-2xl font-bold tracking-tight">Security</h1>
        <p className="text-muted-foreground">PIN dan riwayat akses sensitif</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Set / Ubah PIN
          </CardTitle>
          <CardDescription>
            PIN 4–6 digit untuk aksi sensitif (lihat rekening bank, adjustment stok, void dokumen, dll).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-1 max-w-md">
            <div className="space-y-2">
              <Label>PIN saat ini (kosongkan jika belum pernah set)</Label>
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
              <Label>PIN baru (4–6 digit)</Label>
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
              <Label>Konfirmasi PIN baru</Label>
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
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Simpan PIN'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Terakhir diakses (aksi sensitif)
          </CardTitle>
          <CardDescription>Waktu verifikasi PIN berhasil per jenis aksi.</CardDescription>
        </CardHeader>
        <CardContent>
          {lastAccess.length === 0 ? (
            <p className="text-muted-foreground text-sm">Belum ada riwayat.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {lastAccess.map((a) => (
                <li key={a.action}>
                  <span className="font-medium">{ACTION_LABELS[a.action] ?? a.action}</span>
                  {' — '}
                  {new Date(a.at).toLocaleString('id-ID')}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Riwayat percobaan PIN</CardTitle>
          <CardDescription>Percobaan verifikasi PIN (terbaru di atas).</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md overflow-auto max-h-[280px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Aksi</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attempts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-sm">{new Date(a.createdAt).toLocaleString('id-ID')}</TableCell>
                    <TableCell>{ACTION_LABELS[a.action] ?? a.action}</TableCell>
                    <TableCell>{a.success ? 'Berhasil' : 'Gagal'}</TableCell>
                    <TableCell className="text-muted-foreground">{a.ipAddress ?? '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {attempts.length === 0 && (
            <p className="text-muted-foreground text-sm py-4">Belum ada riwayat.</p>
          )}
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserX className="h-5 w-5" />
              Force reset PIN (Admin)
            </CardTitle>
            <CardDescription>Hapus PIN pengguna lain agar mereka dapat set PIN baru.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 items-end">
            <Select value={resetTargetId} onValueChange={setResetTargetId}>
              <SelectTrigger className="w-[280px]">
                <SelectValue placeholder="Pilih pengguna" />
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
              {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Reset PIN'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
