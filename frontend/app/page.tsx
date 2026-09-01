import Link from "next/link";

const FEATURES = [
  ["Know the real number", "See what remains after living costs and every debt minimum."],
  ["Compare proven paths", "Put Snowball, Avalanche, and minimum-only plans side by side."],
  ["Stay inside your budget", "DebtPilot never models an extra payment your cash flow cannot support."],
] as const;

export default function HomePage() {
  return (
    <main>
      <section className="mx-auto grid max-w-[1280px] gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:px-10 lg:py-24">
        <div>
          <p className="eyebrow">A calmer way out of debt</p>
          <h1 className="mt-4 max-w-3xl font-display text-[clamp(3rem,7vw,6rem)] font-bold leading-[0.92] tracking-tight">
            Make a plan that fits your real life.
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-relaxed text-ink-soft sm:text-xl">
            Start with the money coming in, account for the life you are already
            paying for, and turn what remains into a debt payoff plan you can sustain.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/plan/cash-flow" className="rounded-full bg-ink px-6 py-3 font-semibold text-paper hover:opacity-85">
              Build my plan
            </Link>
            <Link href="/report" className="rounded-full border border-rule px-6 py-3 font-semibold hover:bg-ink/5">
              View saved report
            </Link>
          </div>
          <p className="mt-5 text-sm text-ink-soft">No account. No bank connection. Your entries stay in this browser.</p>
        </div>

        <div className="relative mx-auto w-full max-w-xl">
          <div className="rounded-[2rem] border border-rule bg-white p-6 shadow-xl shadow-ink/5 sm:p-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="eyebrow">Monthly snapshot</p>
                <p className="mt-2 font-display text-2xl font-semibold">You have room to move.</p>
              </div>
              <span className="h-3 w-3 rounded-full bg-avalanche" aria-hidden="true" />
            </div>
            <dl className="mt-8 space-y-4 text-sm">
              <div className="flex justify-between border-b border-rule pb-4"><dt className="text-ink-soft">Income</dt><dd className="tnum font-semibold">$5,300.00</dd></div>
              <div className="flex justify-between border-b border-rule pb-4"><dt className="text-ink-soft">Life + minimums</dt><dd className="tnum font-semibold">− $4,183.40</dd></div>
              <div className="flex justify-between text-lg"><dt>Available cash flow</dt><dd className="tnum font-semibold">$1,116.60</dd></div>
            </dl>
            <div className="mt-8 rounded-2xl bg-ink p-5 text-paper">
              <p className="text-sm opacity-70">Avalanche estimate</p>
              <div className="mt-2 flex items-end justify-between gap-4">
                <p className="font-display text-3xl font-semibold">Debt-free Nov 2027</p>
                <p className="tnum text-sm">15 mo</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1280px] px-5 pb-20 sm:px-8 lg:px-10">
        <div className="grid gap-4 md:grid-cols-3">
          {FEATURES.map(([title, detail], index) => (
            <article key={title} className="rounded-3xl border border-rule bg-white p-6">
              <p className="tnum text-sm text-ink-soft">0{index + 1}</p>
              <h2 className="mt-6 font-display text-2xl font-semibold">{title}</h2>
              <p className="mt-3 leading-relaxed text-ink-soft">{detail}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
