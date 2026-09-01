# Frontend — design

The first user-facing slice of DebtPilot: a single-page, anonymous payoff
calculator built on the stateless `POST /v1/payoff-plans` and
`POST /v1/payoff-plans/explain` endpoints.

Status: design approved, not yet implemented.

Related: [payoff API](2026-08-31-payoff-api-design.md),
[AI guidance layer](2026-09-01-ai-guidance-design.md).

## 1. Purpose

Make the gap between doing nothing and doing something about card debt
visible in one screen, without an account.

A user arrives with two or three cards and a vague dread. The engine already
answers the question they cannot answer alone — *what does paying only the
minimum actually cost me?* — and answers it in under a millisecond. The
frontend's job is to put that answer in front of them fast enough that
adjusting the extra payment feels like moving a dial rather than resubmitting
a form.

Success criteria:

- A first-time visitor sees a real, complete plan before typing anything.
- Changing the extra monthly payment updates all three scenarios without a
  page transition or a visible loading state.
- A portfolio that never pays off is the most legible thing on the page, not
  an error or a blank.
- No number on screen was computed by the browser.

## 2. Non-goals

Deliberately out of this slice:

- **Authentication and persistence.** No Supabase client, no session, no
  `/v1/debts`, no `GET /v1/me/payoff-plan`. The stateless endpoint exists
  precisely so the product can be demonstrated before signup, and building
  auth alongside the first UI would triple the surface for no added proof
  that the idea works.
- **`POST /ask`.** Not built on the backend either.
- **The `?detail=full` per-debt schedule grid.** The summaries and
  `monthly_totals` carry everything this design renders. A month-by-month
  table is a later feature with its own interaction questions.
- **A dark-mode toggle.** System preference is respected; a control to
  override it is a preference store this slice does not have.
- **Non-USD currency, localisation, multi-user anything.**

## 3. Settled decisions

Decided. Change this document before changing the code.

### 3.1 One route, and the browser calls the API directly

The app is a single client-rendered route at `/`. Requests go from the
browser straight to the FastAPI origin. There is no Next.js route handler
proxying them.

A proxy is the reflexive choice and it would be actively wrong here.
`/v1/payoff-plans/explain` rate-limits **per client IP**. Routed through
Vercel, every visitor in the world collapses into a small set of egress
addresses, and a limit designed to be ten requests per hour per person
becomes ten requests per hour for everyone. The backend's own
`TRUST_PROXY_HEADERS` note describes the same failure from the other side.

Nothing else argues for a proxy. CORS is already configured
(`ALLOWED_ORIGINS`, with `allow_credentials=False`), the anonymous endpoints
need no token, and there is therefore no secret that a server hop would keep
off the client.

### 3.2 The frontend performs no financial arithmetic

Every number rendered is a field on a response body. The frontend formats;
it does not calculate.

This is the engine/AI separation from `CLAUDE.md` extended one layer
outward, and it exists for the same reason: a wrong number here is a real
financial mistake for a user, not a cosmetic bug. The engine is the only
place in the system that does money arithmetic, and it is the only place
covered by golden fixtures, property invariants, and a closed-form oracle. A
subtraction performed in a React component has none of that behind it.

The rule has a concrete test. `ComparisonOut` carries six precomputed
deltas, every one of them nullable, because you cannot subtract from a plan
that never pays off. When `interest_saved_avalanche_vs_baseline` is `null`,
the UI renders an em dash. It does not reach for
`baseline.total_interest_paid - avalanche.total_interest_paid` to fill the
hole. That the two operands are sitting right there in the same object is
the temptation the rule exists to refuse.

Permitted browser-side numeric work, exhaustively:

- Converting the range input's value (numeric by nature) to a fixed
  two-decimal string.
- SVG geometry — mapping a month index and a balance to pixel coordinates.
- `Intl.NumberFormat` for display.

### 3.3 Money is a string from keystroke to wire

