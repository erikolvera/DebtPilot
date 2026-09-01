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
    <section aria-labelledby="recommendations-heading" className="mt-12">
      <h2 id="recommendations-heading" className="eyebrow">
        Recommended next steps
      </h2>

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-ink-soft">No recommendations right now.</p>
      ) : (
        <ol className="mt-4 space-y-5">
          {items.map((item) => (
            <li key={item.code} className="border-t border-rule pt-4">
              <h3 className="font-display text-xl leading-tight">{item.title}</h3>
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
