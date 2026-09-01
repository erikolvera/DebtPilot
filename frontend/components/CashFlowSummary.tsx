import { money } from "@/lib/format";

type Status = "deficit" | "break_even" | "surplus";

type Props = {
  totalMonthlyIncome: string;
  totalMonthlyExpenses: string;
  totalMinimumDebtPayments: string;
  availableMonthlyCashFlow: string;
  shortfall: string;
  totalDebt: string;
  status: Status;
  stale: boolean;
};

const STATUS: Record<Status, { label: string; border: string }> = {
  deficit: {
    label: "Monthly budget has a shortfall",
    border: "border-snowball",
  },
  break_even: {
    label: "Monthly budget breaks even",
    border: "border-baseline",
  },
  surplus: {
    label: "Monthly budget has a surplus",
    border: "border-avalanche",
  },
};

export function CashFlowSummary({
  totalMonthlyIncome,
  totalMonthlyExpenses,
  totalMinimumDebtPayments,
  availableMonthlyCashFlow,
  shortfall,
  totalDebt,
  status,
  stale,
}: Props) {
  const state = STATUS[status];
  const rows = [
    ["Monthly income", totalMonthlyIncome],
    ["Monthly expenses", totalMonthlyExpenses],
    ["Debt minimums", totalMinimumDebtPayments],
    ["Available each month", availableMonthlyCashFlow],
    ["Monthly shortfall", shortfall],
    ["Total debt", totalDebt],
  ];

  return (
    <section aria-labelledby="cash-flow-heading">
      <h2 id="cash-flow-heading" className="eyebrow">
        Cash flow
      </h2>

      <p
        role="status"
        className={`mt-4 border-l-2 ${state.border} pl-3 text-sm font-medium`}
      >
        {state.label}
        {stale && (
          <span className="font-normal text-ink-soft"> · Figures reflect earlier valid entries</span>
        )}
      </p>

      <dl className="mt-5 divide-y divide-rule/60 border-y border-rule text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-6 py-3">
            <dt className="text-ink-soft">{label}</dt>
            <dd className="tnum text-right">{money(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
