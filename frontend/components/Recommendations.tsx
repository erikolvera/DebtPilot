type Recommendation = {
  code: string;
  title: string;
  detail: string;
};

type Props = {
  items: Recommendation[];
};

export function Recommendations({ items }: Props) {
  return (
    <section aria-labelledby="recommendations-heading" className="panel panel-lavender">
      <p className="eyebrow text-primary">Keep the momentum</p>
      <h2 id="recommendations-heading" className="mt-2 font-display text-2xl font-semibold">
        Recommended next steps
      </h2>

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-ink-soft">No recommendations right now.</p>
      ) : (
        <ol className="mt-6 grid gap-4 md:grid-cols-2">
          {items.map((item, index) => (
            <li key={item.code} className="rounded-2xl bg-white/80 p-5">
              <span className="tnum grid h-8 w-8 place-items-center rounded-full bg-primary text-xs text-white">{index + 1}</span>
              <h3 className="mt-4 font-display text-xl leading-tight">{item.title}</h3>
              <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-soft">
                {item.detail}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
