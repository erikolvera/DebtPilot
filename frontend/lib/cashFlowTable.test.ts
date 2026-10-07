import { expect, test } from "vitest";
import { EXPENSE, INCOME, rowErrors } from "../components/CashFlowTable";

// Error keys become element ids (`income-0-amount-error`), so they must stay
// the draft's own field names, in name → select → amount order.
test("income errors keep the original keys and copy", () => {
  expect(rowErrors({ id: "a", name: " ", amount: "1.234", frequency: "daily" as never }, INCOME)).toEqual({
    name: "Give this income source a name",
    frequency: "Choose how often you are paid",
    amount: "Take-home amount must be a plain amount, like 1200.50",
  });
  expect(rowErrors({ id: "a", name: "Pay", amount: "100.00", frequency: "biweekly" }, INCOME)).toEqual({});
});

test("expense errors keep the original keys and copy", () => {
  expect(
    Object.keys(rowErrors({ id: "a", name: "x".repeat(121), category: "pets", monthly_amount: "100000000" }, EXPENSE)),
  ).toEqual(["name", "category", "monthly_amount"]);
  expect(rowErrors({ id: "a", name: "Rent", category: "housing", monthly_amount: "100000000" }, EXPENSE)).toEqual({
    monthly_amount: "Monthly amount is too large",
  });
  expect(EXPENSE.select.options[0]).toEqual(["housing", "Housing"]);
});
