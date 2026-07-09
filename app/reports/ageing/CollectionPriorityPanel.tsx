"use client";

import { Card } from "@/components/ui";
import { formatINR, type RiskLevel } from "./analytics";
import type { RiskRow } from "./RiskMatrix";

const PRIORITY_CARDS: { level: RiskLevel; emoji: string; title: string; accent: string }[] = [
  { level: "Critical", emoji: "🔥", title: "Collect Today", accent: "border-red-200 dark:border-red-500/30" },
  { level: "High", emoji: "⚠️", title: "Immediate Follow-up", accent: "border-orange-200 dark:border-orange-500/30" },
  { level: "Medium", emoji: "📞", title: "Reminder Required", accent: "border-amber-200 dark:border-amber-500/30" },
  { level: "Low", emoji: "✅", title: "Healthy Customers", accent: "border-emerald-200 dark:border-emerald-500/30" },
];

/*
  Section 5 — Collection Priority Panel.

  Four cards, one per risk level (same levels as the Risk Matrix above —
  nothing new is calculated here). Clicking a card filters the Risk Matrix
  table to that tier and scrolls up to it, so "open filtered customer list"
  reuses the existing Risk Matrix rather than building a second table.
*/
export function CollectionPriorityPanel({
  rows,
  onSelect,
}: {
  rows: RiskRow[];
  onSelect: (level: RiskLevel) => void;
}) {
  return (
    <Card title="Collection Priority" subtitle="Click a card to jump to that group in the Risk Matrix above." className="mb-6 print:hidden">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {PRIORITY_CARDS.map((card) => {
          const matching = rows.filter((r) => r.risk === card.level);
          const outstanding = matching.reduce((s, r) => s + r.totalOutstanding, 0);
          return (
            <button
              key={card.level}
              type="button"
              onClick={() => onSelect(card.level)}
              className={`rounded-2xl border bg-white p-4 text-left transition-all hover:shadow-md dark:bg-slate-900 ${card.accent}`}
            >
              <p className="text-2xl">{card.emoji}</p>
              <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{card.title}</p>
              <p className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{matching.length}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{formatINR(outstanding)}</p>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
