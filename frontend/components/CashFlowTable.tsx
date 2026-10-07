"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { ExpenseDraft, IncomeDraft } from "@/lib/api";
import { MAX_NAME, MONEY_MAX, moneyError } from "@/lib/validate";

type Row = { id: string; name: string };

type Config<T extends Row> = {
  /** Prefix for error ids, e.g. `income-0-amount-error`. */
  idPrefix: string;
  headingId: string;
  eyebrow: string;
  eyebrowClass: string;
  title: string;
  badgeClass: string;
  noun: [singular: string, plural: string];
  empty: string;
  caption: string;
  untitled: string;
  removeFallback: string;
  max: number;
  limitText: string;
  addLabel: string;
  footnote?: ReactNode;
  name: { header: string; width: string; ariaLabel: string; placeholder: string; missing: string };
  select: {
    field: keyof T & string;
    header: string;
    width: string;
    ariaSuffix: string;
    missing: string;
    options: ReadonlyArray<readonly [value: string, label: string]>;
  };
  amount: { field: keyof T & string; header: string; width: string; ariaSuffix: string; title: string };
  blank: (id: string) => T;
};

export function rowErrors<T extends Row>(row: T, config: Config<T>): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = row.name.trim();
  if (name.length === 0) errors.name = config.name.missing;
  else if (name.length > MAX_NAME) errors.name = "Name is too long";

  const { select, amount } = config;
  if (!select.options.some(([value]) => value === row[select.field])) {
    errors[select.field] = select.missing;
  }

  const money = moneyError(String(row[amount.field]), MONEY_MAX, amount.title);
  if (money) errors[amount.field] = money;
  return errors;
}

