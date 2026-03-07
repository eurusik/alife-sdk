import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ChevronDown, ChevronRight, Menu, X } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { DocReader } from "@/components/DocReader";
import {
  docsFlat,
  docsSections,
  getDocBySlug,
  topNavDocItems,
  type DocHeading,
  type DocSection,
} from "@/content/docsRegistry";
import { scanHeadingsFromDom } from "@/pages/docToc";

const SEARCH_DEBOUNCE_MS = 180;
const TOC_OBSERVER_ROOT_MARGIN = "-90px 0px -72% 0px";
const TOC_SCROLL_SYNC_DELAY_MS = 60;
const TOC_SCROLL_TARGET_Y = 220;

type DocsTreeProps = {
  sections: DocSection[];
  activeSlug: string;
  query: string;
  onOpenDoc: (slug: string) => void;
  onAfterClick?: () => void;
};

function DocsTree({ sections, activeSlug, query, onOpenDoc, onAfterClick }: DocsTreeProps) {
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const activeSectionId = sections.find((section) => section.docs.some((doc) => doc.slug === activeSlug))?.id;

    setCollapsedSections((prev) => {
      const next: Record<string, boolean> = {};

      for (const section of sections) {
        if (query.trim()) {
          next[section.id] = false;
          continue;
        }

        if (section.id === activeSectionId) {
          next[section.id] = false;
          continue;
        }

        next[section.id] = prev[section.id] ?? true;
      }

      return next;
    });
  }, [activeSlug, query, sections]);

  const toggleSection = (sectionId: string) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  return (
    <div className="space-y-5">
      {sections.map((section) => {
        const collapsed = collapsedSections[section.id] ?? false;

        return (
          <section key={section.id}>
            <button
              type="button"
              onClick={() => toggleSection(section.id)}
              className="docs-section-toggle"
            >
              {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              <span>{section.title}</span>
            </button>
            {!collapsed && (
              <div className="mt-1 space-y-1">
                {section.docs.map((doc) => {
                  const active = doc.slug === activeSlug;

                  return (
                    <button
                      key={doc.slug}
                      type="button"
                      onClick={() => {
                        onOpenDoc(doc.slug);
                        onAfterClick?.();
                      }}
                      className={`docs-nav-item ${active ? "docs-nav-item-active" : ""}`}
                    >
                      {doc.title}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

const filterSections = (sections: DocSection[], query: string): DocSection[] => {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return sections;
  }

  return sections
    .map((section) => {
      const docs = section.docs.filter((doc) =>
        [doc.title, doc.description, doc.searchText].some((field) => field.toLowerCase().includes(normalized)),
      );

      if (!docs.length) {
        return null;
      }

      return {
        ...section,
        docs,
      };
    })
    .filter((section): section is DocSection => Boolean(section));
};

const areHeadingsEqual = (a: DocHeading[], b: DocHeading[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i += 1) {
    if (a[i].id !== b[i].id || a[i].text !== b[i].text || a[i].level !== b[i].level) {
      return false;
    }
  }

  return true;
};

const DocPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();

  const rawSlug = params["*"] ?? "";

  const [queryInput, setQueryInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [headings, setHeadings] = useState<DocHeading[]>([]);
  const [activeHeadingId, setActiveHeadingId] = useState<string>("");

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(queryInput.trim());
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [queryInput]);

  const currentDoc = useMemo(() => getDocBySlug(rawSlug), [rawSlug]);

  useEffect(() => {
    if (!currentDoc) {
      return;
    }

    if (rawSlug !== currentDoc.slug) {
      navigate(`/docs/${currentDoc.slug}`, { replace: true });
    }
  }, [currentDoc, navigate, rawSlug]);

  const visibleSections = useMemo(() => filterSections(docsSections, debouncedQuery), [debouncedQuery]);

  useEffect(() => {
    let frame = 0;

    const syncHeadings = () => {
      const root = document.querySelector("#reader .md-content");
      const next = scanHeadingsFromDom(root);

      setHeadings((prev) => (areHeadingsEqual(prev, next) ? prev : next));
    };

    syncHeadings();
    frame = window.requestAnimationFrame(syncHeadings);

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [currentDoc?.slug]);

  useEffect(() => {
    if (!currentDoc || !headings.length) {
      return;
    }

    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }

    const hashId = decodeURIComponent(location.hash.replace(/^#/, ""));
    const hasHashTarget = Boolean(hashId) && headings.some((heading) => heading.id === hashId);

    let firstFrame = 0;
    let secondFrame = 0;

    const syncScrollPosition = () => {
      if (hasHashTarget) {
        const target = document.getElementById(hashId);
        if (target) {
          target.scrollIntoView({ block: "start" });
          setActiveHeadingId(hashId);
          return;
        }
      }

      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      setActiveHeadingId(headings[0]?.id ?? "");
    };

    firstFrame = window.requestAnimationFrame(() => {
      syncScrollPosition();
      secondFrame = window.requestAnimationFrame(syncScrollPosition);
    });

    return () => {
      if (firstFrame) {
        window.cancelAnimationFrame(firstFrame);
      }
      if (secondFrame) {
        window.cancelAnimationFrame(secondFrame);
      }
    };
  }, [currentDoc, headings, location.hash]);

  useEffect(() => {
    const nodes = headings
      .map((heading) => document.getElementById(heading.id))
      .filter((node): node is HTMLElement => Boolean(node));

    if (!nodes.length) {
      setActiveHeadingId("");
      return;
    }

    const hashId = decodeURIComponent(location.hash.replace(/^#/, ""));
    const hasHashTarget = Boolean(hashId) && headings.some((heading) => heading.id === hashId);
    const intersectionState = new Map<string, boolean>();
    let scrollSyncTimeout = 0;
    let hashPriorityLocked = hasHashTarget;
    const hashPriorityUnlockAt = performance.now() + 800;

    const syncFromIntersections = () => {
      const visible = headings.filter((heading) => intersectionState.get(heading.id));

      if (!visible.length) {
        return;
      }

      const nextActiveId = visible[visible.length - 1].id;
      setActiveHeadingId((prev) => (prev === nextActiveId ? prev : nextActiveId));
    };

    const syncFromScrollPosition = () => {
      const positions = headings
        .map((heading) => {
          const element = document.getElementById(heading.id);

          if (!element) {
            return null;
          }

          return {
            id: heading.id,
            top: element.offsetTop - window.scrollY,
          };
        })
        .filter((item): item is { id: string; top: number } => item !== null);

      if (!positions.length) {
        return;
      }

      const passed = positions.filter((item) => item.top <= TOC_SCROLL_TARGET_Y);
      const nextActiveId = passed.length ? passed[passed.length - 1].id : positions[0].id;
      setActiveHeadingId((prev) => (prev === nextActiveId ? prev : nextActiveId));
    };

    const scheduleScrollSync = () => {
      if (hashPriorityLocked && performance.now() < hashPriorityUnlockAt) {
        return;
      }

      hashPriorityLocked = false;

      if (scrollSyncTimeout) {
        window.clearTimeout(scrollSyncTimeout);
      }

      scrollSyncTimeout = window.setTimeout(() => {
        scrollSyncTimeout = 0;
        syncFromScrollPosition();
      }, TOC_SCROLL_SYNC_DELAY_MS);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (hashPriorityLocked) {
          return;
        }

        for (const entry of entries) {
          intersectionState.set(entry.target.id, entry.isIntersecting);
        }

        syncFromIntersections();
      },
      {
        rootMargin: TOC_OBSERVER_ROOT_MARGIN,
        threshold: [0, 1],
      },
    );

    setActiveHeadingId(hasHashTarget ? hashId : headings[0]?.id ?? "");
    nodes.forEach((node) => observer.observe(node));
    window.addEventListener("scroll", scheduleScrollSync, { passive: true });
    window.addEventListener("resize", scheduleScrollSync);
    window.addEventListener("hashchange", scheduleScrollSync);

    return () => {
      if (scrollSyncTimeout) {
        window.clearTimeout(scrollSyncTimeout);
      }
      observer.disconnect();
      window.removeEventListener("scroll", scheduleScrollSync);
      window.removeEventListener("resize", scheduleScrollSync);
      window.removeEventListener("hashchange", scheduleScrollSync);
    };
  }, [headings, currentDoc?.slug, location.hash]);

  const openDoc = (slug: string) => {
    navigate(`/docs/${slug}`);
  };

  if (!currentDoc) {
    return (
      <div className="min-h-screen bg-background px-6 py-12 text-center">
        <p className="font-mono text-muted-foreground">Document not found.</p>
        <Link to="/" className="mt-4 inline-block border-2 border-primary bg-primary/15 px-4 py-2 text-xs font-mono text-primary">
          Back to docs index
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader
        activeSectionId={currentDoc.sectionId}
        query={queryInput}
        navItems={topNavDocItems}
        quickstartHref="/docs/quick-start"
        onQueryChange={setQueryInput}
        onOpenMenu={() => setMobileMenuOpen(true)}
      />

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileMenuOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          <aside className="relative h-full w-80 max-w-[90vw] border-r-2 border-border bg-background p-4">
            <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
              <p className="text-sm font-display font-bold uppercase tracking-wide text-foreground">Docs Navigation</p>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="inline-flex items-center justify-center border-2 border-border bg-secondary p-1.5 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <DocsTree
              sections={visibleSections}
              activeSlug={currentDoc.slug}
              query={debouncedQuery}
              onOpenDoc={openDoc}
              onAfterClick={() => setMobileMenuOpen(false)}
            />
          </aside>
        </div>
      )}

      <div className="mx-auto flex w-full max-w-[1500px] px-4 md:px-6">
        <aside className="hidden w-72 shrink-0 border-r-2 border-border/80 bg-card/75 p-4 lg:block">
          <DocsTree sections={visibleSections} activeSlug={currentDoc.slug} query={debouncedQuery} onOpenDoc={openDoc} />
        </aside>

        <main className="flex-1 py-8 lg:px-8">
          <div className="mx-auto max-w-[780px] space-y-6">
            <section className="pixel-card p-4">
              <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
                <Link to="/" className="md-link">
                  Docs
                </Link>{" "}
                / {currentDoc.sectionId} / {currentDoc.slug}
              </p>
            </section>
            <DocReader doc={currentDoc} docs={docsFlat} onSelectDoc={openDoc} />
          </div>
        </main>

        <aside className="hidden w-64 shrink-0 py-8 xl:block">
          <div className="sticky top-[115px] pixel-card p-4 max-h-[calc(100vh-132px)] overflow-y-auto">
            <p className="mb-3 text-xs font-mono uppercase tracking-wide text-muted-foreground">On This Page</p>
            {headings.length === 0 ? (
              <p className="text-xs font-mono text-muted-foreground">No headings</p>
            ) : (
              <nav className="space-y-0.5">
                {headings.map((heading) => {
                  const active = heading.id === activeHeadingId;
                  const displayText = heading.text.replace(/^\d+\.\s+/, "");

                  return (
                    <a
                      key={heading.id}
                      href={`#${heading.id}`}
                      title={displayText}
                      className={`toc-link ${active ? "toc-link-active" : ""} ${heading.level === 3 ? "pl-3" : ""}`}
                    >
                      <span className="toc-link-text">{displayText}</span>
                    </a>
                  );
                })}
              </nav>
            )}
            <div className="mt-3 border-t border-border/70 pt-2">
              <a href="#reader" className="toc-back-link">
                ↑ Back to top
              </a>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default DocPage;
