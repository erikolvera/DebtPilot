"use client";

import { useEffect, useRef } from "react";
import type { IncomeDraft } from "@/lib/api";

type Props = {
  incomes: IncomeDraft[];
  onChange: (incomes: IncomeDraft[]) => void;
};

type IncomeErrors = Partial<Record<"name" | "monthly_amount", string>>;

export const MAX_INCOMES = 50;

const DECIMAL = /^\d+(\.\d{1,2})?$/;
const MONEY_MAX = 99999999.99;
const MAX_NAME = 120;

function incomeErrors(income: IncomeDraft): IncomeErrors {
  const errors: IncomeErrors = {};
  const name = income.name.trim();

  if (name.length === 0) errors.name = "Give this income source a name";
  else if (name.length > MAX_NAME) errors.name = "Name is too long";

  if (!DECIMAL.test(income.monthly_amount)) {
    errors.monthly_amount = "Monthly amount must be a plain amount, like 1200.50";
  } else if (Number(income.monthly_amount) > MONEY_MAX) {
    errors.monthly_amount = "Monthly amount is too large";
  }

  return errors;
}

export function IncomeTable({ incomes, onChange }: Props) {
  const focusId = useRef<string | null>(null);
  const nameInputs = useRef(new Map<string, HTMLInputElement>());

  useEffect(() => {
    if (focusId.current === null) return;
    nameInputs.current.get(focusId.current)?.focus();
    focusId.current = null;
  }, [incomes]);

  const update = (id: string, field: keyof IncomeDraft, value: string) =>
    onChange(incomes.map((income) => (income.id === id ? { ...income, [field]: value } : income)));

  const remove = (id: string) => onChange(incomes.filter((income) => income.id !== id));

  const add = () => {
    if (incomes.length >= MAX_INCOMES) return;
    const id = crypto.randomUUID();
    focusId.current = id;
    onChange([...incomes, { id, name: "", monthly_amount: "" }]);
  };

  const problems = incomes.flatMap((income, index) => {
    const errors = incomeErrors(income);
    const label = income.name.trim() || "Untitled income";

    return (Object.keys(errors) as Array<keyof IncomeErrors>).map((field) => ({
      id: `income-${index}-${field}-error`,
      message: `${label}: ${errors[field]}`,
    }));
  });

  return (
    <section aria-labelledby="income-heading">
      <h2 id="income-heading" className="eyebrow">
        Monthly income
      </h2>

      {incomes.length === 0 ? (
        <p className="mt-4 text-sm text-ink-soft">No income sources added yet.</p>
      ) : (
        <table className="mt-4 w-full table-fixed border-collapse">
          <caption className="sr-only">
            Your monthly income sources. Edit any value to update the report.
          </caption>
          <thead>
            <tr className="border-b border-rule text-left">
              <th scope="col" className="eyebrow w-[62%] py-2 font-normal">
                Source
              </th>
              <th scope="col" className="eyebrow w-[30%] py-2 text-right font-normal">
                Monthly
              </th>
              <th scope="col" className="sr-only">
                Remove
              </th>
            </tr>
          </thead>
          <tbody>
            {incomes.map((income, index) => {
              const errors = incomeErrors(income);
              const label = income.name.trim() || "Untitled income";

              return (
                <tr key={income.id} className="border-b border-rule/60">
                  <th scope="row" className="py-1 font-normal">
                    <input
                      ref={(element) => {
                        if (element) nameInputs.current.set(income.id, element);
                        else nameInputs.current.delete(income.id);
                      }}
                      className="w-full rounded bg-transparent px-2 py-1.5 text-sm outline-none focus:bg-ink/5"
                      value={income.name}
                      onChange={(event) => update(income.id, "name", event.target.value)}
                      aria-label="Income source name"
                      aria-invalid={errors.name !== undefined}
                      aria-describedby={errors.name ? `income-${index}-name-error` : undefined}
                      placeholder="Paycheck"
                    />
                  </th>
                  <td className="py-1">
                    <input
                      className="w-full rounded bg-transparent px-1 py-1.5 text-right font-mono text-xs tabular-nums outline-none focus:bg-ink/5 sm:px-2 sm:text-sm"
                      type="text"
                      inputMode="decimal"
                      value={income.monthly_amount}
                      onChange={(event) => update(income.id, "monthly_amount", event.target.value)}
                      aria-label={`${label} — monthly amount`}
                      aria-invalid={errors.monthly_amount !== undefined}
                      aria-describedby={
                        errors.monthly_amount ? `income-${index}-monthly_amount-error` : undefined
                      }
                      placeholder="0.00"
                    />
                  </td>
                  <td className="py-1 pl-1">
                    <button
                      type="button"
                      onClick={() => remove(income.id)}
                      className="rounded px-2 py-1 text-ink-soft hover:text-ink"
                      aria-label={`Remove ${income.name || "this income source"}`}
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
            <li id={problem.id} key={problem.id}>
              {problem.message}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={add}
        disabled={incomes.length >= MAX_INCOMES}
        className="mt-4 rounded border border-rule px-3 py-1.5 text-sm hover:bg-ink/5 disabled:opacity-40"
      >
        Add income
      </button>
      {incomes.length >= MAX_INCOMES && (
        <p className="mt-2 text-xs text-ink-soft">Fifty income sources is the limit.</p>
      )}
    </section>
  );
}
