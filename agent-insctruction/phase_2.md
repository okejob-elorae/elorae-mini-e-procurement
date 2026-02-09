# **ELORAE ERP - PHASE 2 SPECIFICATION**
## **Item Master & Procurement Module**

**Prerequisites Completed:** Phase 1 (Auth, RBAC, Suppliers, Document Numbering, PWA Foundation)  
**Scope:** Item Catalog, UOM, Consumption Rules, Purchase Orders with ETA  

---

## **1. DATABASE SCHEMA (Phase 2 Additions Only)**

Add these to your existing `prisma/schema.prisma` from Phase 1:

```prisma
// ==========================================
// MASTER DATA EXTENSIONS (Phase 2)
// ==========================================

model SupplierCategory {
  id          String     @id @default(cuid())
  code        String     @unique // CAT-001
  nameId      String     // "Kain Import"
  nameEn      String     // "Import Fabric"
  description String?
  parentId    String?    // For subcategories (MD3)
  parent      SupplierCategory? @relation("CategoryHierarchy", fields: [parentId], references: [id])
  children    SupplierCategory[] @relation("CategoryHierarchy")
  suppliers   Supplier[]
  createdAt   DateTime   @default(now())
  
  @@index([parentId])
}

model UOM {
  id              String          @id @default(cuid())
  code            String          @unique // YD, PCS, MTR, KG, ROLL
  nameId          String          // "Yard"
  nameEn          String          // "Yard"
  description     String?
  isActive        Boolean         @default(true)
  items           Item[]
  createdAt       DateTime        @default(now())
}

model UOMConversion {
  id          String   @id @default(cuid())
  fromUomId   String
  toUomId     String
  fromUom     UOM      @relation("FromConversions", fields: [fromUomId], references: [id])
  toUom       UOM      @relation("ToConversions", fields: [toUomId], references: [id])
  factor      Decimal  @db.Decimal(10,6) // multiply by this to convert
  isDefault   Boolean  @default(false)
  
  @@unique([fromUomId, toUomId])
  @@index([fromUomId])
  @@index([toUomId])
}

model Item {
  id               String            @id @default(cuid())
  sku              String            @unique
  nameId           String            // "Kain Katun Merah"
  nameEn           String            // "Red Cotton Fabric"
  description      String?
  type             ItemType          // FABRIC, ACCESSORIES, FINISHED_GOOD
  uomId            String
  uom              UOM               @relation(fields: [uomId], references: [id])
  variants         Json?             // [{color: "Red", size: "M", grade: "A"}] (MD6)
  isActive         Boolean           @default(true)
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt
  poItems          POItem[]
  fgConsumptions   ConsumptionRule[] @relation("FGConsumptions")  // If this is FG
  materialUsages   ConsumptionRule[] @relation("MaterialUsages")  // If this is raw material
  
  @@index([type, isActive])
  @@index([sku])
}

model ConsumptionRule {
  id              String   @id @default(cuid())
  finishedGoodId  String   // The FG item
  finishedGood    Item     @relation("FGConsumptions", fields: [finishedGoodId], references: [id])
  materialId      String   // The raw material
  material        Item     @relation("MaterialUsages", fields: [materialId], references: [id])
  qtyRequired     Decimal  @db.Decimal(10,4) // per 1 unit of FG
  wastePercent    Decimal  @default(0) @db.Decimal(5,2) // 5.00 = 5%
  isActive        Boolean  @default(true)
  notes           String?
  createdAt       DateTime @default(now())
  
  @@unique([finishedGoodId, materialId])
  @@index([finishedGoodId])
  @@index([materialId])
}

// ==========================================
// PROCUREMENT (Phase 2)
// ==========================================

model PurchaseOrder {
  id          String          @id @default(cuid())
  docNumber   String          @unique // PO/2024/02/0001
  supplierId  String
  supplier    Supplier        @relation(fields: [supplierId], references: [id])
  status      POStatus        @default(DRAFT)
  etaDate     DateTime?       // Estimated Time of Arrival (PQ2)
  currency    String          @default("IDR")
  totalAmount Decimal         @default(0) @db.Decimal(15,2)
  taxAmount   Decimal         @default(0) @db.Decimal(15,2)
  grandTotal  Decimal         @default(0) @db.Decimal(15,2)
  notes       String?         @db.Text
  terms       String?         @db.Text // Payment terms
  createdById String
  createdBy   User            @relation(fields: [createdById], references: [id])
  items       POItem[]
  statusHistory POStatusHistory[]
  syncStatus  SyncStatus      @default(SYNCED)
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
  
  @@index([supplierId])
  @@index([status])
  @@index([etaDate])
  @@index([createdAt])
}

model POItem {
  id          String        @id @default(cuid())
  poId        String
  po          PurchaseOrder @relation(fields: [poId], references: [id], onDelete: Cascade)
  itemId      String
  item        Item          @relation(fields: [itemId], references: [id])
  qty         Decimal       @db.Decimal(10,2)
  price       Decimal       @db.Decimal(15,2) // Unit price
  uomId       String        // Store the UOM used at time of order
  receivedQty Decimal       @default(0) @db.Decimal(10,2)
  notes       String?
  createdAt   DateTime      @default(now())
  
  @@index([poId])
  @@index([itemId])
}

model POStatusHistory {
  id          String        @id @default(cuid())
  poId        String
  po          PurchaseOrder @relation(fields: [poId], references: [id], onDelete: Cascade)
  status      POStatus
  changedById String
  notes       String?
  createdAt   DateTime      @default(now())
  
  @@index([poId, createdAt])
}

// Enums to add:
enum ItemType {
  FABRIC
  ACCESSORIES
  FINISHED_GOOD
}

enum POStatus {
  DRAFT
  SUBMITTED
  PARTIAL
  CLOSED
  CANCELLED
}

enum SyncStatus {
  SYNCED
  PENDING
  ERROR
}
```

