'use client';

import type { DataCoverage } from '@/app/actions/forecast';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function buildYearRange(coverage: DataCoverage) {
  const years = new Set<number>();
  for (const ch of coverage.channels) {
    for (const m of ch.months) years.add(m.year);
  }
  if (years.size === 0) {
    const y = new Date().getFullYear();
    return [y - 2, y - 1, y];
  }
  const min = Math.min(...years);
  const max = Math.max(...years);
  const list: number[] = [];
  for (let y = min; y <= max; y++) list.push(y);
  return list;
}

export function DataCoverageBar({ coverage }: { coverage: DataCoverage }) {
  const years = buildYearRange(coverage);

  return (
    <div className="space-y-6">
      {coverage.channels.map((ch) => {
        const monthSet = new Set(ch.months.map((m) => `${m.year}-${m.month}`));
        const totalSlots = years.length * 12;
        const filled = monthSet.size;
        const pct = totalSlots > 0 ? Math.round((filled / totalSlots) * 100) : 0;
        const activeClass =
          ch.channel === 'SHOPEE' ? 'bg-orange-500 border-orange-600' : 'bg-blue-500 border-blue-600';

        return (
          <div key={ch.channel} className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{ch.channel}</span>
              <span className="text-muted-foreground">
                {ch.totalRows.toLocaleString()} rows
                {ch.earliestDate && ch.latestDate ?
                  ` · ${ch.earliestDate.toLocaleDateString()} → ${ch.latestDate.toLocaleDateString()}`
                : ''}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {filled}/{totalSlots} months imported ({pct}%)
            </div>
            <div className="overflow-x-auto rounded-md border">
              <div
                className="grid min-w-[620px] gap-1 p-2"
                style={{ gridTemplateColumns: `64px repeat(${years.length}, minmax(84px, 1fr))` }}
              >
                <div className="text-xs font-medium text-muted-foreground px-2 py-1">Month</div>
                {years.map((year) => (
                  <div
                    key={`${ch.channel}-year-${year}`}
                    className="text-center text-xs font-semibold text-muted-foreground px-2 py-1"
                  >
                    {year}
                  </div>
                ))}
                {MONTH_LABELS.map((label, idx) => (
                  <div key={`${ch.channel}-row-${label}`} className="contents">
                    <div className="text-xs px-2 py-1 text-muted-foreground">{label}</div>
                    {years.map((year) => {
                      const has = monthSet.has(`${year}-${idx + 1}`);
                      return (
                        <div
                          key={`${ch.channel}-${year}-${idx}`}
                          title={`${label} ${year}${has ? ' · imported' : ' · missing'}`}
                          className={`h-6 rounded border ${has ? activeClass : 'bg-muted/50 border-muted'}`}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className={`inline-block h-3 w-3 rounded border ${activeClass}`} />
                Imported month
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded border border-muted bg-muted/50" />
                Missing month
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
