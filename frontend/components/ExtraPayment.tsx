"use client";

import { EXTRA_SLIDER_MAX } from "@/lib/seed";
import { money } from "@/lib/format";
import { reportExtraError } from "@/lib/validate";

type Props = {
  value: string;
  onChange: (extra: string) => void;
  maximumAffordable?: string;
  plannedExtra?: string;
  isAffordable?: boolean;
  affordabilityStatus?: string | null;
};

export function ExtraPayment({
  value,
  onChange,
  maximumAffordable,
  plannedExtra,
  isAffordable,
  affordabilityStatus,
}: Props) {
  const error = reportExtraError(value);
  const invalid = error !== null;
  // The one place a money value becomes a number: a range input's value is
  // numeric by nature. It is converted straight back to a fixed-2 string and
  // never used for arithmetic.
  const numericValue = invalid ? 0 : Number(value);
  const numericMaximumAffordable = Number(maximumAffordable ?? 0);
  const sliderMax = Math.max(
    EXTRA_SLIDER_MAX,
    Number.isFinite(numericValue) ? numericValue : 0,
    Number.isFinite(numericMaximumAffordable) ? numericMaximumAffordable : 0,
  );
  const sliderValue = invalid ? 0 : Math.min(numericValue, sliderMax);

  return (
    <section aria-labelledby="extra-heading" className="panel panel-warm">
      <p className="eyebrow text-[#85630d]">Speed up the plan</p>
      <h2 id="extra-heading" className="mt-2 font-display text-2xl font-semibold">
        Extra toward debt
      </h2>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="tnum text-2xl text-[#85630d]">$</span>
        <input
          className="tnum w-40 rounded-xl border border-[#ead690] bg-white/70 px-3 py-2 text-3xl outline-none focus:border-primary"
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label="Extra payment each month, in dollars"
          aria-invalid={invalid}
        />
      </div>

      <input
        className="mt-6 w-full accent-[var(--primary)]"
        type="range"
        min={0}
        max={sliderMax}
        step={0.01}
        value={sliderValue}
        onChange={(event) => onChange(Number(event.target.value).toFixed(2))}
        aria-label="Extra payment each month"
      />

      {error !== null && <p className="mt-2 text-xs text-danger">{error}</p>}

      <p className="mt-2 text-xs text-ink-soft">
        On top of every minimum. The report never models more than your
        available monthly cash.
      </p>
      {maximumAffordable !== undefined && (
        <p className={`mt-4 rounded-xl px-3 py-2 text-xs ${isAffordable === false ? "bg-coral-soft text-danger" : "bg-white/65 text-ink-soft"}`}>
          Budget supports up to {money(maximumAffordable)}.
          {isAffordable === false && plannedExtra !== undefined && (
            <> The payoff plan uses {money(plannedExtra)} instead.</>
          )}
        </p>
      )}
      {maximumAffordable === undefined && affordabilityStatus && (
        <p role="status" className="mt-4 rounded-xl bg-white/65 px-3 py-2 text-xs text-ink-soft">
          {affordabilityStatus}
        </p>
      )}
    </section>
  );
}
