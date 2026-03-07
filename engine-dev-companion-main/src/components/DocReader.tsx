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
          {doc.content}
        </ReactMarkdown>
      </div>
    </section>
  );
}
