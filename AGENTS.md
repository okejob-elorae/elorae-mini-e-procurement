# Agents

## Cursor Cloud specific instructions

### Overview

Elorae ERP is a single Next.js 16 application (TypeScript, Prisma ORM, shadcn/ui) for textile/garment manufacturing procurement and production management. It uses MariaDB/MySQL as its database.

### Running services

**MariaDB** must be running with `lower_case_table_names=1` (required because migration SQL uses inconsistent table name casing). Start it with:

```bash
sudo mkdir -p /run/mysqld && sudo chown mysql:mysql /run/mysqld
sudo mariadbd --user=mysql --datadir=/var/lib/mysql --socket=/run/mysqld/mysqld.sock --port=3306 --lower-case-table-names=1 &
```

**Next.js dev server** must override injected secrets that point to remote/production services:

```bash
DATABASE_URL="mysql://elorae:elorae_dev@localhost:3306/elorae" \
NEXTAUTH_URL="http://localhost:3000" \
AUTH_URL="http://localhost:3000" \
npm run dev
```

The `NEXTAUTH_URL` / `AUTH_URL` override is critical: without it, NextAuth uses `__Secure-` cookies that fail over HTTP on localhost.

### Key commands

See `package.json` scripts for the full list. Most useful:

| Task | Command |
|------|---------|
| Dev server | `npm run dev` (with env overrides above) |
| Lint | `npm run lint` |
| Type check | `npm run type-check` |
| Both checks | `npm run check` |
| Prisma generate | `npm run db:generate` |
| Prisma migrate | `DATABASE_URL="mysql://elorae:elorae_dev@localhost:3306/elorae" npm run db:migrate` |
| Seed database | `DATABASE_URL="mysql://elorae:elorae_dev@localhost:3306/elorae" npm run db:seed` |

### Default login credentials

- **Admin**: admin@elorae.com / admin123 (PIN: 123456)
- **Purchaser**: purchaser@elorae.com / purchaser123
- **Warehouse**: warehouse@elorae.com / warehouse123
- **Production**: production@elorae.com / production123

### Gotchas

- The injected `DATABASE_URL` secret points to TiDB Cloud (unreachable from the VM). Always override it with the local MariaDB URL.
- Prisma migrations require the user to have `GRANT ALL ON *.*` (for shadow database creation).
- `prisma.config.ts` uses `dotenv/config` so it reads `.env` file, but shell environment variables take precedence. Always pass `DATABASE_URL` explicitly on the command line for Prisma commands.
- Type-check (`tsc --noEmit`) has pre-existing errors; `next.config.ts` sets `ignoreBuildErrors: true` so the app builds and runs regardless.
- Firebase/FCM and R2 storage are optional; the app gracefully handles missing config for both.
