"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { currentStartMonth } from "@/lib/api";
import {
  commitmentSentence,
  MILESTONE_LABELS,
  progressCopy,
} from "@/lib/checkIn";
import {
  browserCheckInStorage,
  checkInDue,
  dismissCheckInPrompt,
  emptyCheckInState,
  latestCheckIn,
  loadCheckInState,
  saveCheckInState,
  type CheckInState,
} from "@/lib/checkInStorage";
import { calendarMonth } from "@/lib/format";

type Props = {
  canStart?: boolean;
  showEnrollment?: boolean;
  showLatest?: boolean;
  debtNames?: Record<string, string>;
};

export function CheckInStatusCard({
  canStart = false,
  showEnrollment = false,
  showLatest = false,
  debtNames = {},
}: Props) {
  const [state, setState] = useState<CheckInState>(emptyCheckInState());
  const [ready, setReady] = useState(false);
  const month = currentStartMonth();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(loadCheckInState(browserCheckInStorage()));
    setReady(true);
  }, []);

  if (!ready) return null;
  const latest = latestCheckIn(state);

  if (state.baseline === null) {
    if (!showEnrollment || !canStart) return null;
    return (
      <section className="panel panel-warm" aria-labelledby="start-check-ins-heading">
        <p className="eyebrow text-[#85630d]">A plan you can return to</p>
        <h2 id="start-check-ins-heading" className="mt-2 font-display text-2xl font-semibold">
          Track progress one month at a time.
        </h2>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-soft">
          Confirm today’s balances as a private baseline. Future check-ins can
          recognize progress and help you adjust after a difficult month.
        </p>
        <Link href="/check-in" className="primary-button mt-6 px-5">
          Start monthly check-ins
        </Link>
      </section>
    );
  }

  if (checkInDue(state, month)) {
    const dismissed = dismissCheckInPrompt(state, month);
    return (
      <section className="panel panel-warm" aria-labelledby="check-in-due-heading">
        <p className="eyebrow text-[#85630d]">A gentle monthly reminder</p>
        <h2 id="check-in-due-heading" className="mt-2 font-display text-2xl font-semibold">
          Ready for your {calendarMonth(month)} check-in?
        </h2>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-soft">
          Update only the balances that changed. There is no streak to protect
          and no penalty for a different month than you planned.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/check-in" className="primary-button px-5">
            Check in now
          </Link>
          <button
            type="button"
            className="secondary-button px-5"
            onClick={() => {
              saveCheckInState(browserCheckInStorage(), dismissed);
              setState(dismissed);
            }}
          >
            Not now
          </button>
        </div>
      </section>
    );
  }

  if (!showLatest || latest === null) return null;
  const copy =
    latest.progress === null
      ? {
          title: "Your monthly baseline is saved.",
          detail: "Your next check-in can compare new balances with this starting point.",
          tone: "neutral" as const,
        }
      : progressCopy(latest.progress.since_previous, latest.progress.previous_month);
  const tone =
    copy.tone === "positive"
      ? "panel-mint"
      : copy.tone === "recovery"
        ? "bg-coral-soft"
        : "panel-lavender";

  return (
    <section className={`panel ${tone}`} aria-labelledby="latest-check-in-heading">
      <p className="eyebrow text-primary">Latest monthly check-in</p>
      <h2 id="latest-check-in-heading" className="mt-2 font-display text-2xl font-semibold">
        {copy.title}
      </h2>
      <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-soft">{copy.detail}</p>

      {(latest.newMilestones.length > 0 || latest.newlyCelebratedDebtIds.length > 0) && (
        <ul className="mt-5 space-y-2 rounded-2xl bg-white/70 p-4 text-sm">
          {latest.newMilestones.map((milestone) => (
            <li key={milestone}>✓ {MILESTONE_LABELS[milestone]}</li>
          ))}
          {latest.newlyCelebratedDebtIds.map((id) => (
            <li key={id}>✓ {debtNames[id] ?? "A tracked debt"} reached zero</li>
          ))}
        </ul>
      )}

      {state.activeCommitment !== null && (
        <div className="mt-5 rounded-2xl bg-white/70 p-4">
          <p className="eyebrow">Your next intention</p>
          <p className="mt-2 text-sm leading-relaxed">
            {commitmentSentence(state.activeCommitment)}
          </p>
        </div>
      )}

      <Link href="/check-in" className="secondary-button mt-6 px-5">
        View check-ins
      </Link>
    </section>
  );
}
