import { Search, Menu } from "lucide-react";
import { Link } from "react-router-dom";

type NavItem = {
  id: string;
  title: string;
  href: string;
};

type SiteHeaderProps = {
  activeSectionId: string;
  query: string;
  navItems: NavItem[];
  quickstartHref?: string;
  onQueryChange: (value: string) => void;
  onOpenMenu: () => void;
};

export function SiteHeader({
  activeSectionId,
  query,
  navItems,
  quickstartHref = "#quickstart",
  onQueryChange,
  onOpenMenu,
}: SiteHeaderProps) {
  const activeTitle = navItems.find((item) => item.id === activeSectionId)?.title ?? navItems[0]?.title ?? "Quick Start";

  return (
    <header className="sticky top-0 z-50 border-b-2 border-border bg-background/95 backdrop-blur">
      <div className="mx-auto w-full max-w-[1360px] px-4 py-3 md:px-6">
        <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 md:gap-3">
            <button
              type="button"
              onClick={onOpenMenu}
              className="inline-flex h-9 w-9 items-center justify-center border-2 border-border bg-secondary text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex min-w-0 flex-1 gap-1 sm:flex-none">
              <Link to="/" className="px-3 py-2 text-xs font-mono border-2 border-primary bg-primary/15 text-primary pixel-btn">
                Docs
              </Link>
              {quickstartHref.startsWith("/") ? (
                <Link
                  to={quickstartHref}
                  className="px-3 py-2 text-xs font-mono border-2 border-border text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
                >
                  Quickstart
                </Link>
              ) : (
                <a
                  href={quickstartHref}
                  className="px-3 py-2 text-xs font-mono border-2 border-border text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
                >
                  Quickstart
                </a>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 border-2 border-border bg-secondary px-3 py-1.5 pixel-inset md:min-w-[220px] md:flex-none">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Search docs..."
                className="w-full min-w-0 bg-transparent text-xs font-mono text-foreground outline-none placeholder:text-muted-foreground md:w-52"
              />
            </label>

            <div className="inline-flex items-center gap-1.5 border-2 border-border bg-secondary/60 px-2.5 py-2 md:hidden pixel-inset">
              <span className="text-[9px] font-mono uppercase tracking-[0.16em] text-muted-foreground">Section</span>
              <span className="max-w-[110px] truncate text-[11px] font-display font-semibold text-foreground">
                {activeTitle}
              </span>
            </div>

            <div className="hidden items-center gap-2 border-2 border-border bg-secondary/60 px-3 py-2 xl:flex pixel-inset">
              <span className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">Section</span>
              <span className="text-xs font-display font-semibold text-foreground">{activeTitle}</span>
            </div>
          </div>
        </div>

        <div className="mt-3 border-t border-border/70 pt-2">
          <nav className="flex items-center gap-1.5 overflow-x-auto pb-2 pr-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {navItems.map((item) => {
              const active = item.id === activeSectionId;
              const className = `shrink-0 border px-2.5 py-1.5 text-[11px] md:text-sm font-display font-semibold transition-colors tracking-wider uppercase ${
                active
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-transparent text-muted-foreground hover:border-border/80 hover:bg-secondary/35 hover:text-foreground"
              }`;

              if (item.href.startsWith("/")) {
                return (
                  <Link key={item.id} to={item.href} className={className}>
                    {item.title}
                  </Link>
                );
              }

              return (
                <a key={item.id} href={item.href} className={className}>
                  {item.title}
                </a>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
}
