"use client";

import Link from "next/link";
import { useMemo } from "react";
import { CashFlowSummary } from "@/components/CashFlowSummary";
import { EscapeChart, type Track } from "@/components/EscapeChart";
import { PayoffGuidance } from "@/components/PayoffGuidance";
import { Recommendations } from "@/components/Recommendations";
import { ScenarioSummary } from "@/components/ScenarioSummary";
import { delta, money } from "@/lib/format";
import { effectiveStrategy } from "@/lib/payoffGuidance";
import { useFinancialProfile } from "@/lib/useFinancialProfile";
import { useReport } from "@/lib/useReport";

export default function ReportPage() {
  const { profile, ready, setExtra, setPreferredStrategy } = useFinancialProfile();
  const { report, pending, stale, error } = useReport(
    profile.incomes,
    profile.expenses,
    profile.debts,
    profile.extra,
  );
  const plan = report?.payoff_plan ?? null;
  const guidance = report?.payoff_guidance ?? null;
  const selectedStrategy = effectiveStrategy(
    profile.preferredStrategy,
    guidance?.recommended_strategy ?? null,
  );
  const actionsDisabled = pending || stale;

  const nameFor = useMemo(() => {
    const names = new Map(
      profile.debts.map((debt) => [debt.id, debt.name.trim() || "that debt"]),
    );
    return (debtId: string) => names.get(debtId) ?? "a debt";
  }, [profile.debts]);

  const tracks: Track[] = plan
    ? [
        { key: "baseline", label: "Minimums only", accent: "var(--baseline)", scenario: plan.scenarios.baseline },
        { key: "snowball", label: "Snowball", accent: "var(--snowball)", scenario: plan.scenarios.snowball },
        { key: "avalanche", label: "Avalanche", accent: "var(--avalanche)", scenario: plan.scenarios.avalanche },
      ]
    : [];

  if (!ready) {
    return <main className="mx-auto max-w-6xl px-5 py-16 text-ink-soft">Loading your report…</main>;
  }

  return (
    <main
      className="mx-auto max-w-6xl px-5 py-12 sm:px-8 lg:px-10 lg:py-16"
      aria-live="polite"
    >
      <header className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow text-primary">Your financial report</p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-6xl">
            Here is what your numbers can do.
          </h1>
        </div>
        <Link
          href="/plan/cash-flow"
          className="secondary-button shrink-0"
        >
          Edit my plan
        </Link>
      </header>

      {error !== null && (
        <p role="status" className="mt-8 border-l-2 border-snowball pl-3 text-sm">
          {error}
        </p>
      )}

      {report === null ? (
        <section className="panel mt-12">
          <h2 className="font-display text-2xl font-semibold">Your report needs complete entries.</h2>
          <p className="mt-3 text-ink-soft">
            {pending
              ? "Calculating your report…"
              : "Return to the planner and fix the highlighted fields."}
          </p>
          <Link href="/plan/cash-flow" className="mt-6 inline-block font-semibold">
            Return to planner →
          </Link>
        </section>
      ) : (
        <div className="mt-12 space-y-10">
          <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <CashFlowSummary
              totalMonthlyIncome={report.cash_flow.total_monthly_income}
              totalMonthlyExpenses={report.cash_flow.total_monthly_expenses}
              totalMinimumDebtPayments={report.cash_flow.total_minimum_debt_payments}
              availableMonthlyCashFlow={report.cash_flow.available_monthly_cash_flow}
              shortfall={report.cash_flow.shortfall}
              totalDebt={report.total_debt}
              status={report.cash_flow.status}
              stale={stale}
            />
            <section
              aria-labelledby="payment-budget-heading"
              className="panel panel-mint lg:self-start"
            >
              <h2 id="payment-budget-heading" className="eyebrow">Debt payment budget</h2>
              {report.cash_flow.status === "deficit" ? (
                <p className="mt-5 text-lg leading-relaxed">
                  Income falls short by <span className="tnum font-semibold">{money(report.cash_flow.shortfall)}</span> each month.
                  An accelerated plan would not be realistic yet.
                </p>
              ) : (
                <dl className="mt-6 space-y-5 text-sm">
                  <div className="flex justify-between gap-4"><dt className="text-ink-soft">Available after minimums</dt><dd className="tnum text-lg font-semibold">{money(report.cash_flow.maximum_affordable_extra_payment)}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-ink-soft">Used in the plan</dt><dd className="tnum text-lg font-semibold">{money(report.debt_payment_budget.planned_extra_monthly_payment)}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-ink-soft">Left unassigned</dt><dd className="tnum text-lg font-semibold">{money(report.debt_payment_budget.unallocated_cash_flow)}</dd></div>
                </dl>
              )}
            </section>
          </div>

          {plan === null ? (
            <section aria-labelledby="payoff-heading" className="panel">
              <h2 id="payoff-heading" className="eyebrow">Payoff strategies</h2>
              <p className="mt-4 text-ink-soft">
                {report.cash_flow.status === "deficit"
                  ? "Close the monthly shortfall before choosing Snowball or Avalanche."
                  : "Add a debt balance to compare payoff strategies."}
              </p>
            </section>
          ) : (
            <section aria-labelledby="payoff-heading" className="panel">
              <p className="eyebrow text-primary">Strategy comparison</p>
              <h2 id="payoff-heading" className="mt-2 font-display text-2xl font-semibold">Estimated payoff</h2>
              <div className="mt-6">
                <EscapeChart tracks={tracks} startMonth={plan.start_month} dimmed={pending || stale} />
              </div>
              <div
                className="mt-12 grid gap-5 md:grid-cols-3"
                role="group"
                aria-label="Choose a payoff strategy"
              >
                <ScenarioSummary
                  scenario={plan.scenarios.baseline}
                  label="Minimums only"
                  accent="var(--baseline)"
                  nameFor={nameFor}
                  note="Minimum payments decline with the balance. This is a reference, not a strategy choice."
                />
                <ScenarioSummary
                  scenario={plan.scenarios.snowball}
                  label="Snowball"
                  accent="var(--snowball)"
                  nameFor={nameFor}
                  note="Smallest balance first."
                  selected={profile.preferredStrategy === "snowball"}
                  recommended={guidance?.recommended_strategy === "snowball"}
                  disabled={actionsDisabled}
                  onSelect={() => setPreferredStrategy("snowball")}
                />
                <ScenarioSummary
                  scenario={plan.scenarios.avalanche}
                  label="Avalanche"
                  accent="var(--avalanche)"
                  nameFor={nameFor}
                  note={
                    plan.comparison.interest_saved_avalanche_vs_snowball === null
                      ? "Highest rate first."
                      : `Highest rate first. ${delta(plan.comparison.interest_saved_avalanche_vs_snowball)} less estimated interest than Snowball.`
                  }
                  selected={profile.preferredStrategy === "avalanche"}
                  recommended={guidance?.recommended_strategy === "avalanche"}
                  disabled={actionsDisabled}
                  onSelect={() => setPreferredStrategy("avalanche")}
                />
              </div>
              <p className="mt-8 max-w-prose text-xs leading-relaxed text-ink-soft">
                {report.estimate_disclosure}
              </p>
            </section>
          )}

          {guidance !== null && guidance.payment_options.length > 1 && (
            <PayoffGuidance
              guidance={guidance}
              strategy={selectedStrategy}
              disabled={actionsDisabled}
              onChooseAmount={setExtra}
            />
          )}

          <Recommendations items={report.recommendations} />
        </div>
      )}
    </main>
  );
}
