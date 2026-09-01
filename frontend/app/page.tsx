export default function Page() {
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

      <p className="tnum mt-12 text-2xl">$6,120.00 · 24.99% · Sep 2029</p>
    </main>
  );
}
