import { prisma } from '@/lib/prisma';

export const JUBELIO_API_BASE_URL = 'https://api2.jubelio.com';
export const JUBELIO_TOKEN_KEY = 'JUBELIO_SESSION_TOKEN';

type JubelioLoginResponse = {
  token?: string;
  error?: string;
  message?: string;
};

export type JubelioTokenRow = {
  token: string | null;
  updatedAt: Date | null;
};

let refreshPromise: Promise<string> | null = null;

function readEnvCredentials(): { email: string; password: string } {
  const email = process.env.JUBELIO_EMAIL?.trim() ?? '';
  const password = process.env.JUBELIO_PASSWORD?.trim() ?? '';
  if (!email || !password) {
    throw new Error(
      'Jubelio credentials are not configured. Set JUBELIO_EMAIL and JUBELIO_PASSWORD in the server environment.'
    );
  }
  return { email, password };
}

export async function readJubelioTokenFromDb(): Promise<JubelioTokenRow> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: JUBELIO_TOKEN_KEY },
    select: { value: true, updatedAt: true },
  });
  const token = row?.value?.trim() ?? null;
  return { token: token || null, updatedAt: row?.updatedAt ?? null };
}

export async function storeJubelioToken(token: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error('Jubelio token is empty');

  await prisma.systemSetting.upsert({
    where: { key: JUBELIO_TOKEN_KEY },
    create: {
      key: JUBELIO_TOKEN_KEY,
      value: trimmed,
    },
    update: {
      value: trimmed,
    },
  });
}

export async function loginJubelio(email: string, password: string): Promise<string> {
  const trimmedEmail = email.trim();
  const trimmedPassword = password.trim();
  if (!trimmedEmail || !trimmedPassword) {
    throw new Error('Jubelio email and password are required');
  }

  const response = await fetch(`${JUBELIO_API_BASE_URL}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: trimmedEmail,
      password: trimmedPassword,
    }),
    cache: 'no-store',
  });

  const payload = (await response.json().catch(() => ({}))) as JubelioLoginResponse;
  const token = payload?.token?.trim();

  if (!response.ok || !token) {
    const reason = payload?.message || payload?.error || 'Invalid Jubelio credentials';
    throw new Error(reason);
  }

  return token;
}

export async function loginJubelioWithEnv(): Promise<string> {
  const { email, password } = readEnvCredentials();
  return loginJubelio(email, password);
}

/** Login with env credentials and persist token to SystemSetting. */
export async function refreshJubelioToken(): Promise<string> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const token = await loginJubelioWithEnv();
    await storeJubelioToken(token);
    return token;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

/** Returns stored bearer token, or logs in via env and stores when missing. */
export async function getValidJubelioToken(): Promise<string> {
  const { token } = await readJubelioTokenFromDb();
  if (token) return token;
  return refreshJubelioToken();
}

export function isJubelioAuthFailureStatus(status: number): boolean {
  return status === 401 || status === 403;
}
