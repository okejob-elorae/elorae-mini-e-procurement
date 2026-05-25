'use client';

import { useTranslations } from 'next-intl';
import { PhotoAnalyzerWorkspace } from '@/components/production-colors/PhotoAnalyzerWorkspace';

export function PhotoAnalyzerPageClient() {
  const t = useTranslations('productionColors');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('titlePhotoAnalyzer')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </div>
      <PhotoAnalyzerWorkspace />
    </div>
  );
}
