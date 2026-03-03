# RBAC Testing Guide

## Prerequisites

1. **Database Connection**: Ensure your database is accessible
2. **Environment Variables**: Make sure `DATABASE_URL` is set correctly

## Step 1: Run Database Migration

```bash
npx prisma migrate dev --name add_rbac_tables
```

This will:
- Create the new `RoleDefinition`, `Permission`, and `RolePermission` tables
- Add `roleId` column to the `User` table

## Step 2: Seed Permissions and Roles

```bash
npx prisma db seed
```

This will:
- Create ~35 permissions (dashboard:view, suppliers:create, etc.)
- Create 4 default roles: ADMIN, PURCHASER, WAREHOUSE, PRODUCTION
- Assign permissions to roles based on the matrix
- Migrate existing users to use `roleId` instead of just the enum

## Step 3: Start the Development Server

```bash
npm run dev
```

## Testing Checklist

### 1. Login and Verify Permissions in Session
- [ ] Login as admin@elorae.com / admin123
- [ ] Check browser DevTools → Application → Cookies → Look for authjs.session-token
- [ ] Decode JWT (use jwt.io) and verify it contains `permissions: ['*']` for admin
- [ ] Login as purchaser@elorae.com / purchaser123
- [ ] Verify JWT contains specific permissions array (not wildcard)

### 2. Test Middleware Route Protection
- [ ] As PURCHASER: Try accessing `/backoffice/inventory` → Should redirect to dashboard
- [ ] As PURCHASER: Try accessing `/backoffice/work-orders` → Should redirect to dashboard
- [ ] As PURCHASER: Try accessing `/backoffice/suppliers` → Should allow access
- [ ] As WAREHOUSE: Try accessing `/backoffice/suppliers` → Should redirect to dashboard
- [ ] As WAREHOUSE: Try accessing `/backoffice/inventory` → Should allow access
- [ ] As PRODUCTION: Try accessing `/backoffice/work-orders` → Should allow access
- [ ] As PRODUCTION: Try accessing `/backoffice/vendor-returns` → Should redirect (changed from WAREHOUSE+PRODUCTION to PURCHASER+ADMIN)

### 3. Test Sidebar Navigation
- [ ] As PURCHASER: Verify only Suppliers, Purchase Orders, Supplier Payments, Vendor Returns, Dashboard, Items are visible
- [ ] As WAREHOUSE: Verify only Inventory, Dashboard, Items are visible
- [ ] As PRODUCTION: Verify only Work Orders, Nota Register, Dashboard, Items are visible
- [ ] As ADMIN: Verify all menu items are visible

### 4. Test API Route Protection
- [ ] As PURCHASER: Try POST `/api/suppliers` → Should succeed (has suppliers:create)
- [ ] As PURCHASER: Try DELETE `/api/suppliers/[id]` → Should return 403 (no suppliers:delete)
- [ ] As PURCHASER: Try POST `/api/suppliers/[id]/approve` → Should return 403 (no suppliers:approve)
- [ ] As ADMIN: Try all above → Should succeed (wildcard permissions)

### 5. Test RBAC Settings Page
- [ ] Navigate to `/backoffice/settings/rbac` as ADMIN
- [ ] Verify you can see all 4 roles (ADMIN, PURCHASER, WAREHOUSE, PRODUCTION)
- [ ] Click "Create Role" → Create a new role "TEST_ROLE"
- [ ] Assign some permissions (e.g., items:view, suppliers:view)
- [ ] Save and verify role appears in the list
- [ ] Click "Edit" on TEST_ROLE → Modify permissions
- [ ] Save and verify changes
- [ ] Try to delete ADMIN role → Should show error (system role)
- [ ] Try to delete TEST_ROLE → Should succeed (if no users assigned)
- [ ] Try to edit ADMIN permissions → Should be disabled (system role)

### 6. Test Server Actions Protection
- [ ] As PURCHASER: Try creating a PO → Should succeed
- [ ] As PURCHASER: Try creating stock adjustment → Should fail (no inventory:manage)
- [ ] As WAREHOUSE: Try creating stock adjustment → Should succeed
- [ ] As PURCHASER: Try creating UOM → Should fail (no settings_uom:manage)
- [ ] As ADMIN: Try all above → Should succeed

### 7. Test Notifications
- [ ] Create an overdue PO
- [ ] Run the cron job or manually trigger `checkAndSendOverdueNotifications()`
- [ ] Verify only users with `purchase_orders:view` permission receive notifications
- [ ] Verify ADMIN receives all notifications
- [ ] Complete a work order
- [ ] Verify only users with `work_orders:view` permission receive notifications

### 8. Test Permission Refresh
- [ ] Login as a user with a custom role
- [ ] As ADMIN, edit that role's permissions in RBAC settings
- [ ] The role's `permissionsVersion` should increment
- [ ] User's JWT should refresh on next request (check middleware logic)

## Expected Behavior Changes

### From Current Implementation:
1. **Vendor Returns**: Now only PURCHASER + ADMIN (was WAREHOUSE + PRODUCTION)
2. **Work Orders**: Now only PRODUCTION + ADMIN (was WAREHOUSE + PRODUCTION)
3. **HPP Reports**: Now only ADMIN (was WAREHOUSE + PRODUCTION)
4. **Items**: Now accessible to PRODUCTION (was only PURCHASER + WAREHOUSE)

### Permission Matrix Summary:
- **ADMIN**: All permissions (wildcard `*`)
- **PURCHASER**: Dashboard, Suppliers (view/create), Supplier Types, Items (view), Purchase Orders, Supplier Payments, Vendor Returns
- **WAREHOUSE**: Dashboard, Items (view), Inventory (view/manage)
- **PRODUCTION**: Dashboard, Items (view), Work Orders, Nota Register

## Troubleshooting

### If migration fails:
- Check database connection
- Verify Prisma schema is valid: `npx prisma validate`
- Check for existing data conflicts

### If permissions not working:
- Verify Prisma client is regenerated: `npx prisma generate`
- Check JWT contains permissions array
- Verify middleware is running (check Next.js logs)
- Check browser console for errors

### If RBAC page doesn't load:
- Verify you're logged in as ADMIN
- Check browser console for errors
- Verify `settings_rbac:view` permission exists in database

## Next Steps After Testing

1. **Frontend Guards**: Add permission-based conditional rendering for action buttons (create, edit, delete, approve) across pages
2. **User Management**: Update user management page to assign roles via `assignUserRole()` action
3. **Audit Logging**: Add audit logs for RBAC changes (role creation, permission updates)
4. **Permission Groups**: Consider adding permission groups for easier management
