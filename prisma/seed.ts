import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient, Role, SupplierType, ItemType } from "@prisma/client";
import bcrypt from "bcryptjs";

const adapter = new PrismaMariaDb(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding database...');

  // Create admin user
  const adminPassword = await bcrypt.hash('admin123', 10);
  const adminPin = await bcrypt.hash('123456', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@elorae.com' },
    update: {},
    create: {
      email: 'admin@elorae.com',
      name: 'Administrator',
      passwordHash: adminPassword,
      pinHash: adminPin,
      role: Role.ADMIN,
    },
  });
  console.log('Created admin user:', admin.email);

  // Create purchaser user
  const purchaserPassword = await bcrypt.hash('purchaser123', 10);
  const purchaser = await prisma.user.upsert({
    where: { email: 'purchaser@elorae.com' },
    update: {},
    create: {
      email: 'purchaser@elorae.com',
      name: 'Purchaser',
      passwordHash: purchaserPassword,
      role: Role.PURCHASER,
    },
  });
  console.log('Created purchaser user:', purchaser.email);

  // Create warehouse user
  const warehousePassword = await bcrypt.hash('warehouse123', 10);
  const warehouse = await prisma.user.upsert({
    where: { email: 'warehouse@elorae.com' },
    update: {},
    create: {
      email: 'warehouse@elorae.com',
      name: 'Warehouse Staff',
      passwordHash: warehousePassword,
      role: Role.WAREHOUSE,
    },
  });
  console.log('Created warehouse user:', warehouse.email);

  // Create supplier categories
  const fabricCategory = await prisma.supplierCategory.upsert({
    where: { id: 'cat-fabric' },
    update: {},
    create: {
      id: 'cat-fabric',
      code: 'FABRIC',
      nameId: 'Kain',
      nameEn: 'Fabric',
      description: 'Fabric and textile suppliers',
    },
  });

  const accessoriesCategory = await prisma.supplierCategory.upsert({
    where: { id: 'cat-accessories' },
    update: {},
    create: {
      id: 'cat-accessories',
      code: 'ACCESSORIES',
      nameId: 'Aksesoris',
      nameEn: 'Accessories',
      description: 'Buttons, zippers, and other accessories',
    },
  });

  const tailorCategory = await prisma.supplierCategory.upsert({
    where: { id: 'cat-tailor' },
    update: {},
    create: {
      id: 'cat-tailor',
      code: 'TAILOR',
      nameId: 'Penjahit',
      nameEn: 'Tailor',
      description: 'Production vendors and tailors',
    },
  });
  console.log('Created supplier categories');

  // Create UOMs
  const uomMeter = await prisma.uOM.upsert({
    where: { code: 'MTR' },
    update: {},
    create: {
      code: 'MTR',
      nameId: 'Meter',
      nameEn: 'Meter',
    },
  });

  const uomYard = await prisma.uOM.upsert({
    where: { code: 'YD' },
    update: {},
    create: {
      code: 'YD',
      nameId: 'Yard',
      nameEn: 'Yard',
    },
  });

  const uomPcs = await prisma.uOM.upsert({
    where: { code: 'PCS' },
    update: {},
    create: {
      code: 'PCS',
      nameId: 'Pieces',
      nameEn: 'Pieces',
    },
  });

  const uomKg = await prisma.uOM.upsert({
    where: { code: 'KG' },
    update: {},
    create: {
      code: 'KG',
      nameId: 'Kilogram',
      nameEn: 'Kilogram',
    },
  });
  console.log('Created UOMs');

  // Create sample items
  const fabric1 = await prisma.item.upsert({
    where: { sku: 'FAB-COT-001' },
    update: {},
    create: {
      sku: 'FAB-COT-001',
      nameId: 'Kain Katun Premium',
      nameEn: 'Premium Cotton Fabric',
      type: ItemType.FABRIC,
      uomId: uomMeter.id,
      description: 'High quality cotton fabric for shirts',
    },
  });

  const fabric2 = await prisma.item.upsert({
    where: { sku: 'FAB-POL-001' },
    update: {},
    create: {
      sku: 'FAB-POL-001',
      nameId: 'Kain Polyester',
      nameEn: 'Polyester Fabric',
      type: ItemType.FABRIC,
      uomId: uomMeter.id,
      description: 'Polyester fabric for uniforms',
    },
  });

  const button1 = await prisma.item.upsert({
    where: { sku: 'ACC-BTN-001' },
    update: {},
    create: {
      sku: 'ACC-BTN-001',
      nameId: 'Kancing Putih',
      nameEn: 'White Button',
      type: ItemType.ACCESSORIES,
      uomId: uomPcs.id,
      description: 'Standard white buttons',
    },
  });

  const zipper1 = await prisma.item.upsert({
    where: { sku: 'ACC-ZIP-001' },
    update: {},
    create: {
      sku: 'ACC-ZIP-001',
      nameId: 'Resleting Hitam',
      nameEn: 'Black Zipper',
      type: ItemType.ACCESSORIES,
      uomId: uomPcs.id,
      description: 'Black zippers for jackets',
    },
  });
  console.log('Created sample items');

  // Create sample suppliers
  const supplier1 = await prisma.supplier.upsert({
    where: { code: 'SUP0001' },
    update: {},
    create: {
      code: 'SUP0001',
      name: 'PT Kain Indah',
      type: SupplierType.FABRIC,
      categoryId: fabricCategory.id,
      address: 'Jl. Textile No. 123, Bandung',
      phone: '+62 22 1234567',
      email: 'sales@kainindah.com',
      bankName: 'BCA',
      bankAccountName: 'PT Kain Indah',
    },
  });

  const supplier2 = await prisma.supplier.upsert({
    where: { code: 'SUP0002' },
    update: {},
    create: {
      code: 'SUP0002',
      name: 'Aksesoris Jaya',
      type: SupplierType.ACCESSORIES,
      categoryId: accessoriesCategory.id,
      address: 'Jl. Accessories No. 45, Jakarta',
      phone: '+62 21 9876543',
      email: 'order@aksesorisjaya.com',
      bankName: 'Mandiri',
      bankAccountName: 'Aksesoris Jaya',
    },
  });

  const tailor1 = await prisma.supplier.upsert({
    where: { code: 'SUP0003' },
    update: {},
    create: {
      code: 'SUP0003',
      name: 'Penjahit Pak Budi',
      type: SupplierType.TAILOR,
      categoryId: tailorCategory.id,
      address: 'Jl. Produksi No. 78, Bandung',
      phone: '+62 812 34567890',
      email: 'budi.tailor@email.com',
      bankName: 'BRI',
      bankAccountName: 'Budi Santoso',
    },
  });
  console.log('Created sample suppliers');

  console.log('Seeding completed!');
  console.log('\nLogin credentials:');
  console.log('Admin: admin@elorae.com / admin123');
  console.log('Purchaser: purchaser@elorae.com / purchaser123');
  console.log('Warehouse: warehouse@elorae.com / warehouse123');
  console.log('PIN for sensitive actions: 123456');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
