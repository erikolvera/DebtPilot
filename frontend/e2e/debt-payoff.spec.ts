import { expect, test, type Locator, type Page } from "@playwright/test";

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

async function addIncome(page: Page, name: string, frequency: string, amount: string) {
  const section = page.getByRole("region", { name: "Monthly income" });
  await section.getByRole("button", { name: "Add income" }).click();
  await section.getByRole("textbox", { name: "Income source name" }).last().fill(name);
  await section.getByRole("combobox", { name: `${name} — pay frequency` }).selectOption(frequency);
  await section.getByRole("textbox", { name: `${name} — take-home amount` }).fill(amount);
}

async function addExpense(page: Page, name: string, category: string, amount: string) {
  const section = page.getByRole("region", { name: "Monthly expenses" });
  await section.getByRole("button", { name: "Add expense" }).click();
  await section.getByRole("textbox", { name: "Expense name" }).last().fill(name);
  await section.getByRole("combobox", { name: `${name} — category` }).selectOption(category);
  await section.getByRole("textbox", { name: `${name} — monthly amount` }).fill(amount);
}

type Debt = { name: string; type: string; balance: string; apr: string; minimum: string };

async function addDebt(page: Page, debt: Debt) {
  const section = page.getByRole("region", { name: "Debts" });
  await section.getByRole("button", { name: "Add debt" }).click();
  await section.getByRole("textbox", { name: "Debt name" }).last().fill(debt.name);
  await section.getByRole("combobox", { name: `${debt.name} — debt type` }).selectOption(debt.type);
  await section.getByRole("textbox", { name: `${debt.name} — balance owed` }).fill(debt.balance);
  await section.getByRole("textbox", { name: `${debt.name} — annual percentage rate` }).fill(debt.apr);
  await section.getByRole("textbox", { name: `${debt.name} — minimum payment` }).fill(debt.minimum);
}

test("successful debt-payoff plan with a monthly surplus", async ({ page }) => {
  // Step 1: cash flow. $5,000 income vs $2,000 expenses + $350 minimums.
  await page.goto("/plan/cash-flow");
  await expect(page.getByRole("heading", { name: "Start with your monthly reality." })).toBeVisible();
  await removeAllRows(page.getByRole("region", { name: "Monthly income" }));
  await removeAllRows(page.getByRole("region", { name: "Monthly expenses" }));

  await addIncome(page, "Paycheck", "monthly", "5000.00");
  await addExpense(page, "Rent", "housing", "1500.00");
  await addExpense(page, "Groceries", "food", "500.00");
  await page.getByRole("link", { name: "Continue to debts →" }).click();

  // Step 2: debts and the optional extra payment.
  await expect(page.getByRole("heading", { name: "Add the debts you want to tackle." })).toBeVisible();
  await removeAllRows(page.getByRole("region", { name: "Debts" }));
  await addDebt(page, { name: "Visa", type: "credit_card", balance: "3000.00", apr: "20.00", minimum: "100.00" });
  await addDebt(page, { name: "Car loan", type: "auto_loan", balance: "8000.00", apr: "6.00", minimum: "250.00" });
  await page.getByRole("textbox", { name: "Extra payment each month, in dollars" }).fill("500.00");
  await page.getByRole("link", { name: "See my report →" }).click();

  // Step 3: the report. Every figure below is derivable by hand from the inputs.
  await expect(page).toHaveURL(/\/report$/);
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
