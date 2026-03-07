import fs from "fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

const RAW_DOCS_SITE_URL = process.env.DOCS_SITE_URL || process.env.VITE_SITE_URL || "https://eurusik.github.io/alife-sdk";
const DOCS_SITE_URL = RAW_DOCS_SITE_URL.replace(/\/+$/, "");
const DOCS_DEFAULT_BASE_PATH = (() => {
  const pathname = new URL(DOCS_SITE_URL).pathname.replace(/\/+$/, "");
  return pathname ? `${pathname}/` : "/";
})();

const DOCS_CONTENT_DIR = path.resolve(__dirname, "./content/docs");

const collectMarkdownFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return collectMarkdownFiles(absolutePath);
    }

    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      return [];
    }

    return [absolutePath];
  });

const joinSiteUrl = (siteUrl: string, pathname: string): string =>
  new URL(pathname.replace(/^\/+/, ""), `${siteUrl}/`).toString();

const seoAssetsPlugin = () => ({
  name: "alife-docs-seo-assets",
  apply: "build" as const,
  generateBundle() {
    const docFiles = collectMarkdownFiles(DOCS_CONTENT_DIR).sort();
    const generatedAt = new Date().toISOString();
    const urls = [
      { location: "/", lastModified: generatedAt, priority: "1.0" },
      ...docFiles.map((filePath) => {
        const slug = path.relative(DOCS_CONTENT_DIR, filePath).replace(/\\/g, "/").replace(/\.md$/, "");
        const stat = fs.statSync(filePath);

        return {
          location: `/docs/${slug}`,
          lastModified: stat.mtime.toISOString(),
          priority: slug.endsWith("/index") || slug === "quick-start" || slug === "index" ? "0.9" : "0.7",
        };
      }),
    ];

    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map(
        (entry) =>
          `  <url>\n    <loc>${joinSiteUrl(DOCS_SITE_URL, entry.location)}</loc>\n    <lastmod>${entry.lastModified}</lastmod>\n    <priority>${entry.priority}</priority>\n  </url>`,
      )
      .join("\n")}\n</urlset>\n`;

    const robotsTxt = `User-agent: *\nAllow: /\n\nSitemap: ${joinSiteUrl(DOCS_SITE_URL, "/sitemap.xml")}\n`;

    this.emitFile({
      type: "asset",
      fileName: "sitemap.xml",
      source: sitemapXml,
    });

    this.emitFile({
      type: "asset",
      fileName: "robots.txt",
      source: robotsTxt,
    });
  },
});

const githubPagesSpaFallbackPlugin = () => ({
  name: "alife-docs-github-pages-spa-fallback",
  apply: "build" as const,
  closeBundle() {
    const distDir = path.resolve(__dirname, "./dist");
    const indexHtmlPath = path.join(distDir, "index.html");
    const notFoundHtmlPath = path.join(distDir, "404.html");

    if (!fs.existsSync(indexHtmlPath)) {
      return;
    }

    fs.copyFileSync(indexHtmlPath, notFoundHtmlPath);
  },
});

const createManualChunks = (id: string): string | undefined => {
  if (!id.includes("node_modules")) {
    return undefined;
  }

  if (
    id.includes("/react-syntax-highlighter/") ||
    id.includes("/prismjs/") ||
    id.includes("/highlight.js/")
  ) {
    return "syntax-highlighter";
  }

  if (
    id.includes("/react-markdown/") ||
    id.includes("/remark-gfm/") ||
    id.includes("/rehype-raw/") ||
    id.includes("/mdast-") ||
    id.includes("/micromark") ||
    id.includes("/hast-") ||
    id.includes("/unist-") ||
    id.includes("/vfile")
  ) {
    return "markdown";
  }

  return undefined;
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: mode === "production" ? process.env.DOCS_BASE_PATH || DOCS_DEFAULT_BASE_PATH : "/",
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: createManualChunks,
      },
    },
  },
  plugins: [react(), seoAssetsPlugin(), githubPagesSpaFallbackPlugin(), mode === "development" && componentTagger()].filter(
    Boolean,
  ),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
