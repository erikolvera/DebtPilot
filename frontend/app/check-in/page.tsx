"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  buildFinancialReportRequest,
  currentStartMonth,
  fetchFinancialReport,
  isAbort,
  type FinancialDebtDraft,
  type FinancialReportResponse,
} from "@/lib/api";
import {
  commitmentSentence,
  commitmentSuggestions,
  isPositiveMoney,
  MILESTONE_LABELS,
  progressCopy,
  type CheckInCommitment,
} from "@/lib/checkIn";
import {
  browserCheckInStorage,
  clearCheckInState,
  emptyCheckInState,
  latestCheckIn,
  loadCheckInState,
  progressContextFor,
  recordCheckIn,
  saveCheckInState,
  type CheckInSnapshot,
  type CheckInState,
} from "@/lib/checkInStorage";
import { calendarMonth, money } from "@/lib/format";
import { effectiveStrategy } from "@/lib/payoffGuidance";
import { describeReportError } from "@/lib/reportState";
import { useFinancialProfile } from "@/lib/useFinancialProfile";
import { debtErrors, isFinancialReportSendable } from "@/lib/validate";

type Feeling = "overwhelming" | "manageable" | "ready" | "skip";
type FollowThrough = "completed" | "partly" | "not_this_month" | "skip";

const FEELINGS: Array<[Feeling, string]> = [
  ["overwhelming", "Overwhelming"],
  ["manageable", "Manageable"],
  ["ready", "Ready to focus"],
  ["skip", "Skip"],
];
const FOLLOW_THROUGH: Array<[FollowThrough, string]> = [
  ["completed", "Completed"],
  ["partly", "Partly"],
  ["not_this_month", "Not this month"],
  ["skip", "Skip"],
];

function supportCopy(feeling: Feeling | null, followThrough: FollowThrough | null): string {
  if (feeling === "overwhelming") {
    return "We’ll keep this short: update the balances, then choose only one next step.";
  }
  if (followThrough === "not_this_month") {
    return "A plan is allowed to change. Updating it now is a useful next step.";
  }
  if (followThrough === "partly") {
    return "Partial follow-through still gives you something real to build on.";
  }
  if (followThrough === "completed") {
    return "You followed through. Let’s use the current balances for what comes next.";
  }
  if (feeling === "ready") {
    return "Let’s turn that focus into one sustainable action for this month.";
  }
  return "There is no score here—just a current picture and a workable next step.";
}

function selectedPayoffMonth(
  report: FinancialReportResponse,
  preferred: "snowball" | "avalanche" | null,
): { strategy: "snowball" | "avalanche" | null; payoffMonth: string | null } {
  if (report.payoff_plan === null) return { strategy: null, payoffMonth: null };
  const strategy = effectiveStrategy(
    preferred,
    report.payoff_guidance?.recommended_strategy ?? null,
  );
  return {
    strategy,
    payoffMonth: report.payoff_plan.scenarios[strategy].payoff_month,
  };
}

