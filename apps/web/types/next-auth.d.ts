import { Role } from '@elorae/db';
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
      /** Toko tetap SPG — disegarkan bersama izin (lib/auth/segarkan-sesi.ts). */
      assignedStoreId?: string | null;
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
    assignedStoreId?: string | null;
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
    assignedStoreId?: string | null;
    /** Kapan isi token terakhir dibaca dari basis data (ms epoch). */
    disegarkanPada?: number;
  }
}
