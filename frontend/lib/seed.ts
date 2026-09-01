import type {
  ExpenseDraft,
  FinancialDebtDraft,
  IncomeDraft,
} from "./api";

const SEED_DEBTS: FinancialDebtDraft[] = [
  { id: "visa", name: "Visa Signature", type: "credit_card", balance: "6120.00", apr: "24.99", minimum_payment: "122.40" },
  { id: "store", name: "Store card", type: "credit_card", balance: "1840.00", apr: "27.99", minimum_payment: "46.00" },
  { id: "credit", name: "Credit union", type: "personal_loan", balance: "3250.00", apr: "14.50", minimum_payment: "65.00" },
];

export const EXTRA_SLIDER_MAX = 1000;

const SEED_INCOMES: IncomeDraft[] = [
  { id: "paycheck", name: "Take-home pay", monthly_amount: "5000.00" },
  { id: "recurring", name: "Recurring side income", monthly_amount: "300.00" },
];

const SEED_EXPENSES: ExpenseDraft[] = [
  { id: "housing", name: "Rent", category: "housing", monthly_amount: "1700.00" },
  { id: "food", name: "Groceries", category: "food", monthly_amount: "600.00" },
  { id: "utilities", name: "Utilities", category: "utilities", monthly_amount: "300.00" },
  { id: "transport", name: "Transportation", category: "transportation", monthly_amount: "450.00" },
  { id: "insurance", name: "Insurance", category: "insurance", monthly_amount: "350.00" },
  { id: "health", name: "Healthcare", category: "healthcare", monthly_amount: "150.00" },
  { id: "subscriptions", name: "Subscriptions", category: "subscriptions", monthly_amount: "100.00" },
  { id: "personal", name: "Personal and other", category: "personal", monthly_amount: "300.00" },
];

export function seedFinancialProfile() {
  return {
    incomes: SEED_INCOMES.map((row) => ({ ...row })),
    expenses: SEED_EXPENSES.map((row) => ({ ...row })),
    debts: SEED_DEBTS.map((row) => ({ ...row })),
    extra: "650.00",
  };
}
