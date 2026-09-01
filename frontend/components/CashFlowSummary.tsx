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

const STATUS: Record<Status, { label: string; tone: string; dot: string }> = {
  deficit: {
    label: "Monthly budget has a shortfall",
    tone: "bg-coral-soft text-danger",
    dot: "bg-snowball",
  },
  break_even: {
    label: "Monthly budget breaks even",
    tone: "bg-[#f0f2f7] text-ink",
    dot: "bg-baseline",
  },
  surplus: {
    label: "Monthly budget has a surplus",
    tone: "bg-mint text-[#176347]",
    dot: "bg-avalanche",
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
    <section aria-labelledby="cash-flow-heading" className="panel">
      <p className="eyebrow text-primary">Monthly overview</p>
      <h2 id="cash-flow-heading" className="mt-2 font-display text-2xl font-semibold">
        Cash flow
      </h2>

      <p
        role="status"
        className={`mt-5 inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold ${state.tone}`}
      >
        <span className={`h-2 w-2 rounded-full ${state.dot}`} aria-hidden="true" />
        {state.label}
        {stale && (
          <span className="font-normal text-ink-soft"> · Figures reflect earlier valid entries</span>
        )}
      </p>

      <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-[#f7f8ff] p-4">
            <dt className="text-ink-soft">{label}</dt>
            <dd className="tnum mt-2 text-xl font-semibold">{money(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
