import { isProfile, loadFinancialProfile, type FinancialProfile } from "./profileStorage";
import { CHECK_IN_KEY, emptyCheckInState, isState, type CheckInState } from "./checkInStorage";
import { seedFinancialProfile } from "./seed";

export const DATA_KEY = "debtpilot.data.v1";
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
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
  data: LocalData; error: string | null; recovery: Record<string, string> | null;
} {
  const data = initialData();
  const raw: Record<string, string> = {};
  if (!storage) return { data, error: "Browser storage is unavailable. Changes are only available during this visit.", recovery: null };
  try {
    const current = storage.getItem(DATA_KEY);
    if (current !== null) {
      raw[DATA_KEY] = current;
      const parsed: unknown = JSON.parse(current);
      if (!isLocalData(parsed)) throw new Error("Invalid saved data");
      return { data: parsed, error: null, recovery: null };
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
    return { data, error: saved ? null : "This browser could not save your data. Download a backup before leaving.", recovery: null };
  } catch {
    return { data, error: "Saved data could not be read. Automatic saving is paused to protect the original data. Download the recovery file, or restore a valid backup.", recovery: raw };
  }
}
export function createBackup(data: LocalData, date = new Date()): string {
  return JSON.stringify({ format: "debtpilot-backup", version: 1, exportedAt: date.toISOString(), profile: data.profile, checkIns: data.checkIns }, null, 2);
}
export function parseBackup(text: string): LocalData {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error("Choose a backup smaller than 5 MiB.");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("This file is not valid JSON."); }
  if (typeof value !== "object" || value === null) throw new Error("This is not a DebtPilot backup.");
  const record = value as Record<string, unknown>;
  if (record.format !== "debtpilot-backup") throw new Error("This is not a DebtPilot backup.");
  if (record.version !== 1) throw new Error("This backup version is not supported.");
  if (typeof record.exportedAt !== "string" || !Number.isFinite(Date.parse(record.exportedAt)) || !isLocalData(record)) throw new Error("This backup contains invalid plan or check-in data.");
  return { version: 1, profile: record.profile, checkIns: record.checkIns };
}
export function downloadJson(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
