import { MessageSquare, Github, FolderTree } from "lucide-react";
import type { DocSection } from "@/content/docsRegistry";
import { cn } from "@/lib/utils";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

type DocSidebarProps = {
  activeSectionId: string;
  sections: DocSection[];
};

type MobileSidebarProps = {
  open: boolean;
  onClose: () => void;
  activeSectionId: string;
  sections: DocSection[];
};

function SidebarLinks({ activeSectionId, sections, onClickLink }: { activeSectionId: string; sections: DocSection[]; onClickLink?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {sections.map((section) => {
        const isActive = section.id === activeSectionId;

        return (
          <a
            key={section.id}
            href={`#${section.id}`}
            onClick={onClickLink}
            className={`flex items-center gap-2 px-3 py-2 text-sm font-display font-semibold transition-colors ${
              isActive
                ? "bg-primary/15 text-primary border-l-[3px] border-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary border-l-[3px] border-transparent"
            }`}
          >
            <span className="text-[8px] font-pixel">■</span>
            {section.title}
          </a>
        );
      })}
    </nav>
  );
}

export function DocSidebar({ activeSectionId, sections }: DocSidebarProps) {
  return (
    <aside className="hidden w-60 shrink-0 border-r-2 border-border/80 bg-card/75 p-4 lg:flex lg:flex-col lg:gap-5">
      <SidebarLinks activeSectionId={activeSectionId} sections={sections} />

      <div className="mt-auto flex flex-col gap-2">
        <a
          href="#guides"
          className="flex items-center gap-2 px-2 py-2 text-xs font-mono text-muted-foreground hover:text-foreground border-2 border-border hover:border-primary/40 transition-colors pixel-inset"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          integration-guides
        </a>
        <a
          href="https://github.com/eurusik/alife-sdk"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 px-2 py-2 text-xs font-mono text-muted-foreground hover:text-foreground border-2 border-border hover:border-primary/40 transition-colors pixel-inset"
        >
          <Github className="h-3.5 w-3.5" />
          github.com/alife-sdk
        </a>
      </div>
    </aside>
  );
}

export function MobileSidebar({ open, onClose, activeSectionId, sections }: MobileSidebarProps) {
  const activeSection = sections.find((section) => section.id === activeSectionId) ?? sections[0] ?? null;

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
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
                  Navigation
                </SheetTitle>
                <SheetDescription className="mt-1 text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                  {activeSection?.title ?? "Docs"} • {sections.length} sections
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
            {activeSection?.summary && (
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{activeSection.summary}</p>
            )}
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <nav className="space-y-2.5">
              {sections.map((section) => {
                const isActive = section.id === activeSectionId;

                return (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    onClick={onClose}
                    className={cn(
                      "block border-2 px-3 py-3 transition-colors",
                      isActive
                        ? "border-primary/45 bg-primary/10"
                        : "border-border bg-secondary/25 hover:border-primary/35 hover:bg-secondary/40",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <FolderTree className="h-3.5 w-3.5 shrink-0 text-primary/80" />
                          <p className="text-sm font-display font-semibold uppercase tracking-wide text-foreground">
                            {section.title}
                          </p>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">{section.summary}</p>
                      </div>
                      <span className="shrink-0 border border-border/80 bg-background/60 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                        {section.docs.length}
                      </span>
                    </div>
                  </a>
                );
              })}
            </nav>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
