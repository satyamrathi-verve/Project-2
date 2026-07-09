"use client";

import { Card } from "@/components/ui";
import { formatINR, RISK_COLORS, RISK_ORDER, type RiskLevel } from "./analytics";
import type { RiskRow } from "./RiskMatrix";

/*
  Section 3 — Risk Distribution.

  A plain, dependency-free stacked bar (no chart library added) showing how
  total outstanding splits across the four risk levels. Segment width is
  proportional to outstanding amount; the legend below always shows the
  number and amount directly, so nothing here depends on colour alone.
*/
export function RiskDistribution({ rows }: { rows: RiskRow[] }) {
  const summaries = RISK_ORDER.map((level) => {
    const matching = rows.filter((r) => r.risk === level);
    return {
      level,
      count: matching.length,
      outstanding: matching.reduce((s, r) => s + r.totalOutstanding, 0),
    };
  });
  const total = summaries.reduce((s, r) => s + r.outstanding, 0);

  return (
    <Card title="Risk Distribution" subtitle="Total outstanding, split by risk level." className="mb-6">
      {total === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">Nothing outstanding to distribute.</p>
      ) : (
        <>
          <div className="flex h-8 w-full gap-0.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            {summaries.map(
              (s) =>
                s.outstanding > 0 && (
                  <div
                    key={s.level}
                    className={`${RISK_COLORS[s.level as RiskLevel].bar} h-full transition-all`}
                    style={{ width: `${(s.outstanding / total) * 100}%` }}
                    title={`${s.level}: ${formatINR(s.outstanding)}`}
                  />
                )
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {summaries.map((s) => (
              <div key={s.level} className="flex items-center gap-2">
                <span className={`h-3 w-3 flex-none rounded-full ${RISK_COLORS[s.level].bar}`} />
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-slate-700 dark:text-slate-300">
                    {s.level} ({s.count})
                  </p>
                  <p className="truncate text-xs text-slate-400 dark:text-slate-500">{formatINR(s.outstanding)}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
