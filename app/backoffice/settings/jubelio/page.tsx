'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { getJubelioTokenState, loginAndStoreJubelioToken } from '@/app/actions/settings/jubelio';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function JubelioSettingsPage() {
  const t = useTranslations('settings');
  const tToasts = useTranslations('toasts');
  const { status } = useSession();
  const router = useRouter();
  const [jubelioEmail, setJubelioEmail] = useState('');
  const [jubelioPassword, setJubelioPassword] = useState('');
  const [jubelioToken, setJubelioToken] = useState<string | null>(null);
  const [jubelioTokenUpdatedAt, setJubelioTokenUpdatedAt] = useState<string | null>(null);
  const [isLoadingToken, setIsLoadingToken] = useState(true);
  const [isSubmittingJubelioLogin, setIsSubmittingJubelioLogin] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
      return;
    }
    if (status !== 'authenticated') return;

    getJubelioTokenState()
      .then((state) => {
        setJubelioToken(state.token);
        setJubelioTokenUpdatedAt(state.updatedAt);
      })
      .catch(() => {
        toast.error(t('jubelio.loadTokenError'));
      })
      .finally(() => {
        setIsLoadingToken(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t from useTranslations
  }, [status, router]);

  const handleJubelioLogin = async () => {
    if (!jubelioEmail.trim() || !jubelioPassword.trim()) {
      toast.error(t('jubelio.missingCredentials'));
      return;
    }

    setIsSubmittingJubelioLogin(true);
    try {
      const result = await loginAndStoreJubelioToken(jubelioEmail, jubelioPassword);
      setJubelioToken(result.token);
      setJubelioTokenUpdatedAt(new Date().toISOString());
      setJubelioEmail('');
      setJubelioPassword('');
      toast.success(t('jubelio.loginSuccess'));
    } catch {
      toast.error(t('jubelio.loginFailed'));
    } finally {
      setIsSubmittingJubelioLogin(false);
    }
  };

  const handleCopyToken = async () => {
    if (!jubelioToken) return;
    try {
      await navigator.clipboard.writeText(jubelioToken);
      toast.success(t('jubelio.copySuccess'));
    } catch {
      toast.error(tToasts('failed'));
    }
  };

  const formatTokenPreview = (token: string | null) => {
    if (!token) return t('jubelio.noTokenStored');
    if (token.length <= 12) return token;
    return `${token.slice(0, 6)}...${token.slice(-6)}`;
  };

  if (status === 'loading') {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('jubelio.title')}</h1>
        <p className="text-muted-foreground">{t('jubelio.description')}</p>
      </div>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            {t('jubelio.title')}
          </CardTitle>
          <CardDescription>{t('jubelio.credentialsNotStored')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="jubelio-email">{t('jubelio.email')}</Label>
              <Input
                id="jubelio-email"
                type="email"
                value={jubelioEmail}
                onChange={(event) => setJubelioEmail(event.target.value)}
                placeholder="user@example.com"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="jubelio-password">{t('jubelio.password')}</Label>
              <Input
                id="jubelio-password"
                type="password"
                value={jubelioPassword}
                onChange={(event) => setJubelioPassword(event.target.value)}
                placeholder="••••••••"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleJubelioLogin} disabled={isSubmittingJubelioLogin}>
              {isSubmittingJubelioLogin ? <Loader2 className="h-4 w-4 animate-spin" /> : t('jubelio.loginButton')}
            </Button>
          </div>

          <div className="rounded-md border p-3">
            <p className="text-sm font-medium">{t('jubelio.tokenLabel')}</p>
            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
              {isLoadingToken ? t('jubelio.loadingToken') : formatTokenPreview(jubelioToken)}
            </p>
            {jubelioTokenUpdatedAt ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {t('jubelio.lastUpdated')}: {new Date(jubelioTokenUpdatedAt).toLocaleString()}
              </p>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={handleCopyToken}
              disabled={!jubelioToken || isLoadingToken}
            >
              {t('jubelio.copyToken')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
