"use client";

import Link from "next/link";
import { DebtTable } from "@/components/DebtTable";
import { ExtraPayment } from "@/components/ExtraPayment";
import { PlanSteps } from "@/components/PlanSteps";
import { useFinancialProfile } from "@/lib/useFinancialProfile";
import { useReport } from "@/lib/useReport";
import { isFinancialReportSendable } from "@/lib/validate";

export default function DebtsPage() {
  const { profile, ready, setDebts, setExtra, saveNow } = useFinancialProfile();
  const { report } = useReport(
    profile.incomes,
    profile.expenses,
    profile.debts,
    profile.extra,
  );
  const sendable = isFinancialReportSendable(
    profile.incomes,
    profile.expenses,
    profile.debts,
    profile.extra,
  );

  if (!ready) {
    return <main className="mx-auto max-w-5xl px-5 py-16 text-ink-soft">Loading your plan…</main>;
  }

  return (
    <main className="mx-auto max-w-5xl px-5 py-12 sm:px-8 lg:px-10 lg:py-16">
      <PlanSteps current={2} />
      <header className="mt-8 max-w-3xl">
        <p className="eyebrow">Step two</p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-6xl">
          Add the debts you want to tackle.
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-ink-soft">
          Minimum payments shape your cash flow. An optional extra payment lets
          you compare faster payoff paths.
        </p>
      </header>

      <div className="mt-12 grid gap-8 lg:grid-cols-[1.35fr_0.65fr] lg:items-start">
        <DebtTable debts={profile.debts} onChange={setDebts} />
        <ExtraPayment
          value={profile.extra}
          onChange={setExtra}
          maximumAffordable={report?.cash_flow.maximum_affordable_extra_payment}
          plannedExtra={report?.debt_payment_budget.planned_extra_monthly_payment}
          isAffordable={report?.debt_payment_budget.is_affordable}
        />
      </div>

      <div className="mt-10 flex flex-col items-start justify-between gap-5 border-t border-rule pt-8 sm:flex-row sm:items-center">
        <Link
          href="/plan/cash-flow"
          onClick={saveNow}
          className="font-semibold text-ink-soft hover:text-ink"
        >
          ← Back to cash flow
        </Link>
        {sendable ? (
          <Link
            href="/report"
            onClick={saveNow}
            className="rounded-full bg-ink px-6 py-3 font-semibold text-paper hover:opacity-85"
          >
            See my report →
          </Link>
        ) : (
          <p className="text-sm text-ink-soft">Fix the highlighted entries to continue.</p>
        )}
      </div>
    </main>
  );
}
