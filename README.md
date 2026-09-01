# DebtPilot

DebtPilot turns a monthly household budget into a realistic debt-payoff plan.
It calculates:

```text
income - living expenses - debt minimums = available monthly cash flow
```

If cash flow is negative, the report shows the shortfall and withholds an
accelerated payoff plan. If it is non-negative, the app compares minimum-only,
Debt Snowball, and Debt Avalanche estimates using no more extra money than the
budget supports.

## Features

- Annual salary, monthly, biweekly, and weekly take-home or recurring income.
- Categorized monthly expenses.
- Credit cards, auto loans, personal loans, student loans, medical debt, and
  other debts.
- Monthly cash-flow status, debt total, shortfall, and unassigned surplus.
- Affordability-aware Snowball and Avalanche comparisons.
- Estimated payoff dates, interest, total paid, and payoff chart.
- Deterministic next-step recommendations.
- Automatic browser-local saving; no account or external data connection.

## Architecture

- **Frontend:** Next.js, React, TypeScript, Tailwind CSS.
- **API:** FastAPI and Pydantic.
- **Calculations:** framework-free Python packages under `backend/app/engine`
  and `backend/app/cashflow`.
- **Storage:** browser `localStorage` only.

The browser posts one financial snapshot to `POST /v1/financial-reports`. The
API calculates cash flow first, caps the requested extra payment at the
available amount, and then calls the payoff engine. `POST /v1/payoff-plans`
remains available as a lower-level debt-only calculation endpoint.

Money crosses the API as decimal strings. The backend uses `Decimal` and rounds
to cents explicitly; no generative model calculates or recommends anything.

## Run locally

Backend:

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/uvicorn app.api.main:app --reload
```

Frontend, in a second terminal:

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. API documentation is available at
`http://127.0.0.1:8000/docs`.

## Verify

```bash
cd backend && .venv/bin/pytest
cd frontend && npm test && npm run typecheck && npm run lint
NEXT_PUBLIC_API_BASE_URL=https://api.example.invalid npm run build
```

Frontend types are generated from OpenAPI while the backend is running:

```bash
cd frontend
npm run gen:api
```

## Calculation assumptions

- Interest accrues monthly before payment.
- Annual salary is divided by 12. Weekly income is annualized over 52 pay
  periods and biweekly income over 26, then divided by 12 to produce the
  monthly cash-flow average.
- Snowball targets the smallest balance; Avalanche targets the highest APR.
- Strategy payments keep the initial total minimum-payment budget and roll a
  cleared debt's payment into the next debt.
- The minimum-only baseline approximates a declining credit-card minimum.
- Calculations exclude fees, new charges, missed payments, rate changes, and
  lender-specific daily-interest behavior.
- Non-credit-card debts currently use the same balance/APR/minimum model, so
  their estimates may differ more from lender amortization schedules.
- Runs stop after 1,200 months. A plan that reaches that horizon is shown as
  not paying off within the model.

These results are planning estimates, not financial advice or lender quotes.
