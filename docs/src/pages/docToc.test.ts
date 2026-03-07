import { describe, expect, it } from "vitest";
import { computeActiveHeadingId, scanHeadingsFromDom } from "@/pages/docToc";

const createHeadingNode = (id: string, top: number): HTMLElement => {
  const node = document.createElement("h2");
  node.id = id;
  Object.defineProperty(node, "offsetTop", {
    configurable: true,
    value: top,
  });

  Object.defineProperty(node, "getBoundingClientRect", {
    configurable: true,
    value: () =>
      ({
        x: 0,
        y: top,
        top,
        left: 0,
        right: 0,
        bottom: top,
        width: 0,
        height: 0,
        toJSON: () => ({}),
      }) as DOMRect,
  });

  return node;
};

describe("computeActiveHeadingId", () => {
  it("picks the last heading that passed the activation line", () => {
    const nodes = [createHeadingNode("one", -40), createHeadingNode("two", 92), createHeadingNode("three", 260)];
    expect(computeActiveHeadingId(nodes, 150)).toBe("two");
  });

  it("uses the first heading when no heading reached the activation line", () => {
    const nodes = [createHeadingNode("intro", 210), createHeadingNode("setup", 400)];
    expect(computeActiveHeadingId(nodes, 150)).toBe("intro");
  });

  it("selects the clicked deep section once it crosses the activation line", () => {
    const nodes = [
      createHeadingNode("top", -620),
      createHeadingNode("middle", -280),
      createHeadingNode("deep-section", 38),
      createHeadingNode("tail", 520),
    ];
    expect(computeActiveHeadingId(nodes, 150)).toBe("deep-section");
  });

  it("keeps the last passed heading without forcing bottom override", () => {
    const nodes = [createHeadingNode("a", -100), createHeadingNode("b", 80), createHeadingNode("c", 480)];
    expect(computeActiveHeadingId(nodes, 150)).toBe("b");
  });

  it("handles dense heading blocks around the activation line", () => {
    const nodes = [
      createHeadingNode("h1", 120),
      createHeadingNode("h2", 133),
      createHeadingNode("h3", 144),
      createHeadingNode("h4", 149),
      createHeadingNode("h5", 151),
    ];
    expect(computeActiveHeadingId(nodes, 150)).toBe("h4");
  });

  it("works with long heading lists that include many subsections", () => {
    const nodes = [
      createHeadingNode("section", -220),
      createHeadingNode("section-a", -20),
      createHeadingNode("section-b", 20),
      createHeadingNode("section-c", 120),
      createHeadingNode("section-d", 420),
      createHeadingNode("section-e", 680),
    ];
    expect(computeActiveHeadingId(nodes, 150)).toBe("section-c");
  });

  it("returns empty id when there are no heading nodes", () => {
    expect(computeActiveHeadingId([], 150)).toBe("");
  });
});

describe("scanHeadingsFromDom", () => {
  it("collects only h2/h3 headings, normalizes text, and skips invalid entries", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <h2 id="install" data-doc-heading="h2">Install</h2>
      <h3 id="what-you-get" data-doc-heading="h3">What   you   get</h3>
      <h4 id="ignored">Ignored</h4>
      <h2 id="install">Duplicate id should be ignored</h2>
      <h3 id="">Missing id</h3>
      <h3 id="blank"> </h3>
    `;

    expect(scanHeadingsFromDom(root)).toEqual([
      { id: "install", text: "Install", level: 2 },
      { id: "what-you-get", text: "What you get", level: 3 },
    ]);
  });

  it("falls back to plain h2/h3 selectors without data markers", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <h2 id="overview">Overview</h2>
      <h3 id="details">Details</h3>
    `;

    expect(scanHeadingsFromDom(root)).toEqual([
      { id: "overview", text: "Overview", level: 2 },
      { id: "details", text: "Details", level: 3 },
    ]);
  });

  it("returns an empty list when root is missing", () => {
    expect(scanHeadingsFromDom(null)).toEqual([]);
  });
});
