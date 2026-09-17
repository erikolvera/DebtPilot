"use client";

import type { ExpenseDraft, FinancialDebtDraft, IncomeDraft } from "./api";
import type { PreferredStrategy, FinancialProfile } from "./profileStorage";
import { useLocalData } from "@/components/LocalDataProvider";

export function useFinancialProfile() {
  const { data, ready, update, retry } = useLocalData();
  const patch = (values: Partial<FinancialProfile>) => update((current) => ({ ...current, profile: { ...current.profile, ...values } }));
  return {
    profile: data.profile,
    ready,
    setIncomes: (incomes: IncomeDraft[]) => patch({ incomes }),
    setExpenses: (expenses: ExpenseDraft[]) => patch({ expenses }),
    setDebts: (debts: FinancialDebtDraft[]) => patch({ debts }),
    setExtra: (extra: string) => patch({ extra }),
    setPreferredStrategy: (preferredStrategy: PreferredStrategy | null) => patch({ preferredStrategy }),
    saveNow: retry,
  };
}
