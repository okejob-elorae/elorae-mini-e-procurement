import { Role } from '@prisma/client';
import 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      role: Role;
      roleId: string | null;
      roleName: string;
      permissions: string[];
    };
  }

  interface User {
    id: string;
    email: string;
    name?: string | null;
    role: Role;
    roleId?: string | null;
    roleName?: string;
    permissions?: string[];
    permissionsVersion?: number;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: Role;
    roleId: string | null;
    roleName: string;
    permissions: string[];
    permissionsVersion?: number;
  }
}
