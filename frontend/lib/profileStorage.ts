import type {
  DebtType,
  ExpenseDraft,
  FinancialDebtDraft,
  IncomeFrequency,
  IncomeDraft,
} from "./api";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export type PreferredStrategy = "snowball" | "avalanche";

export type FinancialProfile = {
  incomes: IncomeDraft[];
  expenses: ExpenseDraft[];
  debts: FinancialDebtDraft[];
  extra: string;
  preferredStrategy: PreferredStrategy | null;
};

const PROFILE_KEY = "debtpilot.financial-profile.v4";
const PREVIOUS_PROFILE_KEY = "debtpilot.financial-profile.v3";
const V2_PROFILE_KEY = "debtpilot.financial-profile.v2";
const LEGACY_KEY = "debtpilot.portfolio.v1";
const INCOME_FREQUENCIES = new Set<IncomeFrequency>([
  "salary",
  "monthly",
  "biweekly",
  "weekly",
]);
const DEBT_TYPES = new Set<DebtType>([
  "credit_card",
  "auto_loan",
  "personal_loan",
  "student_loan",
  "medical_debt",
  "other",
]);
const EXPENSE_CATEGORIES = new Set([
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
]);
const PREFERRED_STRATEGIES = new Set<PreferredStrategy>([
  "snowball",
  "avalanche",
]);

function hasStrings(value: unknown, fields: string[]): value is Record<string, string> {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return fields.every((field) => typeof record[field] === "string");
}

function isIncome(value: unknown): value is IncomeDraft {
  return (
    hasStrings(value, ["id", "name", "amount", "frequency"]) &&
    INCOME_FREQUENCIES.has(value.frequency as IncomeFrequency)
  );
}

function isExpense(value: unknown): value is ExpenseDraft {
  return (
    hasStrings(value, ["id", "name", "category", "monthly_amount"]) &&
    EXPENSE_CATEGORIES.has(value.category)
  );
}

function isDebt(value: unknown): value is FinancialDebtDraft {
  return (
    hasStrings(value, ["id", "name", "type", "balance", "apr", "minimum_payment"]) &&
    DEBT_TYPES.has(value.type as DebtType)
  );
}

type V3FinancialProfile = Omit<FinancialProfile, "preferredStrategy">;

function isV3Profile(value: unknown): value is V3FinancialProfile {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.extra === "string" &&
    Array.isArray(record.incomes) &&
    record.incomes.length <= 50 &&
    record.incomes.every(isIncome) &&
    Array.isArray(record.expenses) &&
    record.expenses.length <= 100 &&
    record.expenses.every(isExpense) &&
    Array.isArray(record.debts) &&
    record.debts.length <= 20 &&
    record.debts.every(isDebt)
  );
}

function isProfile(value: unknown): value is FinancialProfile {
  if (!isV3Profile(value)) return false;
  const preferredStrategy = (value as Record<string, unknown>).preferredStrategy;
  return (
    preferredStrategy === null ||
    (typeof preferredStrategy === "string" &&
      PREFERRED_STRATEGIES.has(preferredStrategy as PreferredStrategy))
  );
}

function migrateLegacy(value: unknown): FinancialProfile | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.extra !== "string" || !Array.isArray(record.debts)) return null;
  if (record.debts.length > 20) return null;
  const debts = record.debts.map((value): FinancialDebtDraft | null => {
    if (!hasStrings(value, ["id", "name", "balance", "apr", "minimum_payment"])) {
      return null;
    }
    return { ...value, type: "credit_card" } as FinancialDebtDraft;
  });
  if (debts.some((debt) => debt === null)) return null;
  return {
    incomes: [],
    expenses: [],
    debts: debts as FinancialDebtDraft[],
    extra: record.extra,
    preferredStrategy: null,
  };
}

function migratePreviousProfile(value: unknown): FinancialProfile | null {
  if (!isV3Profile(value)) return null;
  return { ...value, preferredStrategy: null };
}

function migrateV2Profile(value: unknown): FinancialProfile | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.extra !== "string" ||
    !Array.isArray(record.incomes) ||
    record.incomes.length > 50 ||
    !Array.isArray(record.expenses) ||
    record.expenses.length > 100 ||
    !record.expenses.every(isExpense) ||
    !Array.isArray(record.debts) ||
    record.debts.length > 20 ||
    !record.debts.every(isDebt)
  ) {
    return null;
  }

  const incomes = record.incomes.map((value): IncomeDraft | null => {
    if (!hasStrings(value, ["id", "name", "monthly_amount"])) return null;
    return {
      id: value.id,
      name: value.name,
      amount: value.monthly_amount,
      frequency: "monthly",
    };
  });
  if (incomes.some((income) => income === null)) return null;

  return {
    incomes: incomes as IncomeDraft[],
    expenses: record.expenses,
    debts: record.debts,
    extra: record.extra,
    preferredStrategy: null,
  };
}

export function loadFinancialProfile(
  storage: StorageLike | null,
  fallback: FinancialProfile,
): FinancialProfile {
  if (!storage) return fallback;
  try {
    const current = storage.getItem(PROFILE_KEY);
    if (current) {
      const parsed: unknown = JSON.parse(current);
      return isProfile(parsed) ? parsed : fallback;
    }
    const previous = storage.getItem(PREVIOUS_PROFILE_KEY);
    if (previous) {
      return migratePreviousProfile(JSON.parse(previous)) ?? fallback;
    }
    const v2 = storage.getItem(V2_PROFILE_KEY);
    if (v2) {
      return migrateV2Profile(JSON.parse(v2)) ?? fallback;
    }
    const legacy = storage.getItem(LEGACY_KEY);
    if (!legacy) return fallback;
    return migrateLegacy(JSON.parse(legacy)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveFinancialProfile(
  storage: StorageLike | null,
  profile: FinancialProfile,
): void {
  if (!storage) return;
  try {
    storage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Storage is a convenience. The in-memory report still works.
  }
}

export function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
