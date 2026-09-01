"use client";

import { useEffect, useMemo, useState } from "react";
import { DebtTable } from "@/components/DebtTable";
import { EscapeChart, type Track } from "@/components/EscapeChart";
import { ExtraPayment } from "@/components/ExtraPayment";
import { Narrative } from "@/components/Narrative";
import { ScenarioSummary } from "@/components/ScenarioSummary";
import type { DebtDraft } from "@/lib/api";
import { delta } from "@/lib/format";
import { seedPortfolio } from "@/lib/seed";
import { browserStorage, loadPortfolio, savePortfolio, type Portfolio } from "@/lib/storage";
import { usePlan } from "@/lib/usePlan";

export default function Page() {
  const [portfolio, setPortfolio] = useState<Portfolio>(seedPortfolio);
  const [restored, setRestored] = useState(false);

  // Restore after mount, never during render: localStorage does not exist on
  // the server, and reading it during render would mismatch hydration.
  useEffect(() => {
    // localStorage cannot be read during render without a hydration mismatch,
    // and the alternatives (lazy initializer, useSyncExternalStore with a
    // cached snapshot) are respectively wrong and far more machinery than one
    // extra render on mount is worth.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPortfolio(loadPortfolio(browserStorage(), seedPortfolio()));
    setRestored(true);
  }, []);

  useEffect(() => {
    if (restored) savePortfolio(browserStorage(), portfolio);
  }, [portfolio, restored]);

  const setDebts = (debts: DebtDraft[]) =>
    setPortfolio((current) => ({ ...current, debts }));
  const setExtra = (extra: string) =>
    setPortfolio((current) => ({ ...current, extra }));

  const { plan, pending, error } = usePlan(portfolio.debts, portfolio.extra);

  const nameFor = useMemo(() => {
    const byId = new Map(
      portfolio.debts.map((debt) => [debt.id, debt.name.trim() || "that card"]),
    );
    return (debtId: string) => byId.get(debtId) ?? "a card";
  }, [portfolio.debts]);

  const tracks: Track[] = plan
    ? [
        { key: "baseline", label: "Do nothing", accent: "var(--baseline)", scenario: plan.scenarios.baseline },
        { key: "snowball", label: "Snowball", accent: "var(--snowball)", scenario: plan.scenarios.snowball },
        { key: "avalanche", label: "Avalanche", accent: "var(--avalanche)", scenario: plan.scenarios.avalanche },
      ]
    : [];

  return (
    <main className="mx-auto max-w-[1180px] px-6 py-12 lg:px-10">
      <header className="max-w-2xl">
        <p className="eyebrow">DebtPilot</p>
        <h1 className="mt-3 font-display text-[clamp(2.5rem,6vw,4.5rem)] font-bold leading-[0.95] tracking-tight">
          Find your last payment.
        </h1>
        <p className="mt-5 text-lg text-ink-soft">
          Enter your cards. See what minimum payments really cost, and what
          paying a little more buys back.
        </p>
      </header>

      <div className="mt-14 grid gap-12 lg:grid-cols-[380px_1fr] lg:gap-16">
        <div>
          <DebtTable debts={portfolio.debts} onChange={setDebts} />
          <ExtraPayment value={portfolio.extra} onChange={setExtra} />
          <p className="mt-8 text-xs text-ink-soft">
            These numbers are an example. Change any of them — nothing is saved
            beyond this browser.
          </p>
        </div>

        <div>
          {error !== null && (
            <p role="status" className="mb-6 border-l-2 border-snowball pl-3 text-sm">
              {error}
            </p>
          )}

          {plan === null ? (
            <p className="text-ink-soft">
              {portfolio.debts.length === 0
                ? "Add a card to see your payoff date."
                : error !== null
                  ? "No plan yet — the planner didn't answer."
                  : pending
                    ? "Working out your plan…"
                    : "Fix the highlighted fields above and the plan will update."}
            </p>
          ) : (
            <>
              <h2 className="eyebrow">How it plays out</h2>
              <div className="mt-6">
                <EscapeChart
                  tracks={tracks}
                  startMonth={plan.start_month}
                  dimmed={pending}
                />
              </div>

              <div className="mt-12 grid gap-8 sm:grid-cols-3">
                <ScenarioSummary
                  scenario={plan.scenarios.baseline}
                  label="Do nothing"
                  accent="var(--baseline)"
                  nameFor={nameFor}
                  note={null}
                />
                <ScenarioSummary
                  scenario={plan.scenarios.snowball}
                  label="Snowball"
                  accent="var(--snowball)"
                  nameFor={nameFor}
                  note="Smallest balance first."
                />
                <ScenarioSummary
                  scenario={plan.scenarios.avalanche}
                  label="Avalanche"
                  accent="var(--avalanche)"
                  nameFor={nameFor}
                  note={
                    plan.comparison.interest_saved_avalanche_vs_snowball === null
                      ? "Highest rate first."
                      : `Highest rate first. ${delta(plan.comparison.interest_saved_avalanche_vs_snowball)} less interest than snowball.`
                  }
                />
              </div>

              <Narrative
                debts={portfolio.debts}
                extra={portfolio.extra}
              />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
