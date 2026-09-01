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
export type MonthlyTotalOut = ScenarioOut["monthly_totals"][number];

/** A row as the user is editing it. Every field is a string; see spec §3.3. */
export type DebtDraft = {
  id: string;
  name: string;
  balance: string;
  apr: string;
  minimum_payment: string;
};

export const DEFAULT_API_BASE = "http://127.0.0.1:8000";
export const REQUEST_TIMEOUT_MS = 15000;

/**
 * The API origin, normalised.
 *
 * `??` alone is not enough. An env var set to an empty string — trivially easy
 * to do in a Vercel dashboard — IS a string, so it passes the nullish check and
 * every request becomes a relative path: silently wrong anywhere the page is
 * not served from the API's own origin, and it fails as a confusing 404 rather
 * than a missing-configuration error. `||` catches it. The trailing-slash strip
 * is the other half: `https://api.example.com/` would otherwise produce
 * `https://api.example.com//v1/payoff-plans`.
 */
export function apiBase(
  raw: string | undefined = process.env.NEXT_PUBLIC_API_BASE_URL,
): string {
  const trimmed = raw?.trim();
  // A blank var is inlined at build time, so a production build made without
  // it would silently ship pointing at localhost -- every user's requests
  // would leave for their own machine, and no runtime env change could ever
  // repair the already-built artifact. Failing loudly at deploy beats every
  // user silently getting a connection error.
  if (!trimmed && process.env.NODE_ENV === "production") {
    throw new Error(
      "NEXT_PUBLIC_API_BASE_URL is not set. Set it before building for production.",
    );
  }
  // The second fallback is not redundant. A lone "/" is truthy, so it survives
  // the first one, and stripping its trailing slash leaves "" -- landing on the
  // exact relative-path failure this function exists to prevent.
  const base = (trimmed || DEFAULT_API_BASE).replace(/\/+$/, "");
  return base || DEFAULT_API_BASE;
}

const BASE = apiBase();

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
    // A caller's controller only fires on supersede or unmount, so a request
    // that hangs never terminates. AbortSignal.timeout throws TimeoutError, NOT
    // AbortError, so `isAbort` returns false and it lands in the error branch
    // and becomes visible -- which is exactly right. A superseded request still
    // throws AbortError and still stays silent.
    signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
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
