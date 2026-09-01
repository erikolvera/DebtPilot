# AI guidance layer — design

**Date:** 2026-09-01
**Status:** Approved, ready for implementation planning
**Scope:** One endpoint, `POST /v1/payoff-plans/explain`, returning a
plain-language narrative of a payoff comparison. Gemini behind a provider
interface, grounded so the model cannot state a number the engine did not
compute.
**Depends on:** the engine, the stateless payoff API, and the persistence
layer — all complete and merged.

## 1. Purpose

Turn three columns of numbers into a sentence someone acts on. The engine can
already tell a user that avalanche costs $3,140.22 less than snowball and
finishes seven months sooner; what it cannot do is say so in a way that lands.

The layer's entire design follows from one constraint, stated in `CLAUDE.md`
before any AI code existed: **the AI layer never performs financial
calculations.** It receives already-computed numbers and describes them. This
document is mostly about making that enforceable rather than aspirational.

## 2. Non-goals

- **`POST /ask`**, the scoped follow-up question. It accepts arbitrary user
  text, which is a threat surface this codebase has not yet faced, and it
  needs its own conversation about injection, scoping and conversation state.
  Bundling it here would crowd out the questions that matter for `/explain`.
- **Saved plans.** `CLAUDE.md` sketches `/payoff-plans/{id}/explain`, but
  plans are still not persisted, so there is no id to hang the route off.
- **Streaming.** Worth revisiting when the frontend exists and can show
  partial text; it changes the response contract, so it is not free.

## 3. Settled decisions

Four decisions were made during design. Do not relitigate them during
implementation; if one proves wrong, amend this document first.

### 3.1 A separate endpoint that recomputes

`POST /v1/payoff-plans/explain` accepts the same request body as
`POST /v1/payoff-plans`, recomputes the comparison server-side, and returns
only the narrative. The client calls both: it renders the plan immediately and
fills the prose in when it arrives.

The engine computes a plan in under a millisecond; a Gemini call takes
seconds. Folding them into one request makes every user wait on the slow half
to see the fast half, for a number that was ready almost instantly. Separating
them also isolates failure: an outage at Gemini costs a paragraph rather than
the plan itself.

The recomputation that looks wasteful is the point. Having the client post
back the comparison it already holds would avoid it, but then the model
narrates client-supplied figures, and a client that edits the payload gets the
AI to state numbers the engine never produced. That voids the guarantee this
architecture exists to make. Recomputing costs microseconds and keeps the
engine the only source of numbers.

### 3.2 Placeholder substitution, not post-hoc auditing

The model returns prose containing tokens — `{interest_saved_avalanche_vs_snowball}` —
and the server substitutes real values afterwards.

The alternative, letting the model write freely and then extracting every
number to check against an allowlist, fails on good prose. "Just over three
years" and "about $3,100" are the phrasings you want, and no allowlist of
exact values accepts them; the check ends up rejecting the best output.

Substitution makes a wrong number impossible rather than detectable, which is
the same move the engine made with `Outcome` and the API made with the `Money`
type. It also makes the layer testable without a network: a provider returning
a fixed template exercises the whole substitution and validation path.

The cost is real and shapes section 4: the model can only phrase what the
token set allows, so the values must be pre-formatted for prose and the prompt
must list exactly what exists.

### 3.3 Anonymous, with a rate limit

`/explain` requires no authentication, matching the stateless plan endpoint.

The anonymous path exists because asking for card balances before showing any
value is a trust barrier — and the narrative *is* the value. "Avalanche saves
you $3,140.22 and clears this seven months sooner" is the sentence that
changes behaviour; the table alone does not say it. Gating that is gating the
pitch.

Serving the template to anonymous users and the model to signed-in ones was
considered and rejected: visibly worse output at the exact moment you are
asking for trust reads as a bait-and-switch. If the template is good enough
for strangers it is good enough as everyone's fallback; if it is not, it
should not be the anonymous experience.