**Migration Command:**
```bash
npx prisma migrate dev --name phase2_items_and_po
```

---

## **2. CORE BUSINESS LOGIC**

### **2.1 SKU Generation Algorithm**

**File:** `lib/sku-generator.ts`

```typescript
import { prisma } from './prisma';
import { ItemType } from '@prisma/client';

const typePrefixes: Record<ItemType, string> = {
  FABRIC: 'FAB',
  ACCESSORIES: 'ACC',
  FINISHED_GOOD: 'FG'
};

export async function generateSKU(type: ItemType): Promise<string> {
  const prefix = typePrefixes[type];
  
  // Get latest SKU of this type
  const latest = await prisma.item.findFirst({
    where: { type },
    orderBy: { sku: 'desc' },
    select: { sku: true }
  });
  
  let sequence = 1;
  if (latest?.sku) {
    const match = latest.sku.match(/\d+$/);
    if (match) {
      sequence = parseInt(match[0]) + 1;
    }
  }
  
  return `${prefix}-${String(sequence).padStart(5, '0')}`;
}
```

### **2.2 ETA Alert Logic**

**File:** `lib/eta-alerts.ts`

```typescript
import { POStatus } from '@prisma/client';

export type ETAStatus = 'normal' | 'warning' | 'danger' | 'completed';

export function getETAStatus(
  etaDate: Date | null, 
  status: POStatus
): { status: ETAStatus; message: string; daysUntil: number } {
  // If closed or cancelled, no alert
  if (status === 'CLOSED' || status === 'CANCELLED') {
    return { status: 'completed', message: 'Selesai', daysUntil: 0 };
  }
  
  if (!etaDate) {
    return { status: 'normal', message: 'Tanggal belum diisi', daysUntil: 0 };
  }
  
  const now = new Date();
  const eta = new Date(etaDate);
  const diffTime = eta.getTime() - now.getTime();
  const daysUntil = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (daysUntil < 0) {
    return { 
      status: 'danger', 
      message: `Terlambat ${Math.abs(daysUntil)} hari`, 
      daysUntil 
    };
  }
  
  if (daysUntil <= 3) {
    return { 
      status: 'warning', 
      message: `Due dalam ${daysUntil} hari`, 
      daysUntil 
    };
  }
  
  return { 
    status: 'normal', 
    message: `${daysUntil} hari lagi`, 
    daysUntil 
  };
}
```

### **2.3 Consumption Rules Calculation**

**File:** `lib/consumption.ts`

