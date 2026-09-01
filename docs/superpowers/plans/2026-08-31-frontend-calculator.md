# Frontend Payoff Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-page, anonymous debt payoff calculator that renders the engine's three scenarios live as the user edits their cards and drags an extra-payment slider.

**Architecture:** One client-rendered Next.js App Router route at `/`. The browser calls the FastAPI origin directly — no route-handler proxy, because `/explain` rate-limits per client IP and proxying would collapse every visitor into Vercel's egress addresses. All state lives in `app/page.tsx` as strings; a debounced, abortable effect posts to `/v1/payoff-plans` and the last good plan stays rendered while the next is in flight. The frontend formats numbers and never computes them.

**Tech Stack:** Next.js 16.3.4 (App Router, Turbopack), React 19.2.8, TypeScript 5.9 (strict), Tailwind CSS 4.3.3, Vitest 4.1.11, openapi-typescript 7.13.0. No component library, no charting library.

**Spec:** [`docs/superpowers/specs/2026-08-31-frontend-design.md`](../specs/2026-08-31-frontend-design.md)

## Global Constraints

Every task's requirements implicitly include this section.

- **Working directory is `frontend/`** for all npm commands. The repo root is `/Users/erikolvera/Desktop/debtpilot`.
- **Package manager: npm.** Node 20 or newer.
- **Exact versions:** `next@16.3.4`, `react@19.2.8`, `react-dom@19.2.8`, `tailwindcss@4.3.3`, `@tailwindcss/postcss@4.3.3`, `vitest@4.1.11`, `openapi-typescript@7.13.0`, `typescript@^5.9.3`.
- **TypeScript is pinned to `^5.9.3`, not `latest`.** npm's `latest` tag is now `7.0.2`, the native-port rewrite. Next 16's type integration is not validated against it here, and adopting a brand-new major compiler on day one of a greenfield app buys nothing. Upgrade path: once Next's docs name TS 7 as supported, bump and run `npx tsc --noEmit`.
- **TypeScript strict mode on, no implicit `any`** (`CLAUDE.md` convention). `tsconfig.json` must keep `"lib"` including `"esnext"` — `Intl.NumberFormat.format(string)` is typed only there.
- **Money is a `string` at every stage** — input element, React state, request body, response, formatter. There is no `Number()`, `parseFloat`, or `toFixed` anywhere on the money path. `Intl.NumberFormat.prototype.format` accepts a decimal string (ES2023) and formats it exactly; that is the only formatter used.
- **The frontend performs no financial arithmetic.** Every number rendered is a response field. A `null` delta renders an em dash (`—`); it is never reconstructed by subtracting the two operands sitting beside it in the same object. Permitted numeric work, exhaustively: converting the range input's numeric value to a fixed-2 string, and SVG geometry.
- **Suppression rule (spec §3.4):** for a scenario with `outcome !== "paid_off"`, `total_interest_paid` and `total_paid` are populated but are NOT answers — they cover the simulated window, not a lifetime. They must never reach the screen. The guard lives in `scenarioFigures()` in `lib/format.ts`, once, not at each call site.
- **Palette tokens** (exact hex, light / dark): `--paper` `#E8EBF0` / `#14161C`; `--ink` `#1B2028` / `#E6E9EF`; `--ink-soft` `#59616F` / `#98A1B2`; `--rule` `#C8CEDA` / `#2C313C`; `--baseline` `#7C8497` / `#98A1B2`; `--snowball` `#D98324` / `#E89A44`; `--avalanche` `#0E7C6B` / `#22A491`.
- **The three scenario colours are fill colours, never small text.** `#D98324` on `#E8EBF0` is ~2.6:1, below the 4.5:1 body-text floor. Scenario labels are `--ink` with the track or a swatch carrying the identity.
- **Fonts:** Bricolage Grotesque (display), Instrument Sans (body), IBM Plex Mono (all figures, with `font-variant-numeric: tabular-nums`). Loaded via `next/font/google`. Tabular numerals are load-bearing: every figure changes while the slider is dragged, and proportional digits make the results column shimmer on every frame.
- **No component library.** The controls needed are a text input, a native `<input type="range">`, and a button.
- **Copy rules:** sentence case, active voice, user-side vocabulary ("cards", not "debt entities"). Errors state what happened and what to do; they do not apologise. Empty states invite an action.
- **Commit after every task.** Conventional Commits (`feat:`, `test:`, `chore:`, `style:`).

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/app/layout.tsx` | Font loading, `<html>`/`<body>`, metadata |
| `frontend/app/page.tsx` | The only route. Owns all state; wires every component together |
| `frontend/app/globals.css` | Tailwind import, design tokens, base element styles |
| `frontend/components/DebtTable.tsx` | Editable card rows; add and remove |
| `frontend/components/ExtraPayment.tsx` | Native range + text amount, kept in sync |
| `frontend/components/EscapeChart.tsx` | Three wedges on a shared month axis — the signature |
| `frontend/components/ScenarioSummary.tsx` | One scenario's figures, applying the suppression rule |
| `frontend/components/Narrative.tsx` | AI prose, source label, explain-again control |
| `frontend/lib/api-types.ts` | Generated from `/openapi.json`. Never hand-edited |
| `frontend/lib/api.ts` | Re-exported response types, `buildRequest`, `fetchPlan`, `fetchExplanation` |
| `frontend/lib/format.ts` | Money and month formatting; `scenarioFigures()` suppression guard |
| `frontend/lib/chart.ts` | Pure SVG geometry: x-domain, y-scale, wedge path |
| `frontend/lib/storage.ts` | localStorage load/save, corruption-tolerant |
| `frontend/lib/usePlan.ts` | Debounce, abort, plan state |
| `frontend/lib/seed.ts` | The verified demo portfolio |
| `frontend/lib/*.test.ts` | Vitest unit tests, node environment, relative imports only |

---

## Task 1: Scaffold the app and its toolchain

**Files:**
- Create: `frontend/` (via `create-next-app`)
- Create: `frontend/vitest.config.ts`
- Create: `frontend/.env.example`, `frontend/.env.local`
- Modify: `frontend/package.json`, `frontend/tsconfig.json`
- Modify: `.gitignore` (repo root)

**Interfaces:**
- Consumes: nothing.
- Produces: a `frontend/` workspace where `npm run dev`, `npm run build`, `npm test`, and `npx tsc --noEmit` all succeed. Later tasks assume `npm test` runs Vitest against `lib/**/*.test.ts` in a node environment.

- [ ] **Step 1: Scaffold**

From the repo root:

```bash
npx --yes create-next-app@16.3.4 frontend \
  --typescript --tailwind --app --eslint \
  --no-src-dir --import-alias "@/*" --turbopack --use-npm --yes
```

If the CLI prompts despite `--yes`, accept: TypeScript yes, ESLint yes, Tailwind yes, `src/` no, App Router yes, Turbopack yes, custom import alias `@/*`.

- [ ] **Step 2: Pin TypeScript and add Vitest**

```bash
cd frontend
npm install --save-exact --save-dev typescript@5.9.3 vitest@4.1.11 openapi-typescript@7.13.0
```

`vite` arrives as a transitive dependency of `vitest`; do not install it explicitly.

- [ ] **Step 3: Add the Vitest config**

Create `frontend/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node, not jsdom: every test in this project targets a pure function in
    // lib/. Components are verified in the browser, not with a DOM shim.
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Add scripts**

In `frontend/package.json`, set the `scripts` block to exactly:

```json
{
  "dev": "next dev --turbopack",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "gen:api": "openapi-typescript http://127.0.0.1:8000/openapi.json -o lib/api-types.ts"
}
```

- [ ] **Step 5: Confirm the tsconfig invariants**

Open `frontend/tsconfig.json` and confirm `compilerOptions.strict` is `true` and `compilerOptions.lib` contains `"esnext"`. If `lib` is absent, add `"lib": ["dom", "dom.iterable", "esnext"]`.

`esnext` is required: `Intl.NumberFormat.prototype.format` is typed to accept a string only in that lib, and every money value in this app is a string.

- [ ] **Step 6: Environment files**

Create `frontend/.env.example`:

```
# Origin of the DebtPilot API. No trailing slash.
# The backend permits http://localhost:3000 by default via ALLOWED_ORIGINS,
# so local development needs no backend configuration change. A deployed
# preview needs its own origin added to ALLOWED_ORIGINS on the API.
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

Then `cp .env.example .env.local`.

- [ ] **Step 7: Ignore local artefacts**

Append to the repo-root `.gitignore`:

```
# Next.js frontend
frontend/.next/
frontend/node_modules/
frontend/.env.local
frontend/next-env.d.ts
```

- [ ] **Step 8: Add a placeholder test so the runner has something to prove**

Create `frontend/lib/smoke.test.ts`:

```ts
import { expect, test } from "vitest";

test("the test runner is wired up", () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 9: Verify the whole toolchain**

```bash
cd frontend
npm run typecheck    # expected: no output, exit 0
npm test             # expected: 1 passed
npm run build        # expected: build succeeds
```

If `npm run build` fails on the default scaffolded page, that is a scaffold problem, not a plan problem — fix it before continuing. Do not proceed with a red build.

- [ ] **Step 10: Delete the placeholder and commit**

```bash
rm frontend/lib/smoke.test.ts
cd /Users/erikolvera/Desktop/debtpilot
git add frontend .gitignore
git commit -m "chore: scaffold the Next.js frontend workspace

Next 16 App Router with Tailwind 4 and Vitest. TypeScript pinned to 5.9
rather than npm's latest 7.0.2: Next 16's type integration is not validated
against the native-port rewrite, and a greenfield app gains nothing from
being first."
```

---

## Task 2: Generated API types and the request builder

This is the task that enforces the money-as-string discipline, so it is written test-first.

**Files:**
- Create: `frontend/lib/api-types.ts` (generated)
- Create: `frontend/lib/api.ts`
- Test: `frontend/lib/api.test.ts`

**Interfaces:**
- Consumes: Task 1's workspace.
- Produces:
  - `type DebtDraft = { id: string; name: string; balance: string; apr: string; minimum_payment: string }`
  - `type PayoffPlanResponse`, `type ScenarioOut`, `type ComparisonOut`, `type MonthlyTotalOut`, `type ExplainResponse`
  - `currentStartMonth(now?: Date): string`
  - `buildRequest(debts: DebtDraft[], extra: string, now?: Date): PayoffPlanRequest`
  - `fetchPlan(body: PayoffPlanRequest, signal: AbortSignal): Promise<PayoffPlanResponse>`
  - `fetchExplanation(body: PayoffPlanRequest, signal: AbortSignal): Promise<ExplainResponse>`
  - `class ApiError extends Error { status: number }`

- [ ] **Step 1: Generate the types from the running backend**

In one terminal:

```bash
cd /Users/erikolvera/Desktop/debtpilot/backend
.venv/bin/uvicorn app.api.main:app --reload
```

In another:

```bash
cd /Users/erikolvera/Desktop/debtpilot/frontend
npm run gen:api
```

Confirm the output is committed-quality: `lib/api-types.ts` should contain `"/v1/payoff-plans"` and `"/v1/payoff-plans/explain"` path keys, and money fields typed as plain `string` (the backend's `json_schema_input_type=str` is what makes the request side a `string` rather than a `number | string` union — if you see a union, the backend is not the version this plan targets).

Add a header comment at the top of the generated file:

```ts
// Generated by `npm run gen:api` from the backend's /openapi.json.
// Do not edit by hand. Regenerate after any change to backend/app/api/schemas.py.
```

- [ ] **Step 2: Write the failing test**

Create `frontend/lib/api.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { buildRequest, currentStartMonth, type DebtDraft } from "./api";

const DRAFTS: DebtDraft[] = [
  { id: "visa", name: "Visa Signature", balance: "6120.00", apr: "24.99", minimum_payment: "122.40" },
  { id: "store", name: "  Store card  ", balance: "1840.00", apr: "27.99", minimum_payment: "46.00" },
];

describe("currentStartMonth", () => {
  test("formats as YYYY-MM with a zero-padded month", () => {
    expect(currentStartMonth(new Date(2026, 8, 15))).toBe("2026-09");
    expect(currentStartMonth(new Date(2027, 0, 1))).toBe("2027-01");
    expect(currentStartMonth(new Date(2027, 11, 31))).toBe("2027-12");
  });

  test("matches the pattern the API requires", () => {
    expect(currentStartMonth(new Date(2026, 8, 15))).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  });
});

describe("buildRequest", () => {
  test("every money field leaves as a string, never a number", () => {
    const body = buildRequest(DRAFTS, "200.00", new Date(2026, 8, 1));
    expect(typeof body.extra_monthly_payment).toBe("string");
    for (const debt of body.debts) {
      expect(typeof debt.balance).toBe("string");
      expect(typeof debt.apr).toBe("string");
      expect(typeof debt.minimum_payment).toBe("string");
    }
  });

  test("survives a JSON round trip without any value becoming a number", () => {
    // The API returns 422 for a bare JSON number. This asserts the property
    // on the actual serialized bytes rather than on the object.
    const wire = JSON.parse(JSON.stringify(buildRequest(DRAFTS, "200.00", new Date(2026, 8, 1))));
    expect(wire.debts[0].balance).toBe("6120.00");
    expect(wire.extra_monthly_payment).toBe("200.00");
  });

  test("preserves trailing-zero precision exactly", () => {
    const drafts: DebtDraft[] = [
      { id: "a", name: "A", balance: "1000.10", apr: "0.00", minimum_payment: "25.00" },
    ];
    const body = buildRequest(drafts, "0.00", new Date(2026, 8, 1));
    // A parseFloat/toFixed round trip would render these "1000.1" and "0".
    expect(body.debts[0].balance).toBe("1000.10");
    expect(body.debts[0].apr).toBe("0.00");
    expect(body.extra_monthly_payment).toBe("0.00");
  });

  test("trims debt names, matching the server's NonBlankName validator", () => {
    const body = buildRequest(DRAFTS, "200.00", new Date(2026, 8, 1));
    expect(body.debts[1].name).toBe("Store card");
  });

  test("emits no keys beyond the contract, which forbids extras", () => {
    const body = buildRequest(DRAFTS, "200.00", new Date(2026, 8, 1));
    expect(Object.keys(body).sort()).toEqual(["debts", "extra_monthly_payment", "start_month"]);
    expect(Object.keys(body.debts[0]).sort()).toEqual(["apr", "balance", "id", "minimum_payment", "name"]);
  });
});
```

- [ ] **Step 3: Run the test and verify it fails**

```bash
cd frontend && npx vitest run lib/api.test.ts
```

Expected: FAIL — `Failed to resolve import "./api"`.

- [ ] **Step 4: Write `lib/api.ts`**

```ts
import type { paths } from "./api-types";

type PlanPost = paths["/v1/payoff-plans"]["post"];
type ExplainPost = paths["/v1/payoff-plans/explain"]["post"];

// NonNullable: openapi-typescript emits `requestBody?:` for some shapes, and
// indexing an optional type is an error under strict. It is the identity when
// the property is already required.
export type PayoffPlanRequest =
  NonNullable<PlanPost["requestBody"]>["content"]["application/json"];
export type PayoffPlanResponse = PlanPost["responses"][200]["content"]["application/json"];
export type ExplainResponse = ExplainPost["responses"][200]["content"]["application/json"];

export type ScenarioOut = PayoffPlanResponse["scenarios"]["snowball"];
export type ComparisonOut = PayoffPlanResponse["comparison"];
export type MonthlyTotalOut = ScenarioOut["monthly_totals"][number];
export type StrategyKey = keyof PayoffPlanResponse["scenarios"];

/** A row as the user is editing it. Every field is a string; see spec §3.3. */
export type DebtDraft = {
  id: string;
  name: string;
  balance: string;
  apr: string;
  minimum_payment: string;
};

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * The current month as YYYY-MM.
 *
 * The API reads no clock — start_month is required precisely so a response is
 * a pure function of its request — which makes the browser the only clock in
 * the system. `now` is injectable so tests are not time-dependent.
 */
