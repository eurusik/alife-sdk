import { Children, lazy, Suspense, type ReactNode, useEffect, useMemo, useState } from "react";
import { CornerDownRight, Copy, ExternalLink } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { createHeadingAnchorFactory, resolveDocSlug, type DocEntry } from "@/content/docsRegistry";
import { normalizeCodeLanguage } from "@/lib/codeHighlight";

type DocReaderProps = {
  doc: DocEntry | null;
  docs: DocEntry[];
  onSelectDoc: (slug: string) => void;
};

type RelatedLink = {
  label: string;
  href: string;
  slug: string | null;
};

type ActionSectionTitle = "Start here" | "Browse by task" | "Most used" | "Debug this package";

type ActionItem = {
  label: string;
  href: string;
  slug: string | null;
  note: string;
};

type ActionSection = {
  title: ActionSectionTitle;
  items: ActionItem[];
};

const toPlainText = (children: ReactNode): string =>
  Children.toArray(children)
    .map((child) => {
      if (typeof child === "string") {
        return child;
      }

      if (typeof child === "number") {
        return String(child);
      }

      if (typeof child === "object" && child && "props" in child) {
        const nested = (child as { props?: { children?: ReactNode } }).props?.children;
        return toPlainText(nested ?? "");
      }

      return "";
    })
    .join(" ")
    .trim();

const extractCodeLanguage = (className?: string): string => {
  const match = className?.match(/language-([\w-]+)/);
  return match?.[1] ?? "plain/text";
};

const preloadHighlightedCodeBlock = () => import("@/components/HighlightedCodeBlock");
const HighlightedCodeBlock = lazy(preloadHighlightedCodeBlock);

const hasHighlightableCodeBlocks = (content: string): boolean => {
  const fencePattern = /```([^\n`]*)/g;

  for (const match of content.matchAll(fencePattern)) {
    const languageHint = (match[1] ?? "").trim().split(/\s+/)[0] ?? "";

    if (languageHint && normalizeCodeLanguage(languageHint)) {
      return true;
    }
  }

  return false;
};

const ACTION_SECTION_TITLES = new Set<ActionSectionTitle>([
  "Start here",
  "Browse by task",
  "Most used",
  "Debug this package",
]);

const extractDocExtras = (content: string): {
  bodyContent: string;
  relatedLinks: RelatedLink[];
  actionSections: ActionSection[];
} => {
  const lines = content.split("\n");
  const relatedLinks: RelatedLink[] = [];
  const actionSections: ActionSection[] = [];
  const bodyLines: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const headingMatch = line.trim().match(/^##\s+(.+)$/);
    const headingTitle = headingMatch?.[1]?.trim() as ActionSectionTitle | undefined;

    if (headingTitle && ACTION_SECTION_TITLES.has(headingTitle)) {
      index += 1;
      const items: ActionItem[] = [];

      while (index < lines.length) {
        const sectionLine = lines[index];

        if (/^##\s+/.test(sectionLine.trim())) {
          break;
        }

        const linkMatch = sectionLine.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);

        if (linkMatch) {
          const itemText = linkMatch[1].trim();
          const markdownLink = itemText.match(/\[([^\]]+)\]\(([^)]+)\)/);

          if (markdownLink) {
            const href = markdownLink[2].trim();
            const beforeLink = itemText.slice(0, markdownLink.index ?? 0).replace(/->\s*$/, "").trim();
            const afterLink = itemText
              .slice((markdownLink.index ?? 0) + markdownLink[0].length)
              .replace(/^->\s*/, "")
              .trim();

            items.push({
              label: markdownLink[1].trim(),
              href,
              slug: resolveDocSlug(href),
              note: cleanInlineText([beforeLink, afterLink].filter(Boolean).join(" ")),
            });
          }
        }

        index += 1;
      }

      if (items.length > 0) {
        actionSections.push({ title: headingTitle, items });
      }

      while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === "") {
        bodyLines.pop();
      }

      continue;
    }

    if (line.trim() !== "## Related pages") {
      bodyLines.push(line);
      index += 1;
      continue;
    }

    index += 1;

    while (index < lines.length) {
      const sectionLine = lines[index];

      if (/^##\s+/.test(sectionLine.trim())) {
        break;
      }

      const linkMatch = sectionLine.match(/^\s*(?:[-*]|\d+\.)\s+\[([^\]]+)\]\(([^)]+)\)/);

      if (linkMatch) {
        const href = linkMatch[2].trim();
        relatedLinks.push({
          label: linkMatch[1].trim(),
          href,
          slug: resolveDocSlug(href),
        });
      }

      index += 1;
    }

    while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === "") {
      bodyLines.pop();
    }
  }

  return {
    bodyContent: bodyLines.join("\n").trim(),
    relatedLinks,
    actionSections,
  };
};