```typescript
import { Decimal } from 'decimal.js';

interface MaterialRequirement {
  itemId: string;
  itemName: string;
  qtyRequired: Decimal;
  uomId: string;
  wastePercent: Decimal;
  totalNeeded: Decimal; // qtyRequired * (1 + wastePercent/100)
}

export function calculateMaterialNeeds(
  rules: Array<{
    materialId: string;
    materialName: string;
    qtyRequired: Decimal;
    uomId: string;
    wastePercent: Decimal;
  }>,
  plannedOutput: Decimal
): MaterialRequirement[] {
  return rules.map(rule => {
    const baseQty = plannedOutput.mul(rule.qtyRequired);
    const wasteMultiplier = new Decimal(1).plus(rule.wastePercent.div(100));
    const totalNeeded = baseQty.mul(wasteMultiplier);
    
    return {
      itemId: rule.materialId,
      itemName: rule.materialName,
      qtyRequired: rule.qtyRequired,
      uomId: rule.uomId,
      wastePercent: rule.wastePercent,
      totalNeeded
    };
  });
}
```

---

## **3. SERVER ACTIONS**

### **3.1 Item Management** (`app/actions/items.ts`)

```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { generateSKU } from '@/lib/sku-generator';
import { ItemType } from '@prisma/client';

const itemSchema = z.object({
  nameId: z.string().min(1, "Nama Indonesia wajib diisi"),
  nameEn: z.string().min(1, "English name is required"),
  type: z.nativeEnum(ItemType),
  uomId: z.string().uuid(),
  description: z.string().optional(),
  variants: z.array(z.record(z.string())).optional(),
});

export async function createItem(data: z.infer<typeof itemSchema>) {
  const sku = await generateSKU(data.type);
  
  const item = await prisma.item.create({
    data: {
      ...data,
      sku,
      variants: data.variants || [],
    }
  });
  
  revalidatePath('/items');
  return item;
}

export async function updateItem(id: string, data: z.infer<typeof itemSchema>) {
  const item = await prisma.item.update({
    where: { id },
    data
  });
  revalidatePath('/items');
  revalidatePath(`/items/${id}`);
  return item;
}

export async function getItems(filters?: {
  type?: ItemType;
  search?: string;
  isActive?: boolean;
}) {
  return prisma.item.findMany({
    where: {
      type: filters?.type,
      isActive: filters?.isActive,
      OR: filters?.search ? [
        { sku: { contains: filters.search, mode: 'insensitive' } },
        { nameId: { contains: filters.search, mode: 'insensitive' } },
        { nameEn: { contains: filters.search, mode: 'insensitive' } }
      ] : undefined
    },
    include: { uom: true },
    orderBy: { createdAt: 'desc' }
  });
}

export async function toggleItemStatus(id: string, isActive: boolean) {
  await prisma.item.update({
    where: { id },
    data: { isActive }
  });
  revalidatePath('/items');
}

// Consumption Rules (BOM)
export async function getConsumptionRules(finishedGoodId: string) {
  return prisma.consumptionRule.findMany({
    where: { finishedGoodId, isActive: true },
    include: { material: { include: { uom: true } } }
  });
}

export async function saveConsumptionRules(
  finishedGoodId: string,
  rules: Array<{
    materialId: string;
    qtyRequired: number;
    wastePercent: number;
    notes?: string;
  }>
) {
  // Delete existing rules
  await prisma.consumptionRule.deleteMany({
    where: { finishedGoodId }
  });
  
  // Create new rules
  if (rules.length > 0) {
    await prisma.consumptionRule.createMany({
      data: rules.map(r => ({
        finishedGoodId,
        materialId: r.materialId,
        qtyRequired: r.qtyRequired,
        wastePercent: r.wastePercent,
        notes: r.notes
      }))
    });
  }
  
  revalidatePath(`/items/${finishedGoodId}`);
}
```

### **3.2 UOM Management** (`app/actions/uom.ts`)

```typescript
'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

const uomSchema = z.object({
  code: z.string().min(1).max(10),
  nameId: z.string().min(1),
  nameEn: z.string().min(1),
  description: z.string().optional(),
});

export async function createUOM(data: z.infer<typeof uomSchema>) {
  const uom = await prisma.uOM.create({ data });
  revalidatePath('/settings/uom');
  return uom;
}

export async function getUOMs() {
  return prisma.uOM.findMany({
    where: { isActive: true },
    orderBy: { code: 'asc' }
  });
}

export async function createUOMConversion(data: {
  fromUomId: string;
  toUomId: string;
  factor: number;
}) {
  await prisma.uOMConversion.create({
    data: {
      fromUomId: data.fromUomId,
      toUomId: data.toUomId,
      factor: data.factor,
      isDefault: false
    }
  });
  revalidatePath('/settings/uom');
}
```

