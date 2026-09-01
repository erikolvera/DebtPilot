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

  // Props are read through a ref so `ask` has a STABLE identity. If `ask`
  // depended on `debts`/`extra`, the mount effect below would depend on them
  // too, and any edit while the one auto-request is in flight — the normal
  // case, since generation takes seconds and the user is still typing — would
  // run the previous cleanup (aborting the live request), re-enter, find
  // `askedOnce` already set, and return WITHOUT starting a replacement.
  // `loading` would then stay true forever: the skeleton never resolves and
  // "Explain again" stays disabled, with no recovery short of a remount.
  const latest = useRef({ debts, extra });
  useEffect(() => {
    latest.current = { debts, extra };
  });

  const ask = useCallback(() => {
    const { debts, extra } = latest.current;
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
  }, []);

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