export function currentStartMonth(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
}

export function buildRequest(
  debts: DebtDraft[],
  extra: string,
  now: Date = new Date(),
): PayoffPlanRequest {
  return {
    debts: debts.map((debt) => ({
      id: debt.id,
      name: debt.name.trim(),
      balance: debt.balance,
      apr: debt.apr,
      minimum_payment: debt.minimum_payment,
    })),
    extra_monthly_payment: extra,
    start_month: currentStartMonth(now),
  };
}

async function post<T>(path: string, body: PayoffPlanRequest, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    throw new ApiError(response.status, `${path} responded ${response.status}`);
  }
  return (await response.json()) as T;
}

/** No `?detail=full`: the summaries and monthly_totals carry everything rendered. */
export function fetchPlan(body: PayoffPlanRequest, signal: AbortSignal) {
  return post<PayoffPlanResponse>("/v1/payoff-plans", body, signal);
}

export function fetchExplanation(body: PayoffPlanRequest, signal: AbortSignal) {
  return post<ExplainResponse>("/v1/payoff-plans/explain", body, signal);
}

export function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
```

- [ ] **Step 5: Run the test and verify it passes**

```bash
cd frontend && npx vitest run lib/api.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 6: Typecheck and commit**

```bash
cd frontend && npm run typecheck
cd /Users/erikolvera/Desktop/debtpilot
git add frontend/lib/api.ts frontend/lib/api.test.ts frontend/lib/api-types.ts
git commit -m "feat(frontend): generated API types and the request builder

Types come from the backend's own OpenAPI schema, which is why
json_schema_input_type=str exists on the Money annotation: it makes the
request side type as string rather than number|string, so the compiler
enforces the discipline instead of a convention doing it.

Tests assert the money-as-string property on serialized bytes, not just on
the object, and pin trailing-zero precision that a parseFloat round trip
would silently destroy."
```

---

## Task 3: Money and month formatting, with the suppression rule

**Files:**
- Create: `frontend/lib/format.ts`
- Test: `frontend/lib/format.test.ts`

**Interfaces:**
- Consumes: `ScenarioOut` from `lib/api.ts`.
- Produces:
  - `money(value: string): string` — `"6120.00"` → `"$6,120.00"`
  - `moneyWhole(value: string): string` — `"6120.00"` → `"$6,120"`
  - `calendarMonth(value: string): string` — `"2029-09"` → `"Sep 2029"`
  - `monthCount(n: number): string` — `37` → `"3 yr 1 mo"`
  - `type ScenarioFigures` and `scenarioFigures(s: ScenarioOut): ScenarioFigures`
  - `delta(value: string | null): string` — `null` → `"—"`

- [ ] **Step 1: Write the failing test**

Create `frontend/lib/format.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import type { ScenarioOut } from "./api";
import { calendarMonth, delta, money, moneyWhole, monthCount, scenarioFigures } from "./format";

/** A minimal ScenarioOut. Fields not under test carry harmless values. */
function scenario(overrides: Partial<ScenarioOut>): ScenarioOut {
  return {
    strategy: "avalanche",
    outcome: "paid_off",
    months_to_payoff: 35,
    payoff_month: "2029-07",
    underwater_debt_ids: [],
    total_interest_paid: "3859.60",
    total_paid: "15069.60",
    debt_payoffs: [],
    monthly_totals: [],
    schedule: null,
    schedule_truncated: false,
    ...overrides,
  } as ScenarioOut;
}

describe("money", () => {
  test("formats a decimal string without constructing a float", () => {
    expect(money("6120.00")).toBe("$6,120.00");
    expect(money("91219.95")).toBe("$91,219.95");
    expect(money("0.00")).toBe("$0.00");
  });

  test("formats the contract's maximum exactly", () => {
    // MONEY_MAX on the server. Worth pinning: this is where a float would
    // first visibly lose a cent.
    expect(money("99999999.99")).toBe("$99,999,999.99");
  });

  test("moneyWhole drops the cents", () => {
    expect(moneyWhole("3859.60")).toBe("$3,860");
    expect(moneyWhole("4394.32")).toBe("$4,394");
  });
});

describe("calendarMonth", () => {
  test("renders YYYY-MM as an abbreviated month and year", () => {
    expect(calendarMonth("2029-07")).toBe("Jul 2029");
    expect(calendarMonth("2026-01")).toBe("Jan 2026");
    expect(calendarMonth("2026-12")).toBe("Dec 2026");
  });
});

describe("monthCount", () => {
  test("renders months as years and months", () => {
    expect(monthCount(35)).toBe("2 yr 11 mo");
    expect(monthCount(37)).toBe("3 yr 1 mo");
    expect(monthCount(24)).toBe("2 yr");
    expect(monthCount(7)).toBe("7 mo");
    expect(monthCount(1)).toBe("1 mo");
  });
});

describe("delta", () => {
  test("renders a null delta as an em dash rather than computing one", () => {
    expect(delta(null)).toBe("—");
  });

  test("formats a present delta as money", () => {
    expect(delta("534.72")).toBe("$534.72");
  });
});

describe("scenarioFigures", () => {
  test("passes through every figure for a scenario that pays off", () => {
    const figures = scenarioFigures(scenario({}));
    expect(figures.outcome).toBe("paid_off");
    expect(figures.payoffMonth).toBe("Jul 2029");
    expect(figures.months).toBe(35);
    expect(figures.totalInterest).toBe("$3,859.60");
    expect(figures.totalInterestWhole).toBe("$3,860");
    expect(figures.totalPaid).toBe("$15,069.60");
  });

  test("suppresses the totals for a scenario that never pays off", () => {
    // Spec §3.4. The API populates these fields, but they cover the simulated
    // window rather than a lifetime. Rendering "$91,219.95" beside "never pays
    // off" states a bounded price for something that does not end, and
    // contradicts the narrative printed next to it, which omits it by design.
    const figures = scenarioFigures(
      scenario({
        strategy: "minimum_only",
        outcome: "never_pays_off",
        months_to_payoff: null,
        payoff_month: null,
        total_interest_paid: "91219.95",
        total_paid: "93377.74",
        underwater_debt_ids: ["visa"],
      }),
    );
    expect(figures.outcome).toBe("never_pays_off");
    expect(figures.totalInterest).toBeNull();
    expect(figures.totalInterestWhole).toBeNull();
    expect(figures.totalPaid).toBeNull();
    expect(figures.months).toBeNull();
    expect(figures.payoffMonth).toBeNull();
    expect(figures.underwaterIds).toEqual(["visa"]);
  });

  test("suppresses totals even when the API populates a payoff month", () => {
    // Defence in depth: the guard keys on `outcome`, never on whether the
    // other fields happen to be null.
    const figures = scenarioFigures(
      scenario({ outcome: "never_pays_off", payoff_month: "2099-01", months_to_payoff: 876 }),
    );
    expect(figures.totalInterest).toBeNull();
    expect(figures.payoffMonth).toBeNull();
    expect(figures.months).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd frontend && npx vitest run lib/format.test.ts
```

Expected: FAIL — `Failed to resolve import "./format"`.

- [ ] **Step 3: Write `lib/format.ts`**

