# DebtPilot engineering guide

DebtPilot is a monthly cash-flow and debt-payoff planner with anonymous guest
planning and optional accounts. The user
enters income, expenses, debt minimums, and an optional extra payment. The app
shows whether the budget has a surplus or shortfall, compares affordable ways
to increase the extra payment, and lets the user choose Snowball or Avalanche.

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
- The LLM is not part of the calculation or recommendation path. Payoff
  guidance is deterministic and explainable from the returned figures.
- Cash flow is income minus non-debt expenses minus debt minimum payments.
- Divide annual salary by 12. Normalize weekly income with 52 pay periods and
  biweekly income with 26, dividing annual totals by 12 before cash-flow math.
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
- `frontend/`: Next.js planning and report pages, generated API types, and
  browser-local storage.

Accounts and database persistence are now explicitly approved for optional
cloud saving through Supabase. Do not add generative AI or additional service
layers unless the product requirements explicitly change. Prefer a small
vertical feature over a large design document.

Guest planning remains anonymous and browser-local. Accounts are opt-in and
must preserve export, deletion, and each user's data isolation.

## Feature delivery workflow

Use this workflow for every feature implementation or removal:

1. Fetch the latest `origin/main` and create a focused `codex/` branch from it.
   Preserve unrelated local work; use an isolated worktree when needed.
2. Implement the change and run the relevant tests, type checks, lint, and build.
   Add meaningful coverage for changed behavior and review migrations, data
   compatibility, and failure handling where applicable.
3. Review the diff, then commit the scoped change locally with a clear message.
   Include only intended files; exclude secrets and generated artifacts.
4. Push the branch to GitHub without rewriting shared history.
5. Open a PR targeting `main` with a summary, test evidence, and any migration,
   rollout, or rollback steps. Attach the PR to the current Codex task.
6. Review the PR diff, address feedback and failures, and rerun affected checks.
   Merge once required CI checks pass, review findings are resolved, and branch
   protection permits it. Never bypass required reviews or failing checks.

A request to implement or remove a feature includes these six delivery steps
unless the user explicitly limits the scope, such as local-only work or a draft
PR.
If access, required review, CI, or another external gate blocks completion,
report the exact blocker and link the PR. Report the final PR and merge status;
merging code does not authorize production deployment or enabling feature flags.
