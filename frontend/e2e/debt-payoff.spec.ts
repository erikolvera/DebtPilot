import { expect, test, type Locator, type Page } from "@playwright/test";

type Income = { name: string; frequency: string; amount: string };
type Expense = { name: string; category: string; amount: string };
type Debt = { name: string; type: string; balance: string; apr: string; minimum: string };
type Plan = { incomes: Income[]; expenses: Expense[]; debts: Debt[]; extra: string };

// Shared by both scenarios: $350 in debt minimums and $11,000 total debt.
const DEBTS: Debt[] = [
  { name: "Visa", type: "credit_card", balance: "3000.00", apr: "20.00", minimum: "100.00" },
  { name: "Car loan", type: "auto_loan", balance: "8000.00", apr: "6.00", minimum: "250.00" },
];

// The figure a <dt> labels inside a <dl>, e.g. value(cashFlow, "Total debt").
function value(scope: Locator, term: string): Locator {
  return scope
    .locator("dl > div")
    .filter({ has: scope.page().getByText(term, { exact: true }) })
    .locator("dd");
}

// A fresh browser starts with the seeded sample profile; clear a section so
// the test controls every input.
async function removeAllRows(section: Locator) {
  const remove = section.getByRole("button", { name: /^Remove / });
  while ((await remove.count()) > 0) await remove.first().click();
}

// Steps 1 and 2 of the planner, through the UI. Leaves the browser on the
// debts page so a scenario can check it before continuing to the report.
async function enterPlan(page: Page, plan: Plan) {
  await page.goto("/plan/cash-flow");
  await expect(page.getByRole("heading", { name: "Start with your monthly reality." })).toBeVisible();

  const income = page.getByRole("region", { name: "Monthly income" });
  await removeAllRows(income);
  for (const row of plan.incomes) {
    await income.getByRole("button", { name: "Add income" }).click();
    await income.getByRole("textbox", { name: "Income source name" }).last().fill(row.name);
    await income.getByRole("combobox", { name: `${row.name} — pay frequency` }).selectOption(row.frequency);
    await income.getByRole("textbox", { name: `${row.name} — take-home amount` }).fill(row.amount);
  }

  const expenses = page.getByRole("region", { name: "Monthly expenses" });
  await removeAllRows(expenses);
  for (const row of plan.expenses) {
    await expenses.getByRole("button", { name: "Add expense" }).click();
    await expenses.getByRole("textbox", { name: "Expense name" }).last().fill(row.name);
    await expenses.getByRole("combobox", { name: `${row.name} — category` }).selectOption(row.category);
    await expenses.getByRole("textbox", { name: `${row.name} — monthly amount` }).fill(row.amount);
  }
  await page.getByRole("link", { name: "Continue to debts →" }).click();

  await expect(page.getByRole("heading", { name: "Add the debts you want to tackle." })).toBeVisible();
  const debts = page.getByRole("region", { name: "Debts" });
  await removeAllRows(debts);
  for (const debt of plan.debts) {
    await debts.getByRole("button", { name: "Add debt" }).click();
    await debts.getByRole("textbox", { name: "Debt name" }).last().fill(debt.name);
    await debts.getByRole("combobox", { name: `${debt.name} — debt type` }).selectOption(debt.type);
    await debts.getByRole("textbox", { name: `${debt.name} — balance owed` }).fill(debt.balance);
    await debts.getByRole("textbox", { name: `${debt.name} — annual percentage rate` }).fill(debt.apr);
    await debts.getByRole("textbox", { name: `${debt.name} — minimum payment` }).fill(debt.minimum);
  }
  await page.getByRole("textbox", { name: "Extra payment each month, in dollars" }).fill(plan.extra);
}

async function openReport(page: Page) {
  await page.getByRole("link", { name: "See my report →" }).click();
  await expect(page).toHaveURL(/\/report$/);
}

