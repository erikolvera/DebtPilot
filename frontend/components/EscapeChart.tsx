import type { ScenarioOut } from "@/lib/api";
import { clipsAtEdge, wedgePath, xDomainMonths, yMaxBalance, yearTicks } from "@/lib/chart";
import { scenarioFigures } from "@/lib/format";

const LANE = { width: 700, height: 44 };

export type Track = {
  key: string;
  label: string;
  /** A CSS colour expression, used as a fill. */
  accent: string;
  scenario: ScenarioOut;
};

type Props = {
  tracks: Track[];
  startMonth: string;
  dimmed: boolean;
};

export function EscapeChart({ tracks, startMonth, dimmed }: Props) {
  const scenarios = tracks.map((track) => track.scenario);
  const domainMonths = xDomainMonths(scenarios);
  const yMax = yMaxBalance(scenarios);
  const ticks = yearTicks(startMonth, domainMonths);

  const across = (month: number) => `${Math.min(month / domainMonths, 1) * 100}%`;

  const summary = tracks
    .map((track) => {
      const figures = scenarioFigures(track.scenario);
      return figures.paidOff
        ? `${track.label} clears in ${figures.payoffMonth}.`
        : `${track.label} never pays off.`;
    })
    .join(" ");

  return (
    <figure
      className="transition-opacity duration-150"
      style={{ opacity: dimmed ? 0.55 : 1 }}
      role="img"
      aria-label={summary}
    >
      {/* Year gridlines, drawn once behind every lane. */}
      <div className="relative">
        <div className="pointer-events-none absolute inset-0 hidden sm:block" aria-hidden="true">
          {ticks.map((tick) => (
            <div
              key={tick.label}
              className="absolute top-0 bottom-0 border-l border-rule"
              style={{ left: across(tick.month) }}
            >
              <span className="eyebrow absolute -top-0.5 left-1.5">{tick.label}</span>
            </div>
          ))}
        </div>

        <div className="relative space-y-8 pt-6">
          {tracks.map((track) => {
            const figures = scenarioFigures(track.scenario);
            const clips = clipsAtEdge(track.scenario, domainMonths);
            const path = wedgePath(track.scenario.monthly_totals, domainMonths, yMax, LANE);
            const maskId = `fade-${track.key}`;

            return (
              <div key={track.key}>
                <p className="eyebrow">{track.label}</p>

                <div className="relative mt-1.5">
                  <svg
                    className="block h-11 w-full"
                    viewBox={`0 0 ${LANE.width} ${LANE.height}`}
                    // A filled area carries no meaning that non-uniform scaling
                    // destroys, and stretching keeps the month axis aligned with
                    // the HTML gridlines above at every viewport width.
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    {clips && (
                      <defs>
                        <linearGradient id={maskId} x1="0" x2="1">
                          <stop offset="0.82" stopColor="white" stopOpacity="1" />
                          <stop offset="1" stopColor="white" stopOpacity="0" />
                        </linearGradient>
                        <mask id={`mask-${track.key}`}>
                          <rect
                            width={LANE.width}
                            height={LANE.height}
                            fill={`url(#${maskId})`}
                          />
                        </mask>
                      </defs>
                    )}
                    <path
                      d={path}
                      fill={track.accent}
                      mask={clips ? `url(#mask-${track.key})` : undefined}
                    />
                  </svg>

                  {figures.paidOff && !clips && figures.months !== null && (
                    <>
                      {/* The dot marks the month, so the dot ALONE is centred on
                          the point: it is 8px wide, so -translate-x-1/2 moves it
                          4px and lands true. Centring the dot and its label as
                          one span — the obvious thing, and what an earlier
                          version did — shifts the pair by half the LABEL's
                          width, putting the dot roughly 15% of a lane early and
                          making the marker disagree with the wedge beneath it.
                          On a chart whose job is showing when you finish, the
                          marker was claiming the wrong month. */}
                      <span
                        aria-hidden="true"
                        className="absolute top-full mt-1 h-2 w-2 -translate-x-1/2 rounded-full"
                        style={{ left: across(figures.months), background: track.accent }}
                      />
                      {/* The label is right-anchored so it reads up to the dot
                          and never runs off the right edge.
                          ponytail: a payoff in the first third of the domain can
                          push it past the left edge, where it clips. The dot
                          stays correct, and the dot is the part that makes a
                          claim; upgrade to a side-aware anchor if that case
                          shows up in practice. */}
                      <span
                        className="tnum absolute top-full mt-1 -translate-x-full whitespace-nowrap pr-3 text-xs"
                        style={{ left: across(figures.months) }}
                      >
                        {figures.payoffMonth}
                        {figures.totalInterestWhole !== null && (
                          <span className="text-ink-soft">
                            {" · "}
                            {figures.totalInterestWhole} interest
                          </span>
                        )}
                      </span>
                    </>
                  )}

                  {clips && (
                    <span className="absolute top-full right-0 mt-1 text-xs text-ink-soft">
                      still paying →
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <figcaption className="mt-10 text-xs text-ink-soft">
        Height is what you still owe. Estimated with monthly interest, so
        figures are close rather than exact.
      </figcaption>
    </figure>
  );
}