Requiring authentication is the safe operational answer and is the thing to
revisit if abuse appears. Designing for an attacker who does not exist yet, at
the cost of the feature's main use, is the wrong trade this early.

### 3.4 A pipeline of pure functions around one impure call

```
backend/app/api/guidance/
  presentation.py   PlanComparison -> dict[str, str], formatted   [pure]
  prompt.py         presentation dict -> prompt text              [pure]
  provider.py       Provider protocol, GeminiProvider, TemplateProvider
  render.py         template + presentation -> narrative, or reject [pure]
  service.py        orchestration and fallback policy
```

Almost none of this layer is about the LLM. Formatting values, building a
prompt, validating tokens and substituting them are all pure functions over
data; the model call is one impure function in the middle. The structure keeps
that ratio honest, so roughly ninety per cent of the code is tested with no
network, no stub and no nondeterminism.

`provider.py` is the swappable boundary `CLAUDE.md` asks for and the only file
that touches the network. `render.py` holds the security-relevant logic and is
a pure function that can be hammered with adversarial input in microseconds.

A single guidance module was the main alternative. It is defensible at this
size, but the substitution validator would become a private helper inside a
module that also orchestrates I/O, and that validator is where an injection or
malformed-token bug would live.

## 4. The presentation dictionary

`presentation.py` turns a `PlanComparison` into `dict[str, str]`, every value
pre-formatted for prose, keys mirroring the engine's field names one-for-one
so any token is traceable to its source.

**The token set is computed per request.** When a portfolio never pays off,
`baseline_months` is null — and rather than offering a token that renders
"N/A", the token is simply absent. The prompt lists only what exists for this
request, so the model cannot reference a number that is not there. The
never-pays-off case stops being a special case in the prose and becomes an
absence in the vocabulary.

Per scenario, prefixed `avalanche_`, `snowball_`, `baseline_`:

| Token | Example |
|---|---|
| `{x}_outcome` | `pays off` / `never pays off` |
| `{x}_months` | `14 months` — omitted when never pays off |
| `{x}_payoff_month` | `October 2027` — omitted when never pays off |
| `{x}_total_interest` | `$412.88` — omitted when never pays off |
| `{x}_total_paid` | `$2,912.88` — omitted when never pays off |

The totals are omitted for a never-paying-off scenario for a specific reason.
`PlanSummary` reports them over the *simulated window*, which for such a run is
one month or twelve hundred — not a lifetime figure. Offered as a token, the
model would write "you would pay $20.00 in interest" about a debt that never
clears, which is both wrong and reassuring in the worst possible direction.
`{x}_outcome` is all that remains, and "never pays off" is the whole story
anyway.

`first_cleared_name` and `first_cleared_month` are likewise omitted whenever
the avalanche plan clears no debts — a portfolio that never pays off, or an
empty one.

The six deltas, each omitted when the engine's value is null:
`interest_saved_avalanche_vs_snowball`, `interest_saved_avalanche_vs_baseline`,
`interest_saved_snowball_vs_baseline`, and the three `months_saved_*`
equivalents.

Context tokens: `debt_count` (`2 debts`), `total_balance` (`$2,500.00`),
`extra_payment` (`$200.00`), `first_cleared_name` (`Store card`),
`first_cleared_month` (`May 2027`).

Around twenty-five tokens at most.

**Money is exact, with separators.** `$3,140.22`, not `$3,140`. Rounded
variants would let the model write "about $3,100", but they double the
vocabulary for stylistic gain, and precision is the engine's whole discipline.
Adding them later is additive if the copy reads stiffly.

**Months stay months.** `14 months`, not `1 year and 2 months`. Two spellings
of one value is two tokens the model can disagree with itself about. Paired
with `payoff_month`, the natural sentence is already available: "clears in 14
months, by October 2027."

**`first_cleared_name` comes from the avalanche plan.** The first debt to
disappear is the most motivating fact in the comparison and the one a table of
totals does not surface. It is also the only token carrying user-typed text,
which section 6 handles specifically.

## 5. The prompt and the model's contract

