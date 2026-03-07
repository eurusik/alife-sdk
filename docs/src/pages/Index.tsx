import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  BrainCircuit,
  Boxes,
  ChevronUp,
  Cpu,
  ExternalLink,
  Flame,
  FolderTree,
  Gamepad2,
  Layers3,
  Orbit,
  RadioTower,
} from "lucide-react";
import heroAlife from "@/assets/hero-alife.webp";
import { SiteHeader } from "@/components/SiteHeader";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { docsFlat } from "@/content/docsRegistry";
import { buildHomeSeo, useSeo } from "@/lib/seo";

const LANDING_SECTIONS = [
  {
    id: "hero",
    title: "Overview",
    summary: "What the SDK is, which problem it addresses, and how to read the page.",
  },
  {
    id: "proof",
    title: "What It Solves",
    summary: "What changes when you add the SDK and what you can validate in one small scene.",
  },
  {
    id: "architecture",
    title: "Architecture",
    summary: "How the SDK integrates through ports without replacing your engine.",
  },
  {
    id: "routes",
    title: "Entry Points",
    summary: "Direct paths into the docs based on the next integration question.",
  },
] as const;

const LANDING_NAV_ITEMS = LANDING_SECTIONS.map((section) => ({
  id: section.id,
  title: section.title,
  href: `#${section.id}`,
}));

const VALUE_PILLARS: Array<{
  title: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    title: "Off-screen world simulation",
    description: "NPCs can keep moving, working, fighting, or changing state when they are not rendered.",
    icon: RadioTower,
  },
  {
    title: "Observed NPC behavior",
    description: "Nearby NPCs can switch to more expensive behavior only when the player can actually observe them.",
    icon: Gamepad2,
  },
  {
    title: "Engine ownership stays in your game",
    description: "Rendering, physics, scene graph, entities, and animation remain inside your game code.",
    icon: Layers3,
  },
  {
    title: "Add packages only when needed",
    description: "Start with core and simulation, then add AI, hazards, economy, persistence, or engine adapters only when needed.",
    icon: Orbit,
  },
];

const ARCHITECTURE_FLOW: Array<{
  title: string;
  detail: string;
  icon: LucideIcon;
}> = [
  {
    title: "Your Engine",
    detail: "entities, rendering, animation, physics",
    icon: Gamepad2,
  },
  {
    title: "Ports Layer",
    detail: "entity adapter, player position, factories, save transport",
    icon: FolderTree,
  },
  {
    title: "Kernel",
    detail: "lifecycle, events, plugin order",
    icon: Cpu,
  },
  {
    title: "Packages",
    detail: "simulation, AI, hazards, economy, persistence, social, phaser",
    icon: Boxes,
  },
  {
    title: "Living World Runtime",
    detail: "NPC lifecycle, online/offline handoff, world progression",
    icon: BrainCircuit,
  },
];

const SUPPORTED_TODAY = ["Phaser 3", "Custom engines", "Node 20+"];

const ROUTE_CTA_LABELS: Record<string, string> = {
  "Quick Start": "Open quick start",
  "First Living World": "Open guide",
  "Phaser Integration": "Open integration guide",
  Packages: "Open packages",
};

const resolveDoc = (
  slug: string,
  fallback: { title: string; description: string },
): { slug: string; title: string; description: string; href: string } => {
  const doc = docsFlat.find((entry) => entry.slug === slug);

  return {
    slug: doc?.slug ?? slug,
    title: doc?.title ?? fallback.title,
    description: doc?.description ?? fallback.description,
    href: `/docs/${doc?.slug ?? slug}`,
  };
};

const ROUTE_CARDS: Array<{
  label: string;
  eyebrow: string;
  detail: string;
  icon: LucideIcon;
  doc: { slug: string; title: string; description: string; href: string };
}> = [
  {
    eyebrow: "Start here",
    label: "Quick Start",
    detail: "The fastest path from install to one working proof.",
    icon: Flame,
    doc: resolveDoc("quick-start", {
      title: "Quick Start",
      description: "Boot the kernel and get the first tick running",
    }),
  },
  {
    eyebrow: "Minimal proof",
    label: "First Living World",
    detail: "Build one terrain, one faction, one NPC, and watch the loop come alive.",
    icon: Gamepad2,
    doc: resolveDoc("guides/first-living-world", {
      title: "First Living World",
      description: "The smallest proof that the world loop is alive",
    }),
  },
  {
    eyebrow: "Renderer integration",
    label: "Phaser Integration",
    detail: "Wire the SDK into a Phaser scene without giving up engine ownership.",
    icon: Gamepad2,
    doc: resolveDoc("guides/phaser-integration", {
      title: "Phaser Integration",
      description: "Integrate the SDK into a Phaser project",
    }),
  },
  {
    eyebrow: "Package boundaries",
    label: "Packages",
    detail: "See what each package adds and when to bring it in.",
    icon: Boxes,
    doc: resolveDoc("packages/index", {
      title: "Packages",
      description: "Inspect package boundaries and adoption order",
    }),
  },
];

