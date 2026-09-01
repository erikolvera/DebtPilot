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

  const ask = useCallback(() => {
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
  }, [debts, extra]);

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
