import { ApiError } from "./api";

export type ReportErrorKind = "validation" | "too_large" | "timeout" | "service";

export type ReportError = {
  kind: ReportErrorKind;
  message: string;
};

export function describeReportError(cause: unknown): ReportError {
  if (cause instanceof ApiError && cause.status === 422) {
    return {
      kind: "validation",
      message: "One of the highlighted entries is not accepted by the report.",
    };
  }
  if (cause instanceof ApiError && cause.status === 413) {
    return {
      kind: "too_large",
      message: "This profile is too large to analyze in one request.",
    };
  }
  if (cause instanceof Error && cause.name === "TimeoutError") {
    return {
      kind: "timeout",
      message: "The report is taking too long. Your entries are still here.",
    };
  }
  return {
    kind: "service",
    message: "The report service is unavailable. Your entries are still here.",
  };
}

type EmptyReportCopy = {
  title: string;
  detail: string;
};

export function emptyReportCopy(
  pending: boolean,
  error: ReportError | null,
): EmptyReportCopy {
  if (pending) {
    return {
      title: "Calculating your report.",
      detail: "This usually takes only a moment.",
    };
  }
  if (error?.kind === "service" || error?.kind === "timeout") {
    return {
      title: "We could not calculate your report.",
      detail: "Try again shortly. You do not need to re-enter your plan.",
    };
  }
  if (error?.kind === "too_large") {
    return {
      title: "This plan is too large to calculate at once.",
      detail: "Return to the planner and reduce the number of entries.",
    };
  }
  return {
    title: "Your report needs complete entries.",
    detail: "Return to the planner and fix the highlighted fields.",
  };
}

type AffordabilityPresentation = {
  showCurrentReport: boolean;
  status: string | null;
};

export function affordabilityPresentation({
  sendable,
  pending,
  stale,
  error,
}: {
  sendable: boolean;
  pending: boolean;
  stale: boolean;
  error: ReportError | null;
}): AffordabilityPresentation {
  if (!sendable) {
    return {
      showCurrentReport: false,
      status: "Fix the highlighted entries to update what your budget supports.",
    };
  }
  if (error !== null) {
    return { showCurrentReport: false, status: error.message };
  }
  if (pending || stale) {
    return {
      showCurrentReport: false,
      status: "Updating what your budget supports…",
    };
  }
  return { showCurrentReport: true, status: null };
}