const Index = () => {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const sectionIds = useMemo(() => LANDING_SECTIONS.map((section) => section.id), []);
  const [activeSectionId, setActiveSectionId] = useState(sectionIds[0] ?? "hero");
  const seo = useMemo(() => buildHomeSeo(location.pathname), [location.pathname]);

  useSeo(seo);

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
        rootMargin: "-28% 0px -48% 0px",
        threshold: [0.15, 0.35, 0.55],
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
      setShowBackToTop(window.scrollY > 420);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const activeSection = LANDING_SECTIONS.find((section) => section.id === activeSectionId) ?? LANDING_SECTIONS[0];

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader
        activeSectionId={activeSectionId}
        query=""
        navItems={LANDING_NAV_ITEMS}
        contextItems={[{ label: activeSection.title, href: `#${activeSectionId}` }]}
        showSearch={false}
        compactMobileNav
        onQueryChange={() => {}}
        onOpenMenu={() => setMobileMenuOpen(true)}
      />

      <Sheet
        open={mobileMenuOpen}
        onOpenChange={(nextOpen) => {
          setMobileMenuOpen(nextOpen);
        }}
      >
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
                    A-Life SDK
                  </SheetTitle>
                  <SheetDescription className="mt-1 text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                    {activeSection.title} • homepage sections
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
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Living-world SDK for 2D JavaScript and TypeScript games, inspired by the emergent A-Life simulation
                systems popularized by the S.T.A.L.K.E.R. series.
              </p>
            </SheetHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <nav className="space-y-2">
                {LANDING_SECTIONS.map((section) => {
                  const active = section.id === activeSectionId;

                  return (
                    <a
                      key={section.id}
                      href={`#${section.id}`}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`block border-2 px-3 py-3 transition-colors ${
                        active
                          ? "border-primary/45 bg-primary/10"
                          : "border-border bg-secondary/20 hover:border-primary/35 hover:bg-secondary/35"
                      }`}
                    >
                      <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                        {section.title}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{section.summary}</p>
                    </a>
                  );
                })}
              </nav>

              <div className="mt-5 grid grid-cols-1 gap-2">
                <Link
                  to="/docs/quick-start"
                  onClick={() => setMobileMenuOpen(false)}
                  className="inline-flex items-center justify-between border-2 border-primary bg-primary/12 px-3 py-3 text-sm font-display font-semibold text-primary"
                >
                  Open Quick Start
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  to="/docs/packages/index"
                  onClick={() => setMobileMenuOpen(false)}
                  className="inline-flex items-center justify-between border-2 border-border bg-secondary/20 px-3 py-3 text-sm font-display font-semibold text-foreground transition-colors hover:border-primary/35"
                >
                  Browse Packages
                  <ArrowRight className="h-4 w-4 text-primary/75" />
                </Link>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <main className="mx-auto w-full max-w-[1360px] px-4 pb-20 md:px-6">
        <section id="hero" className="scroll-mt-28 pt-8 md:pt-12">
          <div className="pixel-card relative min-h-[420px] overflow-hidden md:min-h-[500px] lg:min-h-[560px]">
            <div className="absolute inset-0 opacity-45">
              <img src={heroAlife} alt="" className="h-full w-full object-cover object-bottom" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(255,179,71,0.16),transparent_30%),linear-gradient(90deg,rgba(10,6,4,0.96)0%,rgba(11,7,5,0.86)34%,rgba(12,8,5,0.56)66%,rgba(8,4,3,0.88)100%)]" />
              <div className="absolute inset-0 scanline" />
            </div>

            <div className="relative min-w-0 px-6 py-8 md:px-8 md:py-10 lg:flex lg:h-full lg:items-center lg:px-10 lg:py-12 xl:px-12 xl:py-14">
              <div className="min-w-0 max-w-[900px]">
                <div className="flex flex-col gap-6 md:gap-7">
                  <p className="landing-kicker">Engine-agnostic A-Life SDK for 2D games</p>
                  <h1 className="max-w-[16ch] font-display text-[3.4rem] font-bold leading-[0.92] tracking-[0.01em] text-foreground md:text-[4.75rem] xl:text-[5.5rem]">
                    A-Life for 2D games: offline simulation, online NPC behavior.
                  </h1>
                  <p className="max-w-[56ch] text-base leading-8 text-muted-foreground md:text-[1.1rem] md:leading-9">
                    An A-Life SDK inspired by the S.T.A.L.K.E.R. series, built for off-screen world simulation and
                    real-time nearby NPC behavior with modular AI, factions, hazards, economy, and persistence.
                  </p>
                </div>

                <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <Link
                    to="/docs/quick-start"
                    className="inline-flex items-center justify-center gap-2 border-2 border-primary bg-primary/15 px-5 py-3 text-sm font-display font-bold uppercase tracking-wide text-primary pixel-btn"
                  >
                    Quick Start
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <a
                    href="https://github.com/eurusik/alife-sdk"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-2 border-2 border-border bg-secondary/35 px-5 py-3 text-sm font-display font-bold uppercase tracking-wide text-foreground transition-colors hover:border-primary/35 hover:text-primary"
                  >
                    GitHub
                    <ExternalLink className="h-4 w-4 text-primary/80" />
                  </a>
                </div>

                <div className="mt-8 flex max-w-[52ch] flex-wrap gap-2.5">
                  {SUPPORTED_TODAY.map((item) => (
                    <span
                      key={item}
                      className="inline-flex items-center border border-border/80 bg-secondary/30 px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="proof" className="scroll-mt-28 pt-10 md:pt-16">
          <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="landing-kicker">What it solves</p>
              <h2 className="mt-3 text-3xl font-display font-bold tracking-wide text-foreground md:text-5xl">
                What the SDK adds
              </h2>
            </div>
            <p className="max-w-[52ch] text-sm leading-7 text-muted-foreground md:text-base">
              The SDK addresses one specific problem: off-screen world progression without forcing you into a custom
              engine runtime.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {VALUE_PILLARS.map((pillar) => (
              <article key={pillar.title} className="landing-panel min-w-0 p-5">
                <pillar.icon className="h-5 w-5 text-primary" />
                <h3 className="mt-4 text-2xl font-display font-bold text-foreground">{pillar.title}</h3>
                <p className="mt-3 text-sm leading-7 text-muted-foreground">{pillar.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="architecture" className="scroll-mt-28 pt-10 md:pt-16">
          <div className="grid gap-5 xl:grid-cols-[0.9fr,1.1fr]">
            <div className="landing-panel p-5 md:p-6">
              <p className="landing-kicker">Architecture</p>
              <h2 className="mt-3 text-3xl font-display font-bold tracking-wide text-foreground md:text-5xl">
                It plugs into your engine, not around it
              </h2>
              <p className="mt-4 text-sm leading-7 text-muted-foreground md:text-base">
                The SDK runs A-Life state, offline simulation, and online/offline NPC handoff. Your game still owns
                rendering, physics, animation, and scene logic.
              </p>

              <div className="mt-6 grid gap-3 md:grid-cols-2">
                <div className="border border-border/70 bg-secondary/18 p-4">
                  <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                    Your game keeps
                  </p>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                    <li>Rendering and scene graph</li>
                    <li>Physics and movement</li>
                    <li>Animation and combat feel</li>
                    <li>Entity creation and save I/O</li>
                  </ul>
                </div>
                <div className="border border-border/70 bg-secondary/18 p-4">
                  <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                    The SDK adds
                  </p>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                    <li>World state and NPC records</li>
                    <li>Offline simulation ticks</li>
                    <li>Online/offline switching</li>
                    <li>Kernel and event-driven runtime</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="landing-panel p-5 md:p-6">
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Runtime map</p>
              <div className="mt-5 grid gap-3">
                {ARCHITECTURE_FLOW.map((node, index) => (
                  <div key={node.title} className="relative">
                    <div className="landing-node">
                      <div className="flex items-start gap-4">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center border border-primary/35 bg-primary/10">
                          <node.icon className="h-5 w-5 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xl font-display font-semibold text-foreground">{node.title}</p>
                          <p className="mt-1 text-sm leading-7 text-muted-foreground">{node.detail}</p>
                        </div>
                      </div>
                    </div>
                    {index < ARCHITECTURE_FLOW.length - 1 && (
                      <div className="ml-5 h-6 w-px border-l border-dashed border-primary/35" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="routes" className="scroll-mt-28 pt-10 md:pt-16">
          <div>
            <div className="max-w-[64ch]">
              <p className="landing-kicker">Entry points</p>
              <h2 className="mt-3 text-3xl font-display font-bold tracking-wide text-foreground md:text-5xl">
                Choose where to start
              </h2>
              <p className="mt-4 text-sm leading-7 text-muted-foreground md:text-base">
                Start with one small proof. Go deeper only when the next integration question appears.
              </p>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {ROUTE_CARDS.map((item) => (
                <article key={item.label} className="landing-panel flex min-w-0 flex-col p-5">
                  <div className="flex h-10 w-10 items-center justify-center border border-primary/35 bg-primary/10">
                    <item.icon className="h-5 w-5 text-primary" />
                  </div>
                  <p className="mt-4 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                    {item.eyebrow}
                  </p>
                  <h3 className="mt-2 text-2xl font-display font-bold text-foreground">{item.label}</h3>
                  <p className="mt-3 flex-1 text-sm leading-7 text-muted-foreground">{item.detail}</p>
                  <Link
                    to={item.doc.href}
                    className="mt-5 inline-flex items-center gap-2 text-sm font-display font-semibold text-primary transition-colors hover:text-foreground"
                  >
                    {ROUTE_CTA_LABELS[item.label] ?? "Open"}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

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
