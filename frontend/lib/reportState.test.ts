import { describe, expect, test } from "vitest";
import { ApiError } from "./api";
import {
  affordabilityPresentation,
  describeReportError,
  emptyReportCopy,
  type ReportError,
} from "./reportState";

const SERVICE_ERROR: ReportError = {
  kind: "service",
  message: "The report service is unavailable. Your entries are still here.",
};

describe("describeReportError", () => {
  test("classifies validation and payload errors", () => {
    expect(describeReportError(new ApiError(422, "invalid")).kind).toBe("validation");
    expect(describeReportError(new ApiError(413, "large")).kind).toBe("too_large");
  });

  test("classifies timeouts separately from other service failures", () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    expect(describeReportError(timeout).kind).toBe("timeout");
    expect(describeReportError(new Error("offline")).kind).toBe("service");
  });
});

describe("emptyReportCopy", () => {
  test("does not blame valid entries for a service failure", () => {
    const copy = emptyReportCopy(false, SERVICE_ERROR);
    expect(copy.title).toBe("We could not calculate your report.");
    expect(copy.detail).not.toMatch(/highlighted fields/i);
  });

  test("directs validation failures back to highlighted fields", () => {
    const error = describeReportError(new ApiError(422, "invalid"));
    expect(emptyReportCopy(false, error).detail).toMatch(/highlighted fields/i);
  });

  test("gives an in-progress request priority over an earlier error", () => {
    expect(emptyReportCopy(true, SERVICE_ERROR).title).toBe("Calculating your report.");
  });
});

describe("affordabilityPresentation", () => {
  test("withholds stale figures while a replacement is calculated", () => {
    expect(
      affordabilityPresentation({
        sendable: true,
        pending: true,
        stale: true,
        error: null,
      }),
    ).toEqual({
      showCurrentReport: false,
      status: "Updating what your budget supports…",
    });
  });

  test("withholds old figures after a failed replacement", () => {
    expect(
      affordabilityPresentation({
        sendable: true,
        pending: false,
        stale: true,
        error: SERVICE_ERROR,
      }),
    ).toEqual({
      showCurrentReport: false,
      status: SERVICE_ERROR.message,
    });
  });

  test("shows figures only when they match the current valid inputs", () => {
    expect(
      affordabilityPresentation({
        sendable: true,
        pending: false,
        stale: false,
        error: null,
      }),
    ).toEqual({ showCurrentReport: true, status: null });
  });
});