### **3.3 Purchase Orders** (`app/actions/purchase-orders.ts`)

```typescript
'use server';

import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { generateDocNumber } from '@/lib/docNumber';
import { revalidatePath } from 'next/cache';
import { getETAStatus } from '@/lib/eta-alerts';

const poItemSchema = z.object({
  itemId: z.string().uuid(),
  qty: z.number().positive(),
  price: z.number().nonnegative(),
  uomId: z.string().uuid(),
  notes: z.string().optional(),
});

const poSchema = z.object({
  supplierId: z.string().uuid(),
  etaDate: z.date().optional().nullable(),
  notes: z.string().optional(),
  items: z.array(poItemSchema).min(1, "Minimal 1 item"),
});

export async function createPO(data: z.infer<typeof poSchema>, userId: string) {
  return await prisma.$transaction(async (tx) => {
    const docNumber = await generateDocNumber('PO', tx);
    
    // Calculate totals
    const totalAmount = data.items.reduce((sum, item) => {
      return sum.plus(new Decimal(item.qty).mul(item.price));
    }, new Decimal(0));
    
    const po = await tx.purchaseOrder.create({
      data: {
        docNumber,
        supplierId: data.supplierId,
        etaDate: data.etaDate,
        notes: data.notes,
        totalAmount: totalAmount.toNumber(),
        grandTotal: totalAmount.toNumber(),
        createdById: userId,
        items: {
          create: data.items
        }
      },
      include: {
        items: { include: { item: true } },
        supplier: true
      }
    });
    
    // Create status history
    await tx.pOStatusHistory.create({
      data: {
        poId: po.id,
        status: 'DRAFT',
        changedById: userId,
        notes: 'PO Created'
      }
    });
    
    return po;
  });
}

export async function updatePO(
  id: string, 
  data: z.infer<typeof poSchema>, 
  userId: string
) {
  // Only allow update if status is DRAFT
  const existing = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: { status: true }
  });
  
  if (existing?.status !== 'DRAFT') {
    throw new Error('Only draft POs can be edited');
  }
  
  return await prisma.$transaction(async (tx) => {
    const totalAmount = data.items.reduce((sum, item) => {
      return sum.plus(new Decimal(item.qty).mul(item.price));
    }, new Decimal(0));
    
    // Delete old items and create new ones
    await tx.pOItem.deleteMany({ where: { poId: id } });
    
    const po = await tx.purchaseOrder.update({
      where: { id },
      data: {
        supplierId: data.supplierId,
        etaDate: data.etaDate,
        notes: data.notes,
        totalAmount: totalAmount.toNumber(),
        grandTotal: totalAmount.toNumber(),
        items: {
          create: data.items
        }
      },
      include: {
        items: { include: { item: true } },
        supplier: true
      }
    });
    
    return po;
  });
}

export async function changePOStatus(
  id: string, 
  newStatus: 'SUBMITTED' | 'CANCELLED' | 'CLOSED',
  userId: string,
  notes?: string
) {
  const po = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: newStatus }
  });
  
  await prisma.pOStatusHistory.create({
    data: {
      poId: id,
      status: newStatus,
      changedById: userId,
      notes: notes || `Status changed to ${newStatus}`
    }
  });
  
  revalidatePath('/purchase-orders');
  return po;
}

export async function getPOs(filters?: {
  status?: string;
  supplierId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}) {
  return prisma.purchaseOrder.findMany({
    where: {
      status: filters?.status as any,
      supplierId: filters?.supplierId,
      createdAt: {
        gte: filters?.dateFrom,
        lte: filters?.dateTo
      }
    },
    include: {
      supplier: true,
      items: { include: { item: true } },
      _count: { select: { items: true } }
    },
    orderBy: { createdAt: 'desc' }
  });
}

export async function getPOById(id: string) {
  return prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      items: { 
        include: { 
          item: { include: { uom: true } } 
        } 
      },
      statusHistory: {
        include: { changedBy: { select: { name: true } } },
        orderBy: { createdAt: 'desc' }
      }
    }
  });
}

export async function getLatePOs() {
  const today = new Date();
  const pos = await prisma.purchaseOrder.findMany({
    where: {
      etaDate: { lt: today },
      status: { notIn: ['CLOSED', 'CANCELLED'] }
    },
    include: { supplier: true },
    orderBy: { etaDate: 'asc' }
  });
  
  return pos.map(po => ({
    ...po,
    etaAlert: getETAStatus(po.etaDate, po.status)
  }));
}
```

