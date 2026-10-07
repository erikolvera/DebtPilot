import { expect, test } from "vitest";
import type { ExpenseDraft, IncomeDraft } from "./api";
import { EXPENSE, INCOME, rowErrors } from "../components/CashFlowTable";

const income = (row: Partial<IncomeDraft>) =>
  rowErrors({ id: "a", name: "Pay", amount: "100.00", frequency: "biweekly", ...row } as IncomeDraft, INCOME);
const expense = (row: Partial<ExpenseDraft>) =>
  rowErrors({ id: "a", name: "Rent", category: "housing", monthly_amount: "100.00", ...row } as ExpenseDraft, EXPENSE);

// Error keys become element ids (`income-0-amount-error`), so they must stay
// the draft's own field names, in name → select → amount order.
test("income errors keep the original keys and copy", () => {
  expect(income({ name: " ", amount: "1.234", frequency: "daily" as IncomeDraft["frequency"] })).toEqual({
    name: "Give this income source a name",
    frequency: "Choose how often you are paid",
    amount: "Take-home amount must be a plain amount, like 1200.50",
  });
  expect(income({})).toEqual({});
});

test("expense errors keep the original keys and copy", () => {
  expect(Object.keys(expense({ name: "x".repeat(121), category: "pets" as ExpenseDraft["category"], monthly_amount: "100000000" }))).toEqual([
    "name",
    "category",
    "monthly_amount",
  ]);
  expect(expense({ monthly_amount: "100000000" })).toEqual({ monthly_amount: "Monthly amount is too large" });
  expect(EXPENSE.select.options[0]).toEqual(["housing", "Housing"]);
});
