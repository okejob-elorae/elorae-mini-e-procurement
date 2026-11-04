'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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
 *
 * `retur`/`workOrder` are `null` for a reader who may not open them (a
 * receivables reader sees only the store notes): the tab is left out rather
 * than shown empty, because an empty folder reads as "nothing here", not as
 * "not yours to see".
 */
export function ArchiveTabs({
  nota,
  retur,
  workOrder,
}: {
  nota: ArchiveData;
  retur: ArchiveData | null;
  workOrder: ArchiveData | null;
}) {
  const t = useTranslations('archive');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Tab tersimpan di ?tab= supaya tautan dan tombol Kembali membuka tab yang sama.
  const tersedia = ['nota', ...(retur ? ['retur'] : []), ...(workOrder ? ['wo'] : [])];
  const dariUrl = searchParams?.get('tab') ?? '';
  const tab = tersedia.includes(dariUrl) ? dariUrl : 'nota';
  const gantiTab = (nilai: string) => {
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    if (nilai === 'nota') next.delete('tab');
    else next.set('tab', nilai);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // Tautan kerja menyebut tujuannya sendiri; tanpa dokumen menggantung, tidak tampil.
  const hint = (href: string, label: string, pending: number) =>
    pending > 0 ? (
      <Link href={href} className="font-medium text-tautan underline underline-offset-2">
        {label} →
      </Link>
    ) : null;

  return (
    <div className="space-y-6">
      <PageHeader title={t('judulHalaman')} />
      <Tabs value={tab} onValueChange={gantiTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="nota">{t('tab.nota')}</TabsTrigger>
        {retur && <TabsTrigger value="retur">{t('tab.retur')}</TabsTrigger>}
        {workOrder && <TabsTrigger value="wo">{t('tab.wo')}</TabsTrigger>}
      </TabsList>

      <TabsContent value="nota">
        <DocumentArchive
          folders={nota.folders}
          groupTitle={t('semuaToko')}
          summary={t('notaSummary', { docs: nota.totalDocs, pending: nota.totalPending })}
          searchPlaceholder={t('searchStore')}
          emptyLabel={t('empty')}
          hint={hint(
            // Langsung ke antrean yang belum berfaktur — halaman Faktur pajak membaca ?status=.
            '/backoffice/finance/faktur-pajak?status=PENDING',
            t('hintLinkNota', { count: nota.totalPending }),
            nota.totalPending,
          )}
        />
      </TabsContent>

      {retur && (
        <TabsContent value="retur">
          <DocumentArchive
            folders={retur.folders}
            groupTitle={t('semuaPemasok')}
            summary={t('returSummary', { docs: retur.totalDocs, pending: retur.totalPending })}
            searchPlaceholder={t('searchVendor')}
            emptyLabel={t('empty')}
            hint={hint(
              '/backoffice/vendor-returns',
              t('hintLinkRetur', { count: retur.totalPending }),
              retur.totalPending,
            )}
          />
        </TabsContent>
      )}

      {workOrder && (
        <TabsContent value="wo">
          <DocumentArchive
            folders={workOrder.folders}
            groupTitle={t('semuaPemasok')}
            summary={t('woSummary', { docs: workOrder.totalDocs, pending: workOrder.totalPending })}
            searchPlaceholder={t('searchVendor')}
            emptyLabel={t('empty')}
            hint={hint(
              '/backoffice/work-orders',
              t('hintLinkWo', { count: workOrder.totalPending }),
              workOrder.totalPending,
            )}
          />
        </TabsContent>
      )}
      </Tabs>
    </div>
  );
}
