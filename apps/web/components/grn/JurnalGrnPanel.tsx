'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { hasPermission } from '@/lib/rbac';
import {
  getGrnJournalState,
  postGrnReceiptJournalAction,
  postGrnReversalJournalAction,
} from '@/app/actions/grn';

/**
 * Jurnal GRN (penerimaan dan pembalik bila ditolak pemilik): lencana +
 * "Lihat jurnal", atau tombol posting ulang untuk pemegang `journals:manage`.
 * Dipakai baris GRN di tab Penerimaan Barang dan halaman rincian GRN.
 */
export function JurnalGrnPanel({ grnId, ditolak }: { grnId: string; ditolak: boolean }) {
  const t = useTranslations('inventory');
  const { data: session } = useSession();
  const bolehPosting = hasPermission(session?.user?.permissions ?? [], 'journals:manage');
  const [jurnal, setJurnal] = useState<Awaited<ReturnType<typeof getGrnJournalState>> | null>(null);
  const [memposting, setMemposting] = useState(false);

  const muat = useCallback(
    () =>
      getGrnJournalState(grnId)
        .then(setJurnal)
        .catch(() => setJurnal(null)),
    [grnId],
  );

  useEffect(() => {
    let batal = false;
    getGrnJournalState(grnId)
      .then((j) => !batal && setJurnal(j))
      .catch(() => !batal && setJurnal(null));
    return () => {
      batal = true;
    };
    // Dimuat ulang juga sesudah pemilik menolak: jurnal pembaliknya baru ada saat itu.
  }, [grnId, ditolak]);

  const posting = async (jenis: 'receipt' | 'reversal') => {
    setMemposting(true);
    try {
      const res = jenis === 'receipt' ? await postGrnReceiptJournalAction(grnId) : await postGrnReversalJournalAction(grnId);
      if (res.ok) {
        toast.success(t(res.created ? 'grnJournal.postedToast' : 'grnJournal.alreadyPostedToast'));
      } else if (res.code === 'UNMAPPED_ROLE') {
        toast.error(t('grnJournal.errUNMAPPED_ROLE', { role: ('role' in res ? res.role : null) ?? '' }));
      } else if (
        res.code === 'UNBALANCED' ||
        res.code === 'NOTHING_TO_POST' ||
        res.code === 'FORBIDDEN' ||
        res.code === 'DITOLAK_PEMILIK'
      ) {
        toast.error(t(`grnJournal.err${res.code}`));
      } else {
        toast.error(t('grnJournal.errBAD_STATE'));
      }
      await muat();
    } catch {
      toast.error(t('grnJournal.errUnexpected'));
    } finally {
      setMemposting(false);
    }
  };

  if (!jurnal) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {jurnal.receiptJournalId ? (
        <>
          <Badge variant="default">{t('grnJournal.posted')}</Badge>
          <Button asChild variant="outline" size="sm">
            <Link href={`/backoffice/finance/journals/${jurnal.receiptJournalId}`}>{t('grnJournal.viewJournal')}</Link>
          </Button>
        </>
      ) : jurnal.hasPostableReceiptJournal && bolehPosting && !ditolak ? (
        <Button size="sm" variant="outline" disabled={memposting} onClick={() => void posting('receipt')}>
          {t('grnJournal.postJournal')}
        </Button>
      ) : null}

      {ditolak &&
        (jurnal.reversalJournalId ? (
          <>
            <Badge variant="secondary">{t('grnJournal.reversalPosted')}</Badge>
            <Button asChild variant="outline" size="sm">
              <Link href={`/backoffice/finance/journals/${jurnal.reversalJournalId}`}>{t('grnJournal.viewJournal')}</Link>
            </Button>
          </>
        ) : jurnal.hasPostableReversalJournal && bolehPosting ? (
          <Button size="sm" variant="outline" disabled={memposting} onClick={() => void posting('reversal')}>
            {t('grnJournal.postReversal')}
          </Button>
        ) : null)}
    </div>
  );
}
