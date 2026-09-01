"use client";

import Link from "next/link";
import { ExpenseTable } from "@/components/ExpenseTable";
import { IncomeTable } from "@/components/IncomeTable";
import { PlanSteps } from "@/components/PlanSteps";
import { useFinancialProfile } from "@/lib/useFinancialProfile";

export default function CashFlowPage() {
  const { profile, ready, setIncomes, setExpenses, saveNow } = useFinancialProfile();

  if (!ready) {
    return <main className="mx-auto max-w-5xl px-5 py-16 text-ink-soft">Loading your plan…</main>;
  }

  return (
    <main className="mx-auto max-w-5xl px-5 py-12 sm:px-8 lg:px-10 lg:py-16">
      <PlanSteps current={1} />
      <header className="mt-8 max-w-3xl">
        <p className="eyebrow text-primary">Step one</p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-6xl">
          Start with your monthly reality.
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-ink-soft">
          Use take-home amounts and a normal month of living expenses. You can
          change every figure later.
        </p>
      </header>

      <div className="mt-12 grid gap-8 lg:grid-cols-2 lg:items-start">
        <IncomeTable incomes={profile.incomes} onChange={setIncomes} />
        <ExpenseTable expenses={profile.expenses} onChange={setExpenses} />
      </div>

      <div className="mt-10 flex flex-col items-start justify-between gap-5 border-t border-rule pt-8 sm:flex-row sm:items-center">
        <p className="max-w-lg text-sm leading-relaxed text-ink-soft">
          Include recurring essentials and lifestyle costs here. Debt minimums
          belong in the next step.
        </p>
        <Link
          href="/plan/debts"
          onClick={saveNow}
          className="primary-button px-6"
        >
          Continue to debts →
        </Link>
      </div>
    </main>
  );
}
