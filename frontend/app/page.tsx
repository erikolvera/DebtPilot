"use client";

import { useState } from "react";
import { DebtTable } from "@/components/DebtTable";
import { ExtraPayment } from "@/components/ExtraPayment";
import { seedPortfolio } from "@/lib/seed";

// Temporary shell: mounts the input rail so it can be exercised before the
// results components exist. Task 12 replaces this with the real page.
export default function Page() {
  const [{ debts, extra }, setPortfolio] = useState(seedPortfolio());

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

      <div className="mt-12 max-w-2xl">
        <DebtTable
          debts={debts}
          onChange={(next) => setPortfolio((prev) => ({ ...prev, debts: next }))}
        />
        <ExtraPayment
          value={extra}
          onChange={(next) => setPortfolio((prev) => ({ ...prev, extra: next }))}
        />
      </div>
    </main>
  );
}
