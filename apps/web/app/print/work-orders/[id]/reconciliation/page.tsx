'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { getWorkOrderById, getReconciliation } from '@/app/actions/production';

type ReconLine = {
  itemId: string;
  itemName: string;
  itemSku: string;
  uomCode: string;
  plannedQty: number;
  issuedQty: number;
  returnedQty: number;
  actualUsed: number;
  theoreticalUsage: number;
  variance: number;
  variancePercent: number;
  varianceValue: number;
  status: 'OK' | 'OVER' | 'UNDER';
};

type ReconSummary = {
  totalIssuedValue: number;
  totalUsedValue: number;
  netVarianceValue: number;
};

export default function PrintReconciliationPage() {
  const params = useParams();
  const t = useTranslations('production');
  const id = typeof params.id === 'string' ? params.id : '';
  const printedRef = useRef(false);
  const [wo, setWO] = useState<Awaited<ReturnType<typeof getWorkOrderById>>>(null);
  const [recon, setRecon] = useState<{
    lines: ReconLine[];
    summary: ReconSummary;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([getWorkOrderById(id), getReconciliation(id)])
      .then(([w, r]) => {
        setWO(w);
        setRecon(r);
      })
      .finally(() => setIsLoading(false));
  }, [id]);

  useEffect(() => {
    if (isLoading || !wo || !recon || printedRef.current) return;
    printedRef.current = true;
    // Delay so the DOM is fully rendered before print. Do not clear this timeout in
    // cleanup so it still runs under React Strict Mode (which runs effect twice and
    // would otherwise cancel the first timeout before it fires).
    const t = setTimeout(() => {
      window.print();
    }, 400);
    return () => {
      clearTimeout(t);
      // If we were torn down before print ran (e.g. Strict Mode), allow print on next run
      printedRef.current = false;
    };
  }, [isLoading, wo, recon]);

  const efficiencyPercent =
    recon && recon.summary.totalIssuedValue > 0
      ? (recon.summary.totalUsedValue / recon.summary.totalIssuedValue) * 100
      : 0;

  const printDate =
    wo && wo.updatedAt instanceof Date
      ? wo.updatedAt.toLocaleDateString()
      : wo?.updatedAt
        ? new Date(wo.updatedAt as string).toLocaleDateString()
        : new Date().toLocaleDateString();

  const subtitle =
    wo?.finishedGood &&
    typeof wo.finishedGood === 'object' &&
    'nameEn' in wo.finishedGood
      ? (wo.finishedGood as { nameEn?: string; nameId?: string }).nameEn ??
        (wo.finishedGood as { nameId?: string }).nameId
      : undefined;

  if (isLoading || !wo || !recon) {
    return (
      <div className="flex min-h-[400px] items-center justify-center bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
      </div>
    );
  }

  return (
    <div className="print-reconciliation bg-white text-black">
      {/* Print-only header */}
      <header className="mb-5 border-b-2 border-gray-400 pb-3">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="m-0 text-lg font-bold leading-tight tracking-tight text-black print:text-[11pt]">
              Work Order Reconciliation
            </h1>
            {subtitle && (
              <p className="m-0 mt-1 text-sm font-medium text-gray-700 print:text-[9pt]">
                {subtitle}
              </p>
            )}
          </div>
          <div className="shrink-0 text-right text-sm font-medium text-gray-700 print:text-[9pt]">
            {typeof wo.docNumber === 'string' && (
              <p className="m-0 font-semibold">{wo.docNumber}</p>
            )}
            <p className="m-0 mt-0.5">{printDate}</p>
          </div>
        </div>
      </header>

      {/* Summary cards */}
      <div className="mb-5 grid grid-cols-3 gap-3 print:mb-4 print:gap-3">
        <div className="rounded border border-gray-300 bg-white p-3 shadow-none print:p-2.5">
          <p className="mb-0.5 text-[10pt] font-semibold uppercase tracking-wide text-gray-700 print:text-[8pt]">
            Total Material Cost (Used)
          </p>
          <p className="text-lg font-bold text-black print:text-[10pt]">
            {recon.summary.totalUsedValue.toLocaleString(undefined, {
              minimumFractionDigits: 2,
            })}
          </p>
        </div>
        <div className="rounded border border-gray-300 bg-white p-3 shadow-none print:p-2.5">
          <p className="mb-0.5 text-[10pt] font-semibold uppercase tracking-wide text-gray-700 print:text-[8pt]">
            Efficiency %
          </p>
          <p className="text-lg font-bold text-black print:text-[10pt]">
            {efficiencyPercent.toFixed(1)}%
          </p>
          <p className="mt-0.5 text-[9pt] text-gray-600 print:text-[8pt]">
            Used vs issued value
          </p>
        </div>
        <div className="rounded border border-gray-300 bg-white p-3 shadow-none print:p-2.5">
          <p className="mb-0.5 text-[10pt] font-semibold uppercase tracking-wide text-gray-700 print:text-[8pt]">
            Cost Variance
          </p>
          <p
            className={`text-lg font-bold print:text-[10pt] ${
              recon.summary.netVarianceValue > 0
                ? 'text-amber-800'
                : recon.summary.netVarianceValue < 0
                  ? 'text-green-800'
                  : 'text-black'
            }`}
          >
            {recon.summary.netVarianceValue >= 0 ? '+' : ''}
            {recon.summary.netVarianceValue.toLocaleString(undefined, {
              minimumFractionDigits: 2,
            })}
          </p>
        </div>
      </div>

      {/* Table section */}
      <div className="break-inside-avoid">
        <h2 className="mb-0.5 text-sm font-semibold text-black print:text-[10pt]">
          {t('selisih')} by material
        </h2>
        <p className="mb-2 text-[10pt] text-gray-600 print:mb-1.5 print:text-[8pt]">
          {t('cuttingPlanned')} vs {t('issuedToCmt')} vs {t('setoran')};{' '}
          {t('selisihFromEstimate')} per line.
        </p>

        <div className="overflow-x-auto print:overflow-visible">
          <table className="print-reconciliation-table w-full table-fixed border-collapse text-[9pt] print:text-[8pt]">
            <colgroup>
              <col style={{ width: '24%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '5%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <thead>
              <tr>
                <th className="border border-gray-400 bg-gray-200 px-2 py-1.5 text-left font-bold text-black">
                  Material
                </th>
                <th className="border border-gray-400 bg-gray-200 px-1.5 py-1.5 text-right font-bold text-black">
                  {t('targetCutting')}
                </th>
                <th className="border border-gray-400 bg-gray-200 px-1.5 py-1.5 text-right font-bold text-black">
                  {t('issuedToCmt')}
                </th>
                <th className="border border-gray-400 bg-gray-200 px-1.5 py-1.5 text-right font-bold text-black">
                  Returned
                </th>
                <th className="border border-gray-400 bg-gray-200 px-1.5 py-1.5 text-right font-bold text-black">
                  {t('setoran')}
                </th>
                <th className="border border-gray-400 bg-gray-200 px-1.5 py-1.5 text-right font-bold text-black">
                  Theoretical
                </th>
                <th className="border border-gray-400 bg-gray-200 px-1.5 py-1.5 text-right font-bold text-black">
                  {t('selisih')}
                </th>
                <th className="border border-gray-400 bg-gray-200 px-1 py-1.5 text-right font-bold text-black">
                  %
                </th>
                <th className="border border-gray-400 bg-gray-200 px-1.5 py-1.5 text-right font-bold text-black">
                  Value
                </th>
                <th className="border border-gray-400 bg-gray-200 px-1.5 py-1.5 text-center font-bold text-black">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {recon.lines.map((line, i) => (
                <tr
                  key={line.itemId}
                  className={
                    line.status === 'OVER'
                      ? 'bg-red-50'
                      : line.status === 'UNDER'
                        ? 'bg-green-50'
                        : i % 2 === 1
                          ? 'bg-gray-50'
                          : ''
                  }
                >
                  <td className="border border-gray-300 px-2 py-1.5 font-medium text-black">
                    <span className="block wrap-break-word">
                      {line.itemName}
                      {line.itemSku && (
                        <span className="ml-1 text-gray-600">({line.itemSku})</span>
                      )}
                    </span>
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1.5 text-right text-black">
                    {line.plannedQty.toLocaleString()} {line.uomCode}
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1.5 text-right text-black">
                    {line.issuedQty.toLocaleString()} {line.uomCode}
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1.5 text-right text-black">
                    {line.returnedQty.toLocaleString()} {line.uomCode}
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1.5 text-right text-black">
                    {line.actualUsed.toLocaleString()} {line.uomCode}
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1.5 text-right text-black">
                    {line.theoreticalUsage.toLocaleString()} {line.uomCode}
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1.5 text-right text-black">
                    {line.variance >= 0 ? '+' : ''}
                    {line.variance.toLocaleString()} {line.uomCode}
                  </td>
                  <td className="border border-gray-300 px-1 py-1.5 text-right text-black">
                    {line.variancePercent >= 0 ? '+' : ''}
                    {line.variancePercent.toFixed(1)}%
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1.5 text-right text-black">
                    {line.varianceValue >= 0 ? '+' : ''}
                    {line.varianceValue.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                    })}
                  </td>
                  <td className="border border-gray-300 px-1.5 py-1.5 text-center">
                    <span
                      className={`print-reconciliation-badge inline-block rounded px-1.5 py-0.5 text-[8pt] font-semibold print:text-[7pt] ${
                        line.status === 'OK'
                          ? 'border border-gray-600 bg-gray-200 text-gray-900'
                          : line.status === 'OVER'
                            ? 'border border-red-800 bg-red-200 text-red-900'
                            : 'border border-green-800 bg-green-200 text-green-900'
                      }`}
                    >
                      {line.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