```ts
import type { ScenarioOut } from "./api";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const USD_WHOLE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Format a decimal string exactly, without ever constructing a float.
 *
 * `Intl.NumberFormat.prototype.format` accepts a decimal string at runtime
 * (ES2023) and formats it exactly. TypeScript, however, types the parameter as
 * `StringNumericLiteral` — literally `` `${number}` | "Infinity" | ... `` — and a
 * plain `string` is not assignable to that template-literal type. The cast is
 * therefore unavoidable, and confining it to this one helper is the whole
 * point: every money value in the app funnels through here, so there is exactly
 * one place to audit.
 *
 * The alternative, `format(Number(value))`, type-checks without complaint and
 * constructs the IEEE-754 double the backend's `_reject_json_numbers` validator
 * exists to keep out of this system — at the last possible moment, in the one
 * place nobody thinks to look. Do not "simplify" this helper into that.
 *
 * A non-numeric string renders as "$NaN" rather than throwing. That is a
 * visible bug rather than a silently wrong figure, and every value reaching
 * here originates as the engine's quantized Decimal output.
 */
function formatDecimal(formatter: Intl.NumberFormat, value: string): string {
  return formatter.format(value as `${number}`);
}

export function money(value: string): string {
  return formatDecimal(USD, value);
}

export function moneyWhole(value: string): string {
  return formatDecimal(USD_WHOLE, value);
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2029-07" -> "Jul 2029". */
export function calendarMonth(value: string): string {
  const [year, month] = value.split("-");
  return `${MONTHS[Number(month) - 1]} ${year}`;
}

/** 37 -> "3 yr 1 mo". Duration, not money: integer arithmetic is fine here. */
export function monthCount(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${rest} mo`;
  if (rest === 0) return `${years} yr`;
  return `${years} yr ${rest} mo`;
}

/**
 * A comparison delta, or an em dash.
 *
 * Every delta on `ComparisonOut` is nullable because you cannot subtract from
 * a plan that never pays off. This function is the whole handling: it never
 * reconstructs a missing delta from the two totals sitting beside it.
 */
export function delta(value: string | null): string {
  return value === null ? "—" : money(value);
}

export type ScenarioFigures = {
  strategy: ScenarioOut["strategy"];
  outcome: ScenarioOut["outcome"];
  paidOff: boolean;
  months: number | null;
  payoffMonth: string | null;
  duration: string | null;
  totalInterest: string | null;
  /** Whole dollars, for the chart's compact marker labels. */
  totalInterestWhole: string | null;
  totalPaid: string | null;
  underwaterIds: string[];
};

/**
 * Everything a scenario is allowed to display.
 *
 * The suppression of spec §3.4 lives here and only here. `total_interest_paid`
 * and `total_paid` are populated for a never-paying-off run, but they cover the
 * simulated window — up to the MAX_MONTHS backstop — not a lifetime.
 * `guidance/presentation.py` withholds them from the AI layer for exactly this
 * reason; a table that stated them would contradict the prose beside it.
 */
export function scenarioFigures(scenario: ScenarioOut): ScenarioFigures {
  const base = {
    strategy: scenario.strategy,
    outcome: scenario.outcome,
    underwaterIds: [...scenario.underwater_debt_ids],
  };

  if (scenario.outcome !== "paid_off") {
    return {
      ...base,
      paidOff: false,
      months: null,
      payoffMonth: null,
      duration: null,
      totalInterest: null,
      totalInterestWhole: null,
      totalPaid: null,
    };
  }

  return {
    ...base,
    paidOff: true,
    months: scenario.months_to_payoff,
    payoffMonth: scenario.payoff_month === null ? null : calendarMonth(scenario.payoff_month),
    duration: scenario.months_to_payoff === null ? null : monthCount(scenario.months_to_payoff),
    totalInterest: money(scenario.total_interest_paid),
    totalInterestWhole: moneyWhole(scenario.total_interest_paid),
    totalPaid: money(scenario.total_paid),
  };
}
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
cd frontend && npx vitest run lib/format.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/erikolvera/Desktop/debtpilot
git add frontend/lib/format.ts frontend/lib/format.test.ts
git commit -m "feat(frontend): money formatting and the never-pays-off suppression

Intl.NumberFormat.format accepts a decimal string, so money reaches the
screen without a float ever existing. format(Number(value)) is the obvious
alternative and reintroduces the exact double the backend spent a validator
excluding, at the last place anyone looks.

scenarioFigures is the single home of the §3.4 rule: a never-paying-off
scenario carries populated totals that cover the simulated window rather
than a lifetime, so they are withheld here the same way presentation.py
withholds them from the model."
```

---

## Task 4: Chart geometry as pure functions

The chart is the signature element, and its rules — the x-domain, the shared y-scale, the down-sampling — are the parts that can be wrong without looking wrong. They live in a testable module before any SVG is written.

**Files:**
- Create: `frontend/lib/chart.ts`
- Test: `frontend/lib/chart.test.ts`

**Interfaces:**
- Consumes: `ScenarioOut`, `MonthlyTotalOut` from `lib/api.ts`.
- Produces:
  - `const FALLBACK_DOMAIN_MONTHS = 120`
  - `xDomainMonths(scenarios: ScenarioOut[]): number`
  - `yMaxBalance(scenarios: ScenarioOut[]): number`
  - `type Lane = { width: number; height: number }`
  - `wedgePath(totals: MonthlyTotalOut[], domainMonths: number, yMax: number, lane: Lane): string`
  - `yearTicks(startMonth: string, domainMonths: number): { month: number; label: string }[]`
  - `clipsAtEdge(scenario: ScenarioOut, domainMonths: number): boolean`

- [ ] **Step 1: Write the failing test**

Create `frontend/lib/chart.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import type { MonthlyTotalOut, ScenarioOut } from "./api";
import {
  FALLBACK_DOMAIN_MONTHS,
  clipsAtEdge,
  wedgePath,
  xDomainMonths,
  yMaxBalance,
  yearTicks,
} from "./chart";

function totals(values: [number, string][]): MonthlyTotalOut[] {
  return values.map(([month_number, remaining_balance]) => ({
    month_number,
    month: "2026-09",
    remaining_balance,
    cumulative_interest: "0.00",
  })) as MonthlyTotalOut[];
}

function scenario(overrides: Partial<ScenarioOut>): ScenarioOut {
  return {
    strategy: "avalanche",
    outcome: "paid_off",
    months_to_payoff: 35,
    payoff_month: "2029-07",
    underwater_debt_ids: [],
    total_interest_paid: "0.00",
    total_paid: "0.00",
    debt_payoffs: [],
    monthly_totals: [],
    schedule: null,
    schedule_truncated: false,
    ...overrides,
  } as ScenarioOut;
}

describe("xDomainMonths", () => {
  test("is 1.15x the furthest finite payoff, rounded up to a whole year", () => {
    // The seeded portfolio: baseline null, snowball 37, avalanche 35.
    // 37 * 1.15 = 42.55 -> ceil to 4 years -> 48 months.
    const domain = xDomainMonths([
      scenario({ months_to_payoff: null, outcome: "never_pays_off" }),
      scenario({ months_to_payoff: 37 }),
      scenario({ months_to_payoff: 35 }),
    ]);
    expect(domain).toBe(48);
  });

  test("ignores never-paying-off scenarios when choosing the anchor", () => {
    expect(xDomainMonths([scenario({ months_to_payoff: null }), scenario({ months_to_payoff: 12 })]))
      .toBe(24);
  });

  test("falls back when nothing pays off", () => {
    // No finite anchor exists. All three tracks then clip, which is the
    // correct and complete answer.
    const domain = xDomainMonths([
      scenario({ months_to_payoff: null, outcome: "never_pays_off" }),
      scenario({ months_to_payoff: null, outcome: "never_pays_off" }),
    ]);
    expect(domain).toBe(FALLBACK_DOMAIN_MONTHS);
  });

  test("ignores a zero-month payoff from an empty portfolio", () => {
    expect(xDomainMonths([scenario({ months_to_payoff: 0 })])).toBe(FALLBACK_DOMAIN_MONTHS);
  });
});

describe("yMaxBalance", () => {
  test("scales to the starting balance, not the largest balance ever reached", () => {
    // The baseline GROWS under negative amortization. Scaling to its true
    // maximum would squash the two scenarios that matter into invisibility.
    const growing = scenario({
      monthly_totals: totals([[1, "6200.00"], [2, "6300.00"], [3, "80000.00"]]),
    });
    const shrinking = scenario({
      monthly_totals: totals([[1, "6000.00"], [2, "5800.00"], [3, "5600.00"]]),
    });
    expect(yMaxBalance([growing, shrinking])).toBe(6200);
  });

  test("never returns zero, so a division by it is always safe", () => {
    expect(yMaxBalance([scenario({ monthly_totals: [] })])).toBe(1);
    expect(yMaxBalance([scenario({ monthly_totals: totals([[1, "0.00"]]) })])).toBe(1);
  });
});

