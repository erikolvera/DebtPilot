"use client";

import { useEffect, useRef } from "react";
import type { FinancialDebtDraft } from "@/lib/api";
import { debtErrors, MAX_DEBTS } from "@/lib/validate";

type Props = {
  debts: FinancialDebtDraft[];
  onChange: (debts: FinancialDebtDraft[]) => void;
};

const DEBT_TYPES = [
  ["credit_card", "Credit card"],
  ["auto_loan", "Auto loan"],
  ["personal_loan", "Personal loan"],
  ["student_loan", "Student loan"],
  ["medical_debt", "Medical debt"],
  ["other", "Other debt"],
] as const;

// Tighter padding and smaller figures below `sm`. The fixed column widths that
// stop "Visa Signature" truncating on desktop leave the numeric columns ~49-68px
// at a 360px viewport, where 14px mono plus 16px of padding clipped every one of
// them mid-value. A clipped NUMBER is worse than a clipped name — "24.9" reads
// as a different APR than "24.99" — so the numerals give up size before the
// value gives up digits.
const CELL = "w-full bg-transparent px-1 py-1.5 text-right tabular-nums " +
  "font-mono text-xs outline-none focus:bg-ink/5 rounded sm:px-2 sm:text-sm";

export function DebtTable({ debts, onChange }: Props) {
  const update = (id: string, field: keyof FinancialDebtDraft, value: string) =>
    onChange(debts.map((debt) => (debt.id === id ? { ...debt, [field]: value } : debt)));

  const remove = (id: string) => onChange(debts.filter((debt) => debt.id !== id));

  // The new row renders above the still-focused "Add a card" button, so Tab
  // skips it. Record which row to focus, then move focus once it exists.
  const focusId = useRef<string | null>(null);
  const nameInputs = useRef(new Map<string, HTMLInputElement>());

  useEffect(() => {
    if (focusId.current === null) return;
    nameInputs.current.get(focusId.current)?.focus();
    focusId.current = null;
  }, [debts]);

  const add = () => {
    const id = crypto.randomUUID();
    focusId.current = id;
    onChange([...debts, { id, name: "", type: "credit_card", balance: "", apr: "", minimum_payment: "" }]);
  };

  // Messages live below the table, not in the cells: the numeric columns are
  // ~112px wide, so an in-cell message wrapped to three lines and doubled the
  // row's height, clipping the card name beside it. The inset marker on the
  // input says WHICH field; this list says what is wrong with it.
  const problems = debts.flatMap((debt, index) => {
    const errors = debtErrors(debt);
    const label = debt.name.trim() || "Untitled debt";
    return Object.entries(errors).map(([field, message]) => ({
      id: `debt-${index}-${field}-error`,
      message: `${label}: ${message}`,
    }));
  });

  return (
    <section aria-labelledby="debts-heading">
      <h2 id="debts-heading" className="eyebrow">
        Debts
      </h2>

      {debts.length === 0 ? (
        <p className="mt-4 text-sm text-ink-soft">
          No debts added. Your report can still show monthly cash flow.
        </p>
      ) : (
        // table-fixed with explicit widths: auto layout gave every column an
        // equal-ish share, squeezing the name to ~86px so "Visa Signature"
        // truncated, while the APR column sat half empty. The numeric columns
        // need only what a formatted amount occupies.
        //
        // The Remove column carries no width class on purpose: `sr-only` sets
        // position:absolute, which takes that <th> out of the table's column
        // model entirely, so a width there would be inert decoration. Fixed
        // layout gives the fifth column whatever the four above leave — the
        // 6% these four do not claim.
        //
        // ponytail: measured ceiling of the resulting 380px rail — the name
        // fits ~16 characters ("Visa Signature" yes, "Chase Sapphire Reserve"
        // no) and Owed fits up to 99,999.99. Both are inputs, so longer values
        // scroll rather than being lost, and a six-figure balance on a CREDIT
        // CARD is not the case this product is for. Upgrade path if it ever
        // matters: drop to a stacked card layout below some width instead of
        // squeezing five columns.
        <table className="mt-4 w-full table-fixed border-collapse">
          <caption className="sr-only">
            Your debts. Edit any value to update the report.
          </caption>
          <thead>
            <tr className="border-b border-rule text-left">
              <th scope="col" className="eyebrow w-[38%] py-2 font-normal">Debt</th>
              <th scope="col" className="eyebrow w-[22%] py-2 text-right font-normal">Owed</th>
              <th scope="col" className="eyebrow w-[16%] py-2 text-right font-normal">APR</th>
              <th scope="col" className="eyebrow w-[18%] py-2 text-right font-normal">Min</th>
              <th scope="col" className="sr-only">Remove</th>
            </tr>
          </thead>
          <tbody>
            {debts.map((debt, index) => {
              const errors = debtErrors(debt);
              const cardLabel = debt.name.trim() || "Untitled debt";
              return (
                <tr key={debt.id} className="border-b border-rule/60">
                  <th scope="row" className="py-1 font-normal">
                    <input
                      ref={(el) => {
                        if (el) nameInputs.current.set(debt.id, el);
                        else nameInputs.current.delete(debt.id);
                      }}
                      className="w-full rounded bg-transparent px-2 py-1.5 text-sm outline-none focus:bg-ink/5"
                      value={debt.name}
                      onChange={(event) => update(debt.id, "name", event.target.value)}
                      aria-label="Debt name"
                      aria-invalid={errors.name !== undefined}
                      aria-describedby={errors.name ? `debt-${index}-name-error` : undefined}
                      placeholder="Debt name"
                    />
                    <select
                      className="mt-0.5 w-full rounded bg-transparent px-2 py-1 text-[0.6875rem] text-ink-soft outline-none focus:bg-ink/5"
                      value={debt.type}
                      onChange={(event) => update(debt.id, "type", event.target.value)}
                      aria-label={`${cardLabel} — debt type`}
                    >
                      {DEBT_TYPES.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </th>
                  <td className="py-1">
                    <input
                      className={CELL}
                      // Not type="number": it returns a string regardless, and
                      // its stepper and locale parsing invite the float thinking
                      // the whole contract excludes.
                      type="text"
                      inputMode="decimal"
                      value={debt.balance}
                      onChange={(event) => update(debt.id, "balance", event.target.value)}
                      aria-label={`${cardLabel} — balance owed`}
                      aria-invalid={errors.balance !== undefined}
                      aria-describedby={errors.balance ? `debt-${index}-balance-error` : undefined}
                      placeholder="0.00"
                    />
                  </td>
                  <td className="py-1">
                    <input
                      className={CELL}
                      type="text"
                      inputMode="decimal"
                      value={debt.apr}
                      onChange={(event) => update(debt.id, "apr", event.target.value)}
                      aria-label={`${cardLabel} — annual percentage rate`}
                      aria-invalid={errors.apr !== undefined}
                      aria-describedby={errors.apr ? `debt-${index}-apr-error` : undefined}
                      placeholder="0.00"
                    />
                  </td>
                  <td className="py-1">
                    <input
                      className={CELL}
                      type="text"
                      inputMode="decimal"
                      value={debt.minimum_payment}
                      onChange={(event) => update(debt.id, "minimum_payment", event.target.value)}
                      aria-label={`${cardLabel} — minimum payment`}
                      aria-invalid={errors.minimum_payment !== undefined}
                      aria-describedby={errors.minimum_payment ? `debt-${index}-minimum_payment-error` : undefined}
                      placeholder="0.00"
                    />
                  </td>
                  <td className="py-1 pl-1">
                    <button
                      type="button"
                      onClick={() => remove(debt.id)}
                      className="rounded px-2 py-1 text-ink-soft hover:text-ink"
                      aria-label={`Remove ${debt.name || "this debt"}`}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {problems.length > 0 && (
        <ul aria-live="polite" className="mt-3 space-y-1 text-xs text-ink-soft">
          {problems.map((problem) => (
            <li id={problem.id} key={problem.id}>{problem.message}</li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={add}
        disabled={debts.length >= MAX_DEBTS}
        className="mt-4 rounded border border-rule px-3 py-1.5 text-sm hover:bg-ink/5 disabled:opacity-40"
      >
        Add debt
      </button>
      {debts.length >= MAX_DEBTS && (
        <p className="mt-2 text-xs text-ink-soft">Twenty debts is the limit.</p>
      )}
    </section>
  );
}
