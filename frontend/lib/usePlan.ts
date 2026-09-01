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
