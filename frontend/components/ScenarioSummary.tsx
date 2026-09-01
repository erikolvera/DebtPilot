import type { ScenarioOut } from "@/lib/api";
import { scenarioFigures } from "@/lib/format";

type Props = {
  scenario: ScenarioOut;
  label: string;
  /** A CSS colour expression. Used as a fill only — never as text colour. */
  accent: string;
  nameFor: (debtId: string) => string;
  note: string | null;
};

export function ScenarioSummary({ scenario, label, accent, nameFor, note }: Props) {
  const figures = scenarioFigures(scenario);
  const tone =
    label === "Avalanche"
      ? "bg-mint"
      : label === "Snowball"
        ? "bg-coral-soft"
        : "bg-[#f1f3f8]";

  return (
    <div className={`rounded-2xl p-5 ${tone}`}>
      <div className="flex items-center gap-2">
        {/* The scenario colour identifies the row as a swatch. It never carries
            text: #D98324 on #E8EBF0 is ~2.6:1, well under the body-text floor. */}
        <span
          aria-hidden="true"
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ background: accent }}
        />
        <h3 className="text-sm font-semibold">{label}</h3>
      </div>

      {figures.paidOff ? (
        <>
          <p className="tnum mt-4 text-3xl leading-none">{figures.payoffMonth}</p>
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-soft">Takes</dt>
              <dd className="tnum">{figures.duration}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-soft">Interest</dt>
              <dd className="tnum">{figures.totalInterest}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-soft">Total paid</dt>
              <dd className="tnum">{figures.totalPaid}</dd>
            </div>
          </dl>
        </>
      ) : (
        <>
          <p className="mt-3 font-display text-3xl leading-none">Never pays off</p>
          <p className="mt-3 text-sm text-ink-soft">
            {figures.underwaterIds.length > 0 ? (
              <>
                Interest outruns the payment on{" "}
                {figures.underwaterIds.map(nameFor).join(", ")}, so the balance
                grows every month.
              </>
            ) : (
              <>The balance never reaches zero at this payment.</>
            )}
          </p>
          {/*
            No totals here, deliberately. The API populates
            total_interest_paid and total_paid for this scenario, but they cover
            the simulated window rather than a lifetime — spec §3.4. Printing
            "$91,219.95" beside "never pays off" states a bounded price for
            something that does not end, and contradicts the narrative below,
            which omits it by design. scenarioFigures() has already nulled them;
            do not reach past it to scenario.total_interest_paid.
          */}
        </>
      )}

      {note !== null && <p className="mt-3 text-sm text-ink-soft">{note}</p>}
    </div>
  );
}
