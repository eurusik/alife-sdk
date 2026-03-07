import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  BrainCircuit,
  Boxes,
  ChevronUp,
  Copy,
  Cpu,
  Flame,
  FolderTree,
  Gamepad2,
  Layers3,
  Orbit,
  RadioTower,
} from "lucide-react";
import heroWasteland from "@/assets/hero-wasteland.jpg";
import { SiteHeader } from "@/components/SiteHeader";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { docsFlat } from "@/content/docsRegistry";

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
    id: "start",
    title: "First Proof",
    summary: "The shortest path from the first tick to a minimal working proof.",
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

const ADOPTION_STEPS = [
  {
    title: "Spin up the kernel",
    description: "Create the runtime coordinator and register only the ports your game already owns.",
  },
  {
    title: "Prove one living location",
    description: "Build one smart terrain, one faction, one NPC, and one visible tick.",
  },
  {
    title: "Add online/offline handoff",
    description: "Let nearby NPCs go rich when watched and cheap when the player walks away.",
  },
  {
    title: "Layer systems after the loop is stable",
    description: "Add AI, hazards, economy, or save/load only after the core loop works.",
  },
];

const codeSnippet = `import { createInMemoryKernel } from "@alife-sdk/simulation";
import { FactionBuilder, SmartTerrain } from "@alife-sdk/core";

const { kernel, sim, factions } = createInMemoryKernel();

factions.factions.register("stalker", new FactionBuilder("stalker").build());

sim.addTerrain(new SmartTerrain({ id: "camp", ... }));
sim.registerNPC({ entityId: "wolf", factionId: "stalker", ... });

kernel.update(5_001);`;

const ENTRY_SEQUENCE = [
  {
    step: "01",
    title: "Start with Quick Start",
    detail: "Boot the kernel, register the minimum ports, and run the first tick.",
  },
  {
    step: "02",
    title: "Prove one living world",
    detail: "Open First Living World when you want one terrain, one faction, one NPC, and one visible handoff.",
  },
  {
    step: "03",
    title: "Go deeper only when needed",
    detail: "Open Phaser Integration for renderer fit, or Packages when you need package boundaries and adoption order.",
  },
];

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
    detail: "Boot the kernel, register the minimum ports, and run the first tick.",
    icon: Flame,
    doc: resolveDoc("quick-start", {
      title: "Quick Start",
      description: "Boot the kernel and get the first tick running",
    }),
  },
  {
    eyebrow: "Minimal proof",
    label: "First Living World",
    detail: "Build the smallest living-world proof with one terrain, one faction, one NPC, and one event.",
    icon: Gamepad2,
    doc: resolveDoc("guides/first-living-world", {
      title: "First Living World",
      description: "The smallest proof that the world loop is alive",
    }),
  },
  {
    eyebrow: "Renderer integration",
    label: "Phaser Integration",
    detail: "See how the SDK integrates with a renderer without owning your entities or scenes.",
    icon: Gamepad2,
    doc: resolveDoc("guides/phaser-integration", {
      title: "Phaser Integration",
      description: "Integrate the SDK into a Phaser project",
    }),
  },
  {
    eyebrow: "Package boundaries",
    label: "Packages",
    detail: "Inspect what lives in core, simulation, AI, and phaser before you integrate further.",
    icon: Boxes,
    doc: resolveDoc("packages/index", {
      title: "Packages",
      description: "Inspect package boundaries and adoption order",
    }),
  },
];

const preloadHighlightedCodeBlock = () => import("@/components/HighlightedCodeBlock");
const HighlightedCodeBlock = lazy(preloadHighlightedCodeBlock);