---

## **4. OFFLINE SUPPORT (Phase 2 Specific)**

### **4.1 Dexie Schema Extension**

Add to your existing `lib/offline/db.ts`:

```typescript
export interface CachedItem {
  id: string;
  sku: string;
  nameId: string;
  nameEn: string;
  type: string;
  uomId: string;
  uomCode?: string;
  variants?: any[];
  syncAt: Date;
}

export interface CachedUOM {
  id: string;
  code: string;
  nameId: string;
  nameEn: string;
}

export interface PendingPO {
  localId?: number;
  supplierId: string;
  supplierName?: string;
  etaDate?: Date;
  items: Array<{
    itemId: string;
    itemName?: string;
    sku?: string;
    qty: number;
    price: number;
    uomId: string;
  }>;
  totalAmount: number;
  notes?: string;
  status: 'DRAFT' | 'PENDING_SYNC';
  createdAt: Date;
  syncError?: string;
}

// Add to Dexie stores:
db.version(2).stores({
  items: 'id, sku, type, syncAt',
  uoms: 'id, code',
  pendingPOs: '++localId, status, createdAt',
  suppliers: 'id, name, type, syncAt' // Cache for PO creation
}).upgrade(tx => {
  // Migration logic if needed
});
```

### **4.2 Offline-Aware Components**

**File:** `components/offline/OfflinePOButton.tsx`

```typescript
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { WifiOff, Wifi } from 'lucide-react';
import { offlineDB } from '@/lib/offline/db';

export function OfflinePOButton({ 
  onSaveLocally, 
  onSubmit,
  disabled 
}: { 
  onSaveLocally: () => Promise<void>;
  onSubmit: () => Promise<void>;
  disabled?: boolean;
}) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSaving, setIsSaving] = useState(false);

  // Listen for online/offline events
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => setIsOnline(true));
    window.addEventListener('offline', () => setIsOnline(false));
  }

  const handleClick = async () => {
    setIsSaving(true);
    try {
      if (isOnline) {
        await onSubmit();
      } else {
        await onSaveLocally();
        alert('PO disimpan secara lokal. Akan disinkronkan saat online.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Button 
      onClick={handleClick} 
      disabled={disabled || isSaving}
      variant={isOnline ? "default" : "secondary"}
    >
      {isOnline ? (
        <>
          <Wifi className="w-4 h-4 mr-2" />
          Simpan & Kirim
        </>
      ) : (
        <>
          <WifiOff className="w-4 h-4 mr-2" />
          Simpan Lokal
        </>
      )}
    </Button>
  );
}
```

---

## **5. UI COMPONENTS**

### **5.1 Item Form with Variant Builder**

**File:** `app/(dashboard)/items/new/page.tsx` and `components/forms/ItemForm.tsx`

Key features:
- Bilingual name inputs (side by side or tabs)
- SKU auto-generation (editable override)
- Dynamic variant builder: User adds attributes (Color, Size, Grade) → adds values → system generates variant combinations
- Type selector (Fabric/Accessories/Finished Good)
- UOM selector with search

**Variant Builder Logic:**
```typescript
// When type is FINISHED_GOOD, show Consumption Rules section
// Consumption Rules: Select Material (from existing items) → Input Qty per FG → Input Waste %

const [variants, setVariants] = useState<Array<Record<string, string>>>([]);
const [attributes, setAttributes] = useState<Array<{key: string, values: string[]}>>([]);

// Example: attributes = [{key: 'Color', values: ['Red', 'Blue']}, {key: 'Size', values: ['S', 'M']}]
// Generates: [{Color: 'Red', Size: 'S'}, {Color: 'Red', Size: 'M'}, ...]
```

### **5.2 PO Form with Line Items**

**File:** `components/forms/POForm.tsx`

Features:
- Supplier selector (searchable, cached for offline)
- ETA Date picker with warning if date is in the past
- Dynamic line items table:
  - Select Item (search by SKU/Name)
  - Input Qty
  - Show UOM
  - Input Price (IDR)
  - Auto-calculate line total
  - Running total at bottom
- Offline support: Save to IndexedDB if no connection

### **5.3 PO List with ETA Indicators**

