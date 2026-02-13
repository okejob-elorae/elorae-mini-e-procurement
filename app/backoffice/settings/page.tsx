'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, FileDigit, Ruler } from 'lucide-react';

export default function SettingsPage() {
  const t = useTranslations('settings');

  const items = [
    { titleKey: 'security.title' as const, descriptionKey: 'security.description' as const, href: '/backoffice/settings/security', icon: Shield },
    { titleKey: 'documents.title' as const, descriptionKey: 'documents.description' as const, href: '/backoffice/settings/documents', icon: FileDigit },
    { titleKey: 'uom.title' as const, descriptionKey: 'uom.description' as const, href: '/backoffice/settings/uom', icon: Ruler },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <Link key={item.href} href={item.href}>
            <Card className="h-full transition-colors hover:bg-muted/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <item.icon className="h-5 w-5" />
                  {t(item.titleKey)}
                </CardTitle>
                <CardDescription>{t(item.descriptionKey)}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
