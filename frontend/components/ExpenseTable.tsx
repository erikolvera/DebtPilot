"use client";

import { useEffect, useRef } from "react";
import type { ExpenseDraft } from "@/lib/api";

type Props = {
  expenses: ExpenseDraft[];
  onChange: (expenses: ExpenseDraft[]) => void;
};

type ExpenseErrors = Partial<Record<"name" | "category" | "monthly_amount", string>>;

export const MAX_EXPENSES = 100;
export const EXPENSE_CATEGORIES = [
  "housing",
  "food",
  "utilities",
  "transportation",
  "insurance",
  "healthcare",
  "childcare",
  "subscriptions",
  "personal",
  "other",
] as const;

const DECIMAL = /^\d+(\.\d{1,2})?$/;
const MONEY_MAX = 99999999.99;
const MAX_NAME = 120;

function expenseErrors(expense: ExpenseDraft): ExpenseErrors {
  const errors: ExpenseErrors = {};
  const name = expense.name.trim();

  if (name.length === 0) errors.name = "Give this expense a name";
  else if (name.length > MAX_NAME) errors.name = "Name is too long";

  if (!EXPENSE_CATEGORIES.some((category) => category === expense.category)) {
    errors.category = "Choose an expense category";
  }

  if (!DECIMAL.test(expense.monthly_amount)) {
    errors.monthly_amount = "Monthly amount must be a plain amount, like 1200.50";
  } else if (Number(expense.monthly_amount) > MONEY_MAX) {
    errors.monthly_amount = "Monthly amount is too large";
  }

  return errors;
}

function categoryLabel(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export function ExpenseTable({ expenses, onChange }: Props) {
  const focusId = useRef<string | null>(null);
  const nameInputs = useRef(new Map<string, HTMLInputElement>());

  useEffect(() => {
    if (focusId.current === null) return;
    nameInputs.current.get(focusId.current)?.focus();
    focusId.current = null;
  }, [expenses]);

  const update = (id: string, field: keyof ExpenseDraft, value: string) =>
    onChange(
      expenses.map((expense) => (expense.id === id ? { ...expense, [field]: value } : expense)),
    );

  const remove = (id: string) => onChange(expenses.filter((expense) => expense.id !== id));

  const add = () => {
    if (expenses.length >= MAX_EXPENSES) return;
    const id = crypto.randomUUID();
    focusId.current = id;
    onChange([...expenses, { id, name: "", category: "other", monthly_amount: "" }]);
  };

  const problems = expenses.flatMap((expense, index) => {
    const errors = expenseErrors(expense);
    const label = expense.name.trim() || "Untitled expense";

    return (Object.keys(errors) as Array<keyof ExpenseErrors>).map((field) => ({
      id: `expense-${index}-${field}-error`,
      message: `${label}: ${errors[field]}`,
    }));
  });

  return (
    <section aria-labelledby="expenses-heading">
      <h2 id="expenses-heading" className="eyebrow">
        Monthly expenses
      </h2>

      {expenses.length === 0 ? (
        <p className="mt-4 text-sm text-ink-soft">No expenses added yet.</p>
      ) : (
        <table className="mt-4 w-full table-fixed border-collapse">
          <caption className="sr-only">
            Your monthly expenses. Edit any value to update the report.
          </caption>
          <thead>
            <tr className="border-b border-rule text-left">
              <th scope="col" className="eyebrow w-[40%] py-2 font-normal">
                Expense
              </th>
              <th scope="col" className="eyebrow w-[25%] py-2 font-normal">
                Category
              </th>
              <th scope="col" className="eyebrow w-[29%] py-2 text-right font-normal">
                Monthly
              </th>
              <th scope="col" className="sr-only">
                Remove
              </th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((expense, index) => {
              const errors = expenseErrors(expense);
              const label = expense.name.trim() || "Untitled expense";

              return (
                <tr key={expense.id} className="border-b border-rule/60">
                  <th scope="row" className="py-1 font-normal">
                    <input
                      ref={(element) => {
                        if (element) nameInputs.current.set(expense.id, element);
                        else nameInputs.current.delete(expense.id);
                      }}
                      className="w-full rounded bg-transparent px-2 py-1.5 text-sm outline-none focus:bg-ink/5"
                      value={expense.name}
                      onChange={(event) => update(expense.id, "name", event.target.value)}
                      aria-label="Expense name"
                      aria-invalid={errors.name !== undefined}
                      aria-describedby={errors.name ? `expense-${index}-name-error` : undefined}
                      placeholder="Rent"
                    />
                  </th>
                  <td className="py-1">
                    <select
                      className="w-full rounded bg-transparent px-1 py-1.5 text-xs outline-none focus:bg-ink/5 sm:px-2 sm:text-sm"
                      value={expense.category}
                      onChange={(event) => update(expense.id, "category", event.target.value)}
                      aria-label={`${label} — category`}
                      aria-invalid={errors.category !== undefined}
                      aria-describedby={
                        errors.category ? `expense-${index}-category-error` : undefined
                      }
                    >
                      {EXPENSE_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {categoryLabel(category)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1">
                    <input
                      className="w-full rounded bg-transparent px-1 py-1.5 text-right font-mono text-xs tabular-nums outline-none focus:bg-ink/5 sm:px-2 sm:text-sm"
                      type="text"
                      inputMode="decimal"
                      value={expense.monthly_amount}
                      onChange={(event) => update(expense.id, "monthly_amount", event.target.value)}
                      aria-label={`${label} — monthly amount`}
                      aria-invalid={errors.monthly_amount !== undefined}
                      aria-describedby={
                        errors.monthly_amount ? `expense-${index}-monthly_amount-error` : undefined
                      }
                      placeholder="0.00"
                    />
                  </td>
                  <td className="py-1 pl-1">
                    <button
                      type="button"
                      onClick={() => remove(expense.id)}
                      className="rounded px-2 py-1 text-ink-soft hover:text-ink"
                      aria-label={`Remove ${expense.name || "this expense"}`}
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
        disabled={expenses.length >= MAX_EXPENSES}
        className="mt-4 rounded border border-rule px-3 py-1.5 text-sm hover:bg-ink/5 disabled:opacity-40"
      >
        Add expense
      </button>
      {expenses.length >= MAX_EXPENSES && (
        <p className="mt-2 text-xs text-ink-soft">One hundred expenses is the limit.</p>
      )}
    </section>
  );
}