const cleanInlineText = (value: string): string =>
  value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~"]/g, "")
    .replace(/\s+/g, " ")
    .trim();

type PlainCodeBlockProps = {
  className?: string;
  codeText: string;
  codeProps?: Record<string, unknown>;
};

function PlainCodeBlock({ className, codeText, codeProps }: PlainCodeBlockProps) {
  return (
    <pre>
      <code className={className} {...codeProps}>
        {codeText}
      </code>
    </pre>
  );
}

export function DocReader({ doc, docs, onSelectDoc }: DocReaderProps) {
  const [copiedBlockKey, setCopiedBlockKey] = useState<string | null>(null);

  const getOutlineHeadingId = createHeadingAnchorFactory();
  const getOtherHeadingId = createHeadingAnchorFactory();
  const docContent = doc?.content ?? "";
  const { bodyContent, relatedLinks, actionSections } = useMemo(() => extractDocExtras(docContent), [docContent]);
  const shouldPrefetchHighlightedCode = useMemo(() => hasHighlightableCodeBlocks(docContent), [docContent]);

  useEffect(() => {
    if (!doc || !shouldPrefetchHighlightedCode) {
      return;
    }

    let timeoutId: number | null = null;
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    const preload = () => {
      void preloadHighlightedCodeBlock();
    };

    if (typeof idleWindow.requestIdleCallback === "function") {
      const idleId = idleWindow.requestIdleCallback(() => preload(), { timeout: 1200 });

      return () => {
        if (typeof idleWindow.cancelIdleCallback === "function") {
          idleWindow.cancelIdleCallback(idleId);
        }
      };
    }

    timeoutId = window.setTimeout(preload, 180);

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [doc, shouldPrefetchHighlightedCode]);

  if (!doc) {
    return null;
  }

  const currentIndex = docs.findIndex((entry) => entry.slug === doc.slug);
  const prevDoc = currentIndex > 0 ? docs[currentIndex - 1] : null;
  const nextDoc = currentIndex >= 0 && currentIndex < docs.length - 1 ? docs[currentIndex + 1] : null;

  const copyCode = async (value: string, blockKey: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedBlockKey(blockKey);
      window.setTimeout(() => setCopiedBlockKey((current) => (current === blockKey ? null : current)), 1200);
    } catch {
      setCopiedBlockKey(null);
    }
  };

  return (
    <section id="reader" className="pixel-card min-w-0 p-4 md:p-6 scroll-mt-24">
      <div className="mb-4 flex flex-col gap-4 border-b border-border pb-4 md:mb-5 md:flex-row md:flex-wrap md:items-start md:justify-between md:gap-3 md:pb-3">
        <div className="min-w-0">
          <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">Markdown Reader</p>
          <h1 className="text-2xl font-display font-bold tracking-wide text-foreground md:text-3xl">{doc.title}</h1>
          <code className="block break-all text-[11px] text-primary/85 md:text-xs">{doc.source}</code>
        </div>
        <div
          className={`grid w-full min-w-0 gap-2 ${prevDoc && nextDoc ? "grid-cols-2" : "grid-cols-1"} md:flex md:w-auto md:flex-wrap md:items-center`}
        >
          {prevDoc && (
            <button
              type="button"
              onClick={() => onSelectDoc(prevDoc.slug)}
              className="doc-nav-btn min-w-0 w-full md:w-auto"
              title={prevDoc.title}
            >
              <span className="doc-nav-kicker">Prev</span>
              <span className="doc-nav-label">{prevDoc.title}</span>
            </button>
          )}
          {nextDoc && (
            <button
              type="button"
              onClick={() => onSelectDoc(nextDoc.slug)}
              className="doc-nav-btn min-w-0 w-full md:w-auto"
              title={nextDoc.title}
            >
              <span className="doc-nav-kicker">Next</span>
              <span className="doc-nav-label">{nextDoc.title}</span>
            </button>
          )}
        </div>
      </div>

      <div className="md-content">
        {actionSections.length > 0 && (
          <div className="mb-8 space-y-4">
            {actionSections.map((section) => (
              <div key={section.title} className="rounded-none border-2 border-border bg-card/55 p-4 md:p-5">
                <div className="mb-3">
                  <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground md:text-xs">
                    {section.title}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {section.items.map((item) => {
                    const linkedDoc = item.slug ? docs.find((entry) => entry.slug === item.slug) ?? null : null;
                    const title = linkedDoc?.title ?? item.label;
                    const description = linkedDoc?.description ?? "";
                    const note = item.note;

                    if (item.slug) {
                      return (
                        <button
                          key={`${section.title}:${item.href}:${title}`}
                          type="button"
                          onClick={() => onSelectDoc(item.slug!)}
                          className="group rounded-none border-2 border-border bg-background/65 p-4 text-left transition-colors hover:border-primary/60 hover:bg-background"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="font-display text-lg font-semibold text-foreground">{title}</h3>
                            <CornerDownRight className="mt-1 h-4 w-4 shrink-0 text-primary/80 transition-transform group-hover:translate-x-0.5 group-hover:translate-y-0.5" />
                          </div>
                          {note && <p className="mt-2 text-sm leading-6 text-primary/85">{note}</p>}
                          {description && <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>}
                        </button>
                      );
                    }

                    return (
                      <a
                        key={`${section.title}:${item.href}:${title}`}
                        href={item.href}
                        target="_blank"
                        rel="noreferrer"
                        className="group rounded-none border-2 border-border bg-background/65 p-4 text-left transition-colors hover:border-primary/60 hover:bg-background"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="font-display text-lg font-semibold text-foreground">{title}</h3>
                          <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-primary/80 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                        </div>
                        {note && <p className="mt-2 text-sm leading-6 text-primary/85">{note}</p>}
                        {description && <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>}
                      </a>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          components={{
            h1: ({ children }) => {
              const id = getOtherHeadingId(toPlainText(children));
              return <h1 id={id}>{children}</h1>;
            },
            h2: ({ children }) => {
              const id = getOutlineHeadingId(toPlainText(children));
              return (
                <h2 id={id} data-doc-heading="h2">
                  {children}
                </h2>
              );
            },
            h3: ({ children }) => {
              const id = getOutlineHeadingId(toPlainText(children));
              return (
                <h3 id={id} data-doc-heading="h3">
                  {children}
                </h3>
              );
            },
            h4: ({ children }) => {
              const id = getOtherHeadingId(toPlainText(children));
              return <h4 id={id}>{children}</h4>;
            },
            a: ({ href = "", children, className }) => {
              const isRouteCard = (className ?? "").split(" ").includes("route-card");

              if (href.startsWith("#")) {
                return (
                  <a href={href} className={isRouteCard ? "route-card" : "md-link"}>
                    {children}
                  </a>
                );
              }

              const internalSlug = resolveDocSlug(href);

              if (internalSlug) {
                const linkClassName = isRouteCard ? "route-card route-card-button" : "md-link md-link-button";

                return (
                  <button type="button" onClick={() => onSelectDoc(internalSlug)} className={linkClassName}>
                    <span>{children}</span>
                    {!isRouteCard && <CornerDownRight className="inline-block ml-1 h-3.5 w-3.5" />}
                  </button>
                );
              }

              return (
                <a href={href} className={isRouteCard ? "route-card" : "md-link"} target="_blank" rel="noreferrer">
                  <span>{children}</span>
                  {!isRouteCard && <ExternalLink className="inline-block ml-1 h-3.5 w-3.5" />}
                </a>
              );
            },
            code: ({ inline, className, children, ...props }) => {
              const codeText = String(children).replace(/\n$/, "");
              const isInline = Boolean(inline) || (!className && !codeText.includes("\n"));

              if (isInline) {
                return (
                  <code className={`md-inline-code ${className ?? ""}`.trim()} {...props}>
                    {children}
                  </code>
                );
              }

              const language = extractCodeLanguage(className);
              const normalizedLanguage = normalizeCodeLanguage(language);
              const blockKey = `${language}:${codeText.slice(0, 120)}`;
              const copied = copiedBlockKey === blockKey;

              return (
                <div className="md-code-block">
                  <div className="md-code-meta">
                    <span className="md-code-lang">{language}</span>
                    <button
                      type="button"
                      onClick={() => void copyCode(codeText, blockKey)}
                      className="md-code-copy"
                      data-copied={copied ? "true" : "false"}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  {normalizedLanguage ? (
                    <Suspense
                      fallback={<PlainCodeBlock className={className} codeProps={props} codeText={codeText} />}
                    >
                      <HighlightedCodeBlock
                        className={className}
                        codeProps={props}
                        codeText={codeText}
                        language={normalizedLanguage}
                      />
                    </Suspense>
                  ) : (
                    <PlainCodeBlock className={className} codeProps={props} codeText={codeText} />
                  )}
                </div>
              );
            },
          }}
        >
          {bodyContent}
        </ReactMarkdown>
      </div>

      {relatedLinks.length > 0 && (
        <div className="mt-8 border-t border-border pt-6">
          <div className="mb-4">
            <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground md:text-xs">
              Related Pages
            </p>
            <h2 className="mt-1 font-display text-xl font-bold tracking-wide text-foreground">Keep Reading</h2>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {relatedLinks.map((link) => {
              const relatedDoc = link.slug ? docs.find((entry) => entry.slug === link.slug) ?? null : null;
              const title = relatedDoc?.title ?? link.label;
              const description = relatedDoc?.description ?? "";

              if (link.slug) {
                return (
                  <button
                    key={`${link.href}:${title}`}
                    type="button"
                    onClick={() => onSelectDoc(link.slug!)}
                    className="group rounded-none border-2 border-border bg-card/75 p-4 text-left transition-colors hover:border-primary/60 hover:bg-card"
                  >
                    <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                      Internal doc
                    </p>
                    <div className="mt-2 flex items-start justify-between gap-3">
                      <h3 className="font-display text-lg font-semibold text-foreground">{title}</h3>
                      <CornerDownRight className="mt-1 h-4 w-4 shrink-0 text-primary/80 transition-transform group-hover:translate-x-0.5 group-hover:translate-y-0.5" />
                    </div>
                    {description && <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>}
                  </button>
                );
              }

              return (
                <a
                  key={`${link.href}:${title}`}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="group rounded-none border-2 border-border bg-card/75 p-4 text-left transition-colors hover:border-primary/60 hover:bg-card"
                >
                  <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                    External link
                  </p>
                  <div className="mt-2 flex items-start justify-between gap-3">
                    <h3 className="font-display text-lg font-semibold text-foreground">{title}</h3>
                    <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-primary/80 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  </div>
                  {description && <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>}
                </a>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
