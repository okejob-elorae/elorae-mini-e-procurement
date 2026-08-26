'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/ui/page-header';
import { DocumentArchive, type ArchiveFolder } from '@/components/archive/DocumentArchive';

type ArchiveData = { folders: ArchiveFolder[]; totalDocs: number; totalPending: number };

/**
 * Three archives behind one set of tabs rather than three sidebar entries.
 *
 * They answer the same question — "where is the paperwork for this party" —
 * and someone hunting a document does not always remember which family it
 * belonged to. Keeping them adjacent means one wrong guess costs a tab click,
 * not a trip back through the menu.
 */
export function ArchiveTabs({
  nota,
  retur,
  workOrder,
}: {
  nota: ArchiveData;
  retur: ArchiveData;
  workOrder: ArchiveData;
}) {
  const t = useTranslations('archive');

  const hint = (body: string, href: string) => (
    <>
      <strong className="text-foreground">{t('hintDot')}</strong> {body}{' '}
      <Link href={href} className="font-medium text-primary underline underline-offset-2">
        {t('hintLink')}
      </Link>
      .
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t('pageTitle')} description={t('pageDescription')} />
      <Tabs defaultValue="nota" className="space-y-4">
      <TabsList>
        <TabsTrigger value="nota">{t('tabNotaToko')}</TabsTrigger>
        <TabsTrigger value="retur">{t('tabReturPemasok')}</TabsTrigger>
        <TabsTrigger value="wo">{t('tabWorkOrder')}</TabsTrigger>
      </TabsList>

      <TabsContent value="nota">
        <DocumentArchive
          folders={nota.folders}
          groupTitle={t('allStores')}
          summary={t('notaSummary', { docs: nota.totalDocs, pending: nota.totalPending })}
          searchPlaceholder={t('searchStore')}
          emptyLabel={t('empty')}
          hint={hint(t('hintNota'), '/backoffice/finance/faktur-pajak')}
        />
      </TabsContent>

      <TabsContent value="retur">
        <DocumentArchive
          folders={retur.folders}
          groupTitle={t('allVendors')}
          summary={t('returSummary', { docs: retur.totalDocs, pending: retur.totalPending })}
          searchPlaceholder={t('searchVendor')}
          emptyLabel={t('empty')}
          hint={hint(t('hintRetur'), '/backoffice/vendor-returns')}
        />
      </TabsContent>

      <TabsContent value="wo">
        <DocumentArchive
          folders={workOrder.folders}
          groupTitle={t('allVendors')}
          summary={t('woSummary', { docs: workOrder.totalDocs, pending: workOrder.totalPending })}
          searchPlaceholder={t('searchVendor')}
          emptyLabel={t('empty')}
          hint={hint(t('hintWo'), '/backoffice/work-orders')}
        />
      </TabsContent>
      </Tabs>
    </div>
  );
}
