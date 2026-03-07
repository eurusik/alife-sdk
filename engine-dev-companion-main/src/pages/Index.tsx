import { useEffect, useMemo, useState } from "react";
import { ChevronUp } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { DocSidebar, MobileSidebar } from "@/components/DocSidebar";
import { HeroSection } from "@/components/HeroSection";
import { FeatureCards } from "@/components/FeatureCards";
import { docsSections, topNavItems, type DocSection } from "@/content/docsRegistry";

const SEARCH_DEBOUNCE_MS = 180;

const filterSections = (sections: DocSection[], rawQuery: string): DocSection[] => {
  const query = rawQuery.trim().toLowerCase();

  if (!query) {
    return sections;
  }

  return sections
    .map((section) => {
      const sectionHit = [section.id, section.title, section.summary].some((field) =>
        field.toLowerCase().includes(query),
      );

      const matchingDocs = section.docs.filter((doc) => doc.searchText.includes(query));

      if (!sectionHit && !matchingDocs.length) {
        return null;
      }

      return {
        ...section,
        docs: sectionHit && !matchingDocs.length ? section.docs : matchingDocs,
      };
    })
    .filter((section): section is DocSection => Boolean(section));
};

const Index = () => {
  const [queryInput, setQueryInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(queryInput.trim());
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [queryInput]);

  const filteredSections = useMemo(() => filterSections(docsSections, debouncedQuery), [debouncedQuery]);
  const sectionIds = useMemo(() => filteredSections.map((section) => section.id), [filteredSections]);

  const [activeSectionId, setActiveSectionId] = useState(sectionIds[0] ?? "quickstart");

  useEffect(() => {
    if (!sectionIds.length) {
      setActiveSectionId("quickstart");
      return;
    }

    if (!sectionIds.includes(activeSectionId)) {
      setActiveSectionId(sectionIds[0]);
    }
  }, [activeSectionId, sectionIds]);

  useEffect(() => {
    const targets = sectionIds
      .map((id) => document.getElementById(id))
      .filter((node): node is HTMLElement => Boolean(node));

    if (!targets.length) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

        if (visible[0]?.target.id) {
          setActiveSectionId(visible[0].target.id);
        }
      },
      {
        rootMargin: "-35% 0px -50% 0px",
        threshold: [0.1, 0.2, 0.4],
      },
    );

    targets.forEach((target) => observer.observe(target));

    return () => {
      targets.forEach((target) => observer.unobserve(target));
      observer.disconnect();
    };
  }, [sectionIds]);

  useEffect(() => {
    const onScroll = () => {
      setShowBackToTop(window.scrollY > 380);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const clearQuery = () => {
    setQueryInput("");
    setDebouncedQuery("");
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader
        activeSectionId={activeSectionId}
        query={queryInput}
        navItems={topNavItems}
        onQueryChange={setQueryInput}
        onOpenMenu={() => setMobileMenuOpen(true)}
      />

      <MobileSidebar
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        activeSectionId={activeSectionId}
        sections={filteredSections}
      />

      <div className="mx-auto flex w-full max-w-[1360px] px-4 md:px-6">
        <DocSidebar activeSectionId={activeSectionId} sections={filteredSections} />
        <main className="flex-1 py-8 lg:pl-8">
          <div className="mx-auto w-full max-w-[980px] space-y-8">
            <HeroSection />
            <FeatureCards sections={filteredSections} query={debouncedQuery} onClearQuery={clearQuery} />
          </div>
        </main>
      </div>

      {showBackToTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-5 right-5 z-50 inline-flex items-center gap-1 border-2 border-primary bg-primary/15 px-3 py-2 text-xs font-mono text-primary pixel-btn"
          aria-label="Back to top"
        >
          <ChevronUp className="h-4 w-4" />
          Top
        </button>
      )}
    </div>
  );
};

export default Index;
