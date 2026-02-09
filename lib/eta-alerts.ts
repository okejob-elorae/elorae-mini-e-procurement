import { POStatus } from '@/lib/constants/enums';

export type ETAStatus = 'normal' | 'warning' | 'danger' | 'completed';

export function getETAStatus(
  etaDate: Date | null, 
  status: POStatus
): { status: ETAStatus; message: string; daysUntil: number } {
  // If closed or cancelled, no alert
  if (status === 'CLOSED' || status === 'CANCELLED') {
    return { status: 'completed', message: 'Selesai', daysUntil: 0 };
  }
  
  if (!etaDate) {
    return { status: 'normal', message: 'Tanggal belum diisi', daysUntil: 0 };
  }
  
  const now = new Date();
  const eta = new Date(etaDate);
  const diffTime = eta.getTime() - now.getTime();
  const daysUntil = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (daysUntil < 0) {
    return { 
      status: 'danger', 
      message: `Terlambat ${Math.abs(daysUntil)} hari`, 
      daysUntil 
    };
  }
  
  if (daysUntil <= 3) {
    return { 
      status: 'warning', 
      message: `Due dalam ${daysUntil} hari`, 
      daysUntil 
    };
  }
  
  return { 
    status: 'normal', 
    message: `${daysUntil} hari lagi`, 
    daysUntil 
  };
}
