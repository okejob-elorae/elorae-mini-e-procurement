# Elorae ERP

A comprehensive Procurement & Production Management System for Textile/Garment Manufacturing.

## Features

### Phase 1 Deliverables (Completed)

- **Authentication & Authorization**
  - NextAuth.js v5 with Credentials provider
  - Role-Based Access Control (ADMIN, PURCHASER, WAREHOUSE, PRODUCTION)
  - PIN setup for sensitive actions

- **Supplier Management**
  - Full CRUD operations
  - Bank Account Encryption (AES-256)
  - Supplier categories and types (Fabric, Accessories, Tailor, Other)
  - PIN-restricted bank account viewing with audit logging

- **Document Numbering Engine**
  - Auto-generation with configurable format
  - Prefix + year + month + counter
  - Transaction-safe counter increment

- **Offline-First Infrastructure**
  - Dexie.js IndexedDB for local storage
  - Sync queue system for pending operations
  - Background sync when connection restored
  - Online/offline status indicator

- **PWA Support**
  - Installable on mobile devices
  - Service worker for offline functionality
  - Responsive design for mobile-first experience

## Tech Stack

- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript
- **Database**: Prisma ORM with MySQL/TiDB support
- **Authentication**: NextAuth.js v5 (Auth.js)
- **State Management**: Zustand (client), TanStack Query (server)
- **Forms**: React Hook Form + Zod
- **UI Library**: shadcn/ui
- **Offline Storage**: Dexie.js (IndexedDB wrapper)
- **PWA**: next-pwa
- **Encryption**: crypto-js (AES-256)

## Getting Started

### Prerequisites

- Node.js 18+
- MySQL/TiDB database

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd elorae-erp
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.local.example .env.local
# Edit .env.local with your configuration
```

4. Set up the database:
```bash
npx prisma migrate dev
npx prisma db seed
```

5. Run the development server:
```bash
npm run dev
```

6. Open [http://localhost:3000](http://localhost:3000) in your browser.

### Default Login Credentials

- **Admin**: admin@elorae.com / admin123 (PIN: 123456)
- **Purchaser**: purchaser@elorae.com / purchaser123
- **Warehouse**: warehouse@elorae.com / warehouse123

## Environment Variables

```env
# Database (TiDB)
DATABASE_URL="mysql://user:password@host.tidbcloud.com:4000/elorae?sslaccept=strict"

# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-super-secret-random-string-min-32-chars!!

# Encryption (Must be exactly 32 characters for AES-256)
ENCRYPTION_KEY=your-32-char-encryption-key-here!!

# Cloudflare R2 (for file uploads)
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
R2_BUCKET_NAME=elorae-erp-files
R2_PUBLIC_URL=https://pub-your-hash.r2.dev
```

## Project Structure

```
app/
├── api/                    # API routes
│   ├── auth/[...nextauth]  # NextAuth configuration
│   ├── suppliers/          # Supplier CRUD API
│   └── sync/               # Offline sync API
├── dashboard/              # Dashboard pages
│   ├── layout.tsx          # Dashboard layout with sidebar
│   ├── page.tsx            # Dashboard home
│   └── suppliers/          # Supplier management
├── login/                  # Login page
components/
├── ui/                     # shadcn/ui components
├── forms/                  # Form components
├── tables/                 # Table components
└── offline/                # Offline indicator
lib/
├── auth.ts                 # Authentication configuration
├── prisma.ts               # Prisma client
├── encryption.ts           # Bank account encryption
├── docNumber.ts            # Document numbering engine
├── audit.ts                # Audit logging
└── offline/                # Offline functionality
    ├── db.ts               # Dexie.js database
    └── sync.ts             # Sync logic
types/                      # TypeScript types
prisma/
└── schema.prisma           # Database schema
```

## Database Schema

The system includes models for:
- Users (with roles)
- Suppliers (with encrypted bank accounts)
- Supplier Categories
- Items (Fabric, Accessories, Finished Goods)
- UOM (Unit of Measure)
- Purchase Orders
- GRN (Goods Receipt Notes)
- Work Orders
- Stock Movements
- Audit Logs

## Role-Based Access Control

| Role | Permissions |
|------|-------------|
| ADMIN | Full access to all features |
| PURCHASER | Suppliers, Purchase Orders, Reports |
| WAREHOUSE | Inventory, GRN, Stock Adjustment, Work Orders |
| PRODUCTION | Work Orders, Vendors, Reports |
| USER | Dashboard only |

## Security Features

- Password hashing with bcryptjs
- AES-256 encryption for bank accounts
- PIN verification for sensitive actions
- Audit logging for data access
- CSRF protection
- Role-based route protection

## Offline Functionality

The app supports offline operations:
- Create suppliers while offline (queued for sync)
- View cached data when offline
- Automatic sync when connection restored
- Visual indicator of online/offline status

## License

MIT
