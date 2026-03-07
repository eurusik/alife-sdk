import { Search, Menu } from "lucide-react";
import { Link } from "react-router-dom";

type NavItem = {
  id: string;
  title: string;
  href: string;
};

type ContextItem = {
  label: string;
  href?: string;
};

type SiteHeaderProps = {
  activeSectionId: string;
  query: string;
  navItems: NavItem[];
  contextItems?: ContextItem[];
  showSearch?: boolean;
  compactMobileNav?: boolean;
  onQueryChange: (value: string) => void;
  onOpenMenu: () => void;
};

function HeaderLogo() {
  return (
    <span className="inline-flex h-8 w-8 items-center justify-center border border-primary/55 bg-[linear-gradient(135deg,rgba(23,17,14,0.96),rgba(47,31,21,0.96))] shadow-[inset_0_0_0_1px_rgba(245,158,11,0.08)]">
      <svg
        viewBox="0 0 64 64"
        aria-hidden="true"
        className="h-5 w-5"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M32 11L48 53H40.8L37.2 43.2H26.8L23.2 53H16L32 11Z" fill="#FFF5DB" />
        <path d="M29.9 35.2H34.1L32 29.3L29.9 35.2Z" fill="#17110E" />
        <circle cx="45.5" cy="18.5" r="6.5" fill="#F59E0B" />
        <circle cx="45.5" cy="18.5" r="2.4" fill="#17110E" />
      </svg>
    </span>
  );
}

export function SiteHeader({
  activeSectionId,
  query,
  navItems,
  contextItems,
  showSearch = true,
  compactMobileNav = false,
  onQueryChange,
  onOpenMenu,
}: SiteHeaderProps) {
  const activeTitle = navItems.find((item) => item.id === activeSectionId)?.title ?? navItems[0]?.title ?? "Quick Start";
  const breadcrumbItems = (contextItems?.length ? contextItems : [activeTitle]).filter(
    (item, index, items) => Boolean(item?.label) && item.label !== items[index - 1]?.label,
  );

  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-background/95 backdrop-blur">
      <div className="mx-auto w-full max-w-[1360px] px-4 py-2.5 md:px-6">
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-2.5 md:flex-1 md:gap-3.5">
              <div className="flex shrink-0 items-center gap-2.5 md:gap-3.5">
                <button
                  type="button"
                  onClick={onOpenMenu}
                  className="inline-flex h-8 w-8 items-center justify-center border border-border/80 bg-secondary/55 text-muted-foreground transition-colors hover:border-primary/45 hover:text-foreground lg:hidden"
                  aria-label="Open navigation"
                >
                  <Menu className="h-4 w-4" />
                </button>

                <Link
                  to="/"
                  className="inline-flex shrink-0 items-center gap-2 transition-colors hover:text-foreground"
                  aria-label="A-Life home"
                >
                  <HeaderLogo />
                  <span className="font-display text-sm font-bold uppercase tracking-[0.16em] text-foreground md:text-base">
                    A-Life
                  </span>
                </Link>

              </div>

              <div className="min-w-0 border-l border-border/60 pl-3">
                <div className="flex min-w-0 items-center gap-1 overflow-x-auto pr-2 text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {breadcrumbItems.map((item, index) => {
                    const isLast = index === breadcrumbItems.length - 1;

                    return (
                      <div key={`${item.label}:${index}`} className="flex shrink-0 items-center gap-1">
                        {index > 0 && <span className="text-muted-foreground/55">/</span>}
                        {item.href && !isLast ? (
                          <Link to={item.href} className="transition-colors hover:text-foreground">
                            {item.label}
                          </Link>
                        ) : (
                          <span className={isLast ? "font-semibold text-primary" : ""}>{item.label}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 md:gap-3">
              {showSearch && (
                <label className="flex min-w-0 flex-1 items-center gap-2 border border-border/75 bg-secondary/45 px-3 py-1.5 transition-colors focus-within:border-primary/45 md:min-w-[280px] md:flex-none">
                  <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    placeholder="Search docs, guides, examples..."
                    className="w-full min-w-0 bg-transparent text-xs font-mono text-foreground outline-none placeholder:text-muted-foreground md:w-64"
                    aria-label="Search docs"
                  />
                </label>
              )}
            </div>
          </div>
        </div>

        <div className={`mt-2 border-t border-border/50 pt-1.5 ${compactMobileNav ? "hidden md:block" : ""}`}>
          <nav className="flex items-center gap-1 overflow-x-auto pb-1 pr-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {navItems.map((item) => {
              const active = item.id === activeSectionId;
              const className = `shrink-0 border-b-2 px-2 py-1.5 text-[11px] font-display font-semibold uppercase tracking-[0.12em] transition-colors md:text-[13px] ${
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:border-border/70 hover:text-foreground"
              }`;

              if (item.href.startsWith("/")) {
                return (
                  <Link key={item.id} to={item.href} className={className} aria-current={active ? "page" : undefined}>
                    {item.title}
                  </Link>
                );
              }

              return (
                <a key={item.id} href={item.href} className={className} aria-current={active ? "page" : undefined}>
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
