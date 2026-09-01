import type { DebtDraft } from "./api";

export type Portfolio = { debts: DebtDraft[]; extra: string };
export type StorageLike = Pick<Storage, "getItem" | "setItem">;

const KEY = "debtpilot.portfolio.v1";

/** Mirrors the server's MAX_DEBTS_PER_USER. */
const MAX_DEBTS = 20;

const FIELDS = ["id", "name", "balance", "apr", "minimum_payment"] as const;

function isDraft(value: unknown): value is DebtDraft {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  // Every field must be a string. A number that slipped in here would reach
  // the request body and earn a 422 that reads like a server fault.
  return FIELDS.every((field) => typeof record[field] === "string");
}

function isPortfolio(value: unknown): value is Portfolio {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.extra !== "string") return false;
  if (!Array.isArray(record.debts)) return false;
  if (record.debts.length > MAX_DEBTS) return false;
  return record.debts.every(isDraft);
}

/**
 * Read the stored portfolio, or the fallback.
 *
 * Every failure path returns the fallback rather than throwing. A corrupt
 * entry, a hostile storage implementation (Safari's private mode throws on
 * access rather than returning null), and a shape from an older build all
 * arrive here, and none of them is a reason to show a blank page.
 */
export function loadPortfolio(storage: StorageLike | null, fallback: Portfolio): Portfolio {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return isPortfolio(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** Persist the portfolio. A quota or permission error is not worth an exception. */
export function savePortfolio(storage: StorageLike | null, portfolio: Portfolio): void {
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify(portfolio));
  } catch {
    // Nothing to do and nothing to tell the user: their numbers are on screen.
  }
}

/** localStorage, or null where there is no window (server render, or blocked). */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