| Stage | Type | Rationale |
|---|---|---|
| Input element | `type="text"` `inputMode="decimal"` | `type="number"` returns a string regardless, and its stepper and locale parsing invite float thinking |
| React state | `string` | no parse, therefore no round-trip loss |
| Request body | `string` | the API returns 422 for a bare JSON number |
| Response | `string` | formatted from the string for display |

The backend's `_reject_json_numbers` validator explains why the wire format
is a string: `JSON.parse("1234.56")` yields an IEEE-754 double and 1234.56 is
not exactly representable, so accepting numbers would reintroduce floats at
the boundary of an engine whose entire discipline is excluding them. The
frontend's contribution is to never create the float in the first place — a
`parseFloat` on input followed by a `toFixed(2)` on output round-trips
incorrectly for values the engine handles exactly.

`apr` is a string on the wire too, for the same reason, even though it is
conceptually a rate rather than an amount.

### 3.4 Suppressed totals: fields that exist and are not answers

For a scenario with `outcome: "never_pays_off"`, the response still carries
populated `total_interest_paid` and `total_paid` fields. **The UI must not
render them.**

Those figures cover the simulated window — which terminates at the
`MAX_MONTHS = 1200` backstop or at the early-exit check — not a lifetime.
The seeded demo portfolio returns `total_interest_paid: "91219.95"` for its
baseline. Printed beside the words "never pays off," that is a falsely
bounded number: it invites the reader to treat roughly ninety-one thousand
dollars as the price of doing nothing, when the actual answer is that there
is no price because it does not end.

`guidance/presentation.py` already refuses to offer these as tokens, with
that reasoning in a comment at the point of the early return. If the UI
rendered them, the page would contradict the narrative printed next to it —
prose that carefully omits a figure, sitting beside a table that states it.

What the UI renders instead for such a scenario:

- The outcome, as words: *never pays off*.
- `underwater_debt_ids`, resolved to debt names, as the explanation of why.
- The chart track, clipped at the axis edge and labelled *still paying*.

Nothing else. `months_to_payoff` is `null` and `payoff_month` is `null`, so
those suppress themselves; the two money fields are the ones that require a
deliberate guard, and the guard belongs in the component that formats a
scenario rather than at each call site.

### 3.5 API types are generated from the OpenAPI schema

`openapi-typescript` as a dev dependency, a `gen:api` script reading the
running backend's `/openapi.json` into `lib/api-types.ts`, and that file
committed.

The backend asked for this. `schemas.py` carries a comment explaining that
`json_schema_input_type=str` is load-bearing specifically because "the
frontend's types are generated from that schema, so the published contract
would be a lie the compiler believes." Hand-writing the mirror would work
today and drift silently later: a renamed field would keep compiling and
fail at runtime, which is the failure mode the generated types exist to
convert into a build error.

Generation is a developer action, not a build step. Committing the output
means CI and Vercel builds do not need a running backend.

## 4. State and the request cycle

All state lives in `app/page.tsx`:

```ts
type DebtDraft = {
  id: string;              // client-generated, stable across edits
  name: string;
  balance: string;
  apr: string;
  minimum_payment: string;
};

const [debts, setDebts] = useState<DebtDraft[]>(SEED);
const [extra, setExtra] = useState<string>("200.00");
```

Every field is a string, per 3.3. `id` is what the response's `underwater_debt_ids` and
`debt_payoffs[].debt_id` are matched against to resolve display names. Seed
rows carry fixed literal ids (`visa`, `store`, `credit`) so the documented
figures in section 7 are reproducible; rows the user adds get
`crypto.randomUUID()`. Both satisfy `DebtIn.id`'s 1-64 character bound, and
ids are never reused after a row is deleted.

The cycle, in `lib/usePlan.ts`:

1. Any change to `debts` or `extra` schedules a request 250ms later.
2. The previous in-flight request is aborted via `AbortController`.
3. `start_month` is computed from `new Date()` as `YYYY-MM`.
4. `POST /v1/payoff-plans` without `?detail=full`.
5. On success, the plan replaces the previous one. On abort, nothing.