**File:** `app/(dashboard)/purchase-orders/page.tsx`

Columns:
- Doc Number
- Supplier Name
- Total Amount (IDR)
- ETA Date (with color badge: Green/Orange/Red)
- Status (Badge: Draft=blue, Submitted=green, Partial=yellow, Closed=gray, Cancelled=red)
- Actions (View, Edit if Draft, Submit if Draft)

**ETA Badge Component:**
```typescript
function ETABadge({ etaDate, status }: { etaDate: Date | null, status: POStatus }) {
  const { status: alertStatus, message } = getETAStatus(etaDate, status);
  
  const colors = {
    normal: 'bg-green-100 text-green-800',
    warning: 'bg-yellow-100 text-yellow-800',
    danger: 'bg-red-100 text-red-800',
    completed: 'bg-gray-100 text-gray-800'
  };
  
  return (
    <span className={`px-2 py-1 rounded-full text-xs ${colors[alertStatus]}`}>
      {message}
    </span>
  );
}
```

---

## **6. VALIDATION SCHEMAS**

**File:** `lib/validations/index.ts`

```typescript
import { z } from 'zod';

export const itemSchema = z.object({
  nameId: z.string().min(1, 'Nama item wajib diisi'),
  nameEn: z.string().min(1, 'Item name is required'),
  type: z.enum(['FABRIC', 'ACCESSORIES', 'FINISHED_GOOD']),
  uomId: z.string().uuid('Pilih satuan'),
  description: z.string().optional(),
  variants: z.array(z.record(z.string())).optional(),
});

export const consumptionRuleSchema = z.object({
  materialId: z.string().uuid(),
  qtyRequired: z.number().positive(),
  wastePercent: z.number().min(0).max(100).default(0),
});

export const poItemSchema = z.object({
  itemId: z.string().uuid('Pilih item'),
  qty: z.number().positive('Qty harus lebih dari 0'),
  price: z.number().nonnegative('Harga tidak boleh negatif'),
  uomId: z.string().uuid(),
});

export const poSchema = z.object({
  supplierId: z.string().uuid('Pilih supplier'),
  etaDate: z.date().optional().nullable(),
  notes: z.string().optional(),
  items: z.array(poItemSchema).min(1, 'Minimal 1 item'),
});
```

---

## **7. ACCEPTANCE CRITERIA**

### **Item Master (MD5-MD8):**
- [ ] Can create items with auto-generated SKU (format: FAB-00001, ACC-00001, FG-00001)
- [ ] Can edit SKU manually but must be unique
- [ ] Variants stored as JSON and displayed in table format
- [ ] Can add consumption rules (BOM) for Finished Goods only
- [ ] Can search items by SKU, name (bilingual), or type
- [ ] UOM conversions work (e.g., 1 Roll = 25 Yards)

### **Purchase Orders (PQ1-PQ3):**
- [ ] Can create PO with multiple line items
- [ ] Auto-calculated total amount (sum of qty × price)
- [ ] Document number auto-generates: PO/2024/0001 (resets yearly)
- [ ] ETA tracking shows visual indicators:
  - Green: >3 days until ETA
  - Yellow: 1-3 days until ETA
  - Red: ETA passed but not closed
- [ ] Status workflow enforced: Can't edit after SUBMITTED
- [ ] Can view PO history (status changes)

### **Offline Support:**
- [ ] Can create PO while offline (saves to IndexedDB)
- [ ] Shows "Pending Sync" indicator for offline POs
- [ ] Auto-syncs when connection restored
- [ ] Item and Supplier lists cached locally for offline reference

### **Bilingual:**
- [ ] All labels available in ID and EN
- [ ] Can switch language without page reload (using next-intl)
- [ ] Item names displayed according to selected language

---

## **8. PAGE ROUTES**

Add these to your app structure:

```
app/(dashboard)/
├── items/
│   ├── page.tsx           # Item list with filters
│   ├── new/
│   │   └── page.tsx       # Create item
│   └── [id]/
│       └── page.tsx       # Edit item + consumption rules
├── purchase-orders/
│   ├── page.tsx           # PO list with ETA alerts
│   ├── new/
│   │   └── page.tsx       # Create PO
│   └── [id]/
│       └── page.tsx       # View PO details
├── settings/
│   └── uom/
│       └── page.tsx       # UOM management
└── api/
    └── sync/              # Offline sync endpoint
```