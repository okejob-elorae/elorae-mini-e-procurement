import { GrnBaruClient } from './GrnBaruClient';

export const dynamic = 'force-dynamic';

/** `?poId=` dari tombol "Terima barang" di rincian PO mengisi PO dan pemasoknya. */
export default async function NewGRNPage({ searchParams }: { searchParams: Promise<{ poId?: string }> }) {
  const { poId } = await searchParams;
  return <GrnBaruClient poIdAwal={typeof poId === 'string' ? poId : ''} />;
}
