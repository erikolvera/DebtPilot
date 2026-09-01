import type { DebtDraft } from "./api";

/**
 * Client-side validation, mirroring the server's bounds.
 *
 * This exists to save a round trip and a red banner for a typo. It is NOT the
 * trust boundary — the server validates independently and is tested
 * independently — and it must never become the only check.
 */

export type FieldErrors = Partial<Record<keyof DebtDraft, string>>;

/** A plain decimal: no sign, no separators, no exponent, at most two decimals. */
const DECIMAL = /^\d+(\.\d{1,2})?$/;

const MONEY_MAX = 99999999.99;
const APR_MAX = 999.99;
/** Mirrors the server's MAX_DEBTS_PER_USER. */
export const MAX_DEBTS = 20;
const MAX_NAME = 120;

function moneyError(value: string, max: number, label: string): string | undefined {
  if (!DECIMAL.test(value)) return `${label} must be a plain amount, like 1200.50`;
  // Bounds comparison only; the value that travels is still the string.
  if (Number(value) > max) return `${label} is too large`;
  return undefined;
}

export function debtErrors(debt: DebtDraft): FieldErrors {
  const errors: FieldErrors = {};
  const name = debt.name.trim();
  if (name.length === 0) errors.name = "Give this card a name";
  else if (name.length > MAX_NAME) errors.name = "Name is too long";

  const balance = moneyError(debt.balance, MONEY_MAX, "Balance");
  if (balance) errors.balance = balance;

  const apr = moneyError(debt.apr, APR_MAX, "APR");
  if (apr) errors.apr = apr;

  // A zero minimum on a live balance is accepted: the engine treats it as a
  // legitimate question and its no-progress check answers it.
  const minimum = moneyError(debt.minimum_payment, MONEY_MAX, "Minimum payment");
  if (minimum) errors.minimum_payment = minimum;

  return errors;
}

export function extraError(extra: string): string | null {
  return moneyError(extra, MONEY_MAX, "Extra payment") ?? null;
}

/** Whether this portfolio is worth sending. */
export function isSendable(debts: DebtDraft[], extra: string): boolean {
  if (debts.length === 0 || debts.length > MAX_DEBTS) return false;
  if (extraError(extra) !== null) return false;
  return debts.every((debt) => Object.keys(debtErrors(debt)).length === 0);
}
