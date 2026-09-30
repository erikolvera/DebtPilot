import { isProfile, loadFinancialProfile, type FinancialProfile } from "./profileStorage";
import { CHECK_IN_KEY, emptyCheckInState, isState, type CheckInState } from "./checkInStorage";
import { seedFinancialProfile } from "./seed";

export const DATA_KEY = "debtpilot.data.v1";
const PROFILE_KEYS = ["debtpilot.financial-profile.v4", "debtpilot.financial-profile.v3", "debtpilot.financial-profile.v2", "debtpilot.portfolio.v1"];
const LEGACY_KEYS = [...PROFILE_KEYS, CHECK_IN_KEY];
export type LocalData = { version: 1; profile: FinancialProfile; checkIns: CheckInState };
export type DataStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function initialData(): LocalData {
  return { version: 1, profile: seedFinancialProfile(), checkIns: emptyCheckInState() };
}
export function isLocalData(value: unknown): value is LocalData {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.version === 1 && isProfile(record.profile) && isState(record.checkIns);
}
export function writeLocalData(storage: DataStorage | null, data: LocalData): boolean {
  if (!storage) return false;
  try {
    storage.setItem(DATA_KEY, JSON.stringify(data));
  } catch { return false; }
  // Cleanup cannot invalidate an already committed document.
  for (const key of LEGACY_KEYS) {
    try { storage.removeItem(key); } catch { /* The combined document remains authoritative. */ }
  }
  return true;
}
export function readLocalData(storage: DataStorage | null): {
  data: LocalData; error: string | null; blocked: boolean;
} {
  const data = initialData();
  const raw: Record<string, string> = {};
  if (!storage) return { data, error: "Browser storage is unavailable. Changes are only available during this visit.", blocked: false };
  try {
    const current = storage.getItem(DATA_KEY);
    if (current !== null) {
      const parsed: unknown = JSON.parse(current);
      if (!isLocalData(parsed)) throw new Error("Invalid saved data");
      return { data: parsed, error: null, blocked: false };
    }
    for (const key of LEGACY_KEYS) {
      const value = storage.getItem(key);
      if (value !== null) raw[key] = value;
    }
    if (PROFILE_KEYS.some((key) => key in raw)) {
      // A unique sentinel distinguishes migration failure from a valid empty draft.
      const fallback = seedFinancialProfile();
      const profile = loadFinancialProfile(storage, fallback);
      if (profile === fallback) throw new Error("Invalid saved profile");
      data.profile = profile;
    }
    if (CHECK_IN_KEY in raw) {
      const checkIns: unknown = JSON.parse(raw[CHECK_IN_KEY]);
      if (!isState(checkIns)) throw new Error("Invalid saved check-ins");
      data.checkIns = checkIns;
    }
    const saved = writeLocalData(storage, data);
    return { data, error: saved ? null : "This browser could not save your data. Changes are only available during this visit.", blocked: false };
  } catch {
    return { data, error: "Saved data could not be read. Automatic saving is paused to protect the original data.", blocked: true };
  }
}
