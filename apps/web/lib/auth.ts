import NextAuth from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from './prisma';
import { Role } from '@prisma/client';

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

        const isValid = await bcrypt.compare(credentials.password as string, user.passwordHash);

        if (!isValid) {
          return null;
        }

        // Get permissions from role
        let permissions: string[] = [];
        let roleId: string | null = null;
        let roleName: string = user.role;

        if (user.roleDefinition) {
          roleId = user.roleDefinition.id;
          roleName = user.roleDefinition.name;
          // If system role (ADMIN), grant wildcard
          if (user.roleDefinition.isSystem) {
            permissions = ['*'];
          } else {
            permissions = user.roleDefinition.permissions.map(rp => rp.permission.code);
          }
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          roleId,
          roleName,
          permissions,
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
      }
      // Refresh permissions if permissionsVersion changed (triggered by session update)
      if (trigger === 'update' && token.id) {
        const user = await prisma.user.findUnique({
          where: { id: token.id as string },
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
        if (user?.roleDefinition) {
          const currentVersion = user.roleDefinition.permissionsVersion;
          if (token.permissionsVersion !== currentVersion) {
            if (user.roleDefinition.isSystem) {
              token.permissions = ['*'];
            } else {
              token.permissions = user.roleDefinition.permissions.map(rp => rp.permission.code);
            }
            token.permissionsVersion = currentVersion;
          }
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
        session.user.roleId = token.roleId as string | null;
        session.user.roleName = token.roleName as string;
        session.user.permissions = (token.permissions || []) as string[];
      }
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