### 5.1 What the model receives

The prompt carries token names and, for computed tokens, their actual values.
The model needs the values to make editorial judgments — whether this user is
in good shape or genuinely stuck, which comparison deserves the headline,
whether "never pays off" is the story. A model writing blind produces generic
copy.

**User-supplied text is excluded.** For `first_cleared_name` the prompt
carries the token name and a one-line description of what it means, never its
content. Section 6 explains why.

### 5.2 What it returns

A JSON object with two fields:

```json
{
  "headline": "Avalanche clears your debt {months_saved_avalanche_vs_baseline} sooner than doing nothing.",
  "body": "You have {debt_count} totalling {total_balance}. Paying {extra_payment} extra each month..."
}
```

Two fields rather than one blob so the UI can style the headline distinctly,
and rather than five because more structure invites padding. Gemini's
`response_mime_type: application/json` with a schema makes the shape a
guarantee rather than a hope.

### 5.3 What the prompt forbids

Four rules, stated plainly and repeated in the schema description:

1. Never write a number, date or amount. Use the tokens. Any digit in the
   output invalidates the response.
2. Only the listed tokens exist. Using another invalidates the response.
3. Describe the figures; do not derive new ones. Every saving and difference
   is already computed. `CLAUDE.md`'s formulation goes in verbatim: *describe
   these figures, never work out the difference.*
4. These are estimates and this is not financial advice. Monthly compounding
   slightly understates real interest, so the copy says "estimated" rather
   than implying precision, and it does not tell anyone what to do with their
   money.

### 5.4 Settings

Temperature 0.2. Low enough that the same portfolio produces broadly stable
copy — a user who recomputes should not watch the narrative rewrite itself —
but not zero, which tends toward stilted repetition across different
portfolios.

## 6. Rendering, validation and containment

### 6.1 Injection is designed out, not mitigated

The model never needs to see a debt name. It writes `{first_cleared_name}`
without knowing whether that says "Visa" or "Ignore previous instructions",
because only the substitution step, after the model is finished, touches the
user's text.

The rule for the prompt is therefore: computed values go in, user-supplied
text does not. With no untrusted text in the prompt, injection is not
mitigated so much as made impossible. No amount of instruction-writing
reliably stops a determined injection; removing the input does.

### 6.2 The validation chain

`render.py`, in order. Each step rejects rather than repairs:

1. **Parse the JSON.** The schema makes the shape near-certain; validating
   anyway costs nothing, and the failure is otherwise an `AttributeError` deep
   inside substitution.
2. **Reject any digit** in `headline` or `body`. Every token name is
   alphabetic and every number arrives through substitution, so a single digit
   means the model wrote a literal figure. One check retires the entire
   ungrounded-number class — no allowlist, no fuzzy matching, no arguing about
   whether "about $3,100" is close enough.
3. **Extract tokens** with `\{([a-z_]+)\}`.
4. **Reject any unknown token** — anything not a key of this request's
   presentation dictionary. This is what stops the model referencing
   `baseline_months` for a portfolio that never pays off.
5. **Substitute.**
6. **Reject any brace the token pattern did not account for** — checked on the
   template, before substitution, by confirming that removing every matched
   token leaves no `{` or `}` behind. A leftover brace means a malformed or
   nested token, and shipping it would leak template syntax to the user.

   The ordering matters. Run this check *after* substitution instead and a
   debt legitimately named `{savings}` would be flagged as malformed, so a
   user's own data could suppress their narrative. Checking the template
   settles the question before any user text is present.

Every step is a pure function over strings.

### 6.3 Output containment

Debt names arrive capped at 120 characters and NUL-free from the request
schemas. The substituted value is additionally stripped of control characters.

**The response is plain text, and clients must not render it as HTML.** That
is a contract note rather than a code change, and it belongs in the README
beside the endpoint.

Substitution happens after token extraction, so a debt name that itself
contains braces is inserted as literal text and never re-scanned.

## 6.4 The empty portfolio short-circuits

