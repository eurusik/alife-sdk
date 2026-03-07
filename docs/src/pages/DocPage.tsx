import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { DocReader } from "@/components/DocReader";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  docsFlat,
  docsSections,
  getDocBySlug,
  topNavDocItems,
  type DocHeading,
  type DocGroup,
  type DocSection,
} from "@/content/docsRegistry";
import { buildDocSeo, buildNotFoundSeo, useSeo } from "@/lib/seo";
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
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const activeSectionId = sections.find((section) => section.docs.some((doc) => doc.slug === activeSlug))?.id;
    const activeGroupKey = sections
      .flatMap((section) => section.groups.map((group) => ({ sectionId: section.id, group })))
      .find(({ group }) => group.docs.some((doc) => doc.slug === activeSlug));

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
    setCollapsedGroups((prev) => {
      const next: Record<string, boolean> = {};

      for (const section of sections) {
        for (const group of section.groups) {
          const key = `${section.id}:${group.id}`;

          if (query.trim()) {
            next[key] = false;
            continue;
          }

          if (activeGroupKey?.sectionId === section.id && activeGroupKey.group.id === group.id) {
            next[key] = false;
            continue;
          }

          next[key] = prev[key] ?? true;
        }
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

  const toggleGroup = (sectionId: string, groupId: string) => {
    const key = `${sectionId}:${groupId}`;

    setCollapsedGroups((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const renderDocButton = (docSlug: string, docTitle: string) => {
    const active = docSlug === activeSlug;

    return (
      <button
        key={docSlug}
        type="button"
        onClick={() => {
          onOpenDoc(docSlug);
          onAfterClick?.();
        }}
        className={`docs-nav-item ${active ? "docs-nav-item-active" : ""}`}
      >
        {docTitle}
      </button>
    );
  };

  const renderGroupedDocs = (section: DocSection, group: DocGroup) => {
    const key = `${section.id}:${group.id}`;
    const collapsed = collapsedGroups[key] ?? false;

    return (
      <div key={group.id} className="mt-3">
        <button
          type="button"
          onClick={() => toggleGroup(section.id, group.id)}
          className="flex w-full items-center gap-2 px-2 py-1 text-left text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
        >
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          <span>{group.title}</span>
          <span className="ml-auto text-[10px] text-muted-foreground/80">{group.docs.length}</span>
        </button>
        {!collapsed && <div className="mt-1 space-y-1">{group.docs.map((doc) => renderDocButton(doc.slug, doc.title))}</div>}
      </div>
    );
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
              <div className="mt-1">
                {section.ungroupedDocs.length > 0 && (
                  <div className="space-y-1">{section.ungroupedDocs.map((doc) => renderDocButton(doc.slug, doc.title))}</div>
                )}
                {section.groups.map((group) => renderGroupedDocs(section, group))}
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
        ungroupedDocs: docs.filter((doc) => !doc.groupId),
        groups: section.groups
          .map((group) => ({
            ...group,
            docs: group.docs.filter((doc) => docs.some((visibleDoc) => visibleDoc.slug === doc.slug)),
          }))
          .filter((group) => group.docs.length > 0),
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
  const [mobileTocOpen, setMobileTocOpen] = useState(false);
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
  const currentSection = useMemo(
    () => docsSections.find((section) => section.id === currentDoc?.sectionId) ?? null,
    [currentDoc?.sectionId],
  );
  const currentGroup = useMemo(
    () => currentSection?.groups.find((group) => group.id === currentDoc?.groupId) ?? null,
    [currentDoc?.groupId, currentSection],
  );
  const seo = useMemo(
    () =>
      currentDoc
        ? buildDocSeo({
            title: currentDoc.title,
            description: currentDoc.description,
            path: location.pathname,
            sectionTitle: currentSection?.title,
            groupTitle: currentGroup?.title,
          })
        : buildNotFoundSeo(location.pathname),
    [currentDoc, currentGroup?.title, currentSection?.title, location.pathname],
  );
  const activeHeadingText = useMemo(() => {
    const activeHeading = headings.find((heading) => heading.id === activeHeadingId);
    return activeHeading?.text.replace(/^\d+\.\s+/, "") ?? "";
  }, [activeHeadingId, headings]);

  useSeo(seo);

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

  useEffect(() => {
    setMobileMenuOpen(false);
    setMobileTocOpen(false);
  }, [currentDoc?.slug]);

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
        contextItems={[
          {
            label: currentSection?.title ?? currentDoc.sectionId,
            href: currentSection ? `/docs/${currentSection.docs[0]?.slug ?? currentDoc.slug}` : undefined,
          },
          currentGroup
            ? {
                label: currentGroup.title,
                href: `/docs/${currentGroup.docs[0]?.slug ?? currentDoc.slug}`,
              }
            : null,
          { label: currentDoc.title },
        ].filter((item): item is { label: string; href?: string } => Boolean(item))}
        onQueryChange={setQueryInput}
        onOpenMenu={() => setMobileMenuOpen(true)}
      />

      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent
          side="left"
          hideClose
          className="w-[88vw] max-w-[360px] border-r-2 border-border bg-background p-0 text-foreground sm:max-w-[360px]"
        >
          <div className="flex h-full flex-col">
            <SheetHeader className="border-b border-border px-4 py-4 text-left">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <SheetTitle className="text-sm font-display font-bold uppercase tracking-wide text-foreground">
                    Docs Navigation
                  </SheetTitle>
                  <SheetDescription className="mt-1 text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                    {currentSection?.title ?? currentDoc.sectionId} • {currentSection?.docs.length ?? 0} docs
                  </SheetDescription>
                </div>
                <SheetClose asChild>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center border-2 border-border bg-secondary px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                  >
                    Close
                  </button>
                </SheetClose>
              </div>
              {currentSection?.summary && (
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{currentSection.summary}</p>
              )}
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <DocsTree
                sections={visibleSections}
                activeSlug={currentDoc.slug}
                query={debouncedQuery}
                onOpenDoc={openDoc}
                onAfterClick={() => setMobileMenuOpen(false)}
              />
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={mobileTocOpen} onOpenChange={setMobileTocOpen}>
        <SheetContent
          side="bottom"
          hideClose
          className="max-h-[82vh] rounded-t-[18px] border-2 border-b-0 border-border bg-background p-0 text-foreground"
        >
          <div className="mx-auto mt-2 h-1.5 w-16 rounded-full bg-border/80" />
          <div className="flex max-h-[82vh] flex-col overflow-hidden">
            <SheetHeader className="border-b border-border px-4 py-4 text-left">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <SheetTitle className="text-sm font-display font-bold uppercase tracking-wide text-foreground">
                    On This Page
                  </SheetTitle>
                  <SheetDescription className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
                    {activeHeadingText || currentDoc.title}
                  </SheetDescription>
                </div>
                <SheetClose asChild>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center border-2 border-border bg-secondary px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                  >
                    Close
                  </button>
                </SheetClose>
              </div>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {headings.length === 0 ? (
                <p className="text-xs font-mono text-muted-foreground">No headings</p>
              ) : (
                <nav className="space-y-1">
                  {headings.map((heading) => {
                    const active = heading.id === activeHeadingId;
                    const displayText = heading.text.replace(/^\d+\.\s+/, "");

                    return (
                      <a
                        key={heading.id}
                        href={`#${heading.id}`}
                        title={displayText}
                        onClick={() => setMobileTocOpen(false)}
                        className={`toc-link ${active ? "toc-link-active" : ""} ${heading.level === 3 ? "pl-4" : ""}`}
                      >
                        <span className="toc-link-text">{displayText}</span>
                      </a>
                    );
                  })}
                </nav>
              )}
            </div>
            <div className="border-t border-border px-4 py-3">
              <a
                href="#reader"
                onClick={() => setMobileTocOpen(false)}
                className="toc-back-link inline-flex"
              >
                ↑ Back to top
              </a>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <div className="mx-auto flex w-full max-w-[1500px] px-3 sm:px-4 md:px-6">
        <aside className="hidden w-72 shrink-0 border-r-2 border-border/80 bg-card/75 p-4 lg:block">
          <DocsTree sections={visibleSections} activeSlug={currentDoc.slug} query={debouncedQuery} onOpenDoc={openDoc} />
        </aside>

        <main className="min-w-0 flex-1 py-5 md:py-8 lg:px-8">
          <div className="mx-auto w-full min-w-0 max-w-[780px] space-y-4 md:space-y-6">
            <section className="pixel-card p-3 md:p-4">
              <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground md:text-xs md:tracking-wide">
                <Link to="/" className="md-link">
                  Docs
                </Link>{" "}
                / {currentSection?.title ?? currentDoc.sectionId} / {currentDoc.title}
              </p>
            </section>

            <div className="grid w-full min-w-0 gap-2 grid-cols-2 lg:grid-cols-1 xl:hidden">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="inline-flex min-w-0 flex-col items-start justify-center border-2 border-border bg-secondary px-3 py-2.5 text-left transition-colors hover:border-primary/50 hover:text-foreground lg:hidden"
              >
                <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">Sections</span>
                <span className="mt-1 block w-full truncate font-display text-sm font-semibold text-foreground">
                  {currentSection?.title ?? currentDoc.sectionId}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setMobileTocOpen(true)}
                className="inline-flex min-w-0 flex-col items-start justify-center border-2 border-border bg-secondary px-3 py-2.5 text-left transition-colors hover:border-primary/50 hover:text-foreground"
              >
                <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                  Outline <span className="ml-1 text-primary/80">{headings.length}</span>
                </span>
                <span className="mt-1 block w-full truncate font-display text-sm font-semibold text-foreground">
                  {activeHeadingText || "Open page outline"}
                </span>
              </button>
            </div>

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
