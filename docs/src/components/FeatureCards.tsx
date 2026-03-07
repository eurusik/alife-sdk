import { BookOpen, Link2 } from "lucide-react";
import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import type { DocSection } from "@/content/docsRegistry";

type FeatureCardsProps = {
  sections: DocSection[];
  query: string;
  onClearQuery: () => void;
};

const getRouteLinks = (sections: DocSection[]) =>
  sections.map((section) => ({
    label: section.title,
    href: `#${section.id}`,
    docsCount: section.docs.length,
  }));

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const highlightText = (text: string, query: string): ReactNode => {
  const normalized = query.trim();

  if (!normalized) {
    return text;
  }

  const regex = new RegExp(`(${escapeRegExp(normalized)})`, "ig");
  const parts = text.split(regex);

  return parts.map((part, index) => {
    const matched = part.toLowerCase() === normalized.toLowerCase();

    if (!matched) {
      return <span key={`${part}-${index}`}>{part}</span>;
    }

    return (
      <mark key={`${part}-${index}`} className="search-mark">
        {part}
      </mark>
    );
  });
};

export function FeatureCards({ sections, query, onClearQuery }: FeatureCardsProps) {
  const quickLinks = getRouteLinks(sections);

  if (!sections.length) {
    return (
      <section className="mt-10 space-y-6" id="docs">
        <div className="pixel-divider" />
        <section className="pixel-card p-6">
          <h3 className="text-lg font-display font-bold text-foreground">No Matches</h3>
          <p className="mt-2 text-sm font-mono text-muted-foreground">
            За запитом <span className="text-primary">"{query}"</span> нічого не знайдено. Спробуйте коротші ключові слова.
          </p>
          <button
            type="button"
            onClick={onClearQuery}
            className="mt-4 border-2 border-primary bg-primary/15 px-3 py-2 text-xs font-mono text-primary transition-colors hover:bg-primary/25"
          >
            Очистити пошук
          </button>
        </section>
      </section>
    );
  }

  return (
    <section className="mt-10 space-y-6" id="docs">
      <div className="pixel-divider" />

      <section className="pixel-card p-5 md:p-6">
        <h3 className="mb-2 flex items-center gap-2 text-lg font-display font-bold text-foreground">
          <BookOpen className="h-4 w-4 text-primary" />
          Documentation Routes
        </h3>
        <p className="mb-4 max-w-[72ch] text-sm font-mono leading-relaxed text-muted-foreground">
          Швидкий перехід по розділах документації. Документи нижче відкриваються як окремі сторінки в стилі VitePress.
        </p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {quickLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="flex items-center justify-between border-2 border-border bg-secondary/25 px-3 py-2 text-sm font-display font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <span>{highlightText(link.label, query)}</span>
              <span className="text-xs font-mono text-primary/80">{link.docsCount} docs</span>
            </a>
          ))}
        </div>
      </section>

      {sections.map((section) => (
        <article key={section.id} id={section.id} className="scroll-mt-28 pixel-card p-5 md:p-6">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-2xl font-display font-bold tracking-wide text-foreground">{highlightText(section.title, query)}</h3>
            <span className="border border-border bg-secondary/40 px-2 py-1 text-xs font-mono text-muted-foreground">
              {section.docs.length} docs
            </span>
          </div>

          <p className="mb-4 max-w-[72ch] text-sm font-mono leading-relaxed text-muted-foreground md:text-base">
            {highlightText(section.summary, query)}
          </p>

          <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-2">
            {section.docs.map((doc) => (
              <div key={doc.slug} className="border-2 border-border bg-secondary/20 px-3 py-3">
                <p className="text-sm font-display font-semibold text-foreground">{highlightText(doc.title, query)}</p>
                <p className="mt-1 text-xs font-mono leading-relaxed text-muted-foreground">{highlightText(doc.description, query)}</p>
                <code className="mt-2 inline-block text-xs text-primary/85">{highlightText(doc.source, query)}</code>
                <Link
                  to={`/docs/${doc.slug}`}
                  className="mt-3 inline-flex items-center gap-2 border-2 border-border bg-secondary px-3 py-1.5 text-xs font-mono text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Open Page
                </Link>
              </div>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}
