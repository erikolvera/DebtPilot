"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/", "Overview"],
  ["/plan/cash-flow", "Plan"],
  ["/report", "Report"],
] as const;

export function AppHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 border-b border-rule bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-4 px-5 py-4 sm:px-8 lg:px-10">
        <Link href="/" className="flex items-center gap-2 font-display text-lg font-bold">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary text-sm text-white shadow-md shadow-primary/20" aria-hidden="true">
            D
          </span>
          <span className="max-[399px]:sr-only">DebtPilot</span>
        </Link>
        <nav aria-label="Primary navigation" className="flex items-center gap-1 text-sm">
          {LINKS.map(([href, label]) => {
            const section = href.split("/")[1];
            const active = href === "/" ? pathname === "/" : pathname.startsWith(`/${section}`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`rounded-full px-3 py-2 transition-colors ${
                  active ? "bg-primary text-white shadow-sm shadow-primary/20" : "text-ink-soft hover:bg-primary/5 hover:text-primary"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
