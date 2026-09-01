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

const MONEY_FIELD =
  "tnum mt-1 w-full rounded-xl border border-rule bg-white px-3 py-2.5 text-right text-sm outline-none transition hover:border-primary/30 focus:border-primary";

export function DebtTable({ debts, onChange }: Props) {
  const focusId = useRef<string | null>(null);
  const nameInputs = useRef(new Map<string, HTMLInputElement>());

  useEffect(() => {
    if (focusId.current === null) return;
    nameInputs.current.get(focusId.current)?.focus();
    focusId.current = null;
  }, [debts]);

  const update = (id: string, field: keyof FinancialDebtDraft, value: string) =>
    onChange(debts.map((debt) => (debt.id === id ? { ...debt, [field]: value } : debt)));

  const remove = (id: string) => onChange(debts.filter((debt) => debt.id !== id));

  const add = () => {
    if (debts.length >= MAX_DEBTS) return;
    const id = crypto.randomUUID();
    focusId.current = id;
    onChange([
      ...debts,
      { id, name: "", type: "credit_card", balance: "", apr: "", minimum_payment: "" },
    ]);
  };

  const problems = debts.flatMap((debt, index) => {
    const errors = debtErrors(debt);
    const label = debt.name.trim() || "Untitled debt";
    return Object.entries(errors).map(([field, message]) => ({
      id: `debt-${index}-${field}-error`,
      message: `${label}: ${message}`,
    }));
  });

  return (
    <section aria-labelledby="debts-heading" className="panel">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow text-primary">What you owe</p>
          <h2 id="debts-heading" className="mt-2 font-display text-2xl font-semibold">Debts</h2>
        </div>
        <span className="tnum rounded-full bg-[#eceaff] px-3 py-1 text-xs text-primary">
          {debts.length} {debts.length === 1 ? "debt" : "debts"}
        </span>
      </div>

      {debts.length === 0 ? (
        <p className="mt-6 text-sm text-ink-soft">
          No debts added. Your report can still show monthly cash flow.
        </p>
      ) : (
        <div className="mt-6 space-y-4">
          {debts.map((debt, index) => {
            const errors = debtErrors(debt);
            const label = debt.name.trim() || "Untitled debt";
            return (
              <fieldset key={debt.id} className="rounded-2xl bg-[#f7f8ff] p-4">
                <legend className="sr-only">{label}</legend>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <input
                      ref={(element) => {
                        if (element) nameInputs.current.set(debt.id, element);
                        else nameInputs.current.delete(debt.id);
                      }}
                      className="w-full rounded-lg bg-transparent px-2 py-1 text-lg font-semibold outline-none hover:bg-white focus:bg-white"
                      value={debt.name}
                      onChange={(event) => update(debt.id, "name", event.target.value)}
                      aria-label="Debt name"
                      aria-invalid={errors.name !== undefined}
                      aria-describedby={errors.name ? `debt-${index}-name-error` : undefined}
                      placeholder="Debt name"
                    />
                    <select
                      className="mt-1 rounded-lg bg-transparent px-2 py-1 text-sm text-ink-soft outline-none hover:bg-white focus:bg-white"
                      value={debt.type}
                      onChange={(event) => update(debt.id, "type", event.target.value)}
                      aria-label={`${label} — debt type`}
                    >
                      {DEBT_TYPES.map(([value, typeLabel]) => (
                        <option key={value} value={value}>{typeLabel}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(debt.id)}
                    className="rounded-full px-2.5 py-1.5 text-ink-soft hover:bg-coral-soft hover:text-danger"
                    aria-label={`Remove ${debt.name || "this debt"}`}
                  >
                    ×
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
                  <label className="text-xs text-ink-soft">
                    Balance
                    <input
                      className={MONEY_FIELD}
                      type="text"
                      inputMode="decimal"
                      value={debt.balance}
                      onChange={(event) => update(debt.id, "balance", event.target.value)}
                      aria-label={`${label} — balance owed`}
                      aria-invalid={errors.balance !== undefined}
                      aria-describedby={errors.balance ? `debt-${index}-balance-error` : undefined}
                      placeholder="0.00"
                    />
                  </label>
                  <label className="text-xs text-ink-soft">
                    APR
                    <input
                      className={MONEY_FIELD}
                      type="text"
                      inputMode="decimal"
                      value={debt.apr}
                      onChange={(event) => update(debt.id, "apr", event.target.value)}
                      aria-label={`${label} — annual percentage rate`}
                      aria-invalid={errors.apr !== undefined}
                      aria-describedby={errors.apr ? `debt-${index}-apr-error` : undefined}
                      placeholder="0.00"
                    />
                  </label>
                  <label className="text-xs text-ink-soft">
                    Minimum
                    <input
                      className={MONEY_FIELD}
                      type="text"
                      inputMode="decimal"
                      value={debt.minimum_payment}
                      onChange={(event) => update(debt.id, "minimum_payment", event.target.value)}
                      aria-label={`${label} — minimum payment`}
                      aria-invalid={errors.minimum_payment !== undefined}
                      aria-describedby={errors.minimum_payment ? `debt-${index}-minimum_payment-error` : undefined}
                      placeholder="0.00"
                    />
                  </label>
                </div>
              </fieldset>
            );
          })}
        </div>
      )}

      {problems.length > 0 && (
        <ul aria-live="polite" className="mt-4 space-y-1 text-xs text-danger">
          {problems.map((problem) => (
            <li id={problem.id} key={problem.id}>{problem.message}</li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={add}
        disabled={debts.length >= MAX_DEBTS}
        className="secondary-button mt-5 px-4 py-2 text-sm disabled:opacity-40"
      >
        Add debt
      </button>
      {debts.length >= MAX_DEBTS && (
        <p className="mt-2 text-xs text-ink-soft">Twenty debts is the limit.</p>
      )}
    </section>
  );
}
