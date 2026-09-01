import Link from "next/link";

type Props = { current: 1 | 2 };

export function PlanSteps({ current }: Props) {
  return (
    <nav aria-label="Plan progress" className="flex items-center gap-3 text-sm">
      <Link
        href="/plan/cash-flow"
        aria-current={current === 1 ? "step" : undefined}
        className={current === 1 ? "font-semibold text-ink" : "text-ink-soft hover:text-ink"}
      >
        <span className="tnum mr-1.5">01</span> Cash flow
      </Link>
      <span aria-hidden="true" className="h-px w-8 bg-rule" />
      <Link
        href="/plan/debts"
        aria-current={current === 2 ? "step" : undefined}
        className={current === 2 ? "font-semibold text-ink" : "text-ink-soft hover:text-ink"}
      >
        <span className="tnum mr-1.5">02</span> Debts
      </Link>
    </nav>
  );
}
