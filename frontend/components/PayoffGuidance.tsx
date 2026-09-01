import { money } from "@/lib/format";
import {
  createsEstimatedPayoff,
  optionFigures,
  type PayoffGuidance as PayoffGuidanceData,
  type PayoffStrategy,
} from "@/lib/payoffGuidance";

type Props = {
  guidance: PayoffGuidanceData;
  strategy: PayoffStrategy;
  disabled: boolean;
  onChooseAmount: (amount: string) => void;
};

const OPTION_LABELS = {
  current: {
    eyebrow: "Current plan",
    title: "Keep your current payment",
  },
  split_difference: {
    eyebrow: "Balanced step",
    title: "Split the difference",
  },
  maximum: {
    eyebrow: "Fastest modeled",
    title: "Use the full surplus",
  },
} as const;

function isZeroMoney(value: string): boolean {
  return /^0+(?:\.0+)?$/.test(value);
}

export function PayoffGuidance({
  guidance,
  strategy,
  disabled,
  onChooseAmount,
}: Props) {
  const strategyLabel = strategy === "snowball" ? "Snowball" : "Avalanche";
  const currentOption = guidance.payment_options.find(
    (option) => option.kind === "current",
  );

  return (
    <section aria-labelledby="payment-options-heading" className="panel panel-warm">
      <p className="eyebrow text-[#85630d]">Smart payoff options</p>
      <h2
        id="payment-options-heading"
        className="mt-2 font-display text-2xl font-semibold"
      >
        Ways to speed this up
      </h2>
      <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-soft">
        Compare affordable monthly amounts using the {strategyLabel} strategy.
      </p>

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        {guidance.payment_options.map((option) => {
          const labels = OPTION_LABELS[option.kind];
          const figures = optionFigures(option, strategy);
          const current = option.kind === "current";
          const leavesNoCushion = isZeroMoney(option.monthly_cushion_remaining);
          const createsPayoff =
            !current && createsEstimatedPayoff(currentOption, option, strategy);
          const hasMonthsSaved =
            !current && figures.monthsSaved !== null && figures.monthsSaved > 0;
          const hasInterestSaved =
            !current &&
            figures.interestSaved !== null &&
            !isZeroMoney(option[strategy].interest_saved_vs_current ?? "0.00");

          return (
            <article
              key={option.kind}
              className="flex h-full flex-col rounded-2xl border border-[#ead690] bg-white/80 p-5"
            >
              <p className="eyebrow text-[#85630d]">{labels.eyebrow}</p>
              <h3 className="mt-2 font-display text-xl font-semibold leading-tight">
                {labels.title}
              </h3>
              <p className="tnum mt-4 text-3xl font-semibold leading-none">
                {money(option.extra_monthly_payment)}
              </p>
              <p className="mt-1 text-xs text-ink-soft">extra each month</p>

              <dl className="mt-5 space-y-2 border-t border-rule pt-4 text-sm">
                {!current && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-soft">More than today</dt>
                    <dd className="tnum">{money(option.additional_monthly_payment)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-soft">Monthly cushion</dt>
                  <dd className="tnum">{money(option.monthly_cushion_remaining)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-soft">Estimated payoff</dt>
                  <dd className="tnum text-right">
                    {figures.paidOff ? figures.payoffMonth : "Not within estimate"}
                  </dd>
                </div>
                {figures.paidOff && figures.duration !== null && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-soft">Time to payoff</dt>
                    <dd className="tnum">{figures.duration}</dd>
                  </div>
                )}
                {figures.paidOff && figures.totalInterest !== null && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-soft">Estimated interest</dt>
                    <dd className="tnum">{figures.totalInterest}</dd>
                  </div>
                )}
              </dl>

              {!figures.paidOff && (
                <p className="mt-4 text-sm leading-relaxed text-ink-soft">
                  This option still does not pay off within the estimate.
                </p>
              )}

              {(createsPayoff || hasMonthsSaved || hasInterestSaved) && (
                <ul className="mt-4 space-y-1 rounded-xl bg-mint px-3 py-2 text-sm">
                  {createsPayoff && <li>Creates an estimated payoff date</li>}
                  {hasMonthsSaved && (
                    <li>
                      {figures.monthsSaved} {figures.monthsSaved === 1 ? "month" : "months"} sooner
                    </li>
                  )}
                  {hasInterestSaved && (
                    <li>{figures.interestSaved} less estimated interest</li>
                  )}
                </ul>
              )}

              {!current && leavesNoCushion && (
                <p className="mt-4 text-xs leading-relaxed text-danger">
                  Leaves no monthly cushion. Choose this only if your budget already
                  includes enough breathing room.
                </p>
              )}

              <div className="mt-auto pt-5">
                <button
                  type="button"
                  onClick={() => onChooseAmount(option.extra_monthly_payment)}
                  disabled={current || disabled}
                  className="secondary-button w-full px-4 py-2 text-sm disabled:pointer-events-none disabled:opacity-55"
                >
                  {current
                    ? "Current amount"
                    : `Use ${money(option.extra_monthly_payment)}`}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
