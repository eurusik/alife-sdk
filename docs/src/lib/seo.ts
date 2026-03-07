import { useEffect } from "react";

export const SEO_SITE_NAME = "A-Life SDK Docs";
export const SEO_REPOSITORY_URL = "https://github.com/eurusik/alife-sdk";
export const SEO_DEFAULT_SITE_URL = "https://eurusik.github.io/alife-sdk";
export const SEO_DEFAULT_IMAGE_PATH = "/og-image.svg";
export const SEO_DEFAULT_DESCRIPTION =
  "Engine-agnostic TypeScript SDK for living game worlds with offline NPC simulation, online behavior, Phaser integration, and modular package docs.";
export const SEO_DEFAULT_ROBOTS = "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1";

type JsonLdValue = Record<string, unknown> | Array<Record<string, unknown>>;

export type SeoMetadata = {
  title: string;
  description: string;
  path?: string;
  type?: "website" | "article";
  imagePath?: string;
  keywords?: string[];
  robots?: string;
  jsonLd?: JsonLdValue | ((context: { canonicalUrl: string; imageUrl: string; siteUrl: string }) => JsonLdValue);
};

type DocSeoInput = {
  title: string;
  description: string;
  path: string;
  sectionTitle?: string | null;
  groupTitle?: string | null;
};

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const normalizePathname = (value: string): string => {
  const normalized = value.trim();

  if (!normalized || normalized === "/") {
    return "/";
  }

  return normalized.startsWith("/") ? normalized : `/${normalized}`;
};

const dedupeKeywords = (keywords: Array<string | null | undefined>): string[] =>
  Array.from(
    new Set(
      keywords
        .map((keyword) => keyword?.trim())
        .filter((keyword): keyword is string => Boolean(keyword)),
    ),
  );

const setMetaTag = (selector: string, attribute: "name" | "property", key: string, content: string) => {
  let element = document.head.querySelector<HTMLMetaElement>(selector);

  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }

  element.setAttribute("content", content);
};

const setLinkTag = (selector: string, rel: string, href: string) => {
  let element = document.head.querySelector<HTMLLinkElement>(selector);

  if (!element) {
    element = document.createElement("link");
    element.setAttribute("rel", rel);
    document.head.appendChild(element);
  }

  element.setAttribute("href", href);
};

const setStructuredData = (value: JsonLdValue) => {
  const selector = 'script[data-seo="json-ld"]';
  let element = document.head.querySelector<HTMLScriptElement>(selector);

  if (!element) {
    element = document.createElement("script");
    element.type = "application/ld+json";
    element.dataset.seo = "json-ld";
    document.head.appendChild(element);
  }

  element.textContent = JSON.stringify(value);
};

const removeStructuredData = () => {
  document.head.querySelector('script[data-seo="json-ld"]')?.remove();
};

export const getConfiguredSiteUrl = (): string =>
  trimTrailingSlash(import.meta.env.VITE_SITE_URL?.trim() || SEO_DEFAULT_SITE_URL);

export const joinSiteUrl = (siteUrl: string, pathname: string): string => {
  const baseUrl = `${trimTrailingSlash(siteUrl)}/`;
  const normalizedPath = normalizePathname(pathname).replace(/^\/+/, "");

  return normalizedPath ? new URL(normalizedPath, baseUrl).toString() : trimTrailingSlash(siteUrl);
};

export const buildHomeSeo = (path: string): SeoMetadata => ({
  title: "A-Life SDK Docs | Living World Simulation for Phaser and TypeScript Games",
  description: SEO_DEFAULT_DESCRIPTION,
  path,
  type: "website",
  keywords: [
    "A-Life SDK",
    "living world simulation",
    "NPC AI",
    "TypeScript game SDK",
    "Phaser 3 integration",
    "game engine ports",
  ],
  jsonLd: ({ canonicalUrl, imageUrl }) => ({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SEO_SITE_NAME,
    description: SEO_DEFAULT_DESCRIPTION,
    url: canonicalUrl,
    image: imageUrl,
    about: {
      "@type": "SoftwareSourceCode",
      name: "A-Life SDK",
      codeRepository: SEO_REPOSITORY_URL,
      programmingLanguage: "TypeScript",
    },
  }),
});

