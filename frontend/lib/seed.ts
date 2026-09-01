import type { DebtDraft } from "./api";

/**
 * The portfolio the page loads with, marked in the UI as an example.
 *
 * These numbers are a design decision, not filler. The Visa's 2% minimum sits
 * just under its 2.0825% monthly interest, so the minimums-only baseline never
 * pays off — which is the only reason the signature element (a track that runs
 * off the axis and never ends) is visible on first paint. Verified against the
 * engine; figures are recorded in spec §7.
 *
 * Ids are literal rather than generated so those recorded figures stay
 * reproducible. Rows the user adds get crypto.randomUUID().
 */
const SEED_DEBTS: DebtDraft[] = [
  { id: "visa", name: "Visa Signature", balance: "6120.00", apr: "24.99", minimum_payment: "122.40" },
  { id: "store", name: "Store card", balance: "1840.00", apr: "27.99", minimum_payment: "46.00" },
  { id: "credit", name: "Credit union", balance: "3250.00", apr: "14.50", minimum_payment: "65.00" },
];

export const DEFAULT_EXTRA = "200.00";

export const EXTRA_SLIDER_MAX = 1000;

export function seedPortfolio() {
  return { debts: SEED_DEBTS.map((debt) => ({ ...debt })), extra: DEFAULT_EXTRA };
}