A request with no debts returns a fixed sentence without calling the model at
all. There is nothing to compare, every interesting token is absent, and a
paid API call to narrate an empty table is waste. The response still carries
`source`, reported as `"template"`.

## 7. Failure policy

`/explain` does not return 5xx for a model problem.

| Situation | Response |
|---|---|
| Validation fails | one retry, then the template |
| Provider errors, times out, or is rate-limited | the template |
| No API key configured | the template |
| Model succeeds and validates | the model's narrative |

`TemplateProvider` is a hand-written narrative using the same tokens and the
same substitution path. It is plain, it is correct, and it means local
development works with no credentials.

The response carries a `source` field, `"model"` or `"template"`. A UI that
cannot tell which it received cannot decide whether to show a "generated"
label, and silently degrading is the kind of thing that should be visible in
logs.

## 8. Provider interface

```python
class Provider(Protocol):
    def generate(self, prompt: str) -> str: ...
```

One method, string in, string out. `GeminiProvider` wraps the SDK with the
JSON schema and a timeout; `TemplateProvider` ignores the prompt and returns
the hand-written template. Adding a provider is one new class, with no
branching anywhere else.

Selection is by environment: `GEMINI_API_KEY` present means Gemini, absent
means template. Not a `PROVIDER=` setting, because a missing key alongside
`PROVIDER=gemini` is a configuration error discovered in production, whereas
"no key, no calls" is unambiguous.

## 9. Rate limiting

A small in-memory per-IP limiter, ten requests per hour, and honest
documentation of what it is not.

The limit applies to every request, including those served by the template
provider. Making it conditional on a paid call would mean the limit disappears
whenever the key is missing or Gemini is down — exactly when the endpoint is
cheapest to hammer — and the branch buys nothing.

It does not survive a restart, it does not coordinate across instances, and
anyone with several IP addresses defeats it. Its actual job is stopping a loop
in a frontend from spending a fortune overnight, and it does that.

**The real ceiling is a spend limit configured in the Gemini console**, and
the README says so. An application-level limit cannot protect against a bug in
the application.

## 10. Test strategy

| File | Needs | Proves |
|---|---|---|
| `test_presentation.py` | nothing | formatting; tokens omitted when values are null |
| `test_prompt.py` | nothing | no user text in the prompt; the token list is complete |
| `test_render.py` | nothing | the six-step chain, adversarially |
| `test_template_provider.py` | nothing | the fallback is complete and grounded |
| `test_routes_explain.py` | `TestClient` | status codes, `source`, the rate limit |

`TemplateProvider` is not a test double that happens to ship. It is a real
implementation the tests happen to use, exercised in production whenever
Gemini is unavailable — so the tests exercise the same path production does,
rather than proving a fake works.

**The test least worth losing:** every token `TemplateProvider` emits must
exist in the presentation dictionary for every scenario shape — paid off,
never pays off, empty portfolio. That is the fallback's version of the
grounding guarantee, and without it the safety net has a hole in exactly the
situation it exists to cover.

**Adversarial cases for `render.py`:** literal digits, unicode digits such as
`٣`, unknown tokens, `{{nested}}`, unclosed braces, a token named after a
dunder, an empty body, and a debt name containing braces — that last because
it enters after token extraction and must not be re-substituted.

**Gemini is never called in tests.** `GeminiProvider`'s single HTTP call is
stubbed, exactly as the JWKS fetch is in the auth layer: same principle, same
justification, and the only network boundary in the layer.

The coverage gate stays at 100% across `app`.

## 11. Configuration

`GEMINI_API_KEY` is a new secret. `.env.example` gains it with a comment
saying that leaving it unset selects the template provider, which is the
intended local-development path.

## 12. Deferred

- `POST /ask`, with its own design for injection, scoping and conversation
  state.
- Saved plans, and the `payoff_plans` schema question.
- Streaming responses.
- Caching narratives by request hash. Responses are a pure function of the
  request, so it is possible; nothing yet needs it.
