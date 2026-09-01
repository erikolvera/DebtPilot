"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  buildFinancialReportRequest,
  fetchFinancialReport,
  isAbort,
  type ExpenseDraft,
  type FinancialDebtDraft,
  type FinancialReportResponse,
  type IncomeDraft,
} from "./api";
import { isFinancialReportSendable } from "./validate";

const DEBOUNCE_MS = 250;

type ReportState = {
  report: FinancialReportResponse | null;
  pending: boolean;
  stale: boolean;
  error: string | null;
};

function describe(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 422) {
    return "One of the highlighted entries is not accepted by the report.";
  }
  if (cause instanceof ApiError && cause.status === 413) {
    return "This profile is too large to analyze in one request.";
  }
  if (cause instanceof Error && cause.name === "TimeoutError") {
    return "The report is taking too long. Your entries are still here.";
  }
  return "The report service is unavailable. Your entries are still here.";
}

export function useReport(
  incomes: IncomeDraft[],
  expenses: ExpenseDraft[],
  debts: FinancialDebtDraft[],
  extra: string,
): ReportState {
  const sendable = isFinancialReportSendable(incomes, expenses, debts, extra);
  const request = useMemo(
    () =>
      sendable
        ? buildFinancialReportRequest(incomes, expenses, debts, extra)
        : null,
    [debts, expenses, extra, incomes, sendable],
  );
  const signature = useMemo(
    () => (request === null ? null : JSON.stringify(request)),
    [request],
  );
  const [report, setReport] = useState<FinancialReportResponse | null>(null);
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (request === null || signature === null) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInFlight(true);

    const timer = setTimeout(() => {
      fetchFinancialReport(request, controller.signal)
        .then((next) => {
          setReport(next);
          setReportFor(signature);
          setError(null);
          setInFlight(false);
        })
        .catch((cause: unknown) => {
          if (isAbort(cause)) return;
          setError(describe(cause));
          setInFlight(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [request, signature]);

  return {
    report,
    pending: inFlight && sendable,
    stale: report !== null && reportFor !== signature,
    error,
  };
}
