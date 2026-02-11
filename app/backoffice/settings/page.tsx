'use client';

import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, FileDigit, Ruler } from 'lucide-react';

const items = [
  {
    title: 'Security',
    description: 'PIN, riwayat percobaan, reset PIN (admin)',
    href: '/backoffice/settings/security',
    icon: Shield,
  },
  {
    title: 'Document Numbers',
    description: 'Prefix dan reset period untuk nomor dokumen',
    href: '/backoffice/settings/documents',
    icon: FileDigit,
  },
  {
    title: 'UOM',
    description: 'Unit of measure dan konversi',
    href: '/backoffice/settings/uom',
    icon: Ruler,
  },
];

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Pengaturan sistem dan keamanan</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <Link key={item.href} href={item.href}>
            <Card className="h-full transition-colors hover:bg-muted/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <item.icon className="h-5 w-5" />
                  {item.title}
                </CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
