"use client";

import { EXTRA_SLIDER_MAX } from "@/lib/seed";
import { extraError } from "@/lib/validate";

type Props = {
  value: string;
  onChange: (extra: string) => void;
};

export function ExtraPayment({ value, onChange }: Props) {
  const error = extraError(value);
  const invalid = error !== null;
  // The one place a money value becomes a number: a range input's value is
  // numeric by nature. It is converted straight back to a fixed-2 string and
  // never used for arithmetic.
  const sliderValue = invalid ? 0 : Math.min(Number(value), EXTRA_SLIDER_MAX);

  return (
    <section aria-labelledby="extra-heading" className="mt-10">
      <h2 id="extra-heading" className="eyebrow">
        Extra each month
      </h2>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="tnum text-2xl text-ink-soft">$</span>
        <input
          className="tnum w-32 rounded bg-transparent text-3xl outline-none focus:bg-ink/5"
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label="Extra payment each month, in dollars"
          aria-invalid={invalid}
        />
      </div>

      <input
        className="mt-4 w-full accent-[var(--avalanche)]"
        type="range"
        min={0}
        max={EXTRA_SLIDER_MAX}
        step={5}
        value={sliderValue}
        onChange={(event) => onChange(Number(event.target.value).toFixed(2))}
        aria-label="Extra payment each month"
      />

      {error !== null && <p className="mt-2 text-xs text-ink-soft">{error}</p>}

      <p className="mt-2 text-xs text-ink-soft">
        On top of every minimum. Drag to see what it buys back.
      </p>
    </section>
  );
}