export default function CheckInPage() {
  const { profile, ready, setDebts } = useFinancialProfile();
  const [history, setHistory] = useState<CheckInState>(emptyCheckInState());
  const [draftDebts, setDraftDebts] = useState<FinancialDebtDraft[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [feeling, setFeeling] = useState<Feeling | null>(null);
  const [followThrough, setFollowThrough] = useState<FollowThrough | null>(null);
  const [report, setReport] = useState<FinancialReportResponse | null>(null);
  const [selectedCommitment, setSelectedCommitment] = useState<CheckInCommitment | null>(null);
  const [skipCommitment, setSkipCommitment] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const month = currentStartMonth();

  useEffect(() => {
    if (!ready) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraftDebts(profile.debts.map((debt) => ({ ...debt })));
    setHistory(loadCheckInState(browserCheckInStorage()));
    setLoaded(true);
  }, [profile.debts, ready]);

  useEffect(() => () => controller.current?.abort(), []);

  const hasActiveDebt = draftDebts.some((debt) => isPositiveMoney(debt.balance));
  const canBegin = history.baseline !== null || hasActiveDebt;
  const sendable = isFinancialReportSendable(
    profile.incomes,
    profile.expenses,
    draftDebts,
    profile.extra,
  );
  const priorCommitmentDue =
    history.activeCommitment !== null && history.activeCommitment.createdMonth < month;
  const suggestions = useMemo(
    () =>
      report === null
        ? []
        : commitmentSuggestions(report, month, hasActiveDebt),
    [hasActiveDebt, month, report],
  );

  if (!ready || !loaded) {
    return <main className="mx-auto max-w-5xl px-5 py-16 text-ink-soft">Loading your check-in…</main>;
  }

  if (!canBegin) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
        <section className="panel">
          <p className="eyebrow text-primary">Monthly check-in</p>
          <h1 className="mt-3 font-display text-4xl font-bold">Add an active debt first.</h1>
          <p className="mt-4 text-ink-soft">
            A first check-in needs at least one positive balance to establish a baseline.
          </p>
          <Link href="/plan/debts" className="primary-button mt-6 px-5">Go to debts</Link>
        </section>
      </main>
    );
  }

  if (history.baseline !== null && history.baseline.month > month) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
        <section className="panel">
          <p className="eyebrow text-primary">Monthly check-in</p>
          <h1 className="mt-3 font-display text-4xl font-bold">Check your device date.</h1>
          <p className="mt-4 text-ink-soft">
            Your saved baseline is in {calendarMonth(history.baseline.month)}, which is later
            than this device’s current month. No history has been changed.
          </p>
        </section>
      </main>
    );
  }

  const updateBalance = (id: string, balance: string) => {
    setDraftDebts((current) =>
      current.map((debt) => (debt.id === id ? { ...debt, balance } : debt)),
    );
    setReport(null);
    setSaved(false);
  };

  const calculate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sendable) return;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const request = buildFinancialReportRequest(
        profile.incomes,
        profile.expenses,
        draftDebts,
        profile.extra,
        new Date(),
        progressContextFor(history, month),
      );
      const nextReport = await fetchFinancialReport(request, nextController.signal);
      setReport(nextReport);
      setSelectedCommitment(null);
      setSkipCommitment(false);
    } catch (cause: unknown) {
      if (!isAbort(cause)) setError(describeReportError(cause).message);
    } finally {
      if (!nextController.signal.aborted) setPending(false);
    }
  };

  let pendingSnapshot: Omit<CheckInSnapshot, "newMilestones" | "newlyCelebratedDebtIds"> | null = null;
  let previewSnapshot: CheckInSnapshot | null = null;
  if (report !== null) {
    const payoff = selectedPayoffMonth(report, profile.preferredStrategy);
    pendingSnapshot = {
      month,
      debts: draftDebts.map(({ id, balance }) => ({ id, balance })),
      totalDebt: report.total_debt,
      cashFlowStatus: report.cash_flow.status,
      plannedExtra: report.debt_payment_budget.planned_extra_monthly_payment,
      selectedStrategy: payoff.strategy,
      payoffMonth: payoff.payoffMonth,
      progress: report.check_in_progress,
    };
    previewSnapshot = latestCheckIn(recordCheckIn(history, pendingSnapshot, null));
  }

  const finish = () => {
    if (pendingSnapshot === null || (!skipCommitment && selectedCommitment === null)) return;
    const next = recordCheckIn(
      history,
      pendingSnapshot,
      skipCommitment ? null : selectedCommitment,
    );
    const persisted = saveCheckInState(browserCheckInStorage(), next);
    setHistory(next);
    setDebts(draftDebts);
    setSaved(true);
    setStorageWarning(
      persisted
        ? null
        : "This browser could not save check-in history. Your updated balances remain available for this visit.",
    );
  };

  const resultCopy =
    report?.check_in_progress === null || report?.check_in_progress === undefined
      ? null
      : progressCopy(
          report.check_in_progress.since_previous,
          report.check_in_progress.previous_month,
        );

  return (
    <main className="mx-auto max-w-5xl px-5 py-12 sm:px-8 lg:px-10 lg:py-16">
      <header className="max-w-3xl">
        <p className="eyebrow text-primary">Monthly check-in · {calendarMonth(month)}</p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-6xl">
          Meet this month where it is.
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-ink-soft">
          {supportCopy(feeling, followThrough)}
        </p>
      </header>

      <div className="mt-10 space-y-8">
        <section className="panel" aria-labelledby="feeling-heading">
          <h2 id="feeling-heading" className="font-display text-2xl font-semibold">
            How does your plan feel today?
          </h2>
          <p className="mt-2 text-sm text-ink-soft">
            Optional. This changes only the wording on this screen and is never saved.
          </p>
          <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="How the plan feels">
            {FEELINGS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={feeling === value}
                onClick={() => setFeeling(value)}
                className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                  feeling === value ? "border-primary bg-primary text-white" : "border-rule bg-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {priorCommitmentDue && history.activeCommitment !== null && (
          <section className="panel panel-lavender" aria-labelledby="follow-through-heading">
            <p className="eyebrow text-primary">Last intention</p>
            <h2 id="follow-through-heading" className="mt-2 font-display text-2xl font-semibold">
              How did this go?
            </h2>
            <p className="mt-3 max-w-prose text-sm leading-relaxed">
              {commitmentSentence(history.activeCommitment)}
            </p>
            <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Previous intention result">
              {FOLLOW_THROUGH.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={followThrough === value}
                  onClick={() => setFollowThrough(value)}
                  className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                    followThrough === value ? "border-primary bg-primary text-white" : "border-rule bg-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-soft">Your answer is not saved.</p>
          </section>
        )}

        <form className="panel" onSubmit={calculate} aria-labelledby="balances-heading">
          <p className="eyebrow text-primary">Current picture</p>
          <h2 id="balances-heading" className="mt-2 font-display text-2xl font-semibold">
            Update your balances
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            Enter zero when a debt is paid off. To add or remove a debt, or change its APR
            or minimum, use the full planner.
          </p>
          <div className="mt-6 space-y-3">
            {draftDebts.map((debt) => {
              const balanceError = debtErrors(debt).balance;
              return (
                <label
                  key={debt.id}
                  className="flex items-center justify-between gap-4 rounded-2xl bg-[#f7f8ff] p-4"
                >
                  <span>
                    <span className="block font-semibold">{debt.name}</span>
                    <span className="mt-1 block text-xs text-ink-soft">Balance owed</span>
                  </span>
                  <span className="w-36">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={debt.balance}
                      onChange={(event) => updateBalance(debt.id, event.target.value)}
                      aria-label={`${debt.name} — current balance`}
                      aria-invalid={balanceError !== undefined}
                      className="tnum w-full rounded-xl border border-rule bg-white px-3 py-2.5 text-right text-sm outline-none focus:border-primary"
                    />
                    {balanceError !== undefined && (
                      <span className="mt-1 block text-xs text-danger">{balanceError}</span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <Link href="/plan/debts" className="text-sm font-semibold text-primary">
              Edit the full debt plan →
            </Link>
            <button
              type="submit"
              disabled={!sendable || pending}
              className="primary-button px-6 disabled:pointer-events-none disabled:opacity-50"
            >
              {pending ? "Updating…" : history.baseline === null ? "Set my baseline" : "See my update"}
            </button>
          </div>
          {!sendable && (
            <p className="mt-3 text-right text-sm text-danger">
              Fix the highlighted balance or update invalid plan details first.
            </p>
          )}
          {error !== null && <p role="status" className="mt-4 text-sm text-danger">{error}</p>}
        </form>

        {report !== null && pendingSnapshot !== null && previewSnapshot !== null && (
          <section className="panel panel-mint" aria-labelledby="result-heading" aria-live="polite">
            <p className="eyebrow text-[#176347]">
              {resultCopy === null ? "Your starting point" : "Your monthly update"}
            </p>
            <h2 id="result-heading" className="mt-2 font-display text-3xl font-semibold">
              {resultCopy?.title ?? "Your baseline is ready."}
            </h2>
            <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-soft">
              {resultCopy?.detail ??
                "This confirms today’s balances without claiming progress yet. Your next monthly check-in can compare against it."}
            </p>
            <p className="tnum mt-5 text-3xl font-semibold">{money(report.total_debt)}</p>
            <p className="mt-1 text-xs text-ink-soft">total tracked debt</p>

            {(previewSnapshot.newMilestones.length > 0 ||
              previewSnapshot.newlyCelebratedDebtIds.length > 0) && (
              <ul className="mt-5 space-y-2 rounded-2xl bg-white/75 p-4 text-sm">
                {previewSnapshot.newMilestones.map((milestone) => (
                  <li key={milestone}>✓ {MILESTONE_LABELS[milestone]}</li>
                ))}
                {previewSnapshot.newlyCelebratedDebtIds.map((id) => (
                  <li key={id}>
                    ✓ {draftDebts.find((debt) => debt.id === id)?.name ?? "A tracked debt"} reached zero
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-8 border-t border-[#b9e2cf] pt-6">
              <h3 className="font-display text-xl font-semibold">Choose one next intention</h3>
              <p className="mt-2 text-sm text-ink-soft">
                Pick what feels sustainable, or skip it. This does not change the financial calculation.
              </p>
              <div className="mt-4 grid gap-3">
                {suggestions.map((choice) => (
                  <button
                    type="button"
                    key={choice.kind}
                    aria-pressed={selectedCommitment?.kind === choice.kind && !skipCommitment}
                    onClick={() => {
                      setSelectedCommitment(choice);
                      setSkipCommitment(false);
                    }}
                    className={`rounded-2xl border p-4 text-left text-sm leading-relaxed ${
                      selectedCommitment?.kind === choice.kind && !skipCommitment
                        ? "border-primary bg-white shadow-sm"
                        : "border-[#b9e2cf] bg-white/60"
                    }`}
                  >
                    {choice.sentence}
                  </button>
                ))}
                <button
                  type="button"
                  aria-pressed={skipCommitment}
                  onClick={() => {
                    setSelectedCommitment(null);
                    setSkipCommitment(true);
                  }}
                  className={`rounded-2xl border p-4 text-left text-sm ${
                    skipCommitment ? "border-primary bg-white" : "border-[#b9e2cf] bg-white/60"
                  }`}
                >
                  Skip an intention for now
                </button>
              </div>
              <button
                type="button"
                onClick={finish}
                disabled={saved || (!skipCommitment && selectedCommitment === null)}
                className="primary-button mt-6 px-6 disabled:pointer-events-none disabled:opacity-50"
              >
                {saved ? "Check-in saved" : "Save this check-in"}
              </button>
              {storageWarning !== null && <p role="status" className="mt-3 text-sm text-danger">{storageWarning}</p>}
              {saved && storageWarning === null && (
                <p role="status" className="mt-4 text-sm text-[#176347]">
                  Saved only in this browser. <Link href="/report" className="font-semibold underline">Return to your report</Link>
                </p>
              )}
            </div>
          </section>
        )}

        {history.snapshots.length > 0 && (
          <section className="panel" aria-labelledby="history-heading">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="eyebrow text-primary">Browser-local history</p>
                <h2 id="history-heading" className="mt-2 font-display text-2xl font-semibold">
                  Recent check-ins
                </h2>
              </div>
              {!confirmClear ? (
                <button type="button" className="text-sm font-semibold text-danger" onClick={() => setConfirmClear(true)}>
                  Clear check-in history
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-coral-soft p-3">
                  <span className="text-sm">Keep your plan, but clear every check-in?</span>
                  <button
                    type="button"
                    className="rounded-full bg-danger px-3 py-1.5 text-sm font-semibold text-white"
                    onClick={() => {
                      const cleared = clearCheckInState(browserCheckInStorage());
                      if (cleared) {
                        setHistory(emptyCheckInState());
                        setReport(null);
                        setSaved(false);
                        setStorageWarning(null);
                      } else {
                        setStorageWarning("This browser could not clear check-in history.");
                      }
                      setConfirmClear(false);
                    }}
                  >
                    Yes, clear it
                  </button>
                  <button type="button" className="px-2 py-1 text-sm font-semibold" onClick={() => setConfirmClear(false)}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
            <ol className="mt-6 divide-y divide-rule">
              {[...history.snapshots].reverse().map((item) => (
                <li key={item.month} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
                  <div>
                    <p className="font-semibold">{calendarMonth(item.month)}</p>
                    <p className="mt-1 text-xs capitalize text-ink-soft">{item.cashFlowStatus.replace("_", " ")}</p>
                  </div>
                  <div className="text-right">
                    <p className="tnum font-semibold">{money(item.totalDebt)}</p>
                    <p className="mt-1 text-xs text-ink-soft">
                      {item.payoffMonth === null ? "No payoff estimate" : `Estimate: ${calendarMonth(item.payoffMonth)}`}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </main>
  );
}
