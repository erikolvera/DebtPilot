import type { ScenarioOut } from "@/lib/api";
import { scenarioFigures } from "@/lib/format";

type Props = {
  scenario: ScenarioOut;
  label: string;
  /** A CSS colour expression. Used as a fill only — never as text colour. */
  accent: string;
  nameFor: (debtId: string) => string;
  note: string | null;
  selected?: boolean;
  recommended?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
};

export function ScenarioSummary({
  scenario,
  label,
  accent,
  nameFor,
  note,
  selected = false,
  recommended = false,
  disabled = false,
  onSelect,
}: Props) {
  const figures = scenarioFigures(scenario);
  const tone =
    label === "Avalanche"
      ? "bg-mint"
      : label === "Snowball"
        ? "bg-coral-soft"
        : "bg-[#f1f3f8]";
  const selectable = onSelect !== undefined;

  return (
    <article
      className={`flex h-full flex-col rounded-2xl border-2 p-5 transition ${tone} ${
        selected
          ? "border-primary shadow-[0_10px_28px_rgb(88_78_232/14%)]"
          : "border-transparent"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {/* Color is a swatch only; the adjacent text carries the label. */}
        <span
          aria-hidden="true"
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ background: accent }}
        />
        <h3 className="text-sm font-semibold">{label}</h3>
        {recommended && (
          <span className="rounded-full bg-white/75 px-2 py-1 text-[0.6875rem] font-semibold text-primary">
            Recommended
          </span>
        )}
        {!selectable && (
          <span className="rounded-full bg-white/75 px-2 py-1 text-[0.6875rem] text-ink-soft">
            Reference
          </span>
        )}
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

      {selectable && (
        <div className="mt-auto pt-5">
          <button
            type="button"
            onClick={onSelect}
            disabled={disabled}
            aria-pressed={selected}
            className={`w-full rounded-full px-4 py-2 text-sm font-semibold disabled:pointer-events-none disabled:opacity-55 ${
              selected
                ? "bg-primary text-white"
                : "border border-rule bg-white/80 text-ink hover:border-primary"
            }`}
          >
            {selected ? `${label} selected` : `Choose ${label}`}
          </button>
        </div>
      )}
    </article>
  );
}