export const buildDocSeo = ({ title, description, path, sectionTitle, groupTitle }: DocSeoInput): SeoMetadata => ({
  title: `${title} | ${SEO_SITE_NAME}`,
  description,
  path,
  type: "article",
  keywords: dedupeKeywords([
    "A-Life SDK",
    title,
    sectionTitle,
    groupTitle,
    "TypeScript game SDK",
    "living world simulation",
    "NPC AI docs",
  ]),
  jsonLd: ({ canonicalUrl, imageUrl }) => ({
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: title,
    description,
    url: canonicalUrl,
    image: imageUrl,
    author: {
      "@type": "Person",
      name: "Eugene Rusakov",
    },
    publisher: {
      "@type": "Organization",
      name: "A-Life SDK",
      url: SEO_REPOSITORY_URL,
    },
    articleSection: dedupeKeywords([sectionTitle, groupTitle]).join(" / "),
    about: dedupeKeywords([sectionTitle, groupTitle, "A-Life SDK"]),
    isPartOf: {
      "@type": "WebSite",
      name: SEO_SITE_NAME,
      url: joinSiteUrl(getConfiguredSiteUrl(), "/"),
    },
    mainEntityOfPage: canonicalUrl,
  }),
});

export const buildNotFoundSeo = (path: string): SeoMetadata => ({
  title: `Page Not Found | ${SEO_SITE_NAME}`,
  description: "The requested documentation page could not be found.",
  path,
  type: "website",
  robots: "noindex,nofollow",
});

export const useSeo = (metadata: SeoMetadata) => {
  useEffect(() => {
    const siteUrl = getConfiguredSiteUrl();
    const pathname = metadata.path || (typeof window !== "undefined" ? window.location.pathname : "/");
    const canonicalUrl =
      typeof window !== "undefined"
        ? new URL(normalizePathname(pathname), window.location.origin).toString()
        : joinSiteUrl(siteUrl, pathname);
    const imageUrl = joinSiteUrl(siteUrl, metadata.imagePath ?? SEO_DEFAULT_IMAGE_PATH);

    document.title = metadata.title;
    document.documentElement.lang = "en";

    setMetaTag('meta[name="description"]', "name", "description", metadata.description);
    setMetaTag('meta[name="author"]', "name", "author", "Eugene Rusakov");
    setMetaTag('meta[name="robots"]', "name", "robots", metadata.robots ?? SEO_DEFAULT_ROBOTS);
    setMetaTag('meta[name="keywords"]', "name", "keywords", dedupeKeywords(metadata.keywords ?? []).join(", "));
    setMetaTag('meta[property="og:site_name"]', "property", "og:site_name", SEO_SITE_NAME);
    setMetaTag('meta[property="og:title"]', "property", "og:title", metadata.title);
    setMetaTag('meta[property="og:description"]', "property", "og:description", metadata.description);
    setMetaTag('meta[property="og:type"]', "property", "og:type", metadata.type ?? "website");
    setMetaTag('meta[property="og:url"]', "property", "og:url", canonicalUrl);
    setMetaTag('meta[property="og:image"]', "property", "og:image", imageUrl);
    setMetaTag('meta[name="twitter:card"]', "name", "twitter:card", "summary_large_image");
    setMetaTag('meta[name="twitter:title"]', "name", "twitter:title", metadata.title);
    setMetaTag('meta[name="twitter:description"]', "name", "twitter:description", metadata.description);
    setMetaTag('meta[name="twitter:image"]', "name", "twitter:image", imageUrl);
    setLinkTag('link[rel="canonical"]', "canonical", canonicalUrl);

    if (metadata.jsonLd) {
      const value = typeof metadata.jsonLd === "function" ? metadata.jsonLd({ canonicalUrl, imageUrl, siteUrl }) : metadata.jsonLd;
      setStructuredData(value);
    } else {
      removeStructuredData();
    }
  }, [metadata]);
};