function CashFlowTable<T extends Row>({
  rows,
  onChange,
  config,
}: {
  rows: T[];
  onChange: (rows: T[]) => void;
  config: Config<T>;
}) {
  const focusId = useRef<string | null>(null);
  const nameInputs = useRef(new Map<string, HTMLInputElement>());
  const { idPrefix, select, amount } = config;

  useEffect(() => {
    if (focusId.current === null) return;
    nameInputs.current.get(focusId.current)?.focus();
    focusId.current = null;
  }, [rows]);

  const update = (id: string, field: keyof T & string, value: string) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)));

  const remove = (id: string) => onChange(rows.filter((row) => row.id !== id));

  const add = () => {
    if (rows.length >= config.max) return;
    const id = crypto.randomUUID();
    focusId.current = id;
    onChange([...rows, config.blank(id)]);
  };

  const errorId = (index: number, field: string) => `${idPrefix}-${index}-${field}-error`;

  const problems = rows.flatMap((row, index) => {
    const errors = rowErrors(row, config);
    const label = row.name.trim() || config.untitled;
    return Object.keys(errors).map((field) => ({
      id: errorId(index, field),
      message: `${label}: ${errors[field]}`,
    }));
  });

  return (
    <section aria-labelledby={config.headingId} className="panel">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={`eyebrow ${config.eyebrowClass}`}>{config.eyebrow}</p>
          <h2 id={config.headingId} className="mt-2 font-display text-2xl font-semibold">
            {config.title}
          </h2>
        </div>
        <span className={`tnum rounded-full px-3 py-1 text-xs ${config.badgeClass}`}>
          {rows.length} {rows.length === 1 ? config.noun[0] : config.noun[1]}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-ink-soft">{config.empty}</p>
      ) : (
        <table className="mt-6 w-full table-fixed border-collapse">
          <caption className="sr-only">{config.caption}</caption>
          <thead>
            <tr className="border-b border-rule text-left">
              <th scope="col" className={`eyebrow ${config.name.width} py-2 font-normal`}>
                {config.name.header}
              </th>
              <th scope="col" className={`eyebrow ${select.width} py-2 font-normal`}>
                {select.header}
              </th>
              <th scope="col" className={`eyebrow ${amount.width} py-2 text-right font-normal`}>
                {amount.header}
              </th>
              <th scope="col" className="sr-only">
                Remove
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const errors = rowErrors(row, config);
              const label = row.name.trim() || config.untitled;
              const describedBy = (field: string) =>
                errors[field] ? errorId(index, field) : undefined;

              return (
                <tr key={row.id} className="border-b border-rule/60">
                  <th scope="row" className="py-1 font-normal">
                    <input
                      ref={(element) => {
                        if (element) nameInputs.current.set(row.id, element);
                        else nameInputs.current.delete(row.id);
                      }}
                      className="w-full rounded-lg bg-transparent px-2 py-2 text-sm outline-none hover:bg-primary/5 focus:bg-primary/5"
                      value={row.name}
                      onChange={(event) => update(row.id, "name", event.target.value)}
                      aria-label={config.name.ariaLabel}
                      aria-invalid={errors.name !== undefined}
                      aria-describedby={describedBy("name")}
                      placeholder={config.name.placeholder}
                    />
                  </th>
                  <td className="py-1">
                    <select
                      className="w-full rounded-lg bg-transparent px-1 py-2 text-xs outline-none hover:bg-primary/5 focus:bg-primary/5 sm:px-2 sm:text-sm"
                      value={String(row[select.field])}
                      onChange={(event) => update(row.id, select.field, event.target.value)}
                      aria-label={`${label} — ${select.ariaSuffix}`}
                      aria-invalid={errors[select.field] !== undefined}
                      aria-describedby={describedBy(select.field)}
                    >
                      {select.options.map(([value, optionLabel]) => (
                        <option key={value} value={value}>
                          {optionLabel}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1">
                    <input
                      className="w-full rounded-lg bg-transparent px-1 py-2 text-right font-mono text-xs tabular-nums outline-none hover:bg-primary/5 focus:bg-primary/5 sm:px-2 sm:text-sm"
                      type="text"
                      inputMode="decimal"
                      value={String(row[amount.field])}
                      onChange={(event) => update(row.id, amount.field, event.target.value)}
                      aria-label={`${label} — ${amount.ariaSuffix}`}
                      aria-invalid={errors[amount.field] !== undefined}
                      aria-describedby={describedBy(amount.field)}
                      placeholder="0.00"
                    />
                  </td>
                  <td className="py-1 pl-1">
                    <button
                      type="button"
                      onClick={() => remove(row.id)}
                      className="rounded-full px-2 py-1 text-ink-soft hover:bg-coral-soft hover:text-danger"
                      aria-label={`Remove ${row.name || config.removeFallback}`}
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

      {config.footnote}

      <button
        type="button"
        onClick={add}
        disabled={rows.length >= config.max}
        className="secondary-button mt-5 px-4 py-2 text-sm disabled:opacity-40"
      >
        {config.addLabel}
      </button>
      {rows.length >= config.max && (
        <p className="mt-2 text-xs text-ink-soft">{config.limitText}</p>
      )}
    </section>
  );
}

export const INCOME: Config<IncomeDraft> = {
  idPrefix: "income",
  headingId: "income-heading",
  eyebrow: "Cash coming in",
  eyebrowClass: "text-primary",
  title: "Monthly income",
  badgeClass: "bg-mint text-[#176347]",
  noun: ["source", "sources"],
  empty: "No income sources added yet.",
  caption: "Your monthly income sources. Edit any value to update the report.",
  untitled: "Untitled income",
  removeFallback: "this income source",
  max: 50,
  limitText: "Fifty income sources is the limit.",
  addLabel: "Add income",
  footnote: (
    <p className="mt-4 text-xs leading-relaxed text-ink-soft">
      Enter the amount that reaches your account after taxes and payroll
      deductions. For Salary (annual), use your yearly take-home total. Weekly
      pay uses 52 checks per year; biweekly pay uses 26. The report converts
      each to a monthly average.
    </p>
  ),
  name: {
    header: "Source",
    width: "w-[42%]",
    ariaLabel: "Income source name",
    placeholder: "Paycheck",
    missing: "Give this income source a name",
  },
  select: {
    field: "frequency",
    header: "Pay basis",
    width: "w-[30%]",
    ariaSuffix: "pay frequency",
    missing: "Choose how often you are paid",
    options: [
      ["salary", "Salary (annual)"],
      ["monthly", "Monthly"],
      ["biweekly", "Biweekly"],
      ["weekly", "Weekly"],
    ],
  },
  amount: {
    field: "amount",
    header: "Take-home amount",
    width: "w-[22%]",
    ariaSuffix: "take-home amount",
    title: "Take-home amount",
  },
  blank: (id) => ({ id, name: "", amount: "", frequency: "monthly" }),
};

const EXPENSE_CATEGORIES = [
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
];

export const EXPENSE: Config<ExpenseDraft> = {
  idPrefix: "expense",
  headingId: "expenses-heading",
  eyebrow: "Cash going out",
  eyebrowClass: "text-snowball",
  title: "Monthly expenses",
  badgeClass: "bg-coral-soft text-danger",
  noun: ["expense", "expenses"],
  empty: "No expenses added yet.",
  caption: "Your monthly expenses. Edit any value to update the report.",
  untitled: "Untitled expense",
  removeFallback: "this expense",
  max: 100,
  limitText: "One hundred expenses is the limit.",
  addLabel: "Add expense",
  name: {
    header: "Expense",
    width: "w-[40%]",
    ariaLabel: "Expense name",
    placeholder: "Rent",
    missing: "Give this expense a name",
  },
  select: {
    field: "category",
    header: "Category",
    width: "w-[25%]",
    ariaSuffix: "category",
    missing: "Choose an expense category",
    options: EXPENSE_CATEGORIES.map((c) => [c, c.charAt(0).toUpperCase() + c.slice(1)] as const),
  },
  amount: {
    field: "monthly_amount",
    header: "Monthly",
    width: "w-[29%]",
    ariaSuffix: "monthly amount",
    title: "Monthly amount",
  },
  blank: (id) => ({ id, name: "", category: "other", monthly_amount: "" }),
};

export function IncomeTable(props: { incomes: IncomeDraft[]; onChange: (rows: IncomeDraft[]) => void }) {
  return <CashFlowTable rows={props.incomes} onChange={props.onChange} config={INCOME} />;
}

export function ExpenseTable(props: { expenses: ExpenseDraft[]; onChange: (rows: ExpenseDraft[]) => void }) {
  return <CashFlowTable rows={props.expenses} onChange={props.onChange} config={EXPENSE} />;
}
