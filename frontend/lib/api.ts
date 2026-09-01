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
