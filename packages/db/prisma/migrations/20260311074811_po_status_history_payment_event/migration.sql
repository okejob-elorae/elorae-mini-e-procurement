-- DropForeignKey
ALTER TABLE `FabricRoll` DROP FOREIGN KEY `FabricRoll_grnId_fkey`;

-- DropForeignKey
ALTER TABLE `FabricRoll` DROP FOREIGN KEY `FabricRoll_itemId_fkey`;

-- DropForeignKey
ALTER TABLE `FabricRoll` DROP FOREIGN KEY `FabricRoll_uomId_fkey`;

-- DropForeignKey
ALTER TABLE `GRN` DROP FOREIGN KEY `GRN_ownerApprovedById_fkey`;

-- DropForeignKey
ALTER TABLE `Item` DROP FOREIGN KEY `Item_categoryId_fkey`;

-- DropForeignKey
ALTER TABLE `RejectedGoodsLedger` DROP FOREIGN KEY `RejectedGoodsLedger_itemId_fkey`;

-- DropForeignKey
ALTER TABLE `RolePermission` DROP FOREIGN KEY `RolePermission_permissionId_fkey`;

-- DropForeignKey
ALTER TABLE `RolePermission` DROP FOREIGN KEY `RolePermission_roleId_fkey`;

-- DropForeignKey
ALTER TABLE `Supplier` DROP FOREIGN KEY `Supplier_approvedById_fkey`;

-- DropForeignKey
ALTER TABLE `User` DROP FOREIGN KEY `User_roleId_fkey`;

-- DropForeignKey
ALTER TABLE `VendorReturn` DROP FOREIGN KEY `VendorReturn_grnId_fkey`;

-- DropForeignKey
ALTER TABLE `WorkOrder` DROP FOREIGN KEY `WorkOrder_consumptionMaterialId_fkey`;

-- DropForeignKey
ALTER TABLE `WorkOrder` DROP FOREIGN KEY `WorkOrder_poId_fkey`;

-- DropForeignKey
ALTER TABLE `WorkOrderStep` DROP FOREIGN KEY `WorkOrderStep_supplierId_fkey`;

-- DropForeignKey
ALTER TABLE `WorkOrderStep` DROP FOREIGN KEY `WorkOrderStep_woId_fkey`;
