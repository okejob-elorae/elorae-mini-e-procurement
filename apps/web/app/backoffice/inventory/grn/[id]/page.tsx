import { getRincianGRN } from '@/app/actions/grn';
import { RincianGrnClient } from './RincianGrnClient';

export const dynamic = 'force-dynamic';

/** Rincian satu GRN: barang, qty, harga, foto, terima-lebih, jurnal, roll kain. */
export default async function RincianGrnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const grn = await getRincianGRN(id);
  return <RincianGrnClient grn={grn} />;
}