**Aborting is not an optimisation.** Without it, responses can resolve out of
order and paint a stale plan over a fresh one — a bug that is invisible with
a form-submit interaction and constant with a slider.

The last good plan stays rendered, at reduced opacity, while the next is in
flight. A chart that blanks between frames is unusable at drag speed, and
the empty-to-populated transition is far more distracting than a brief dim.

Local validation mirrors the API's bounds — balance and minimum in
`0 … 99999999.99`, APR in `0 … 999.99` at two decimal places, name 1–120
characters after trimming, at most 20 debts — purely to avoid a round trip
and a red banner for a typo. **The trust boundary is still the server.**
Client-side checks are a convenience layered on top of validation that
already exists and is tested; they never become the only check.

The portfolio and extra payment are written to `localStorage` on change and
restored on mount. A refresh should not destroy ten minutes of typing. This
is the only persistence in the slice, it is per-browser, and it is not a
substitute for the accounts feature.

## 5. Visual system

**Direction: escape velocity.** What an extra fifty dollars a month buys is
*time*, so time is the page's primary axis and the layout is organised
around a shared month scale rather than around cards or figures.

### 5.1 Palette

Cool early morning. Defined as CSS custom properties in `globals.css` and
exposed to Tailwind v4 through `@theme`.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--paper` | `#E8EBF0` | `#14161C` | page ground |
| `--ink` | `#1B2028` | `#E6E9EF` | all body and figure text |
| `--ink-soft` | `#59616F` | `#98A1B2` | labels, axis, captions |
| `--rule` | `#C8CEDA` | `#2C313C` | hairlines, gridlines |
| `--baseline` | `#7C8497` | `#98A1B2` | minimums-only track |
| `--snowball` | `#D98324` | `#E89A44` | snowball track |
| `--avalanche` | `#0E7C6B` | `#22A491` | avalanche track |

System preference only, via `prefers-color-scheme`. No toggle.

**Binding constraint: the three scenario colours are fill colours, never
small text.** `#D98324` on `#E8EBF0` measures roughly 2.6:1, well under the
4.5:1 floor for body text. Scenario labels are set in `--ink` with a colour
swatch or the track itself carrying the identity. The full palette is to be
run through the `dataviz` skill's contrast validator before implementation
and adjusted if any pair fails; this table is the starting point, not an
exemption.

### 5.2 Typography

| Role | Face | Setting |
|---|---|---|
| Display | Bricolage Grotesque | variable; wide width axis, tight tracking, used only for the page headline and scenario outcomes |
| Body | Instrument Sans | 1rem / 1.6 |
| Data | IBM Plex Mono | `font-variant-numeric: tabular-nums` |

Loaded through `next/font/google`, self-hosted at build time, so there is no
layout shift and no request to a third-party origin at runtime.

**Tabular numerals are load-bearing, not a refinement.** Every figure on the
page changes while the extra-payment slider is dragged. With proportional
digits, the numbers reflow on each frame and the whole results column
shimmers; with tabular figures, only the glyphs change and the layout holds
still. This is the single typographic decision that most affects whether the
core interaction feels solid.

Scale: display `clamp(2.5rem, 6vw, 4.5rem)`; figures `1.75rem` mono;
eyebrows `0.6875rem` mono, uppercase, `0.12em` tracking; body `1rem`.

### 5.3 Layout

At `≥1024px`, two columns: a fixed left rail of about 380px holding the debt
table and the extra-payment control, and a right column holding the chart,
the three scenario summaries, and the narrative in that order.

Below 1024px, a single column with inputs first. The chart keeps its
horizontal tracks — rotating them would abandon the direction — but
compresses the month axis and moves payoff markers beneath each track label
rather than inline.

