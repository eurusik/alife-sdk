import { useEffect } from "react";
import { MessageSquare, Github, X } from "lucide-react";
import type { DocSection } from "@/content/docsRegistry";

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
  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] lg:hidden">
      <button
        type="button"
        aria-label="Close navigation"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <aside className="relative h-full w-72 max-w-[85vw] border-r-2 border-border bg-background p-4">
        <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
          <p className="text-sm font-display font-bold uppercase tracking-wide text-foreground">Navigation</p>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center border-2 border-border bg-secondary p-1.5 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <SidebarLinks activeSectionId={activeSectionId} sections={sections} onClickLink={onClose} />
      </aside>
    </div>
  );
}
