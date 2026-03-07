import heroImage from "@/assets/hero-pixel.png";
import pixelFire from "@/assets/pixel-fire.png";

export function HeroSection() {
  return (
    <section className="relative" id="intro">
      <div className="relative mb-6 h-44 overflow-hidden border-2 border-border pixel-border md:h-52">
        <img src={heroImage} alt="A-Life SDK Zone Scene" className="h-full w-full object-cover opacity-78" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent" />
        <div className="absolute inset-0 scanline pointer-events-none" />
        <img src={pixelFire} alt="" className="absolute bottom-1 right-4 h-12 w-12 animate-flicker" />
      </div>

      <div className="pixel-divider mb-6" />

      <div className="mb-6 flex items-end gap-3">
        <h1 className="text-3xl leading-relaxed text-foreground md:text-5xl font-pixel tracking-wide text-glow-soft">A-LIFE SDK</h1>
        <img src={pixelFire} alt="" className="mb-2 h-9 w-9 opacity-90" />
      </div>

      <div className="mb-6 max-w-[72ch]">
        <h2 className="mb-3 text-xl font-display font-bold tracking-wide text-foreground">A-Life SDK Documentation</h2>
        <p className="text-sm font-mono leading-relaxed text-muted-foreground md:text-base">
          Build living game worlds with a TypeScript A-Life SDK inspired by the emergent simulation systems
          popularized by the S.T.A.L.K.E.R. series. Explore Quick Start, Concepts, Guides, Packages, Examples, and
          the Glossary from this repository.
        </p>
      </div>

      <a
        href="#quickstart"
        className="inline-block border-2 border-primary bg-primary/15 px-5 py-2.5 text-sm font-display font-bold tracking-wide text-primary pixel-btn"
      >
        ▶ Quickstart Guides
      </a>
    </section>
  );
}
