import { createHash } from "crypto";
import NextAuth from "next-auth";
import type { JWT } from "next-auth/jwt";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@elorae/db";
import { Role } from "@elorae/db";

type RolePayload = {
  role: Role;
  roleId: string | null;
  roleName: string;
  permissions: string[];
  permissionsVersion: number | undefined;
  passwordFingerprint: string | null;
};

type UserWithRole = {
  id: string;
  role: Role;
  roleId: string | null;
  passwordHash: string | null;
  roleDefinition: {
    id: string;
    name: string;
    isSystem: boolean;
    permissionsVersion: number;
    permissions: Array<{ permission: { code: string } }>;
  } | null;
};

function fingerprintPassword(passwordHash: string | null | undefined): string | null {
  if (!passwordHash) return null;
  return createHash("sha256").update(passwordHash).digest("hex");
}

function rolePayloadFromUser(user: UserWithRole): RolePayload {
  let permissions: string[] = [];
  let roleId: string | null = null;
  let roleName: string = user.role;
  let permissionsVersion: number | undefined;

  if (user.roleDefinition) {
    roleId = user.roleDefinition.id;
    roleName = user.roleDefinition.name;
    permissionsVersion = user.roleDefinition.permissionsVersion;
    if (user.roleDefinition.isSystem) {
      permissions = ["*"];
    } else {
      permissions = user.roleDefinition.permissions.map((rp) => rp.permission.code);
    }
  }

  return {
    role: user.role,
    roleId,
    roleName,
    permissions,
    permissionsVersion,
    passwordFingerprint: fingerprintPassword(user.passwordHash),
  };
}

async function loadRolePayload(userId: string): Promise<RolePayload | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
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
  if (!user) return null;
  return rolePayloadFromUser(user as UserWithRole);
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

        const user = await prisma.user.findUnique({
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

        const payload = rolePayloadFromUser(user as UserWithRole);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: payload.role,
          roleId: payload.roleId,
          roleName: payload.roleName,
          permissions: payload.permissions,
          permissionsVersion: payload.permissionsVersion,
          passwordFingerprint: payload.passwordFingerprint,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role as Role;
        token.roleId = (user as any).roleId as string | null;
        token.roleName = (user as any).roleName as string;
        token.permissions = (user as any).permissions as string[];
        token.permissionsVersion = (user as any).permissionsVersion as
          | number
          | undefined;
        token.passwordFingerprint = (user as any).passwordFingerprint as
          | string
          | null;
        delete (token as { sessionInvalid?: boolean }).sessionInvalid;
        return token;
      }

      if ((token as { sessionInvalid?: boolean }).sessionInvalid) {
        return invalidatedToken();
      }

      if (!token.id) return token;

      // Cheap probe: role identity + password fingerprint + permissionsVersion.
      const probe = await prisma.user.findUnique({
        where: { id: token.id as string },
        select: {
          role: true,
          roleId: true,
          passwordHash: true,
          roleDefinition: {
            select: { name: true, permissionsVersion: true },
          },
        },
      });
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

      const permissionsVersion = probe.roleDefinition?.permissionsVersion;
      const roleChanged =
        token.role !== probe.role ||
        token.roleId !== probe.roleId ||
        token.permissionsVersion !== permissionsVersion;

      if (roleChanged) {
        const payload = await loadRolePayload(token.id as string);
        if (!payload) return invalidatedToken();
        token.role = payload.role;
        token.roleId = payload.roleId;
        token.roleName = payload.roleName;
        token.permissions = payload.permissions;
        token.permissionsVersion = payload.permissionsVersion;
        token.passwordFingerprint = payload.passwordFingerprint;
        return token;
      }

      token.role = probe.role;
      token.roleId = probe.roleId;
      token.roleName = probe.roleDefinition?.name ?? probe.role;
      token.passwordFingerprint = passwordFingerprint;
      return token;
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
      return session;
    },
  },
});

// PIN verification for sensitive actions
export async function verifyPin(userId: string, pin: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { pinHash: true },
  });

  if (!user?.pinHash) {
    return false;
  }

  return bcrypt.compare(pin, user.pinHash);
}

// Set PIN for user
export async function setPin(userId: string, pin: string): Promise<void> {
  const pinHash = await bcrypt.hash(pin, 10);
  await prisma.user.update({
    where: { id: userId },
    data: { pinHash },
  });
}
