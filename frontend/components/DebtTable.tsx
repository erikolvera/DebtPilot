"use client";

import type { DebtDraft } from "@/lib/api";
import { debtErrors } from "@/lib/validate";

const MAX_DEBTS = 20;

type Props = {
  debts: DebtDraft[];
  onChange: (debts: DebtDraft[]) => void;
};

const CELL = "w-full bg-transparent px-2 py-1.5 text-right tabular-nums " +
  "font-mono text-sm outline-none focus:bg-ink/5 rounded";

export function DebtTable({ debts, onChange }: Props) {
  const update = (id: string, field: keyof DebtDraft, value: string) =>
    onChange(debts.map((debt) => (debt.id === id ? { ...debt, [field]: value } : debt)));

  const remove = (id: string) => onChange(debts.filter((debt) => debt.id !== id));

  const add = () =>
    onChange([
      ...debts,
      { id: crypto.randomUUID(), name: "", balance: "", apr: "", minimum_payment: "" },
    ]);

  return (
    <section aria-labelledby="cards-heading">
      <h2 id="cards-heading" className="eyebrow">
        Your cards
      </h2>

      {debts.length === 0 ? (
        <p className="mt-4 text-sm text-ink-soft">
          No cards yet. Add one to see your payoff date.
        </p>
      ) : (
        <table className="mt-4 w-full border-collapse">
          <caption className="sr-only">
            Your credit cards. Edit any value to update the plan.
          </caption>
          <thead>
            <tr className="border-b border-rule text-left">
              <th scope="col" className="eyebrow py-2 font-normal">Card</th>
              <th scope="col" className="eyebrow py-2 text-right font-normal">Owed</th>
              <th scope="col" className="eyebrow py-2 text-right font-normal">APR</th>
              <th scope="col" className="eyebrow py-2 text-right font-normal">Min</th>
              <th scope="col" className="sr-only">Remove</th>
            </tr>
          </thead>
          <tbody>
            {debts.map((debt) => {
              const errors = debtErrors(debt);
              return (
                <tr key={debt.id} className="border-b border-rule/60">
                  <td className="py-1">
                    <input
                      className="w-full rounded bg-transparent px-2 py-1.5 text-sm outline-none focus:bg-ink/5"
                      value={debt.name}
                      onChange={(event) => update(debt.id, "name", event.target.value)}
                      aria-label="Card name"
                      aria-invalid={errors.name !== undefined}
                      placeholder="Card name"
                    />
                  </td>
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
                      aria-label="Balance owed"
                      aria-invalid={errors.balance !== undefined}
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
                      aria-label="Annual percentage rate"
                      aria-invalid={errors.apr !== undefined}
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
                      aria-label="Minimum payment"
                      aria-invalid={errors.minimum_payment !== undefined}
                      placeholder="0.00"
                    />
                  </td>
                  <td className="py-1 pl-1">
                    <button
                      type="button"
                      onClick={() => remove(debt.id)}
                      className="rounded px-2 py-1 text-ink-soft hover:text-ink"
                      aria-label={`Remove ${debt.name || "this card"}`}
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

      <button
        type="button"
        onClick={add}
        disabled={debts.length >= MAX_DEBTS}
        className="mt-4 rounded border border-rule px-3 py-1.5 text-sm hover:bg-ink/5 disabled:opacity-40"
      >
        Add a card
      </button>
      {debts.length >= MAX_DEBTS && (
        <p className="mt-2 text-xs text-ink-soft">Twenty cards is the limit.</p>
      )}
    </section>
  );
}