describe("wedgePath", () => {
  const lane = { width: 700, height: 40 };

  test("opens at full lane height and closes as a filled area", () => {
    const path = wedgePath(totals([[1, "5000.00"], [2, "2500.00"], [3, "0.00"]]), 48, 10000, lane);
    expect(path.startsWith("M 0.0 0.0")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
  });

  test("returns an empty path for an empty series", () => {
    expect(wedgePath([], 48, 10000, lane)).toBe("");
  });

  test("clamps a balance above the y-scale to the top of the lane", () => {
    // A baseline that grows past the starting balance fills its lane and
    // never rises out of it.
    const path = wedgePath(totals([[1, "999999.00"]]), 48, 6200, lane);
    expect(path).toContain(" 0.0");
    expect(path).not.toMatch(/-\d/);
  });

  test("down-samples to at most one point per rendered pixel column", () => {
    // A minimums-only baseline can carry 1200 rows. A path with 1200 points
    // in a 700px lane is bytes nobody can see.
    const long = totals(Array.from({ length: 1200 }, (_, i) => [i + 1, "1000.00"] as [number, string]));
    const path = wedgePath(long, 1200, 5000, lane);
    const lineCommands = (path.match(/L /g) ?? []).length;
    expect(lineCommands).toBeLessThanOrEqual(lane.width + 5);
  });

  test("never emits a coordinate beyond the lane width", () => {
    const past = totals([[1, "1000.00"], [200, "1000.00"]]);
    const path = wedgePath(past, 48, 5000, lane);
    for (const [, x] of path.matchAll(/[ML] (\d+\.\d) /g)) {
      expect(Number(x)).toBeLessThanOrEqual(lane.width);
    }
  });
});

describe("yearTicks", () => {
  test("marks each January inside the domain", () => {
    expect(yearTicks("2026-09", 48)).toEqual([
      { month: 5, label: "2027" },
      { month: 17, label: "2028" },
      { month: 29, label: "2029" },
      { month: 41, label: "2030" },
    ]);
  });

  test("marks month 1 when the plan starts in January", () => {
    expect(yearTicks("2027-01", 13)[0]).toEqual({ month: 1, label: "2027" });
  });
});

describe("clipsAtEdge", () => {
  test("is true for a scenario that never pays off", () => {
    expect(clipsAtEdge(scenario({ outcome: "never_pays_off", months_to_payoff: null }), 48)).toBe(true);
  });

  test("is true for a scenario that pays off past the domain", () => {
    expect(clipsAtEdge(scenario({ months_to_payoff: 60 }), 48)).toBe(true);
  });

  test("is false for a scenario that terminates inside the domain", () => {
    expect(clipsAtEdge(scenario({ months_to_payoff: 35 }), 48)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd frontend && npx vitest run lib/chart.test.ts
```

Expected: FAIL — `Failed to resolve import "./chart"`.

- [ ] **Step 3: Write `lib/chart.ts`**

```ts
import type { MonthlyTotalOut, ScenarioOut } from "./api";

/**
 * Geometry only.
 *
 * `Number()` appears throughout this file and nowhere else outside it. Spec
 * §3.2 permits it for SVG coordinates: these values become pixel positions, not
 * figures on the screen. Nothing computed here is ever rendered as text.
 */

/** Used when no scenario pays off, so there is no finite anchor for the axis. */
export const FALLBACK_DOMAIN_MONTHS = 120;

const HEADROOM = 1.15;

/** The x-axis span: 1.15x the furthest finite payoff, rounded up to a whole year. */
export function xDomainMonths(scenarios: ScenarioOut[]): number {
  const finite = scenarios
    .map((s) => s.months_to_payoff)
    .filter((m): m is number => m !== null && m > 0);
  if (finite.length === 0) return FALLBACK_DOMAIN_MONTHS;
  return Math.ceil((Math.max(...finite) * HEADROOM) / 12) * 12;
}

/**
 * The shared y-scale: the largest starting balance across scenarios.
 *
 * Deliberately not the largest balance ever reached. Under negative
 * amortization the minimums-only baseline grows without bound, and scaling to
 * that maximum would squash snowball and avalanche into invisibility. Clamping
 * instead makes the baseline a full-height band that never tapers — a truthful
 * reading of a balance that never falls.
 */
export function yMaxBalance(scenarios: ScenarioOut[]): number {
  let max = 0;
  for (const scenario of scenarios) {
    const first = scenario.monthly_totals[0];
    if (first) max = Math.max(max, Number(first.remaining_balance));
  }
  return max > 0 ? max : 1;
}

export type Lane = { width: number; height: number };

/** An SVG path for one scenario's wedge: the balance curve, filled to the lane floor. */
export function wedgePath(
  totals: MonthlyTotalOut[],
  domainMonths: number,
  yMax: number,
  lane: Lane,
): string {
  if (totals.length === 0 || domainMonths <= 0) return "";

  const x = (month: number) => Math.min(month / domainMonths, 1) * lane.width;
  const y = (balance: number) => lane.height - Math.min(balance / yMax, 1) * lane.height;

  // At most one sample per rendered pixel column.
  const step = Math.max(1, Math.ceil(totals.length / lane.width));

  const parts: string[] = [`M ${x(0).toFixed(1)} ${y(yMax).toFixed(1)}`];
  for (let i = 0; i < totals.length; i += step) {
    const point = totals[i];
    parts.push(`L ${x(point.month_number).toFixed(1)} ${y(Number(point.remaining_balance)).toFixed(1)}`);
  }
  const last = totals[totals.length - 1];
  parts.push(`L ${x(last.month_number).toFixed(1)} ${y(Number(last.remaining_balance)).toFixed(1)}`);
  parts.push(`L ${x(last.month_number).toFixed(1)} ${lane.height.toFixed(1)}`);
  parts.push(`L ${x(0).toFixed(1)} ${lane.height.toFixed(1)}`);
  parts.push("Z");
  return parts.join(" ");
}

/** One tick per calendar January inside the domain. */
export function yearTicks(
  startMonth: string,
  domainMonths: number,
): { month: number; label: string }[] {
  const [startYear, startMonthNumber] = startMonth.split("-").map(Number);
  const ticks: { month: number; label: string }[] = [];
  for (let i = 0; i < domainMonths; i++) {
    const absolute = startMonthNumber - 1 + i;
    if (absolute % 12 === 0) {
      ticks.push({ month: i + 1, label: String(startYear + Math.floor(absolute / 12)) });
    }
  }
  return ticks;
}

/** Whether this scenario's wedge runs past the axis and must fade out at the edge. */
export function clipsAtEdge(scenario: ScenarioOut, domainMonths: number): boolean {
  if (scenario.outcome !== "paid_off") return true;
  return scenario.months_to_payoff === null || scenario.months_to_payoff > domainMonths;
}
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
cd frontend && npx vitest run lib/chart.test.ts
```

Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/erikolvera/Desktop/debtpilot
git add frontend/lib/chart.ts frontend/lib/chart.test.ts
git commit -m "feat(frontend): chart geometry as tested pure functions

The y-scale is the starting balance, not the largest balance reached. Under
negative amortization the baseline grows without bound, so scaling to its
true maximum would squash the two scenarios that matter into invisibility.
Clamping makes the baseline a full-height band that never tapers, which is
what a balance that never falls actually looks like.

Number() is confined to this file: these values become pixel coordinates,
never text on the screen."
```

---

## Task 5: The seed portfolio and corruption-tolerant storage

**Files:**
- Create: `frontend/lib/seed.ts`
- Create: `frontend/lib/storage.ts`
- Test: `frontend/lib/storage.test.ts`

**Interfaces:**
- Consumes: `DebtDraft` from `lib/api.ts`.
- Produces:
  - `const SEED_DEBTS: DebtDraft[]`, `const DEFAULT_EXTRA = "200.00"`, `seedPortfolio(): Portfolio`
  - `type Portfolio = { debts: DebtDraft[]; extra: string }`
  - `loadPortfolio(storage: StorageLike | null, fallback: Portfolio): Portfolio`
  - `savePortfolio(storage: StorageLike | null, portfolio: Portfolio): void`
  - `type StorageLike = Pick<Storage, "getItem" | "setItem">`

- [ ] **Step 1: Write `lib/seed.ts`**

No test: it is data, and its correctness was established by running it through the engine (spec §7).

```ts
import type { DebtDraft } from "./api";

/**
 * The portfolio the page loads with, marked in the UI as an example.
 *
 * These numbers are a design decision, not filler. The Visa's 2% minimum sits
 * just under its 2.0825% monthly interest, so the minimums-only baseline never
 * pays off — which is the only reason the signature element (a track that runs
 * off the axis and never ends) is visible on first paint. Verified against the
 * engine; figures are recorded in spec §7.
 *
 * Ids are literal rather than generated so those recorded figures stay
 * reproducible. Rows the user adds get crypto.randomUUID().
 */
export const SEED_DEBTS: DebtDraft[] = [
  { id: "visa", name: "Visa Signature", balance: "6120.00", apr: "24.99", minimum_payment: "122.40" },
  { id: "store", name: "Store card", balance: "1840.00", apr: "27.99", minimum_payment: "46.00" },
  { id: "credit", name: "Credit union", balance: "3250.00", apr: "14.50", minimum_payment: "65.00" },
];

export const DEFAULT_EXTRA = "200.00";

export const EXTRA_SLIDER_MAX = 1000;

export function seedPortfolio() {
  return { debts: SEED_DEBTS.map((debt) => ({ ...debt })), extra: DEFAULT_EXTRA };
}
```

- [ ] **Step 2: Write the failing test**

Create `frontend/lib/storage.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { seedPortfolio } from "./seed";
import { loadPortfolio, savePortfolio, type StorageLike } from "./storage";

function stub(initial?: string): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  if (initial !== undefined) store.set("debtpilot.portfolio.v1", initial);
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
}

const FALLBACK = seedPortfolio();

describe("loadPortfolio", () => {
  test("round-trips a saved portfolio", () => {
    const storage = stub();
    const saved = { debts: [{ id: "a", name: "A", balance: "10.00", apr: "1.00", minimum_payment: "2.00" }], extra: "50.00" };
    savePortfolio(storage, saved);
    expect(loadPortfolio(storage, FALLBACK)).toEqual(saved);
  });

  test("returns the fallback when nothing is stored", () => {
    expect(loadPortfolio(stub(), FALLBACK)).toEqual(FALLBACK);
  });

  test("returns the fallback for a corrupt blob rather than throwing", () => {
    // A half-written entry must not take the page down on load.
    expect(loadPortfolio(stub("{not json"), FALLBACK)).toEqual(FALLBACK);
  });

  test("returns the fallback when a money field is a number", () => {
    // An older build, or a hand-edited entry. A number here would reach the
    // request body and earn a 422 that looks like a server fault.
    const bad = JSON.stringify({ debts: [{ id: "a", name: "A", balance: 10, apr: "1.00", minimum_payment: "2.00" }], extra: "50.00" });
    expect(loadPortfolio(stub(bad), FALLBACK)).toEqual(FALLBACK);
  });

  test("returns the fallback for a shape that is not a portfolio", () => {
    expect(loadPortfolio(stub(JSON.stringify([1, 2, 3])), FALLBACK)).toEqual(FALLBACK);
    expect(loadPortfolio(stub(JSON.stringify({ debts: "no" })), FALLBACK)).toEqual(FALLBACK);
  });

  test("rejects a stored portfolio over the server's 20-debt cap", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({
      id: String(i), name: "A", balance: "10.00", apr: "1.00", minimum_payment: "2.00",
    }));
    expect(loadPortfolio(stub(JSON.stringify({ debts: many, extra: "0.00" })), FALLBACK)).toEqual(FALLBACK);
  });

  test("returns the fallback when storage itself throws", () => {
    // Safari in private mode throws on access rather than returning null.
    const hostile: StorageLike = {
      getItem: () => { throw new DOMException("denied"); },
      setItem: () => { throw new DOMException("denied"); },
    };
    expect(loadPortfolio(hostile, FALLBACK)).toEqual(FALLBACK);
  });

  test("returns the fallback when there is no storage at all", () => {
    expect(loadPortfolio(null, FALLBACK)).toEqual(FALLBACK);
  });
});

describe("savePortfolio", () => {
  test("swallows a quota error rather than breaking the keystroke that caused it", () => {
    const hostile: StorageLike = {
      getItem: () => null,
      setItem: () => { throw new DOMException("QuotaExceededError"); },
    };
    expect(() => savePortfolio(hostile, FALLBACK)).not.toThrow();
    expect(() => savePortfolio(null, FALLBACK)).not.toThrow();
  });
});
```

- [ ] **Step 3: Run the test and verify it fails**

```bash
cd frontend && npx vitest run lib/storage.test.ts
```

Expected: FAIL — `Failed to resolve import "./storage"`.

- [ ] **Step 4: Write `lib/storage.ts`**

```ts
import type { DebtDraft } from "./api";

export type Portfolio = { debts: DebtDraft[]; extra: string };
export type StorageLike = Pick<Storage, "getItem" | "setItem">;

const KEY = "debtpilot.portfolio.v1";

/** Mirrors the server's MAX_DEBTS_PER_USER. */
const MAX_DEBTS = 20;

const FIELDS = ["id", "name", "balance", "apr", "minimum_payment"] as const;

function isDraft(value: unknown): value is DebtDraft {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  // Every field must be a string. A number that slipped in here would reach
  // the request body and earn a 422 that reads like a server fault.
  return FIELDS.every((field) => typeof record[field] === "string");
}

function isPortfolio(value: unknown): value is Portfolio {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.extra !== "string") return false;
  if (!Array.isArray(record.debts)) return false;
  if (record.debts.length > MAX_DEBTS) return false;
  return record.debts.every(isDraft);
}

/**
 * Read the stored portfolio, or the fallback.
 *
 * Every failure path returns the fallback rather than throwing. A corrupt
 * entry, a hostile storage implementation (Safari's private mode throws on
 * access rather than returning null), and a shape from an older build all
 * arrive here, and none of them is a reason to show a blank page.
 */
export function loadPortfolio(storage: StorageLike | null, fallback: Portfolio): Portfolio {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return isPortfolio(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** Persist the portfolio. A quota or permission error is not worth an exception. */
export function savePortfolio(storage: StorageLike | null, portfolio: Portfolio): void {
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify(portfolio));
  } catch {
    // Nothing to do and nothing to tell the user: their numbers are on screen.
  }
}

/** localStorage, or null where there is no window (server render, or blocked). */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run the test and verify it passes**

```bash
cd frontend && npx vitest run lib/storage.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 6: Run the whole suite and commit**

```bash
cd frontend && npm test && npm run typecheck
cd /Users/erikolvera/Desktop/debtpilot
git add frontend/lib/seed.ts frontend/lib/storage.ts frontend/lib/storage.test.ts
git commit -m "feat(frontend): seed portfolio and corruption-tolerant storage

The seed's Visa carries a 2% minimum against 2.0825% monthly interest, so
the minimums-only baseline never pays off. That is what makes the signature
element visible on first paint rather than after the user has done work.

Every storage failure path returns the fallback instead of throwing. A
half-written entry, a shape from an older build, and Safari's private mode
throwing on access all land here, and none of them justifies a blank page."
```

---

## Task 6: Design tokens and the app shell

**Files:**
- Modify: `frontend/app/globals.css` (replace entirely)
- Modify: `frontend/app/layout.tsx` (replace entirely)
- Modify: `frontend/app/page.tsx` (replace with a static shell)
- Delete: `frontend/app/page.module.css` if the scaffold created one

**Interfaces:**
- Consumes: nothing.
- Produces: Tailwind theme colours `paper`, `ink`, `ink-soft`, `rule`, `baseline`, `snowball`, `avalanche`; font families `font-display`, `font-body`, `font-mono`; utility class `.tnum` for tabular figures. Later tasks use these class names.

- [ ] **Step 1: Replace `app/globals.css`**

```css
@import "tailwindcss";

/* Light is the base definition; dark redefines only the values. Tailwind v4's
   `@theme inline` then maps them onto colour utilities, which is what lets a
   media query change the palette without redeclaring the theme. */
:root {
  --paper: #e8ebf0;
  --ink: #1b2028;
  --ink-soft: #59616f;
  --rule: #c8ceda;
  --baseline: #7c8497;
  --snowball: #d98324;
  --avalanche: #0e7c6b;
}

@media (prefers-color-scheme: dark) {
  :root {
    --paper: #14161c;
    --ink: #e6e9ef;
    --ink-soft: #98a1b2;
    --rule: #2c313c;
    --baseline: #98a1b2;
    --snowball: #e89a44;
    --avalanche: #22a491;
  }
}

@theme inline {
  --color-paper: var(--paper);
  --color-ink: var(--ink);
  --color-ink-soft: var(--ink-soft);
  --color-rule: var(--rule);
  --color-baseline: var(--baseline);
  --color-snowball: var(--snowball);
  --color-avalanche: var(--avalanche);

  --font-display: var(--font-bricolage), ui-sans-serif, system-ui, sans-serif;
  --font-body: var(--font-instrument), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-plex-mono), ui-monospace, SFMono-Regular, monospace;
}

html {
  color-scheme: light dark;
}

body {
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-body);
  -webkit-font-smoothing: antialiased;
}

/* Every figure on this page changes while the slider is dragged. With
   proportional digits the results column shimmers on each frame; with tabular
   figures only the glyphs change and the layout holds still. */
.tnum {
  /* var(--font-plex-mono), not var(--font-mono): the latter is declared inside
     `@theme inline`, which resolves theme values into utilities rather than
     guaranteeing the custom property is emitted to :root. next/font puts
     --font-plex-mono on :root via the html className, so it is certain. */
  font-family: var(--font-plex-mono), ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
}

.eyebrow {
  font-family: var(--font-plex-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-soft);
}

:focus-visible {
  outline: 2px solid var(--avalanche);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 2: Replace `app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import { Bricolage_Grotesque, IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import "./globals.css";

// Variable font: omit `weight`, and list extra axes. `wght` is implicit and
// must not appear in `axes` — next/font throws if it does.
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz", "wdth"],
  variable: "--font-bricolage",
  display: "swap",
});

const instrument = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
});

// IBM Plex Mono is not a variable font on Google Fonts, so weights are explicit.
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DebtPilot — find your last payment",
  description:
    "Enter your cards and see what minimum payments really cost, and what paying a little more buys back.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${instrument.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Replace `app/page.tsx` with a static shell**

This proves the tokens and fonts render before any interactivity exists.

```tsx
export default function Page() {
  return (
    <main className="mx-auto max-w-[1180px] px-6 py-12 lg:px-10">
      <header className="max-w-2xl">
        <p className="eyebrow">DebtPilot</p>
        <h1 className="mt-3 font-display text-[clamp(2.5rem,6vw,4.5rem)] font-bold leading-[0.95] tracking-tight">
          Find your last payment.
        </h1>
        <p className="mt-5 text-lg text-ink-soft">
          Enter your cards. See what minimum payments really cost, and what
          paying a little more buys back.
        </p>
      </header>

      <p className="tnum mt-12 text-2xl">$6,120.00 · 24.99% · Sep 2029</p>
    </main>
  );
}
```

- [ ] **Step 4: Verify in a browser**

```bash
cd frontend && npm run dev
```

Open `http://localhost:3000` and confirm, by eye:
- The headline renders in Bricolage Grotesque — a wide, high-contrast grotesque, clearly not the system sans.
- The figure line renders in IBM Plex Mono.
- The background is `#E8EBF0` in light mode. Switch the OS to dark and confirm it becomes `#14161C` with light text.
- Tab into the page; focus rings are visible.

- [ ] **Step 5: Delete leftover scaffold styles and commit**

```bash
cd frontend && rm -f app/page.module.css
npm run build   # expected: succeeds
cd /Users/erikolvera/Desktop/debtpilot
git add frontend/app
git commit -m "style(frontend): design tokens, fonts, and the app shell

Tailwind v4 @theme inline maps CSS variables onto colour utilities, which is
what lets prefers-color-scheme swap the palette by redefining values rather
than redeclaring the theme.

.tnum is not a refinement: every figure changes while the slider is dragged,
and proportional digits make the whole results column shimmer each frame."
```

---

## Task 7: Input validation and the plan hook

Validation is folded in here because it belongs to the request cycle: it exists to stop the hook firing a request that is already known to earn a 422.

**Files:**
- Create: `frontend/lib/validate.ts`
- Create: `frontend/lib/usePlan.ts`
- Test: `frontend/lib/validate.test.ts`

**Interfaces:**
- Consumes: `DebtDraft`, `buildRequest`, `fetchPlan`, `isAbort`, `ApiError` from `lib/api.ts`.
- Produces:
  - `type FieldErrors = Partial<Record<keyof DebtDraft, string>>`
  - `debtErrors(debt: DebtDraft): FieldErrors`
  - `extraError(extra: string): string | null`
  - `isSendable(debts: DebtDraft[], extra: string): boolean`
  - `usePlan(debts: DebtDraft[], extra: string): { plan, pending, error }`
  - `const DEBOUNCE_MS = 250`

**Caller requirement:** `usePlan`'s effect keys on the `debts` array identity. `app/page.tsx` MUST hold `debts` in `useState` and pass that value directly. Constructing a new array inline on each render (`debts.filter(...)`, `[...debts]`) would refire the effect every render and spin the API.

- [ ] **Step 1: Write the failing test**

Create `frontend/lib/validate.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import type { DebtDraft } from "./api";
import { debtErrors, extraError, isSendable } from "./validate";

const OK: DebtDraft = {
  id: "a", name: "Visa", balance: "6120.00", apr: "24.99", minimum_payment: "122.40",
};

describe("debtErrors", () => {
  test("accepts a well-formed row", () => {
    expect(debtErrors(OK)).toEqual({});
  });

  test("accepts money with no decimal part or a single decimal place", () => {
    expect(debtErrors({ ...OK, balance: "6120" })).toEqual({});
    expect(debtErrors({ ...OK, balance: "6120.5" })).toEqual({});
  });

  test("rejects an empty or whitespace-only name, matching the server", () => {
    expect(debtErrors({ ...OK, name: "" }).name).toBeDefined();
    expect(debtErrors({ ...OK, name: "   " }).name).toBeDefined();
  });

  test("rejects a name over 120 characters", () => {
    expect(debtErrors({ ...OK, name: "x".repeat(121) }).name).toBeDefined();
    expect(debtErrors({ ...OK, name: "x".repeat(120) }).name).toBeUndefined();
  });

  test("rejects money that is not a plain decimal", () => {
    for (const bad of ["", "  ", "abc", "-5.00", "1,200.00", "1e5", "5.123", "$5"]) {
      expect(debtErrors({ ...OK, balance: bad }).balance).toBeDefined();
    }
  });

  test("bounds money at the server's MONEY_MAX", () => {
    expect(debtErrors({ ...OK, balance: "99999999.99" }).balance).toBeUndefined();
    expect(debtErrors({ ...OK, balance: "100000000.00" }).balance).toBeDefined();
  });

  test("bounds APR at 999.99 with at most two decimals", () => {
    expect(debtErrors({ ...OK, apr: "0" }).apr).toBeUndefined();
    expect(debtErrors({ ...OK, apr: "999.99" }).apr).toBeUndefined();
    expect(debtErrors({ ...OK, apr: "1000.00" }).apr).toBeDefined();
  });

  test("accepts a zero minimum payment on a live balance", () => {
    // The engine accepts this deliberately; its no-progress check catches it.
    // Rejecting it here would refuse a question the engine can answer.
    expect(debtErrors({ ...OK, minimum_payment: "0.00" })).toEqual({});
  });
});

describe("extraError", () => {
  test("accepts zero and a plain decimal", () => {
    expect(extraError("0.00")).toBeNull();
    expect(extraError("200")).toBeNull();
  });

  test("rejects an empty or malformed amount", () => {
    expect(extraError("")).not.toBeNull();
    expect(extraError("-1")).not.toBeNull();
  });
});

describe("isSendable", () => {
  test("is false while any row is mid-edit", () => {
    expect(isSendable([{ ...OK, balance: "" }], "200.00")).toBe(false);
  });

  test("is false for an empty portfolio", () => {
    // Nothing to plan. The page shows its empty state instead of a request.
    expect(isSendable([], "200.00")).toBe(false);
  });

  test("is false above the server's 20-debt cap", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ ...OK, id: String(i) }));
    expect(isSendable(many, "200.00")).toBe(false);
  });

  test("is true for a valid portfolio", () => {
    expect(isSendable([OK], "200.00")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd frontend && npx vitest run lib/validate.test.ts
```

Expected: FAIL — `Failed to resolve import "./validate"`.

- [ ] **Step 3: Write `lib/validate.ts`**

```ts
import type { DebtDraft } from "./api";

/**
 * Client-side validation, mirroring the server's bounds.
 *
 * This exists to save a round trip and a red banner for a typo. It is NOT the
 * trust boundary — the server validates independently and is tested
 * independently — and it must never become the only check.
 */

export type FieldErrors = Partial<Record<keyof DebtDraft, string>>;

/** A plain decimal: no sign, no separators, no exponent, at most two decimals. */
const DECIMAL = /^\d+(\.\d{1,2})?$/;

const MONEY_MAX = 99999999.99;
const APR_MAX = 999.99;
const MAX_DEBTS = 20;
const MAX_NAME = 120;

function moneyError(value: string, max: number, label: string): string | undefined {
  if (!DECIMAL.test(value)) return `${label} must be a plain amount, like 1200.50`;
  // Bounds comparison only; the value that travels is still the string.
  if (Number(value) > max) return `${label} is too large`;
  return undefined;
}

export function debtErrors(debt: DebtDraft): FieldErrors {
  const errors: FieldErrors = {};
  const name = debt.name.trim();
  if (name.length === 0) errors.name = "Give this card a name";
  else if (name.length > MAX_NAME) errors.name = "Name is too long";

  const balance = moneyError(debt.balance, MONEY_MAX, "Balance");
  if (balance) errors.balance = balance;

  const apr = moneyError(debt.apr, APR_MAX, "APR");
  if (apr) errors.apr = apr;

  // A zero minimum on a live balance is accepted: the engine treats it as a
  // legitimate question and its no-progress check answers it.
  const minimum = moneyError(debt.minimum_payment, MONEY_MAX, "Minimum payment");
  if (minimum) errors.minimum_payment = minimum;

  return errors;
}

export function extraError(extra: string): string | null {
  return moneyError(extra, MONEY_MAX, "Extra payment") ?? null;
}

/** Whether this portfolio is worth sending. */
export function isSendable(debts: DebtDraft[], extra: string): boolean {
  if (debts.length === 0 || debts.length > MAX_DEBTS) return false;
  if (extraError(extra) !== null) return false;
  return debts.every((debt) => Object.keys(debtErrors(debt)).length === 0);
}
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
cd frontend && npx vitest run lib/validate.test.ts
```

Expected: PASS, 14 tests.

- [ ] **Step 5: Write `lib/usePlan.ts`**

No unit test. The debounce-and-abort orchestration needs a DOM and a fake network to exercise, and what it would prove is that `setTimeout` and `AbortController` behave as documented. The logic that can be wrong in a way that reaches a user — the request body, the formatting, the suppression, the geometry — is covered in Tasks 2 through 5. Step 6 is a manual verification instead, and it is not optional.

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  ApiError,
  buildRequest,
  fetchPlan,
  isAbort,
  type DebtDraft,
  type PayoffPlanResponse,
} from "./api";
import { isSendable } from "./validate";

export const DEBOUNCE_MS = 250;

export type PlanState = {
  plan: PayoffPlanResponse | null;
  pending: boolean;
  error: string | null;
};

function describe(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 422) {
    return "One of the numbers above isn't an amount the planner accepts.";
  }
  if (cause instanceof ApiError && cause.status === 413) {
    return "That's more cards than the planner takes at once.";
  }
  return "Can't reach the planner right now. Your numbers are still here.";
}

/**
 * The plan for the current portfolio, recomputed as it changes.
 *
 * The effect keys on the `debts` array identity, so the caller must hold it in
 * state and pass it through unchanged. Building a new array inline each render
 * would refire this on every render and spin the API.
 */
export function usePlan(debts: DebtDraft[], extra: string): PlanState {
  const [plan, setPlan] = useState<PayoffPlanResponse | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSendable(debts, extra)) {
      // Mid-edit or empty. Keep the last good plan on screen; there is nothing
      // useful to ask for and a 422 would read as a server fault.
      setPending(false);
      return;
    }

    const controller = new AbortController();
    setPending(true);

    const timer = setTimeout(() => {
      fetchPlan(buildRequest(debts, extra), controller.signal)
        .then((next) => {
          setPlan(next);
          setError(null);
          setPending(false);
        })
        .catch((cause: unknown) => {
          // An abort means a newer request is already in flight. Leaving
          // `pending` set is correct — the newer effect owns it now. Without
          // this guard, responses resolve out of order and a stale plan paints
          // over a fresh one: invisible with a submit button, constant with a
          // slider.
          if (isAbort(cause)) return;
          setError(describe(cause));
          setPending(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [debts, extra]);

  return { plan, pending, error };
}
```

- [ ] **Step 6: Commit**

```bash
cd frontend && npm test && npm run typecheck
cd /Users/erikolvera/Desktop/debtpilot
git add frontend/lib/validate.ts frontend/lib/validate.test.ts frontend/lib/usePlan.ts
git commit -m "feat(frontend): input validation and the debounced plan hook

Validation mirrors the server's bounds to save a round trip on a typo. It is
not the trust boundary and never becomes the only check.

Aborting the in-flight request is not an optimisation. Without it responses
resolve out of order and a stale plan paints over a fresh one -- invisible
behind a submit button, constant behind a slider."
```

---

## Task 8: The input rail

**Files:**
- Create: `frontend/components/DebtTable.tsx`
- Create: `frontend/components/ExtraPayment.tsx`

**Interfaces:**
- Consumes: `DebtDraft` from `lib/api.ts`; `debtErrors` from `lib/validate.ts`; `EXTRA_SLIDER_MAX` from `lib/seed.ts`.
- Produces:
  - `<DebtTable debts={DebtDraft[]} onChange={(debts: DebtDraft[]) => void} />`
  - `<ExtraPayment value={string} onChange={(extra: string) => void} />`

- [ ] **Step 1: Write `components/DebtTable.tsx`**

```tsx
"use client";

import type { DebtDraft } from "@/lib/api";
import { debtErrors } from "@/lib/validate";

const MAX_DEBTS = 20;

type Props = {
  debts: DebtDraft[];
  onChange: (debts: DebtDraft[]) => void;
};

const CELL = "w-full bg-transparent px-2 py-1.5 text-right tabular-nums " +
  "font-mono text-sm outline-none focus:bg-ink/5 rounded";

export function DebtTable({ debts, onChange }: Props) {
  const update = (id: string, field: keyof DebtDraft, value: string) =>
    onChange(debts.map((debt) => (debt.id === id ? { ...debt, [field]: value } : debt)));

  const remove = (id: string) => onChange(debts.filter((debt) => debt.id !== id));

  const add = () =>
    onChange([
      ...debts,
      { id: crypto.randomUUID(), name: "", balance: "", apr: "", minimum_payment: "" },
    ]);

  return (
    <section aria-labelledby="cards-heading">
      <h2 id="cards-heading" className="eyebrow">
        Your cards
      </h2>

      {debts.length === 0 ? (
        <p className="mt-4 text-sm text-ink-soft">
          No cards yet. Add one to see your payoff date.
        </p>
      ) : (
        <table className="mt-4 w-full border-collapse">
          <caption className="sr-only">
            Your credit cards. Edit any value to update the plan.
          </caption>
          <thead>
            <tr className="border-b border-rule text-left">
              <th scope="col" className="eyebrow py-2 font-normal">Card</th>
              <th scope="col" className="eyebrow py-2 text-right font-normal">Owed</th>
              <th scope="col" className="eyebrow py-2 text-right font-normal">APR</th>
              <th scope="col" className="eyebrow py-2 text-right font-normal">Min</th>
              <th scope="col" className="sr-only">Remove</th>
            </tr>
          </thead>
          <tbody>
            {debts.map((debt) => {
              const errors = debtErrors(debt);
              return (
                <tr key={debt.id} className="border-b border-rule/60">
                  <td className="py-1">
                    <input
                      className="w-full rounded bg-transparent px-2 py-1.5 text-sm outline-none focus:bg-ink/5"
                      value={debt.name}
                      onChange={(event) => update(debt.id, "name", event.target.value)}
                      aria-label="Card name"
                      aria-invalid={errors.name !== undefined}
                      placeholder="Card name"
                    />
                  </td>
                  <td className="py-1">
                    <input
                      className={CELL}
                      // Not type="number": it returns a string regardless, and
                      // its stepper and locale parsing invite float thinking.
                      type="text"
                      inputMode="decimal"
                      value={debt.balance}
                      onChange={(event) => update(debt.id, "balance", event.target.value)}
                      aria-label="Balance owed"
                      aria-invalid={errors.balance !== undefined}
                      placeholder="0.00"
                    />
                  </td>
                  <td className="py-1">
                    <input
                      className={CELL}
                      type="text"
                      inputMode="decimal"
                      value={debt.apr}
                      onChange={(event) => update(debt.id, "apr", event.target.value)}
                      aria-label="Annual percentage rate"
                      aria-invalid={errors.apr !== undefined}
                      placeholder="0.00"
                    />
                  </td>
                  <td className="py-1">
                    <input
                      className={CELL}
                      type="text"
                      inputMode="decimal"
                      value={debt.minimum_payment}
                      onChange={(event) => update(debt.id, "minimum_payment", event.target.value)}
                      aria-label="Minimum payment"
                      aria-invalid={errors.minimum_payment !== undefined}
                      placeholder="0.00"
                    />
                  </td>
                  <td className="py-1 pl-1">
                    <button
                      type="button"
                      onClick={() => remove(debt.id)}
                      className="rounded px-2 py-1 text-ink-soft hover:text-ink"
                      aria-label={`Remove ${debt.name || "this card"}`}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <button
        type="button"
        onClick={add}
        disabled={debts.length >= MAX_DEBTS}
        className="mt-4 rounded border border-rule px-3 py-1.5 text-sm hover:bg-ink/5 disabled:opacity-40"
      >
        Add a card
      </button>
      {debts.length >= MAX_DEBTS && (
        <p className="mt-2 text-xs text-ink-soft">Twenty cards is the limit.</p>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Write `components/ExtraPayment.tsx`**

```tsx
"use client";

import { EXTRA_SLIDER_MAX } from "@/lib/seed";
import { extraError } from "@/lib/validate";

type Props = {
  value: string;
  onChange: (extra: string) => void;
};

export function ExtraPayment({ value, onChange }: Props) {
  const invalid = extraError(value) !== null;
  // The one place a money value becomes a number: a range input's value is
  // numeric by nature. It is converted straight back to a fixed-2 string and
  // never used for arithmetic.
  const sliderValue = invalid ? 0 : Math.min(Number(value), EXTRA_SLIDER_MAX);

  return (
    <section aria-labelledby="extra-heading" className="mt-10">
      <h2 id="extra-heading" className="eyebrow">
        Extra each month
      </h2>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="tnum text-2xl text-ink-soft">$</span>
        <input
          className="tnum w-32 rounded bg-transparent text-3xl outline-none focus:bg-ink/5"
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label="Extra payment each month, in dollars"
          aria-invalid={invalid}
        />
      </div>

      <input
        className="mt-4 w-full accent-[var(--avalanche)]"
        type="range"
        min={0}
        max={EXTRA_SLIDER_MAX}
        step={5}
        value={sliderValue}
        onChange={(event) => onChange(Number(event.target.value).toFixed(2))}
        aria-label="Extra payment each month"
      />

      <p className="mt-2 text-xs text-ink-soft">
        On top of every minimum. Drag to see what it buys back.
      </p>
    </section>
  );
}
```

- [ ] **Step 3: Wire them into the shell temporarily and verify in a browser**

Replace `app/page.tsx` with a client component (`"use client"` at the top — it holds state) that calls `useState(seedPortfolio())` and renders both, so they can be exercised before the results exist. Confirm:
- Typing in any cell updates it, and clearing a balance shows the invalid state rather than crashing.
- The slider moves the dollar figure and vice versa, and the figure does not jitter as it changes.
- Tab reaches every input and both buttons, with a visible focus ring.
- "Add a card" appends an empty row; the button disables at twenty.

- [ ] **Step 4: Commit**

```bash
cd frontend && npm run typecheck && npm run build
cd /Users/erikolvera/Desktop/debtpilot
git add frontend/components frontend/app/page.tsx
git commit -m "feat(frontend): editable card table and the extra-payment control

Money inputs are type=text with inputMode=decimal, not type=number: the
latter returns a string anyway, and its stepper and locale parsing invite
the float thinking the whole contract is built to exclude.

The range input's numeric value is the single permitted number-to-money
conversion, and it goes straight back to a fixed-2 string."
```

---

## Task 9: Scenario summaries

**Files:**
- Create: `frontend/components/ScenarioSummary.tsx`

**Interfaces:**
- Consumes: `ScenarioOut` from `lib/api.ts`; `scenarioFigures`, `delta` from `lib/format.ts`.
- Produces: `<ScenarioSummary scenario={ScenarioOut} label={string} accent={string} nameFor={(id: string) => string} note={string | null} />` where `accent` is a CSS colour expression such as `"var(--avalanche)"` and `note` is a preformatted comparison line or `null`.

- [ ] **Step 1: Write `components/ScenarioSummary.tsx`**

```tsx
import type { ScenarioOut } from "@/lib/api";
import { scenarioFigures } from "@/lib/format";

type Props = {
  scenario: ScenarioOut;
  label: string;
  /** A CSS colour expression. Used as a fill only — never as text colour. */
  accent: string;
  nameFor: (debtId: string) => string;
  note: string | null;
};

export function ScenarioSummary({ scenario, label, accent, nameFor, note }: Props) {
  const figures = scenarioFigures(scenario);

  return (
    <div className="border-t border-rule pt-4">
      <div className="flex items-center gap-2">
        {/* The scenario colour identifies the row as a swatch. It never carries
            text: #D98324 on #E8EBF0 is ~2.6:1, well under the body-text floor. */}
        <span
          aria-hidden="true"
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ background: accent }}
        />
        <h3 className="text-sm font-medium">{label}</h3>
      </div>

      {figures.paidOff ? (
        <>
          <p className="tnum mt-3 text-3xl leading-none">{figures.payoffMonth}</p>
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-soft">Takes</dt>
              <dd className="tnum">{figures.duration}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-soft">Interest</dt>
              <dd className="tnum">{figures.totalInterest}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-soft">Total paid</dt>
              <dd className="tnum">{figures.totalPaid}</dd>
            </div>
          </dl>
        </>
      ) : (
        <>
          <p className="mt-3 font-display text-3xl leading-none">Never pays off</p>
          <p className="mt-3 text-sm text-ink-soft">
            {figures.underwaterIds.length > 0 ? (
              <>
                Interest outruns the payment on{" "}
                {figures.underwaterIds.map(nameFor).join(", ")}, so the balance
                grows every month.
              </>
            ) : (
              <>The balance never reaches zero at this payment.</>
            )}
          </p>
          {/*
            No totals here, deliberately. The API populates
            total_interest_paid and total_paid for this scenario, but they cover
            the simulated window rather than a lifetime — spec §3.4. Printing
            "$91,219.95" beside "never pays off" states a bounded price for
            something that does not end, and contradicts the narrative below,
            which omits it by design. scenarioFigures() has already nulled them;
            do not reach past it to scenario.total_interest_paid.
          */}
        </>
      )}

      {note !== null && <p className="mt-3 text-sm text-ink-soft">{note}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
cd frontend && npm run typecheck
cd /Users/erikolvera/Desktop/debtpilot
git add frontend/components/ScenarioSummary.tsx
git commit -m "feat(frontend): scenario summaries with the suppression rule applied

A never-paying-off scenario renders its outcome and the cards whose interest
outruns their payment, and no totals. The API populates those totals, but
they cover the simulated window rather than a lifetime; stating them would
contradict the prose printed below, which omits them by design."
```

---

## Task 10: The escape chart

The signature element. Geometry is already tested in Task 4; this task is rendering only.

**Files:**
- Create: `frontend/components/EscapeChart.tsx`

**Interfaces:**
- Consumes: `ScenarioOut` from `lib/api.ts`; every export of `lib/chart.ts`; `scenarioFigures` from `lib/format.ts`.
- Produces: `type Track = { key: string; label: string; accent: string; scenario: ScenarioOut }` and `<EscapeChart tracks={Track[]} startMonth={string} dimmed={boolean} />`.

**Layout approach:** the SVG holds only the wedges, stretched with `preserveAspectRatio="none"` — a filled area carries no meaning that distortion destroys. Every label, marker, and gridline is HTML positioned in percentages over the same box, so text never distorts or scales with the viewport. Do not put `<text>` inside the SVG.

- [ ] **Step 1: Write `components/EscapeChart.tsx`**

```tsx
import type { ScenarioOut } from "@/lib/api";
import { clipsAtEdge, wedgePath, xDomainMonths, yMaxBalance, yearTicks } from "@/lib/chart";
import { scenarioFigures } from "@/lib/format";

const LANE = { width: 700, height: 44 };

export type Track = {
  key: string;
  label: string;
  /** A CSS colour expression, used as a fill. */
  accent: string;
  scenario: ScenarioOut;
};

type Props = {
  tracks: Track[];
  startMonth: string;
  dimmed: boolean;
};

export function EscapeChart({ tracks, startMonth, dimmed }: Props) {
  const scenarios = tracks.map((track) => track.scenario);
  const domainMonths = xDomainMonths(scenarios);
  const yMax = yMaxBalance(scenarios);
  const ticks = yearTicks(startMonth, domainMonths);

  const across = (month: number) => `${Math.min(month / domainMonths, 1) * 100}%`;

  const summary = tracks
    .map((track) => {
      const figures = scenarioFigures(track.scenario);
      return figures.paidOff
        ? `${track.label} clears in ${figures.payoffMonth}.`
        : `${track.label} never pays off.`;
    })
    .join(" ");

  return (
    <figure
      className="transition-opacity duration-150"
      style={{ opacity: dimmed ? 0.55 : 1 }}
      role="img"
      aria-label={summary}
    >
      {/* Year gridlines, drawn once behind every lane. */}
      <div className="relative">
        <div className="pointer-events-none absolute inset-0 hidden sm:block" aria-hidden="true">
          {ticks.map((tick) => (
            <div
              key={tick.label}
              className="absolute top-0 bottom-0 border-l border-rule"
              style={{ left: across(tick.month) }}
            >
              <span className="eyebrow absolute -top-0.5 left-1.5">{tick.label}</span>
            </div>
          ))}
        </div>

        <div className="relative space-y-8 pt-6">
          {tracks.map((track) => {
            const figures = scenarioFigures(track.scenario);
            const clips = clipsAtEdge(track.scenario, domainMonths);
            const path = wedgePath(track.scenario.monthly_totals, domainMonths, yMax, LANE);
            const maskId = `fade-${track.key}`;

            return (
              <div key={track.key}>
                <p className="eyebrow">{track.label}</p>

                <div className="relative mt-1.5">
                  <svg
                    className="block h-11 w-full"
                    viewBox={`0 0 ${LANE.width} ${LANE.height}`}
                    // A filled area carries no meaning that non-uniform scaling
                    // destroys, and stretching keeps the month axis aligned with
                    // the HTML gridlines above at every viewport width.
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    {clips && (
                      <defs>
                        <linearGradient id={maskId} x1="0" x2="1">
                          <stop offset="0.82" stopColor="white" stopOpacity="1" />
                          <stop offset="1" stopColor="white" stopOpacity="0" />
                        </linearGradient>
                        <mask id={`mask-${track.key}`}>
                          <rect
                            width={LANE.width}
                            height={LANE.height}
                            fill={`url(#${maskId})`}
                          />
                        </mask>
                      </defs>
                    )}
                    <path
                      d={path}
                      fill={track.accent}
                      mask={clips ? `url(#mask-${track.key})` : undefined}
                    />
                  </svg>

                  {figures.paidOff && !clips && figures.months !== null && (
                    <span
                      className="absolute top-full mt-1 -translate-x-1/2 whitespace-nowrap"
                      style={{ left: across(figures.months) }}
                    >
                      <span
                        aria-hidden="true"
                        className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                        style={{ background: track.accent }}
                      />
                      <span className="tnum text-xs">
                        {figures.payoffMonth}
                        {/* figures.*, never track.scenario.*: reaching past
                            scenarioFigures() is how the §3.4 suppression gets
                            bypassed by accident. */}
                        {figures.totalInterestWhole !== null && (
                          <span className="text-ink-soft">
                            {" · "}
                            {figures.totalInterestWhole} interest
                          </span>
                        )}
                      </span>
                    </span>
                  )}

                  {clips && (
                    <span className="absolute top-full right-0 mt-1 text-xs text-ink-soft">
                      still paying →
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <figcaption className="mt-10 text-xs text-ink-soft">
        Height is what you still owe. Estimated with monthly interest, so
        figures are close rather than exact.
      </figcaption>
    </figure>
  );
}
```

- [ ] **Step 2: Verify the clipping behaviour in a browser**

With the seeded portfolio, confirm:
- Three wedges render. Snowball and avalanche taper to nothing and carry a dated marker.
- The "Do nothing" wedge fills its lane at full height for the whole axis and fades out at the right edge under "still paying →".
- Setting the extra payment to `0.00` still leaves the baseline clipped; raising it to `900` slides both markers left and shortens the axis.
- Deleting every card but the Visa keeps the baseline clipped, and the year gridlines still line up with the wedge ends.

- [ ] **Step 3: Commit**

```bash
cd frontend && npm run typecheck && npm run build
cd /Users/erikolvera/Desktop/debtpilot
git add frontend/components/EscapeChart.tsx
git commit -m "feat(frontend): the escape chart

Three wedges on a shared month axis, drawn from monthly_totals so the shape
is the data tapering rather than a bar dressed up as one. A scenario that
never pays off, or that runs past the axis, fades out at the right edge under
'still paying'.

months_to_payoff: null is the most important thing the engine can say, and in
most calculators it is a blank cell. Here it is the longest mark on the page
and the only one that does not end.

Only the wedges live in SVG, stretched with preserveAspectRatio=none. Every
label and marker is HTML positioned in percentages, so text never distorts."
```

---

## Task 11: The narrative

**Files:**
- Create: `frontend/components/Narrative.tsx`

**Interfaces:**
- Consumes: `DebtDraft`, `buildRequest`, `fetchExplanation`, `isAbort`, `ExplainResponse` from `lib/api.ts`.
- Produces: `<Narrative debts={DebtDraft[]} extra={string} ready={boolean} />`.

- [ ] **Step 1: Write `components/Narrative.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildRequest,
  fetchExplanation,
  isAbort,
  type DebtDraft,
  type ExplainResponse,
} from "@/lib/api";

type Props = {
  debts: DebtDraft[];
  extra: string;
  /** True once a plan has arrived, so there is something worth explaining. */
  ready: boolean;
};

export function Narrative({ debts, extra, ready }: Props) {
  const [result, setResult] = useState<ExplainResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const askedOnce = useRef(false);

  // Props are read through a ref so `ask` has a STABLE identity. If `ask`
  // depended on `debts`/`extra`, the mount effect below would depend on them
  // too, and any edit while the one auto-request is in flight — the normal
  // case, since generation takes seconds and the user is still typing — would
  // run the previous cleanup (aborting the live request), re-enter, find
  // `askedOnce` already set, and return WITHOUT starting a replacement.
  // `loading` would then stay true forever: the skeleton never resolves and
  // "Explain again" stays disabled, with no recovery short of a remount.
  const latest = useRef({ debts, extra });
  useEffect(() => {
    latest.current = { debts, extra };
  });

  const ask = useCallback(() => {
    const { debts, extra } = latest.current;
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    fetchExplanation(buildRequest(debts, extra), controller.signal)
      .then((next) => {
        setResult(next);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (isAbort(cause)) return;
        // A failed call leaves the previous narrative in place and never
        // blocks the plan. The plan is the product; this is a layer on top of
        // it, which is why the API returns them separately.
        setLoading(false);
        setFailed(true);
      });
    return () => controller.abort();
  }, []);

  // Once per session, when the first plan arrives. Firing on the debounced
  // change stream would exhaust the endpoint's ten-per-hour limit inside a
  // minute of dragging, and would describe a portfolio the user had already
  // moved past — generation takes seconds.
  useEffect(() => {
    if (!ready || askedOnce.current) return;
    askedOnce.current = true;
    return ask();
  }, [ready, ask]);

  return (
    <section aria-labelledby="narrative-heading" className="mt-14 max-w-prose">
      <h2 id="narrative-heading" className="eyebrow">
        What this means
      </h2>

      {loading && result === null ? (
        <div className="mt-4 space-y-2" aria-hidden="true">
          <div className="h-4 w-3/4 rounded bg-ink/10" />
          <div className="h-4 w-full rounded bg-ink/10" />
          <div className="h-4 w-5/6 rounded bg-ink/10" />
        </div>
      ) : result !== null ? (
        <>
          <h3 className="mt-4 font-display text-2xl leading-tight">{result.headline}</h3>
          {/*
            Plain text into a <p>. The response is prose assembled by
            substituting server-side values into a model-written template; it
            is not markup and must never be parsed as any.
            Do not introduce dangerouslySetInnerHTML here.
          */}
          <p className="mt-3 whitespace-pre-line leading-relaxed">{result.body}</p>
          {result.source === "template" && (
            <p className="mt-3 text-xs text-ink-soft">
              Written from a fixed template while the explainer is unavailable.
              The figures are the same.
            </p>
          )}
        </>
      ) : failed ? (
        <p className="mt-4 text-sm text-ink-soft">
          The explainer didn&apos;t answer. The plan above is unaffected.
        </p>
      ) : null}

      {ready && (
        <button
          type="button"
          onClick={ask}
          disabled={loading}
          className="mt-5 rounded border border-rule px-3 py-1.5 text-sm hover:bg-ink/5 disabled:opacity-40"
        >
          {result === null ? "Explain this plan" : "Explain again"}
        </button>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Verify both sources**

With `GEMINI_API_KEY` unset on the backend, load the page and confirm the narrative arrives with `source: "template"` and shows the template label. If a key is available, set it, restart the backend, and confirm the label disappears and the prose changes.

Then stop the backend and click "Explain again": confirm the previous narrative stays on screen, the plan is untouched, and the failure line appears.

- [ ] **Step 3: Commit**

```bash
cd frontend && npm run typecheck
cd /Users/erikolvera/Desktop/debtpilot
git add frontend/components/Narrative.tsx
git commit -m "feat(frontend): plain-language narrative beside the plan

Fires once when the first plan arrives, then only on request. The endpoint
allows ten calls an hour per IP; firing it on the debounced change stream
would exhaust that in a minute of dragging and would describe a portfolio the
user had already moved past.

Rendered as text into a <p>. The response is prose with server-substituted
figures, not markup, and the template source is labelled as the correct
deterministic fallback rather than styled as an error."
```

---

## Task 12: Wire the page together

**Files:**
- Modify: `frontend/app/page.tsx` (replace entirely)

**Interfaces:**
- Consumes: every component and lib module built so far.
- Produces: the finished route.

**Critical constraint:** `portfolio.debts` must keep array identity when only `extra` changes, or `usePlan`'s effect refires on every render. Update with `setPortfolio((current) => ({ ...current, extra }))` — the spread preserves the `debts` reference.

- [ ] **Step 1: Write `app/page.tsx`**

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { DebtTable } from "@/components/DebtTable";
import { EscapeChart, type Track } from "@/components/EscapeChart";
import { ExtraPayment } from "@/components/ExtraPayment";
import { Narrative } from "@/components/Narrative";
import { ScenarioSummary } from "@/components/ScenarioSummary";
import type { DebtDraft } from "@/lib/api";
import { delta } from "@/lib/format";
import { seedPortfolio } from "@/lib/seed";
import { browserStorage, loadPortfolio, savePortfolio, type Portfolio } from "@/lib/storage";
import { usePlan } from "@/lib/usePlan";

export default function Page() {
  const [portfolio, setPortfolio] = useState<Portfolio>(seedPortfolio);
  const [restored, setRestored] = useState(false);

  // Restore after mount, never during render: localStorage does not exist on
  // the server, and reading it during render would mismatch hydration.
  useEffect(() => {
    setPortfolio(loadPortfolio(browserStorage(), seedPortfolio()));
    setRestored(true);
  }, []);

  useEffect(() => {
    if (restored) savePortfolio(browserStorage(), portfolio);
  }, [portfolio, restored]);

  const setDebts = (debts: DebtDraft[]) =>
    setPortfolio((current) => ({ ...current, debts }));
  const setExtra = (extra: string) =>
    setPortfolio((current) => ({ ...current, extra }));

  const { plan, pending, error } = usePlan(portfolio.debts, portfolio.extra);

  const nameFor = useMemo(() => {
    const byId = new Map(
      portfolio.debts.map((debt) => [debt.id, debt.name.trim() || "that card"]),
    );
    return (debtId: string) => byId.get(debtId) ?? "a card";
  }, [portfolio.debts]);

  const tracks: Track[] = plan
    ? [
        { key: "baseline", label: "Do nothing", accent: "var(--baseline)", scenario: plan.scenarios.baseline },
        { key: "snowball", label: "Snowball", accent: "var(--snowball)", scenario: plan.scenarios.snowball },
        { key: "avalanche", label: "Avalanche", accent: "var(--avalanche)", scenario: plan.scenarios.avalanche },
      ]
    : [];

  return (
    <main className="mx-auto max-w-[1180px] px-6 py-12 lg:px-10">
      <header className="max-w-2xl">
        <p className="eyebrow">DebtPilot</p>
        <h1 className="mt-3 font-display text-[clamp(2.5rem,6vw,4.5rem)] font-bold leading-[0.95] tracking-tight">
          Find your last payment.
        </h1>
        <p className="mt-5 text-lg text-ink-soft">
          Enter your cards. See what minimum payments really cost, and what
          paying a little more buys back.
        </p>
      </header>

      <div className="mt-14 grid gap-12 lg:grid-cols-[380px_1fr] lg:gap-16">
        <div>
          <DebtTable debts={portfolio.debts} onChange={setDebts} />
          <ExtraPayment value={portfolio.extra} onChange={setExtra} />
          <p className="mt-8 text-xs text-ink-soft">
            These numbers are an example. Change any of them — nothing is saved
            beyond this browser.
          </p>
        </div>

        <div>
          {error !== null && (
            <p role="status" className="mb-6 border-l-2 border-snowball pl-3 text-sm">
              {error}
            </p>
          )}

          {plan === null ? (
            <p className="text-ink-soft">
              {portfolio.debts.length === 0
                ? "Add a card to see your payoff date."
                : error !== null
                  ? "No plan yet — the planner didn't answer."
                  : "Working out your plan…"}
            </p>
          ) : (
            <>
              <h2 className="eyebrow">How it plays out</h2>
              <div className="mt-6">
                <EscapeChart
                  tracks={tracks}
                  startMonth={plan.start_month}
                  dimmed={pending}
                />
              </div>

              <div className="mt-12 grid gap-8 sm:grid-cols-3">
                <ScenarioSummary
                  scenario={plan.scenarios.baseline}
                  label="Do nothing"
                  accent="var(--baseline)"
                  nameFor={nameFor}
                  note={null}
                />
                <ScenarioSummary
                  scenario={plan.scenarios.snowball}
                  label="Snowball"
                  accent="var(--snowball)"
                  nameFor={nameFor}
                  note="Smallest balance first."
                />
                <ScenarioSummary
                  scenario={plan.scenarios.avalanche}
                  label="Avalanche"
                  accent="var(--avalanche)"
                  nameFor={nameFor}
                  note={
                    plan.comparison.interest_saved_avalanche_vs_snowball === null
                      ? "Highest rate first."
                      : `Highest rate first. ${delta(plan.comparison.interest_saved_avalanche_vs_snowball)} less interest than snowball.`
                  }
                />
              </div>

              <Narrative
                debts={portfolio.debts}
                extra={portfolio.extra}
                ready={plan !== null}
              />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify the whole flow**

```bash
cd backend && .venv/bin/uvicorn app.api.main:app --reload   # terminal one
cd frontend && npm run dev                                   # terminal two
```

Walk every path at `http://localhost:3000`:

| Check | Expected |
|---|---|
| Cold load | Seeded portfolio, three wedges, baseline clipped under "still paying" |
| Drag the slider | Markers slide left; figures change without the layout jittering; no blank frame |
| Network panel while dragging | Superseded requests show as cancelled, not completed |
| Clear a balance field | Last good plan stays on screen; no 422 banner; no request fired |
| Set extra to `0` | Snowball and avalanche still pay off; baseline still clipped |
| Delete every card | "Add a card to see your payoff date." |
| Add a card, fill it in | Plan updates; the new row participates |
| Reload the page | The edited portfolio is restored, not the seed |
| `localStorage.setItem("debtpilot.portfolio.v1", "{oops")` then reload | Seed loads; no crash |
| Stop the backend, edit a value | Error line appears; the previous plan stays on screen |
| Never-pays-off baseline | No dollar total anywhere in its summary or on its track |

- [ ] **Step 3: Verify the quality floor**

- Narrow the window to 360px. Nothing overflows horizontally; inputs stack; the chart still reads.
- Tab through the entire page. Every input, both buttons per row, the slider, and the explain button take focus with a visible ring, in a sensible order.
- Enable "reduce motion" in the OS. The chart snaps rather than transitions.
- Switch the OS to dark mode. Every token flips; no element keeps a light-mode background.
- Zoom the browser to 200%. The layout reflows without clipping.

- [ ] **Step 4: Final check and commit**

```bash
cd frontend && npm test && npm run typecheck && npm run lint && npm run build
```

All four must pass. Then:

```bash
cd /Users/erikolvera/Desktop/debtpilot
git add frontend/app/page.tsx
git commit -m "feat(frontend): wire the calculator together

State updates spread the previous portfolio so the debts array keeps its
identity when only the extra payment changes -- usePlan's effect keys on that
identity, and a fresh array each render would spin the API.

localStorage is read after mount rather than during render: it does not exist
on the server, and reading it during render would mismatch hydration."
```

- [ ] **Step 5: Update the roadmap**

In `README.md`, change `- [ ] Next.js frontend` to `- [x] Next.js frontend — anonymous calculator`, and add a short section documenting `cd frontend && npm run dev` and the `NEXT_PUBLIC_API_BASE_URL` variable. Commit as `docs: mark the frontend calculator shipped`.

---

## Self-Review

**Spec coverage.** Every numbered section of the spec maps to a task:

| Spec | Task |
|---|---|
| §3.1 one route, direct calls | 1, 2 |
| §3.2 no financial arithmetic | 2, 3 (`delta`), enforced by review in 9, 10 |
| §3.3 money as a string | 2 (tested), 8 (inputs) |
| §3.4 suppressed totals | 3 (tested), applied in 9, 10 |
| §3.5 generated types | 2 |
| §4 state and request cycle | 5 (storage), 7 (validate, usePlan), 12 (wiring) |
| §5 palette, type, layout | 6, 12 |
| §6 escape chart | 4 (geometry, tested), 10 (rendering) |
| §7 seeded portfolio | 5 |
| §8 narrative | 11 |
| §9 quality floor | 6 (focus, reduced motion), 8 (labels), 12 step 3 |
| §10 test strategy | 2, 3, and extended to 4, 5, 7 |
| §11 configuration | 1 |
| §12 file layout | matches the File Structure table |
| §13 deferred | untouched by design |

Two places where the plan exceeds the spec, both deliberate: the spec named one test file, and this plan writes five (`api`, `format`, `chart`, `storage`, `validate`). Writing chart geometry, storage recovery, and validation bounds untested would have left the spec's riskiest derived rules — the y-scale clamp and the corrupt-blob path — resting on manual inspection. The spec's §10 stays accurate about *what* must be covered; the plan covers more of it.

**Placeholder scan.** No "TBD", no "add appropriate error handling", no "similar to Task N". Every code step carries the code. Every verification step names the command and the expected result.

**Type consistency.** `DebtDraft`, `Portfolio`, `StorageLike`, `ScenarioFigures`, `Track`, `Lane`, `FieldErrors`, and `PlanState` are each defined once and referenced by the same name everywhere. `scenarioFigures` returns `underwaterIds` (camelCase) throughout; `accent` is a CSS colour expression string in both `ScenarioSummary` and `EscapeChart`; `nameFor` has the same signature in both. `EXTRA_SLIDER_MAX` is defined in Task 5 and consumed in Task 8.
