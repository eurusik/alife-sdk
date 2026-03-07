import fs from "fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

const DOCS_SITE_URL = (process.env.DOCS_SITE_URL || process.env.VITE_SITE_URL || "https://eurusik.github.io/alife-sdk").replace(
  /\/+$/,
  "",
);

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

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), seoAssetsPlugin(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
