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
  if (cause instanceof Error && cause.name === "TimeoutError") {
    return "The planner is taking too long. Your numbers are still here.";
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
  const [inFlight, setInFlight] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // `pending` is derived, not stored: a portfolio that is mid-edit or empty has
  // no request to wait for, so the bail branch below needs no state write at all.
  const pending = inFlight && isSendable(debts, extra);

  useEffect(() => {
    if (!isSendable(debts, extra)) {
      // Mid-edit or empty. Keep the last good plan on screen; there is nothing
      // useful to ask for and a 422 would read as a server fault.
      return;
    }

    const controller = new AbortController();
    // A new sendable value means a new request is about to start, so the
    // loading flag must flip back on synchronously here — there is no
    // external event to react to later that would do it instead.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInFlight(true);

    const timer = setTimeout(() => {
      fetchPlan(buildRequest(debts, extra), controller.signal)
        .then((next) => {
          setPlan(next);
          setError(null);
          setInFlight(false);
        })
        .catch((cause: unknown) => {
          // An abort means a newer request is already in flight. Leaving
          // `pending` set is correct — the newer effect owns it now. Without
          // this guard, responses resolve out of order and a stale plan paints
          // over a fresh one: invisible with a submit button, constant with a
          // slider.
          if (isAbort(cause)) return;
          setError(describe(cause));
          setInFlight(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [debts, extra]);

  return { plan, pending, error };
}
