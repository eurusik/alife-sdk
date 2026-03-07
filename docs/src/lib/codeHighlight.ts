import type { CSSProperties } from "react";

const LANGUAGE_ALIASES: Record<string, string> = {
  bash: "bash",
  console: "bash",
  diff: "diff",
  html: "markup",
  javascript: "javascript",
  js: "javascript",
  json: "json",
  jsx: "jsx",
  markdown: "markdown",
  md: "markdown",
  sh: "bash",
  shell: "bash",
  svg: "markup",
  ts: "typescript",
  tsx: "tsx",
  typescript: "typescript",
  xml: "markup",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

export const normalizeCodeLanguage = (language: string): string | null => {
  const normalized = language.trim().toLowerCase();
  return LANGUAGE_ALIASES[normalized] ?? null;
};

export const docCodeTheme: Record<string, CSSProperties> = {
  plain: {
    color: "#d9c3a0",
    backgroundColor: "transparent",
  },
  'pre[class*="language-"]': {
    background: "transparent",
    color: "#d9c3a0",
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: "1rem",
    lineHeight: "1.8",
    margin: 0,
    textShadow: "none",
  },
  'code[class*="language-"]': {
    background: "transparent",
    color: "#d9c3a0",
    fontFamily: '"Share Tech Mono", monospace',
    textShadow: "none",
  },
  comment: {
    color: "#7f6651",
    fontStyle: "italic",
  },
  prolog: {
    color: "#90735b",
  },
  doctype: {
    color: "#90735b",
  },
  cdata: {
    color: "#90735b",
  },
  punctuation: {
    color: "#bb9a71",
  },
  property: {
    color: "#ffba58",
  },
  tag: {
    color: "#ffba58",
  },
  boolean: {
    color: "#d89d56",
  },
  number: {
    color: "#d89d56",
  },
  constant: {
    color: "#d89d56",
  },
  symbol: {
    color: "#d89d56",
  },
  selector: {
    color: "#ffd28b",
  },
  "attr-name": {
    color: "#f7c77f",
  },
  string: {
    color: "#e4c487",
  },
  char: {
    color: "#e4c487",
  },
  builtin: {
    color: "#f9ce79",
  },
  inserted: {
    color: "#d6cf8e",
  },
  deleted: {
    color: "#cf7d61",
  },
  operator: {
    color: "#caa27d",
  },
  entity: {
    color: "#f4cf98",
  },
  url: {
    color: "#ddb87d",
  },
  variable: {
    color: "#efd2a8",
  },
  atrule: {
    color: "#ffb347",
    fontWeight: 700,
  },
  keyword: {
    color: "#ffb347",
    fontWeight: 700,
  },
  function: {
    color: "#ffe4aa",
  },
  "class-name": {
    color: "#ffd27a",
  },
  regex: {
    color: "#d6b079",
  },
  important: {
    color: "#ffb347",
    fontWeight: 700,
  },
  bold: {
    fontWeight: 700,
  },
  italic: {
    fontStyle: "italic",
  },
};
