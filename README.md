# DebtPilot

[![Backend CI](https://github.com/erikolvera/DebtPilot/actions/workflows/backend.yml/badge.svg)](https://github.com/erikolvera/DebtPilot/actions/workflows/backend.yml)
[![Frontend CI](https://github.com/erikolvera/DebtPilot/actions/workflows/frontend.yml/badge.svg)](https://github.com/erikolvera/DebtPilot/actions/workflows/frontend.yml)

DebtPilot turns a monthly household budget into a realistic debt-payoff plan.
It calculates:

```text
income - living expenses - debt minimums = available monthly cash flow
```

If cash flow is negative, the report shows the shortfall and withholds an
accelerated payoff plan. If it is non-negative, the app compares minimum-only,
Debt Snowball, and Debt Avalanche estimates using no more extra money than the
budget supports.

The project is deliberately anonymous and stateless: profiles are saved only
in the browser, the API does not persist request data, and payoff guidance is
calculated without a generative model.

## Features

- Annual salary, monthly, biweekly, and weekly take-home or recurring income.
- Categorized monthly expenses.
- Credit cards, auto loans, personal loans, student loans, medical debt, and
  other debts.
- Monthly cash-flow status, debt total, shortfall, and unassigned surplus.
- Affordability-aware Snowball and Avalanche comparisons.
- Deterministic payoff options that compare the current extra payment, half of
  the remaining surplus, and the maximum budget-supported amount.
- A browser-local Snowball or Avalanche preference.
- Estimated payoff dates, interest, total paid, and payoff chart.
- Deterministic next-step recommendations.
- Automatic browser-local saving; no account or external data connection.

## Architecture

- **Frontend:** Next.js, React, TypeScript, Tailwind CSS.
- **API:** FastAPI and Pydantic.
- **Calculations:** framework-free Python packages under `backend/app/engine`
  and `backend/app/cashflow`.
- **Storage:** browser `localStorage` only.

```text
Next.js planner
    ├── saves the editable profile in localStorage
    └── POST /v1/financial-reports
            ├── normalize monthly cash flow
            ├── cap the extra payment at the affordable amount
            ├── run the shared Decimal payoff engine
            └── compare deterministic payoff options
```

The browser posts one financial snapshot to `POST /v1/financial-reports`. The
API calculates cash flow first, caps the requested extra payment at the
available amount, and then calls the payoff engine. It also compares two
faster, affordable payment options when unassigned cash remains.
`POST /v1/payoff-plans` remains available as a lower-level debt-only
calculation endpoint.

Money crosses the API as decimal strings. The backend uses `Decimal` and rounds
to cents explicitly. Payoff guidance is deterministic, and no financial data
is sent to a generative model.

## Engineering quality

The current codebase was verified with:

- 249 backend tests and 99.08% coverage with branch coverage enabled.
- 73 frontend unit tests for API/report orchestration, storage migrations,
  validation, formatting, chart geometry, and payoff-guidance selection.
- CI gates for backend coverage plus frontend type checking, linting, tests,
  and the production Next.js build.

The financial engine is tested with hand-calculated golden cases,
property-based invariants, and an independent closed-form amortization oracle.
API contract tests ensure that validated decimal-string values survive the
mapping boundary unchanged.

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
(cd backend && .venv/bin/pytest)
(cd frontend && npm test && npm run typecheck && npm run lint)
(cd frontend && NEXT_PUBLIC_API_BASE_URL=https://api.example.invalid npm run build)
```

Frontend types are generated from OpenAPI while the backend is running:

```bash
cd frontend
npm run gen:api
```

## Deploy on Vercel

Deploy this monorepo as two Vercel projects connected to the same repository.
Keeping separate project roots lets Vercel detect and build FastAPI and Next.js
independently. This setup follows Vercel's current [monorepo](https://vercel.com/docs/monorepos)
and [FastAPI](https://vercel.com/docs/frameworks/backend/fastapi) deployment
conventions.

### 1. Create the backend project

1. Import the repository into Vercel as a new project, for example
   `debtpilot-api`.
2. Set **Root Directory** to `backend` and leave framework detection enabled.
   Vercel reads `pyproject.toml` and loads `app.api.main:app` as the FastAPI
   entrypoint.
3. Deploy, then confirm that `https://<backend-domain>/health` returns
   `{"status":"ok"}`. Interactive API documentation is available at
   `https://<backend-domain>/docs`.

No database, account, or API key is required.

### 2. Create the frontend project

1. Import the same repository again as a second project, for example
   `debtpilot`.
2. Set **Root Directory** to `frontend`; Vercel will select the Next.js preset.
3. Add this Production environment variable, without a trailing slash:

   ```text
   NEXT_PUBLIC_API_BASE_URL=https://<backend-domain>
   ```

4. Deploy the frontend and note its stable production domain.

`NEXT_PUBLIC_API_BASE_URL` is embedded into the browser bundle at build time,
so changing it requires a new frontend deployment.

### 3. Allow the frontend origin

In the backend Vercel project, add this Production environment variable,
again without a trailing slash:

```text
ALLOWED_ORIGINS=https://<frontend-domain>
```

Redeploy the backend after changing `ALLOWED_ORIGINS`, then build a plan from
the deployed frontend and confirm the report loads. To allow more than one
stable origin, use a comma-separated list. Preview domains are not allowed
implicitly; add an exact preview origin to the backend Preview environment when
testing a preview deployment.

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
