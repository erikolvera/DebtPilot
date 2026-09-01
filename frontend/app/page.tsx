"use client";

import { useEffect, useMemo, useState } from "react";
import { CashFlowSummary } from "@/components/CashFlowSummary";
import { DebtTable } from "@/components/DebtTable";
import { EscapeChart, type Track } from "@/components/EscapeChart";
import { ExpenseTable } from "@/components/ExpenseTable";
import { ExtraPayment } from "@/components/ExtraPayment";
import { IncomeTable } from "@/components/IncomeTable";
import { Recommendations } from "@/components/Recommendations";
import { ScenarioSummary } from "@/components/ScenarioSummary";
import type { ExpenseDraft, FinancialDebtDraft, IncomeDraft } from "@/lib/api";
import { delta, money } from "@/lib/format";
import {
  browserStorage,
  loadFinancialProfile,
  saveFinancialProfile,
  type FinancialProfile,
} from "@/lib/profileStorage";
import { seedFinancialProfile } from "@/lib/seed";
import { useReport } from "@/lib/useReport";

export default function Page() {
  const [profile, setProfile] = useState<FinancialProfile>(seedFinancialProfile);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfile(loadFinancialProfile(browserStorage(), seedFinancialProfile()));
    setRestored(true);
  }, []);

  useEffect(() => {
    if (restored) saveFinancialProfile(browserStorage(), profile);
  }, [profile, restored]);

  const setIncomes = (incomes: IncomeDraft[]) =>
    setProfile((current) => ({ ...current, incomes }));
  const setExpenses = (expenses: ExpenseDraft[]) =>
    setProfile((current) => ({ ...current, expenses }));
  const setDebts = (debts: FinancialDebtDraft[]) =>
    setProfile((current) => ({ ...current, debts }));
  const setExtra = (extra: string) =>
    setProfile((current) => ({ ...current, extra }));

  const { report, pending, stale, error } = useReport(
    profile.incomes,
    profile.expenses,
    profile.debts,
    profile.extra,
  );
  const plan = report?.payoff_plan ?? null;

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

  return (
    <main className="mx-auto max-w-[1280px] px-5 py-10 sm:px-8 lg:px-10 lg:py-14">
      <header className="max-w-3xl">
        <p className="eyebrow">DebtPilot</p>
        <h1 className="mt-3 font-display text-[clamp(2.5rem,6vw,4.75rem)] font-bold leading-[0.95] tracking-tight">
          Build a payoff plan your budget can actually carry.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-ink-soft">
          Add monthly income, living expenses, and debts. DebtPilot calculates
          the cash left after minimums before comparing payoff strategies.
        </p>
      </header>

      <div className="mt-14 grid gap-14 lg:grid-cols-[460px_1fr] lg:gap-16">
        <div className="space-y-12">
          <IncomeTable incomes={profile.incomes} onChange={setIncomes} />
          <ExpenseTable expenses={profile.expenses} onChange={setExpenses} />
          <DebtTable debts={profile.debts} onChange={setDebts} />
          <ExtraPayment
            value={profile.extra}
            onChange={setExtra}
            maximumAffordable={report?.cash_flow.maximum_affordable_extra_payment}
            plannedExtra={report?.debt_payment_budget.planned_extra_monthly_payment}
            isAffordable={report?.debt_payment_budget.is_affordable}
          />
          <p className="text-xs leading-relaxed text-ink-soft">
            Your entries stay in this browser. Payoff dates are estimates and
            may differ from lender statements, especially for installment loans.
          </p>
        </div>

        <div aria-live="polite">
          {error !== null && (
            <p role="status" className="mb-6 border-l-2 border-snowball pl-3 text-sm">
              {error}
            </p>
          )}

          {report === null ? (
            <p className="text-ink-soft">
              {pending
                ? "Calculating your financial report…"
                : "Complete or fix the highlighted entries to calculate your report."}
            </p>
          ) : (
            <div className="space-y-14">
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

              <section aria-labelledby="payment-budget-heading" className="border-t border-rule pt-5">
                <h2 id="payment-budget-heading" className="eyebrow">Debt payment budget</h2>
                {report.cash_flow.status === "deficit" ? (
                  <p className="mt-4 max-w-prose text-lg leading-relaxed">
                    Income falls short by <span className="tnum font-medium">{money(report.cash_flow.shortfall)}</span> each month.
                    An accelerated payoff plan would not be realistic yet.
                  </p>
                ) : (
                  <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-ink-soft">Available after minimums</dt>
                      <dd className="tnum mt-1 text-xl">{money(report.cash_flow.maximum_affordable_extra_payment)}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-soft">Used in the plan</dt>
                      <dd className="tnum mt-1 text-xl">{money(report.debt_payment_budget.planned_extra_monthly_payment)}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-soft">Left unassigned</dt>
                      <dd className="tnum mt-1 text-xl">{money(report.debt_payment_budget.unallocated_cash_flow)}</dd>
                    </div>
                  </dl>
                )}
              </section>

              {plan === null ? (
                <section aria-labelledby="payoff-heading" className="border-t border-rule pt-5">
                  <h2 id="payoff-heading" className="eyebrow">Payoff strategies</h2>
                  <p className="mt-4 text-ink-soft">
                    {report.cash_flow.status === "deficit"
                      ? "Close the monthly shortfall before choosing Snowball or Avalanche."
                      : "Add a debt balance to compare payoff strategies."}
                  </p>
                </section>
              ) : (
                <section aria-labelledby="payoff-heading">
                  <h2 id="payoff-heading" className="eyebrow">Estimated payoff</h2>
                  <div className="mt-6">
                    <EscapeChart tracks={tracks} startMonth={plan.start_month} dimmed={pending || stale} />
                  </div>
                  <div className="mt-12 grid gap-8 sm:grid-cols-3">
                    <ScenarioSummary scenario={plan.scenarios.baseline} label="Minimums only" accent="var(--baseline)" nameFor={nameFor} note="Minimum payments decline with the balance." />
                    <ScenarioSummary scenario={plan.scenarios.snowball} label="Snowball" accent="var(--snowball)" nameFor={nameFor} note="Smallest balance first." />
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
                    />
                  </div>
                  <p className="mt-8 max-w-prose text-xs leading-relaxed text-ink-soft">
                    {report.estimate_disclosure}
                  </p>
                </section>
              )}

              <Recommendations items={report.recommendations} />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
