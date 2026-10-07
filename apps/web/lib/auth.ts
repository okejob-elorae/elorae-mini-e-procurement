import NextAuth from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from '@elorae/db';
import { Role } from '@elorae/db';
import { ServerUnavailableSignin, TooManyAttemptsSignin } from '@/lib/auth/login-errors';
import { loginThrottle, throttleKey } from '@/lib/auth/login-throttle';
import { ingatIsiSesi, isiSesiDari, segarkanToken } from '@/lib/auth/segarkan-sesi';

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  trustHost: true,
  adapter: PrismaAdapter(prisma) as any,
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60, // 8 hours
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const key = throttleKey(credentials.email as string);
        if (loginThrottle.retryAfterMs(key) > 0) {
          throw new TooManyAttemptsSignin();
        }

        // A database that cannot be reached must not read as a wrong password:
        // the form would tell the user to retype a password that was right.
        let user;
        try {
          user = await prisma.user.findUnique({
            where: { email: credentials.email as string },
            include: {
              roleDefinition: {
                include: {
                  permissions: {
                    include: {
                      permission: true,
                    },
                  },
                },
              },
            },
          });
        } catch (err) {
          console.error('[auth] user lookup failed during sign-in', err);
          throw new ServerUnavailableSignin();
        }

        // Percobaan ini dicatat DULU sebagai gagal, baru sandinya dicocokkan —
        // pola `cobaPin` di app/actions/security/pin-auth.ts. Dulu gagal dicatat
        // sesudah bcrypt, jadi tebakan serentak semuanya melihat nol gagal dan
        // semuanya sampai ke bcrypt (terukur: 8 dari 8). Periksa-lalu-catat di
        // bawah tidak punya `await` di antaranya, jadi atomik di satu proses:
        // paling banyak lima per jendela yang sampai ke bcrypt. Sesudah pencarian
        // pengguna, supaya basis data yang mati tidak dihitung sebagai salah.
        if (loginThrottle.retryAfterMs(key) > 0) {
          throw new TooManyAttemptsSignin();
        }
        loginThrottle.recordFailure(key);

        // Email tak terdaftar ikut dihitung: responsnya sama dengan sandi salah.
        if (!user || !user.passwordHash) {
          return null;
        }

        const isValid = await bcrypt.compare(credentials.password as string, user.passwordHash);

        if (!isValid) {
          return null;
        }

        loginThrottle.reset(key);

        // Peran sistem (ADMIN) mendapat wildcard — aturan yang sama dengan penyegaran sesi.
        const isi = isiSesiDari(user);
        ingatIsiSesi(user.id, isi);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          ...isi,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role as Role;
        token.roleId = (user as any).roleId as string | null;
        token.roleName = (user as any).roleName as string;
        token.permissions = (user as any).permissions as string[];
        token.permissionsVersion = (user as any).permissionsVersion as number | undefined;
        token.assignedStoreId = ((user as any).assignedStoreId ?? null) as string | null;
        token.disegarkanPada = Date.now();
        return token;
      }
      // Isi sesi dibaca ulang dari basis data bila token lebih tua dari semenit
      // (atau selalu, saat halaman peran memanggil `update()`). Akun yang sudah
      // tidak ada → null → sesi tidak sah. Lihat lib/auth/segarkan-sesi.ts.
      return segarkanToken(token, { paksa: trigger === 'update' });
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
        session.user.roleId = token.roleId as string | null;
        session.user.roleName = token.roleName as string;
        session.user.permissions = (token.permissions || []) as string[];
        session.user.assignedStoreId = (token.assignedStoreId ?? null) as string | null;
      }
      return session;
    },
  },
});

// Verifikasi PIN TIDAK ada di sini: pakai `verifyPinForAction`
// (app/actions/security/pin-auth.ts), yang membatasi tebakan. `verifyPin` lama
// tanpa batas dihapus — dulu dipakai API pembuka rekening pemasok.

// Set PIN for user
export async function setPin(userId: string, pin: string): Promise<void> {
  const pinHash = await bcrypt.hash(pin, 10);
  await prisma.user.update({
    where: { id: userId },
    data: { pinHash },
  });
}