const Index = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [copiedBlockKey, setCopiedBlockKey] = useState<string | null>(null);
  const sectionIds = useMemo(() => LANDING_SECTIONS.map((section) => section.id), []);
  const [activeSectionId, setActiveSectionId] = useState(sectionIds[0] ?? "hero");

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

  useEffect(() => {
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
  }, []);

  const copyCode = async (value: string, blockKey: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedBlockKey(blockKey);
      window.setTimeout(() => setCopiedBlockKey((current) => (current === blockKey ? null : current)), 1200);
    } catch {
      setCopiedBlockKey(null);
    }
  };

  const activeSection = LANDING_SECTIONS.find((section) => section.id === activeSectionId) ?? LANDING_SECTIONS[0];
  const landingSampleBlockKey = "landing:ts:minimal-setup";
  const landingSampleCopied = copiedBlockKey === landingSampleBlockKey;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader
        activeSectionId={activeSectionId}
        query=""
        navItems={LANDING_NAV_ITEMS}
        quickstartHref="/docs/quick-start"
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
                TypeScript SDK for 2D JavaScript games with off-screen simulation, on-screen NPC behavior, and
                ports-based integration for Phaser or custom engines.
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
          <div className="pixel-card relative overflow-hidden">
            <div className="absolute inset-0 opacity-45">
              <img src={heroWasteland} alt="" className="h-full w-full object-cover object-center" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(255,179,71,0.18),transparent_32%),linear-gradient(135deg,rgba(8,4,3,0.88),rgba(12,7,5,0.58),rgba(8,4,3,0.94))]" />
              <div className="absolute inset-0 scanline" />
            </div>

            <div className="relative min-w-0 p-6 md:p-8 xl:p-10">
              <div className="min-w-0 max-w-[1120px]">
                <p className="landing-kicker">Engine-agnostic TypeScript SDK for 2D games</p>
                <h1 className="mt-4 max-w-[16ch] font-display text-4xl font-bold leading-[0.95] tracking-wide text-foreground md:max-w-[18ch] md:text-6xl xl:max-w-[20ch] xl:text-7xl">
                  Online/offline NPC simulation for 2D games.
                </h1>
                <p className="mt-5 max-w-[62ch] text-base leading-8 text-muted-foreground md:max-w-[70ch] md:text-lg md:leading-9 xl:max-w-[78ch]">
                  For 2D JavaScript and TypeScript games that need living-world NPC simulation without replacing the
                  renderer, entities, or physics.
                </p>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <Link
                    to="/docs/quick-start"
                    className="inline-flex items-center justify-center gap-2 border-2 border-primary bg-primary/15 px-5 py-3 text-sm font-display font-bold uppercase tracking-wide text-primary pixel-btn"
                  >
                    Read Quick Start
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link
                    to="/docs/guides/phaser-integration"
                    className="inline-flex items-center justify-center gap-2 border-2 border-border bg-secondary/35 px-5 py-3 text-sm font-display font-bold uppercase tracking-wide text-foreground transition-colors hover:border-primary/35 hover:text-primary"
                  >
                    See Phaser Integration
                    <ArrowRight className="h-4 w-4 text-primary/80" />
                  </Link>
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

          <div className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
            <div className="grid gap-4 md:grid-cols-2">
              {VALUE_PILLARS.map((pillar) => (
                <article key={pillar.title} className="landing-panel min-w-0 p-5">
                  <pillar.icon className="h-5 w-5 text-primary" />
                  <h3 className="mt-4 text-2xl font-display font-bold text-foreground">{pillar.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-muted-foreground">{pillar.description}</p>
                </article>
              ))}
            </div>

            <div className="landing-panel p-5 md:p-6">
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">First proof</p>
              <h3 className="mt-3 text-3xl font-display font-bold text-foreground">
                The smallest useful proof
              </h3>
              <div className="mt-5 space-y-3">
                {[
                  {
                    title: "One living location",
                    text: "One terrain, one faction, one NPC, one event. Enough to validate the loop before scaling the game.",
                  },
                  {
                    title: "One visible handoff",
                    text: "The same NPC can exist as off-screen simulation and become an observable actor when the player arrives.",
                  },
                  {
                    title: "One integration boundary",
                    text: "Ports let your game answer narrow runtime questions without exposing your whole engine internals.",
                  },
                ].map((item, index) => (
                  <div key={item.title} className="flex gap-4 border border-border/70 bg-secondary/20 px-4 py-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-primary/35 bg-primary/10 text-[11px] font-mono text-primary">
                      0{index + 1}
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-lg font-display font-semibold text-foreground">{item.title}</h4>
                      <p className="mt-1 text-sm leading-7 text-muted-foreground">{item.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="architecture" className="scroll-mt-28 pt-10 md:pt-16">
          <div className="grid gap-5 xl:grid-cols-[0.9fr,1.1fr]">
            <div className="landing-panel p-5 md:p-6">
              <p className="landing-kicker">Architecture</p>
              <h2 className="mt-3 text-3xl font-display font-bold tracking-wide text-foreground md:text-5xl">
                How the SDK fits into your game
              </h2>
              <p className="mt-4 text-sm leading-7 text-muted-foreground md:text-base">
                Your engine keeps ownership of rendering, physics, entities, animation, and scene rules. The SDK sits
                at the boundary through ports and coordinates lifecycle, events, simulation, and package flow.
              </p>

              <div className="mt-6 grid gap-3 md:grid-cols-2">
                <div className="border border-border/70 bg-secondary/18 p-4">
                  <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                    What stays in your game
                  </p>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                    <li>Entities and scene graph</li>
                    <li>Rendering and animation</li>
                    <li>Physics and interactions</li>
                    <li>Concrete adapters and save transport</li>
                  </ul>
                </div>
                <div className="border border-border/70 bg-secondary/18 p-4">
                  <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                    What the SDK owns
                  </p>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                    <li>Kernel lifecycle and events</li>
                    <li>Online/offline transitions</li>
                    <li>Living-world progression</li>
                    <li>Package composition and runtime flow</li>
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

        <section id="start" className="scroll-mt-28 pt-10 md:pt-16">
          <div className="grid gap-5 xl:grid-cols-[0.85fr,1.15fr]">
            <div className="landing-panel p-5 md:p-6">
              <p className="landing-kicker">First proof</p>
              <h2 className="mt-3 text-3xl font-display font-bold tracking-wide text-foreground md:text-5xl">
                From first tick to first proof
              </h2>
              <div className="mt-6 space-y-4">
                {ADOPTION_STEPS.map((step, index) => (
                  <div key={step.title} className="flex gap-4 border-l-2 border-primary/35 pl-4">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border border-primary/35 bg-primary/10 text-[11px] font-mono text-primary">
                      {index + 1}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-xl font-display font-semibold text-foreground">{step.title}</h3>
                      <p className="mt-1 text-sm leading-7 text-muted-foreground">{step.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="landing-panel md-code-block landing-code-block overflow-hidden">
              <div className="md-code-meta">
                <div>
                  <p className="md-code-lang uppercase tracking-[0.16em]">Minimal setup</p>
                  <p className="mt-1 text-sm font-display font-semibold text-foreground">
                    The smallest working loop
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="md-code-lang border border-border/80 bg-background/60 px-2 py-1 uppercase tracking-[0.16em]">
                    ts
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyCode(codeSnippet, landingSampleBlockKey)}
                    className="md-code-copy"
                    data-copied={landingSampleCopied ? "true" : "false"}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {landingSampleCopied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
              <Suspense
                fallback={
                  <pre className="overflow-x-auto text-[0.94rem] leading-8 text-muted-foreground">
                    <code>{codeSnippet}</code>
                  </pre>
                }
              >
                <HighlightedCodeBlock language="typescript" codeText={codeSnippet} className="language-typescript" />
              </Suspense>
            </div>
          </div>
        </section>

        <section id="routes" className="scroll-mt-28 pt-10 md:pt-16">
          <div className="grid gap-5 xl:grid-cols-[0.82fr,1.18fr]">
            <div className="landing-panel p-5 md:p-6">
              <p className="landing-kicker">Entry points</p>
              <h2 className="mt-3 text-3xl font-display font-bold tracking-wide text-foreground md:text-5xl">
                Choose where to start
              </h2>
              <p className="mt-4 max-w-[56ch] text-sm leading-7 text-muted-foreground md:text-base">
                Start with the smallest proof. Open deeper docs only when the next integration question appears.
              </p>

              <div className="mt-6 space-y-3">
                {ENTRY_SEQUENCE.map((item) => (
                  <div key={item.step} className="flex gap-4 border border-border/70 bg-secondary/18 px-4 py-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-primary/35 bg-primary/10 text-[11px] font-mono text-primary">
                      {item.step}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-display font-semibold text-foreground">{item.title}</p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
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
                    {item.doc.title}
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
