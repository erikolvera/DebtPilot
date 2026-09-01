"use client";

import { useEffect, useState } from "react";
import type { ExpenseDraft, FinancialDebtDraft, IncomeDraft } from "./api";
import {
  browserStorage,
  loadFinancialProfile,
  saveFinancialProfile,
  type FinancialProfile,
} from "./profileStorage";
import { seedFinancialProfile } from "./seed";

export function useFinancialProfile() {
  const [profile, setProfile] = useState<FinancialProfile>(seedFinancialProfile);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfile(loadFinancialProfile(browserStorage(), seedFinancialProfile()));
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) saveFinancialProfile(browserStorage(), profile);
  }, [profile, ready]);

  return {
    profile,
    ready,
    setIncomes: (incomes: IncomeDraft[]) =>
      setProfile((current) => ({ ...current, incomes })),
    setExpenses: (expenses: ExpenseDraft[]) =>
      setProfile((current) => ({ ...current, expenses })),
    setDebts: (debts: FinancialDebtDraft[]) =>
      setProfile((current) => ({ ...current, debts })),
    setExtra: (extra: string) =>
      setProfile((current) => ({ ...current, extra })),
    saveNow: () => saveFinancialProfile(browserStorage(), profile),
  };
}
