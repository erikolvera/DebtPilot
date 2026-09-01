import Link from "next/link";

type Props = { current: 1 | 2 };

export function PlanSteps({ current }: Props) {
  return (
    <nav aria-label="Plan progress" className="flex items-center gap-3 text-sm">
      <Link
        href="/plan/cash-flow"
        aria-current={current === 1 ? "step" : undefined}
        className={`rounded-full px-3 py-2 ${current === 1 ? "bg-primary text-white" : "bg-white text-ink-soft hover:text-primary"}`}
      >
        <span className="tnum mr-1.5 opacity-70">01</span> Cash flow
      </Link>
      <span aria-hidden="true" className="h-px w-8 bg-rule" />
      <Link
        href="/plan/debts"
        aria-current={current === 2 ? "step" : undefined}
        className={`rounded-full px-3 py-2 ${current === 2 ? "bg-primary text-white" : "bg-white text-ink-soft hover:text-primary"}`}
      >
        <span className="tnum mr-1.5 opacity-70">02</span> Debts
      </Link>
    </nav>
  );
}
