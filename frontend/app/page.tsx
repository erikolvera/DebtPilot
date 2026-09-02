import Link from "next/link";
import { CheckInStatusCard } from "@/components/CheckInStatusCard";

const FEATURES = [
  ["Know the real number", "See what remains after living costs and every debt minimum.", "bg-[#fff5d6]"],
  ["Compare proven paths", "Put Snowball, Avalanche, and minimum-only plans side by side.", "bg-[#e8f8ff]"],
  ["Stay inside your budget", "DebtPilot never models an extra payment your cash flow cannot support.", "bg-[#eceaff]"],
] as const;

export default function HomePage() {
  return (
    <main>
      <section className="mx-auto grid max-w-[1280px] gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:px-10 lg:py-24">
        <div>
          <p className="eyebrow inline-flex rounded-full bg-sun/55 px-3 py-2 text-ink">A calmer way out of debt</p>
          <h1 className="mt-4 max-w-3xl font-display text-[clamp(3rem,7vw,6rem)] font-bold leading-[0.92] tracking-tight">
            Make a plan that fits your <span className="text-primary">real life.</span>
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-relaxed text-ink-soft sm:text-xl">
            Start with the money coming in, account for the life you are already
            paying for, and turn what remains into a debt payoff plan you can sustain.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/plan/cash-flow" className="primary-button px-6">
              Build my plan
            </Link>
            <Link href="/report" className="secondary-button px-6">
              View saved report
            </Link>
          </div>
          <p className="mt-5 text-sm text-ink-soft">No account. No bank connection. Your entries stay in this browser.</p>
        </div>

        <div className="relative mx-auto w-full max-w-xl">
          <div className="absolute -left-5 -top-5 h-24 w-24 rounded-full bg-sun/70 blur-sm" aria-hidden="true" />
          <div className="absolute -bottom-5 -right-5 h-32 w-32 rounded-full bg-sky/30 blur-sm" aria-hidden="true" />
          <div className="relative rounded-[2rem] border border-white bg-white/90 p-6 shadow-2xl shadow-primary/10 sm:p-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="eyebrow">Monthly snapshot</p>
                <p className="mt-2 font-display text-2xl font-semibold">You have room to move.</p>
              </div>
              <span className="rounded-full bg-mint px-3 py-1 text-xs font-semibold text-[#176347]">Surplus</span>
            </div>
            <dl className="mt-8 space-y-4 text-sm">
              <div className="flex justify-between border-b border-rule pb-4"><dt className="text-ink-soft">Income</dt><dd className="tnum font-semibold">$5,300.00</dd></div>
              <div className="flex justify-between border-b border-rule pb-4"><dt className="text-ink-soft">Life + minimums</dt><dd className="tnum font-semibold">− $4,183.40</dd></div>
              <div className="flex justify-between text-lg"><dt>Available cash flow</dt><dd className="tnum font-semibold">$1,116.60</dd></div>
            </dl>
            <div className="mt-8 rounded-2xl bg-primary p-5 text-white shadow-lg shadow-primary/20">
              <p className="text-sm text-white/70">Avalanche estimate</p>
              <div className="mt-2 flex items-end justify-between gap-4">
                <p className="font-display text-3xl font-semibold">Debt-free Nov 2027</p>
                <p className="tnum text-sm">15 mo</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1280px] px-5 pb-10 sm:px-8 lg:px-10">
        <CheckInStatusCard />
      </section>

      <section className="mx-auto max-w-[1280px] px-5 pb-20 sm:px-8 lg:px-10">
        <div className="grid gap-4 md:grid-cols-3">
          {FEATURES.map(([title, detail, color], index) => (
            <article key={title} className={`rounded-3xl border border-white p-6 shadow-sm shadow-ink/5 ${color}`}>
              <p className="tnum grid h-9 w-9 place-items-center rounded-full bg-white text-sm text-primary">0{index + 1}</p>
              <h2 className="mt-6 font-display text-2xl font-semibold">{title}</h2>
              <p className="mt-3 leading-relaxed text-ink-soft">{detail}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
