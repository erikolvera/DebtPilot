# DebtPilot engineering guide

DebtPilot is an anonymous monthly cash-flow and debt-payoff planner. The user
enters income, expenses, debt minimums, and an optional extra payment. The app
shows whether the budget has a surplus or shortfall and only simulates a debt
payment the available cash can support.

## Commands

Backend:

```bash
cd backend
.venv/bin/pytest
.venv/bin/uvicorn app.api.main:app --reload
```

Frontend:

```bash
cd frontend
npm test
npm run typecheck
npm run lint
npm run build
npm run dev
```

## Non-negotiable financial rules

- All money uses Python `Decimal`, quantized to cents with `ROUND_HALF_UP`.
- JSON money is a string, never a bare JSON number.
- The LLM is not part of the calculation path. Recommendations are deterministic.
- Cash flow is income minus non-debt expenses minus debt minimum payments.
- A requested extra payment is capped at non-negative available cash flow.
- A deficit never produces an accelerated payoff recommendation.
- Snowball, Avalanche, and minimum-only use the same parameterized simulator.
- Interest accrues monthly before payment. User-facing figures are estimates.
- `MAX_MONTHS` and the sound never-payoff early exit must remain bounded.
- Keep deterministic ordering tie-breaks and final-payment surplus cascading.

## Architecture

- `backend/app/cashflow/`: pure monthly cash-flow calculation.
- `backend/app/engine/`: pure payoff engine with no FastAPI or Pydantic imports.
- `backend/app/api/`: schemas, mapping, and two stateless POST endpoints.
- `frontend/`: one Next.js client page, generated API types, browser-local storage.

Do not add accounts, database persistence, generative AI, or additional service
layers unless the product requirements explicitly change. Prefer a small
vertical feature over a large design document.
