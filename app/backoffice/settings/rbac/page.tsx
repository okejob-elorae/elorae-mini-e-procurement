'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus, Edit2 } from 'lucide-react';
import { getRoles, getPermissions, createRole, updateRolePermissions, deleteRole } from '@/app/actions/rbac';
import { toast } from 'sonner';
import { useSession } from 'next-auth/react';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';

type Role = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionsVersion: number;
  userCount: number;
  permissions: Array<{
    id: string;
    code: string;
    module: string;
    action: string;
    description: string | null;
  }>;
};

type Permission = {
  id: string;
  code: string;
  module: string;
  action: string;
  description: string | null;
};

export default function RBACSettingsPage() {
  const { data: session } = useSession();
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Record<string, Permission[]>>({});
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [roleToDelete, setRoleToDelete] = useState<Role | null>(null);
  const [formData, setFormData] = useState({ name: '', description: '' });
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(new Set());

  const canManage = session?.user?.permissions && hasPermission(session.user.permissions, PERMISSIONS.SETTINGS_RBAC_MANAGE);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [rolesData, permissionsData] = await Promise.all([
        getRoles(),
        getPermissions(),
      ]);
      setRoles(rolesData);
      setPermissions(permissionsData);
    } catch (error: any) {
      toast.error(error.message || 'Failed to load RBAC data');
    } finally {
      setLoading(false);
    }
  }

  function handleCreateRole() {
    setFormData({ name: '', description: '' });
    setSelectedPermissions(new Set());
    setIsCreateDialogOpen(true);
  }

  function handleEditRole(role: Role) {
    setSelectedRole(role);
    setFormData({ name: role.name, description: role.description || '' });
    setSelectedPermissions(new Set(role.permissions.map(p => p.id)));
    setIsEditDialogOpen(true);
  }

  function handleDeleteRole(role: Role) {
    setRoleToDelete(role);
    setIsDeleteDialogOpen(true);
  }

  async function handleSaveCreate() {
    try {
      await createRole(formData, Array.from(selectedPermissions));
      toast.success('Role created successfully');
      setIsCreateDialogOpen(false);
      loadData();
    } catch (error: any) {
      toast.error(error.message || 'Failed to create role');
    }
  }

  async function handleSaveEdit() {
    if (!selectedRole) return;
    try {
      await updateRolePermissions(selectedRole.id, Array.from(selectedPermissions));
      toast.success('Role permissions updated successfully');
      setIsEditDialogOpen(false);
      setSelectedRole(null);
      loadData();
    } catch (error: any) {
      toast.error(error.message || 'Failed to update role');
    }
  }

  async function handleConfirmDelete() {
    if (!roleToDelete) return;
    try {
      await deleteRole(roleToDelete.id);
      toast.success('Role deleted successfully');
      setIsDeleteDialogOpen(false);
      setRoleToDelete(null);
      loadData();
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete role');
    }
  }

  function togglePermission(permissionId: string) {
    const newSet = new Set(selectedPermissions);
    if (newSet.has(permissionId)) {
      newSet.delete(permissionId);
    } else {
      newSet.add(permissionId);
    }
    setSelectedPermissions(newSet);
  }

  function toggleModule(module: string) {
    const modulePerms = permissions[module] || [];
    const modulePermIds = modulePerms.map(p => p.id);
    const allSelected = modulePermIds.every(id => selectedPermissions.has(id));
    
    const newSet = new Set(selectedPermissions);
    if (allSelected) {
      modulePermIds.forEach(id => newSet.delete(id));
    } else {
      modulePermIds.forEach(id => newSet.add(id));
    }
    setSelectedPermissions(newSet);
  }

  if (loading) {
    return <div className="flex items-center justify-center p-8">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">RBAC Settings</h1>
          <p className="text-muted-foreground">Manage roles and permissions</p>
        </div>
        {canManage && (
          <Button onClick={handleCreateRole}>
            <Plus className="mr-2 h-4 w-4" />
            Create Role
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {roles.map((role) => (
          <Card key={role.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="flex items-center gap-2">
                    {role.name}
                    {role.isSystem && (
                      <Badge variant="secondary" className="text-xs">System</Badge>
                    )}
                  </CardTitle>
                  {role.description && (
                    <CardDescription className="mt-1">{role.description}</CardDescription>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">
                  {role.userCount} user{role.userCount !== 1 ? 's' : ''} assigned
                </div>
                <div className="text-sm text-muted-foreground">
                  {role.permissions.length} permission{role.permissions.length !== 1 ? 's' : ''}
                </div>
                {canManage && !role.isSystem && (
                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEditRole(role)}
                      className="flex-1"
                    >
                      <Edit2 className="mr-1 h-3 w-3" />
                      Edit
                    </Button>
                    {role.userCount === 0 && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDeleteRole(role)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Create Role Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Role</DialogTitle>
            <DialogDescription>Create a new role and assign permissions</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Role Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Manager"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Role description"
                rows={2}
              />
            </div>
            <div className="space-y-4">
              <Label>Permissions</Label>
              {Object.entries(permissions).map(([module, perms]) => (
                <div key={module} className="space-y-2 border rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <Label className="font-semibold capitalize">{module.replace(/_/g, ' ')}</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleModule(module)}
                    >
                      {perms.every(p => selectedPermissions.has(p.id)) ? 'Deselect All' : 'Select All'}
                    </Button>
                  </div>
                  <div className="space-y-2 pl-4">
                    {perms.map((perm) => (
                      <div key={perm.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={perm.id}
                          checked={selectedPermissions.has(perm.id)}
                          onCheckedChange={() => togglePermission(perm.id)}
                        />
                        <Label
                          htmlFor={perm.id}
                          className="text-sm font-normal cursor-pointer flex-1"
                        >
                          {perm.description || perm.code}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveCreate} disabled={!formData.name}>
              Create Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Role Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Role: {selectedRole?.name}</DialogTitle>
            <DialogDescription>Update role permissions</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {selectedRole?.isSystem && (
              <div className="bg-muted p-3 rounded-md text-sm text-muted-foreground">
                This is a system role. All permissions are enabled and cannot be modified.
              </div>
            )}
            <div className="space-y-4">
              <Label>Permissions</Label>
              {Object.entries(permissions).map(([module, perms]) => (
                <div key={module} className="space-y-2 border rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <Label className="font-semibold capitalize">{module.replace(/_/g, ' ')}</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleModule(module)}
                      disabled={selectedRole?.isSystem}
                    >
                      {perms.every(p => selectedPermissions.has(p.id)) ? 'Deselect All' : 'Select All'}
                    </Button>
                  </div>
                  <div className="space-y-2 pl-4">
                    {perms.map((perm) => (
                      <div key={perm.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`edit-${perm.id}`}
                          checked={selectedPermissions.has(perm.id)}
                          onCheckedChange={() => togglePermission(perm.id)}
                          disabled={selectedRole?.isSystem}
                        />
                        <Label
                          htmlFor={`edit-${perm.id}`}
                          className="text-sm font-normal cursor-pointer flex-1"
                        >
                          {perm.description || perm.code}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={selectedRole?.isSystem}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Role</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the role &quot;{roleToDelete?.name}&quot;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
