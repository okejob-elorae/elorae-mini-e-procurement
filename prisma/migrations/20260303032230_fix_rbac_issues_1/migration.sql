-- Only drop RBAC-related FKs so the next migration can add them back
-- (after creating RoleDefinition/Permission). Do NOT drop unrelated FKs
-- (RejectedGoodsLedger_itemId, Supplier_approvedById, WorkOrder_poId) or
-- referential integrity is lost and schema would be out of sync.

-- DropForeignKey (RolePermission references RoleDefinition and Permission)
ALTER TABLE `rolepermission` DROP FOREIGN KEY `RolePermission_permissionId_fkey`;
ALTER TABLE `rolepermission` DROP FOREIGN KEY `RolePermission_roleId_fkey`;

-- DropForeignKey (User.roleId will be re-added in add_rbac migration)
ALTER TABLE `user` DROP FOREIGN KEY `User_roleId_fkey`;
