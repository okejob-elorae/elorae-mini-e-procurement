import { createHash } from "crypto";
import NextAuth from "next-auth";
import type { JWT } from "next-auth/jwt";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@elorae/db";
import { Role } from "@elorae/db";
import { ServerUnavailableSignin, TooManyAttemptsSignin } from "@/lib/auth/login-errors";
import { loginThrottle, throttleKey } from "@/lib/auth/login-throttle";
import { ingatIsiSesi, isiSesiDari, segarkanToken } from "@/lib/auth/segarkan-sesi";

function fingerprintPassword(passwordHash: string | null | undefined): string | null {
  if (!passwordHash) return null;
  return createHash("sha256").update(passwordHash).digest("hex");
}

/** Marker JWT for an invalidated session — proxy must treat as logged out and clear cookies. */
function invalidatedToken(): JWT {
  return { sessionInvalid: true } as unknown as JWT;
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  trustHost: true,
  adapter: PrismaAdapter(prisma) as any,
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60, // 8 hours
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  events: {
    /**
     * Every sign-out path (PWA, backoffice, packer, password change) ends here. The device's
     * FCM token stays on the user row until something clears it, so without this a shared
     * phone keeps receiving the previous user's pushes after they log out. Auth.js logs and
     * swallows a throw here, so a failed write never blocks the logout itself.
     */
    async signOut(message) {
      const userId = "token" in message ? message.token?.id : undefined;
      if (typeof userId !== "string" || userId === "") return;
      await prisma.user.updateMany({ where: { id: userId }, data: { fcmToken: null } });
    },
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
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
          console.error("[auth] user lookup failed during sign-in", err);
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

        const isValid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash,
        );

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
          passwordFingerprint: fingerprintPassword(user.passwordHash),
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
        token.permissionsVersion = (user as any).permissionsVersion as
          | number
          | undefined;
        token.assignedStoreId = ((user as any).assignedStoreId ?? null) as string | null;
        token.passwordFingerprint = (user as any).passwordFingerprint as
          | string
          | null;
        token.disegarkanPada = Date.now();
        delete (token as { sessionInvalid?: boolean }).sessionInvalid;
        return token;
      }

      if ((token as { sessionInvalid?: boolean }).sessionInvalid) {
        return invalidatedToken();
      }

      if (!token.id) return token;

      // Cheap probe: role identity + password fingerprint + permissionsVersion + SPG store.
      let probe;
      try {
        probe = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: {
            role: true,
            roleId: true,
            passwordHash: true,
            assignedStoreId: true,
            roleDefinition: {
              select: { permissionsVersion: true },
            },
          },
        });
      } catch (err) {
        // A momentary database outage must not log everyone out; the next request checks again.
        console.error("[auth] session probe failed; keeping the current token", err);
        return token;
      }
      if (!probe) return invalidatedToken();

      const passwordFingerprint = fingerprintPassword(probe.passwordHash);
      const priorFingerprint = token.passwordFingerprint as
        | string
        | null
        | undefined;

      // One-time migrate: existing JWTs lack passwordFingerprint — stamp, don't wipe.
      if (priorFingerprint === undefined) {
        token.passwordFingerprint = passwordFingerprint;
      } else if (passwordFingerprint !== priorFingerprint) {
        return invalidatedToken();
      }

      const roleChanged =
        token.role !== probe.role ||
        token.roleId !== probe.roleId ||
        token.permissionsVersion !== probe.roleDefinition?.permissionsVersion ||
        (token.assignedStoreId ?? null) !== (probe.assignedStoreId ?? null);

      // Role, permissions and the SPG's fixed store are re-read through lib/auth/segarkan-sesi.ts:
      // at once when the probe saw a change or the roles page called `update()`, otherwise at most
      // once a minute. An account that no longer exists ends the session.
      const refreshed = await segarkanToken(token, { paksa: trigger === "update" || roleChanged });
      if (!refreshed) return invalidatedToken();
      return refreshed;
    },
    async session({ session, token }) {
      if (
        !token?.id ||
        (token as { sessionInvalid?: boolean }).sessionInvalid
      ) {
        return { expires: session.expires } as typeof session;
      }
      session.user.id = token.id as string;
      session.user.role = token.role as Role;
      session.user.roleId = token.roleId as string | null;
      session.user.roleName = token.roleName as string;
      session.user.permissions = (token.permissions || []) as string[];
      session.user.assignedStoreId = (token.assignedStoreId ?? null) as string | null;
      return session;
    },
  },
});