Restraint is the rule everywhere outside the chart: no shadows, no
gradients, no rounded cards competing for attention. One element carries the
personality of the page and everything else stays quiet enough to let it.

## 6. The escape chart

The signature element. Hand-rolled SVG in `components/EscapeChart.tsx`; no
charting library. The behaviour that matters — a track that exceeds the axis
and fades off the edge — is custom regardless, and the rest is three paths
and a set of gridlines.

Three horizontal wedges share one month axis. A wedge's height at month *m*
is proportional to that scenario's `remaining_balance` at *m*, read from
`monthly_totals`. The shape is therefore the data tapering to zero, not a
bar decorated to resemble one.

The seeded portfolio of section 7, starting `2026-09`, renders as:

```
        2027         2028         2029              →
        ├────────────┼────────────┼─────────────────
DO      ███████████████████████████████████▓▓▓▒▒▒░░░
NOTHING                              still paying →

SNOW    ██████████████████████████▄▄▄▄▄▖
BALL                            ● Sep 2029 · $4,394 interest

AVA     ████████████████████████▄▄▄▄▖
LANCHE                        ● Jul 2029 · $3,860 interest
```

**The x-domain runs from month 1 to 1.15 x the furthest finite payoff**,
rounded up to a whole year. A scenario that never pays off, or that simply
runs past that domain, is clipped at the right edge under a mask-driven
opacity fade and labelled *still paying*.

If no scenario pays off, there is no finite anchor; the domain falls back to
120 months and all three tracks clip. The label still reads *still paying*
for each, which is the correct and complete answer.

This is the design's whole argument. `months_to_payoff: null` is the most
important thing the engine can tell a user, and in most calculators it is an
absence — a blank cell, a dash, an error. Here it is the longest mark on the
page, and the only one that does not end.

`monthly_totals` is present on the default response, so the wedges cost no
extra request and no `?detail=full`. A baseline can carry several hundred
rows; the path is simplified to at most one point per rendered pixel column
before being written to `d`.

Motion: wedge geometry transitions over ~120ms on plan change, disabled
entirely under `prefers-reduced-motion`.

Accessibility: the SVG is `role="img"` with an `aria-label` summarising the
three outcomes. It is not the accessible path to the data — every figure it
displays also exists as real text in the scenario summaries below, which is.

## 7. The seeded demo portfolio

The page loads with a sample portfolio, marked as an example, with every
field editable in place. A chart-led hero with nothing to chart is a dead
first impression, and the drag interaction teaches itself far better than a
caption does.

The sample numbers are a design decision, not filler: the seed must produce
a **never-paying-off baseline**, or the signature element is invisible until
the user has done real work. Verified against the engine:

| Debt | Balance | APR | Minimum |
|---|---|---|---|
| Visa Signature | 6120.00 | 24.99 | 122.40 |
| Store card | 1840.00 | 27.99 | 46.00 |
| Credit union | 3250.00 | 14.50 | 65.00 |

At the default extra payment of `200.00`:

| Scenario | Outcome | Months | Interest |
|---|---|---|---|
| Minimums only | never pays off | — | suppressed (3.4) |
| Snowball | paid off | 37 | 4394.32 |
| Avalanche | paid off | 35 | 3859.60 |

`underwater_debt_ids` is `["visa"]` — the Visa's 2% minimum sits just under
its 2.0825% monthly interest, which is an unremarkable real-world card and
exactly why the baseline matters. Avalanche saves 534.72 and two months
against snowball, so the strategy comparison is also non-trivial on first
paint.

Note that `interest_saved_avalanche_vs_baseline` is `null` here. **The
headline comparison against the baseline is unavailable in precisely the
case the product exists to dramatise.** The UI must therefore not be built
around a "you save $X versus doing nothing" figure; the comparison it can
always make is qualitative — a date against the absence of one — and that is
what the chart shows.

## 8. Narrative

`POST /v1/payoff-plans/explain` fires **once**, when the first plan of a
session arrives, and thereafter only when the user asks for it explicitly
via an *Explain again* control.

