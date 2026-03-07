import type { DocHeading } from "@/content/docsRegistry";

type ComputeActiveHeadingOptions = Record<string, never>;

const DOC_HEADING_SELECTOR = '[data-doc-heading="h2"][id], [data-doc-heading="h3"][id], h2[id], h3[id]';

const normalizeHeadingText = (value: string): string => value.replace(/\s+/g, " ").trim();

export const scanHeadingsFromDom = (root: ParentNode | null): DocHeading[] => {
  if (!root) {
    return [];
  }

  const seenIds = new Set<string>();
  const headings: DocHeading[] = [];

  const nodes = root.querySelectorAll<HTMLElement>(DOC_HEADING_SELECTOR);

  for (const node of nodes) {
    const id = node.id.trim();
    if (!id || seenIds.has(id)) {
      continue;
    }

    const marker = (node.dataset.docHeading ?? node.tagName).toLowerCase();
    if (marker !== "h2" && marker !== "h3") {
      continue;
    }

    const text = normalizeHeadingText(node.textContent ?? "");
    if (!text) {
      continue;
    }

    seenIds.add(id);
    headings.push({
      id,
      text,
      level: marker === "h2" ? 2 : 3,
    });
  }

  return headings;
};

export const computeActiveHeadingId = (
  nodes: HTMLElement[],
  activationY: number,
  _options: ComputeActiveHeadingOptions = {},
): string => {
  if (!nodes.length) {
    return "";
  }

  const positions = nodes
    .map((node, index) => {
      const top = node.offsetTop - window.scrollY;
      return Number.isFinite(top) ? { id: node.id, top, index } : null;
    })
    .filter((item): item is { id: string; top: number; index: number } => item !== null)
    .sort((a, b) => {
      if (a.top === b.top) {
        return a.index - b.index;
      }
      return a.top - b.top;
    });

  if (!positions.length) {
    return "";
  }

  const passed = positions.filter((item) => item.top <= activationY);
  if (!passed.length) {
    return positions[0].id;
  }

  return passed[passed.length - 1].id;
};
