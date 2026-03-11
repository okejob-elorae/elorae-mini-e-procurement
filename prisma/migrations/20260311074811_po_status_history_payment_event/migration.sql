-- DropForeignKey
ALTER TABLE `fabricroll` DROP FOREIGN KEY `FabricRoll_grnId_fkey`;

-- DropForeignKey
ALTER TABLE `fabricroll` DROP FOREIGN KEY `FabricRoll_itemId_fkey`;

-- DropForeignKey
ALTER TABLE `fabricroll` DROP FOREIGN KEY `FabricRoll_uomId_fkey`;

-- DropForeignKey
ALTER TABLE `grn` DROP FOREIGN KEY `GRN_ownerApprovedById_fkey`;

-- DropForeignKey
ALTER TABLE `item` DROP FOREIGN KEY `Item_categoryId_fkey`;

-- DropForeignKey
ALTER TABLE `rejectedgoodsledger` DROP FOREIGN KEY `RejectedGoodsLedger_itemId_fkey`;

-- DropForeignKey
ALTER TABLE `rolepermission` DROP FOREIGN KEY `RolePermission_permissionId_fkey`;

-- DropForeignKey
ALTER TABLE `rolepermission` DROP FOREIGN KEY `RolePermission_roleId_fkey`;

-- DropForeignKey
ALTER TABLE `supplier` DROP FOREIGN KEY `Supplier_approvedById_fkey`;

-- DropForeignKey
ALTER TABLE `user` DROP FOREIGN KEY `User_roleId_fkey`;

-- DropForeignKey
ALTER TABLE `vendorreturn` DROP FOREIGN KEY `VendorReturn_grnId_fkey`;

-- DropForeignKey
ALTER TABLE `workorder` DROP FOREIGN KEY `WorkOrder_consumptionMaterialId_fkey`;

-- DropForeignKey
ALTER TABLE `workorder` DROP FOREIGN KEY `WorkOrder_poId_fkey`;

-- DropForeignKey
ALTER TABLE `workorderstep` DROP FOREIGN KEY `WorkOrderStep_supplierId_fkey`;

-- DropForeignKey
ALTER TABLE `workorderstep` DROP FOREIGN KEY `WorkOrderStep_woId_fkey`;
