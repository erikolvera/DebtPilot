# Browser UI tests (Playwright)

End-to-end tests that drive the running DebtPilot UI in Chromium against a
real local API. They cover the core guest workflow: **enter cash flow → enter
debts → read the report**.

## Run

One-time setup (from the repo root):

```bash
cd backend && python -m venv .venv && .venv/bin/pip install -e ".[dev]" && cd ..
cd frontend && npm ci && npx playwright install chromium
```

Then, from `frontend/`:

```bash
npm run test:ui                       # headless
npm run test:ui:headed                # visible browser
SLOWMO=400 npm run test:ui:headed     # visible, slowed down for a demo
npx playwright test --ui              # interactive runner with time-travel
npx playwright show-trace test-results/<test>/trace.zip   # inspect a failure
```

Playwright starts both servers itself (`playwright.config.ts`):

| Server | Port | Notes |
|---|---|---|
| FastAPI (`backend/.venv`) | 8100 | `ALLOWED_ORIGINS` set to the test web origin |
| Next.js dev | 3100 | `NEXT_PUBLIC_API_BASE_URL` → 8100, accounts disabled |

The ports differ from `npm run dev` (3000/8000), so the tests never reach a
deployed API or depend on your own dev server.

## Scenarios

| # | Scenario | What it proves |
|---|---|---|
| 1 | Successful debt-payoff plan with a monthly surplus | Income, expenses, debts and extra payment entered in the UI produce the right cash flow, payment budget and payoff estimates on the report |

Test data for scenario 1 (income higher than all monthly outflows):

- Income: Paycheck, monthly, $5,000.00
- Expenses: Rent $1,500.00 and Groceries $500.00, for $2,000.00 in total
- Debts: Visa $3,000.00 at 20% with a $100.00 minimum, and Car loan $8,000.00 at 6% with a $250.00 minimum, for $350.00 in minimums
- Extra payment: $500.00

The expected cash-flow figures can be checked by hand: $5,000 − $2,000 − $350
= $2,650 available, and $2,650 − $500 = $2,150 left unassigned. The payoff
durations and interest come from the deterministic engine and don't depend on
the current month, so the assertions are stable.

## Setup, data and cleanup

- **Isolation:** each test gets a fresh browser context, so localStorage
  starts empty. The app loads its sample profile, and the test removes those
  rows before entering its own data. Tests share no state and can run in
  parallel.
- **External services:** none. Guest mode is browser-local, the calculation API
  is stateless and runs locally, and Supabase accounts are turned off for the
  run.
- **Cleanup:** nothing persists outside the browser context. Playwright stops
  both servers when the run ends. Failure artifacts go to `test-results/`,
  which git ignores.

## Locator strategy

Locators use accessible roles and labels that already exist in the
components, such as `region "Monthly income"` and
`textbox "Visa — minimum payment"`. No test IDs were added. A locator that
breaks usually means the UI also got harder to use with a screen reader.

## Limitations

- Chromium only. Firefox and WebKit can be added as extra `projects`.
- Runs against `next dev`, not a production build.
- Account sync (Supabase) is not covered here. `npm run test:integration` and
  `npm run test:e2e` cover it at the HTTP level.
- The payoff month (for example "Dec 2027") depends on the current date, so it
  isn't asserted. Durations and interest are asserted instead.

## What existed vs. what was added

**Existed before this exercise:** Vitest unit tests for `lib/` (`npm test`),
backend pytest with a coverage gate, and HTTP-level account tests against a
local Supabase (`npm run test:integration`, `npm run test:e2e`). There were no
browser-driven UI tests.

**Added:** `@playwright/test`, `playwright.config.ts` (managed servers on
isolated ports), `e2e/debt-payoff.spec.ts`, the `test:ui` and
`test:ui:headed` scripts, and this README.