test("successful debt-payoff plan with a monthly surplus", async ({ page }) => {
  // $5,000 income vs $2,000 expenses + $350 minimums.
  await enterPlan(page, {
    incomes: [{ name: "Paycheck", frequency: "monthly", amount: "5000.00" }],
    expenses: [
      { name: "Rent", category: "housing", amount: "1500.00" },
      { name: "Groceries", category: "food", amount: "500.00" },
    ],
    debts: DEBTS,
    extra: "500.00",
  });
  await openReport(page);

  // Every cash-flow figure below is derivable by hand from the inputs.
  const cashFlow = page.getByRole("region", { name: "Cash flow" });
  await expect(cashFlow.getByRole("status")).toHaveText("Monthly budget has a surplus");
  await expect(value(cashFlow, "Monthly income")).toHaveText("$5,000.00");
  await expect(value(cashFlow, "Monthly expenses")).toHaveText("$2,000.00");
  await expect(value(cashFlow, "Debt minimums")).toHaveText("$350.00");
  await expect(value(cashFlow, "Available each month")).toHaveText("$2,650.00"); // 5000 − 2000 − 350
  await expect(value(cashFlow, "Monthly shortfall")).toHaveText("$0.00");
  await expect(value(cashFlow, "Total debt")).toHaveText("$11,000.00");

  const budget = page.getByRole("region", { name: "Debt payment budget" });
  await expect(value(budget, "Available after minimums")).toHaveText("$2,650.00");
  await expect(value(budget, "Used in the plan")).toHaveText("$500.00");
  await expect(value(budget, "Left unassigned")).toHaveText("$2,150.00"); // 2650 − 500

  // Payoff estimates from the deterministic engine. Durations and interest do
  // not depend on the start month, so they are stable across runs.
  const strategies = page.getByRole("group", { name: "Choose a payoff strategy" });
  const card = (label: string) =>
    strategies.getByRole("article").filter({ has: page.getByRole("heading", { name: label, exact: true }) });

  await expect(value(card("Minimums only"), "Takes")).toHaveText("10 yr 4 mo");
  await expect(value(card("Minimums only"), "Interest")).toHaveText("$3,993.25");
  for (const strategy of ["Snowball", "Avalanche"]) {
    await expect(value(card(strategy), "Takes")).toHaveText("1 yr 2 mo");
    await expect(value(card(strategy), "Interest")).toHaveText("$519.12");
    await expect(card(strategy).getByRole("button", { name: `Choose ${strategy}` })).toBeEnabled();
  }
});



// SCENARIO 2: Deficit budget
test("deficit budget shows the shortfall and withholds an accelerated plan", async ({ page }) => {
  // Edge case: income covers living expenses ($3,000 > $2,800) but not the
  // $350 in debt minimums too, so the budget is $150 short each month.
  await enterPlan(page, {
    incomes: [{ name: "Paycheck", frequency: "monthly", amount: "3000.00" }],
    expenses: [
      { name: "Rent", category: "housing", amount: "2000.00" },
      { name: "Groceries", category: "food", amount: "800.00" },
    ],
    debts: DEBTS,
    extra: "500.00",
  });

  // The requested $500 extra is capped at the non-negative cash flow: $0.
  await expect(page.getByText("Budget supports up to $0.00. The payoff plan uses $0.00 instead.")).toBeVisible();
  await openReport(page);

  const cashFlow = page.getByRole("region", { name: "Cash flow" });
  await expect(cashFlow.getByRole("status")).toHaveText("Monthly budget has a shortfall");
  await expect(value(cashFlow, "Monthly income")).toHaveText("$3,000.00");
  await expect(value(cashFlow, "Monthly expenses")).toHaveText("$2,800.00");
  await expect(value(cashFlow, "Debt minimums")).toHaveText("$350.00");
  await expect(value(cashFlow, "Available each month")).toHaveText("-$150.00"); // 3000 − 2800 − 350
  await expect(value(cashFlow, "Monthly shortfall")).toHaveText("$150.00");
  await expect(value(cashFlow, "Total debt")).toHaveText("$11,000.00");

  await expect(page.getByRole("region", { name: "Debt payment budget" })).toHaveText(
    /Income falls short by \$150\.00 each month\. An accelerated plan would not be realistic yet\./,
  );

  // A deficit never produces an accelerated payoff recommendation.
  const payoff = page.getByRole("region", { name: "Payoff strategies" });
  await expect(payoff).toContainText("Close the monthly shortfall before choosing Snowball or Avalanche.");
  await expect(page.getByRole("group", { name: "Choose a payoff strategy" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Choose (Snowball|Avalanche)$/ })).toHaveCount(0);

  const nextSteps = page.getByRole("region", { name: "Recommended next steps" });
  await expect(nextSteps.getByRole("heading", { name: "Close the monthly shortfall first" })).toBeVisible();
});
