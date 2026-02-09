'use client';

import { useSession } from 'next-auth/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ShoppingCart,
  Package,
  ClipboardList,
  Users,
  TrendingUp,
  Clock,
} from 'lucide-react';
import { Role } from '@/lib/constants/enums';

function getRoleLabel(role: Role): string {
  const labels: Record<Role, string> = {
    ADMIN: 'Administrator',
    PURCHASER: 'Purchaser',
    WAREHOUSE: 'Warehouse Staff',
    PRODUCTION: 'Production Manager',
    USER: 'User',
  };
  return labels[role] || role;
}

const stats = [
  {
    title: 'Purchase Orders',
    value: '12',
    description: 'Pending approval',
    icon: ShoppingCart,
    trend: '+2 this week',
  },
  {
    title: 'Inventory Items',
    value: '1,234',
    description: 'Active SKUs',
    icon: Package,
    trend: '+15 new items',
  },
  {
    title: 'Work Orders',
    value: '8',
    description: 'In production',
    icon: ClipboardList,
    trend: '3 completed today',
  },
  {
    title: 'Suppliers',
    value: '45',
    description: 'Active vendors',
    icon: Users,
    trend: '+3 this month',
  },
];

export default function DashboardPage() {
  const { data: session } = useSession();

  if (!session) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome to Elorae ERP. Here&apos;s what&apos;s happening today.
          </p>
        </div>
        <Badge variant="secondary" className="w-fit">
          {getRoleLabel(session.user.role as Role)}
        </Badge>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <p className="text-xs text-muted-foreground">{stat.description}</p>
                <div className="flex items-center gap-1 mt-2 text-xs text-green-600">
                  <TrendingUp className="h-3 w-3" />
                  {stat.trend}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Recent Activity */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Recent Activity
            </CardTitle>
            <CardDescription>Latest actions in the system</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { action: 'New Purchase Order created', user: 'John Doe', time: '2 hours ago' },
                { action: 'Supplier updated', user: 'Jane Smith', time: '4 hours ago' },
                { action: 'Goods Receipt processed', user: 'Mike Johnson', time: '5 hours ago' },
                { action: 'Work Order completed', user: 'Sarah Williams', time: '1 day ago' },
              ].map((item, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between py-2 border-b last:border-0"
                >
                  <div>
                    <p className="text-sm font-medium">{item.action}</p>
                    <p className="text-xs text-muted-foreground">by {item.user}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{item.time}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common tasks you might want to perform</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { label: 'New Purchase Order', href: '/backoffice/purchase-orders/new' },
                { label: 'Add Supplier', href: '/backoffice/suppliers/new' },
                { label: 'Create Work Order', href: '/backoffice/work-orders/new' },
                { label: 'View Reports', href: '/backoffice/reports' },
              ].map((action) => (
                <a
                  key={action.label}
                  href={action.href}
                  className="flex items-center justify-center p-4 rounded-lg border bg-card hover:bg-accent hover:text-accent-foreground transition-colors text-sm font-medium"
                >
                  {action.label}
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
