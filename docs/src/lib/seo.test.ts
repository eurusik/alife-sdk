import { buildDocSeo, buildNotFoundSeo, joinSiteUrl, SEO_SITE_NAME } from "@/lib/seo";

describe("seo helpers", () => {
  it("joins site url and pathname without losing repo base path", () => {
    expect(joinSiteUrl("https://eurusik.github.io/alife-sdk", "/docs/quick-start")).toBe(
      "https://eurusik.github.io/alife-sdk/docs/quick-start",
    );
  });

  it("builds doc seo metadata with section keywords", () => {
    const seo = buildDocSeo({
      title: "Quick Start",
      description: "Boot the kernel and verify the first tick.",
      path: "/docs/quick-start",
      sectionTitle: "Quick Start",
      groupTitle: null,
    });

    expect(seo.title).toBe(`Quick Start | ${SEO_SITE_NAME}`);
    expect(seo.type).toBe("article");
    expect(seo.keywords).toContain("Quick Start");
  });

  it("marks missing pages as noindex", () => {
    expect(buildNotFoundSeo("/missing").robots).toBe("noindex,nofollow");
  });
});