The endpoint allows ten requests per hour per IP. Firing it on the debounced
change stream would exhaust that inside a minute of dragging the slider, and
would be pointless besides: generation takes seconds, so every response
would describe a portfolio the user had already moved past.

Rendering rules:

- **Plain text into a `<p>`.** Never `dangerouslySetInnerHTML`. The response
  is prose assembled by substituting server-side values into a model-written
  template; it is not markup and must not be parsed as any.
- `source: "template"` is labelled honestly and quietly. It is the correct
  deterministic fallback, not a degraded state, and styling it as an error
  would misrepresent it.
- A failed or aborted call leaves the previous narrative in place and never
  blocks or dims the plan. The plan is the product; the prose is a layer on
  top of it, which is why the API returns them separately.
- While the first generation is in flight, a skeleton holds the space so the
  page does not reflow when several hundred words arrive.

## 9. Quality floor

Not negotiable, and not announced in the UI:

- Responsive to 360px.
- Visible keyboard focus on every interactive element; the extra-payment
  control is a native `<input type="range">`, so arrow-key adjustment and
  screen-reader semantics come free rather than being reimplemented.
- `prefers-reduced-motion` respected by the chart and every transition.
- Every debt row's inputs are labelled; the table is a real `<table>` with
  header cells, not a grid of divs.
- Colour is never the only carrier of meaning — each scenario is named in
  text beside its track.

## 10. Test strategy

One Vitest file, `lib/api.test.ts`, covering the two things whose failure is
silent and expensive:

- **`buildRequest()`** — every money field leaves as a `string`, never a
  number; `start_month` matches `YYYY-MM`; the shape matches
  `PayoffPlanRequest` exactly, including `extra="forbid"` meaning no stray
  keys.
- **`format.ts`** — money strings render correctly, including values that a
  float round-trip would corrupt, and the suppression rule of 3.4 returns
  nothing rather than a formatted figure for a never-paying-off scenario.

No component tests and no Playwright in this slice. The engine's correctness
is already covered by four layers of tests on the other side of the wire;
what the frontend can uniquely break is the money-as-string discipline and
the suppression rule, and those are unit-testable pure functions.

## 11. Configuration

```
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

Kept in `frontend/.env.example`. The backend already permits
`http://localhost:3000` by default via `ALLOWED_ORIGINS`, so local
development needs no backend configuration change. Deployed previews require
their own origin added to `ALLOWED_ORIGINS` on the API, which the backend's
own comment anticipates.

TypeScript strict mode on, no implicit `any`, per `CLAUDE.md`.

## 12. File layout

```
frontend/
  app/
    layout.tsx              fonts, metadata
    page.tsx                the single route; owns all state
    globals.css             tokens, Tailwind v4 @theme
  components/
    DebtTable.tsx           editable rows, add and remove
    ExtraPayment.tsx        native range plus text amount
    EscapeChart.tsx         three wedges on a month axis
    ScenarioSummary.tsx     one scenario's figures, with 3.4 suppression
    Narrative.tsx           prose, source label, explain-again
  lib/
    api.ts                  buildRequest, fetchPlan, fetchExplanation
    api-types.ts            generated; do not edit
    format.ts               money and month formatting
    usePlan.ts              debounce, abort, localStorage
```

No component library. The controls this design needs are a text input, a
range input, and a button; installing a registry to supply what the platform
already ships would add a dependency and a theming layer for nothing.

## 13. Deferred

- Supabase Auth and the `/v1/debts` screens, including the question of
  migrating a locally-entered portfolio into an account on signup.
- The `?detail=full` month-by-month schedule view.
- `POST /ask` follow-up questions, which are not built on the backend.
- "How much extra would I need?" — the binary search over `simulate` noted
  as deferred in the engine design. It is the natural next control on this
  page once it exists, and the extra-payment slider is where it belongs.
