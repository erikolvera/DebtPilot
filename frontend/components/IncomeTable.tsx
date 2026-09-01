"use client";

import { useEffect, useRef } from "react";
import type { IncomeDraft } from "@/lib/api";

type Props = {
  incomes: IncomeDraft[];
  onChange: (incomes: IncomeDraft[]) => void;
};

type IncomeErrors = Partial<Record<"name" | "amount" | "frequency", string>>;

export const MAX_INCOMES = 50;

const DECIMAL = /^\d+(\.\d{1,2})?$/;
const MONEY_MAX = 99999999.99;
const MAX_NAME = 120;
const FREQUENCIES = [
  ["salary", "Salary (annual)"],
  ["monthly", "Monthly"],
  ["biweekly", "Biweekly"],
  ["weekly", "Weekly"],
] as const;

function incomeErrors(income: IncomeDraft): IncomeErrors {
  const errors: IncomeErrors = {};
  const name = income.name.trim();

  if (name.length === 0) errors.name = "Give this income source a name";
  else if (name.length > MAX_NAME) errors.name = "Name is too long";

  if (!FREQUENCIES.some(([frequency]) => frequency === income.frequency)) {
    errors.frequency = "Choose how often you are paid";
  }

  if (!DECIMAL.test(income.amount)) {
    errors.amount = "Take-home amount must be a plain amount, like 1200.50";
  } else if (Number(income.amount) > MONEY_MAX) {
    errors.amount = "Take-home amount is too large";
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
    onChange([...incomes, { id, name: "", amount: "", frequency: "monthly" }]);
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
    <section aria-labelledby="income-heading" className="panel">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow text-primary">Cash coming in</p>
          <h2 id="income-heading" className="mt-2 font-display text-2xl font-semibold">
            Monthly income
          </h2>
        </div>
        <span className="tnum rounded-full bg-mint px-3 py-1 text-xs text-[#176347]">
          {incomes.length} {incomes.length === 1 ? "source" : "sources"}
        </span>
      </div>

      {incomes.length === 0 ? (
        <p className="mt-4 text-sm text-ink-soft">No income sources added yet.</p>
      ) : (
        <table className="mt-6 w-full table-fixed border-collapse">
          <caption className="sr-only">
            Your monthly income sources. Edit any value to update the report.
          </caption>
          <thead>
            <tr className="border-b border-rule text-left">
              <th scope="col" className="eyebrow w-[42%] py-2 font-normal">
                Source
              </th>
              <th scope="col" className="eyebrow w-[30%] py-2 font-normal">
                Pay basis
              </th>
              <th scope="col" className="eyebrow w-[22%] py-2 text-right font-normal">
                Take-home amount
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
                      className="w-full rounded-lg bg-transparent px-2 py-2 text-sm outline-none hover:bg-primary/5 focus:bg-primary/5"
                      value={income.name}
                      onChange={(event) => update(income.id, "name", event.target.value)}
                      aria-label="Income source name"
                      aria-invalid={errors.name !== undefined}
                      aria-describedby={errors.name ? `income-${index}-name-error` : undefined}
                      placeholder="Paycheck"
                    />
                  </th>
                  <td className="py-1">
                    <select
                      className="w-full rounded-lg bg-transparent px-1 py-2 text-xs outline-none hover:bg-primary/5 focus:bg-primary/5 sm:px-2 sm:text-sm"
                      value={income.frequency}
                      onChange={(event) => update(income.id, "frequency", event.target.value)}
                      aria-label={`${label} — pay frequency`}
                      aria-invalid={errors.frequency !== undefined}
                      aria-describedby={errors.frequency ? `income-${index}-frequency-error` : undefined}
                    >
                      {FREQUENCIES.map(([value, frequencyLabel]) => (
                        <option key={value} value={value}>{frequencyLabel}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1">
                    <input
                      className="w-full rounded-lg bg-transparent px-1 py-2 text-right font-mono text-xs tabular-nums outline-none hover:bg-primary/5 focus:bg-primary/5 sm:px-2 sm:text-sm"
                      type="text"
                      inputMode="decimal"
                      value={income.amount}
                      onChange={(event) => update(income.id, "amount", event.target.value)}
                      aria-label={`${label} — take-home amount`}
                      aria-invalid={errors.amount !== undefined}
                      aria-describedby={
                        errors.amount ? `income-${index}-amount-error` : undefined
                      }
                      placeholder="0.00"
                    />
                  </td>
                  <td className="py-1 pl-1">
                    <button
                      type="button"
                      onClick={() => remove(income.id)}
                      className="rounded-full px-2 py-1 text-ink-soft hover:bg-coral-soft hover:text-danger"
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
        <ul aria-live="polite" className="mt-3 space-y-1 text-xs text-danger">
          {problems.map((problem) => (
            <li id={problem.id} key={problem.id}>
              {problem.message}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-xs leading-relaxed text-ink-soft">
        Enter the amount that reaches your account after taxes and payroll
        deductions. For Salary (annual), use your yearly take-home total. Weekly
        pay uses 52 checks per year; biweekly pay uses 26. The report converts
        each to a monthly average.
      </p>

      <button
        type="button"
        onClick={add}
        disabled={incomes.length >= MAX_INCOMES}
        className="secondary-button mt-5 px-4 py-2 text-sm disabled:opacity-40"
      >
        Add income
      </button>
      {incomes.length >= MAX_INCOMES && (
        <p className="mt-2 text-xs text-ink-soft">Fifty income sources is the limit.</p>
      )}
    </section>
  );
}
