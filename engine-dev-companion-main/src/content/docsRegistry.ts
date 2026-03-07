export type DocEntry = {
  slug: string;
  title: string;
  description: string;
  source: string;
  content: string;
  sectionId: string;
  searchText: string;
};

export type DocSection = {
  id: string;
  title: string;
  summary: string;
  docs: DocEntry[];
};

export type DocHeading = {
  id: string;
  text: string;
  level: number;
};

const SECTION_META = [
  {
    id: "quickstart",
    title: "Quick Start",
    summary: "Базовий маршрут: підняти kernel, запустити перший tick і перевірити події.",
  },
  {
    id: "concepts",
    title: "Concepts",
    summary: "Ментальна модель SDK: kernel, ports, online/offline, lifecycle, events.",
  },
  {
    id: "guides",
    title: "Guides",
    summary: "Практичні інтеграційні маршрути для Phaser і custom engine.",
  },
  {
    id: "packages",
    title: "Packages",
    summary: "Package-level документація по модулях SDK і їх ролях.",
  },
  {
    id: "examples",
    title: "Examples",
    summary: "Робочі приклади для швидкого підтвердження поведінки runtime.",
  },
  {
    id: "glossary",
    title: "Glossary",
    summary: "Швидкий словник термінів і частих плутанин у проєкті.",
  },
] as const;

type SectionId = (typeof SECTION_META)[number]["id"];

const markdownModules = import.meta.glob("/content/docs/**/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const toTitleCase = (value: string) =>
  value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const stripFrontmatter = (raw: string): string => raw.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();

const cleanInlineMarkdown = (text: string): string =>
  text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const parseTitle = (content: string, fallback: string): string => {
  const match = content.match(/^#\s+(.+)$/m);
  return cleanInlineMarkdown(match?.[1] ?? fallback);
};

const parseDescription = (content: string): string => {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("#"))
    .filter((line) => !line.startsWith("---"))
    .filter((line) => !line.startsWith("```"))
    .filter((line) => !line.startsWith("<"));

  return cleanInlineMarkdown(lines[0] ?? "");
};

const detectSectionId = (relativePath: string): SectionId => {
  if (relativePath.startsWith("concepts/")) {
    return "concepts";
  }
  if (relativePath.startsWith("guides/")) {
    return "guides";
  }
  if (relativePath.startsWith("packages/")) {
    return "packages";
  }
  if (relativePath.startsWith("examples/")) {
    return "examples";
  }
  if (relativePath === "glossary.md") {
    return "glossary";
  }
  return "quickstart";
};

const getSectionDocRank = (sectionId: SectionId, relativePath: string): number => {
  if (sectionId === "quickstart" && relativePath === "quick-start.md") {
    return 0;
  }
  if (relativePath === "index.md") {
    return 1;
  }
  if (relativePath.endsWith("/index.md")) {
    return 0;
  }
  return 10;
};

export const slugifyHeading = (value: string): string =>
  value
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-") || "section";

export const createHeadingAnchorFactory = () => {
  const counts = new Map<string, number>();

  return (rawText: string): string => {
    const base = slugifyHeading(cleanInlineMarkdown(rawText));
    const used = counts.get(base) ?? 0;
    counts.set(base, used + 1);

    if (used === 0) {
      return base;
    }

    return `${base}-${used + 1}`;
  };
};

export const extractDocHeadings = (content: string, includeLevels: number[] = [2, 3]): DocHeading[] => {
  const lines = content.split("\n");
  const makeAnchor = createHeadingAnchorFactory();
  const headings: DocHeading[] = [];

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);

    if (!match) {
      continue;
    }

    const level = match[1].length;
    if (!includeLevels.includes(level)) {
      continue;
    }

    const text = cleanInlineMarkdown(match[2]);
    const id = makeAnchor(text);
    headings.push({ id, text, level });
  }

  return headings;
};

const docs: DocEntry[] = Object.entries(markdownModules)
  .map(([absolutePath, rawContent]) => {
    const relativePath = absolutePath.replace("/content/docs/", "");
    const slug = relativePath.replace(/\.md$/, "");
    const filename = slug.split("/").at(-1) ?? slug;
    const content = stripFrontmatter(rawContent);
    const sectionId = detectSectionId(relativePath);
    const title = parseTitle(content, toTitleCase(filename));
    const description = parseDescription(content) || `Documentation page: ${title}`;

    return {
      slug,
      title,
      description,
      source: `content/docs/${relativePath}`,
      content,
      sectionId,
      searchText: `${title}\n${description}\n${content}`.toLowerCase(),
    } satisfies DocEntry;
  })
  .sort((a, b) => {
    if (a.sectionId !== b.sectionId) {
      const aIndex = SECTION_META.findIndex((section) => section.id === a.sectionId);
      const bIndex = SECTION_META.findIndex((section) => section.id === b.sectionId);
      return aIndex - bIndex;
    }

    const aRank = getSectionDocRank(a.sectionId as SectionId, a.source.replace("content/docs/", ""));
    const bRank = getSectionDocRank(b.sectionId as SectionId, b.source.replace("content/docs/", ""));

    if (aRank !== bRank) {
      return aRank - bRank;
    }

    return a.title.localeCompare(b.title);
  });

export const docsSections: DocSection[] = SECTION_META.map((section) => {
  const sectionDocs = docs.filter((doc) => doc.sectionId === section.id);

  return {
    id: section.id,
    title: section.title,
    summary: section.summary,
    docs: sectionDocs,
  };
}).filter((section) => section.docs.length > 0);

export const docsFlat: DocEntry[] = docsSections.flatMap((section) => section.docs);

export const topNavItems = docsSections.map((section) => ({
  id: section.id,
  title: section.title,
  href: `#${section.id}`,
}));

export const topNavDocItems = docsSections.map((section) => ({
  id: section.id,
  title: section.title,
  href: `/docs/${section.docs[0].slug}`,
}));

export const normalizeDocHref = (href: string): string | null => {
  const pathOnly = href.split("#")[0]?.split("?")[0] ?? "";

  if (!pathOnly || pathOnly.startsWith("http") || pathOnly.startsWith("mailto:")) {
    return null;
  }

  let normalized = pathOnly.replace(/^\/+|\/+$/g, "");

  if (normalized.startsWith("docs/")) {
    normalized = normalized.slice(5);
  }

  normalized = normalized.replace(/\.md$/, "");

  if (!normalized) {
    return "index";
  }

  return normalized;
};

export const resolveDocSlug = (href: string): string | null => {
  const normalized = normalizeDocHref(href);

  if (!normalized) {
    return null;
  }

  const candidates = [normalized, `${normalized}/index`];
  const doc = docsFlat.find((entry) => candidates.includes(entry.slug));
  return doc?.slug ?? null;
};

export const getDocBySlug = (slug: string | null | undefined): DocEntry | null => {
  if (!slug) {
    return docsFlat[0] ?? null;
  }

  const cleanSlug = slug.replace(/^\/+|\/+$/g, "");
  const candidates = [cleanSlug, cleanSlug.replace(/\.md$/, ""), `${cleanSlug}/index`];
  const doc = docsFlat.find((entry) => candidates.includes(entry.slug));
  return doc ?? null;
};
