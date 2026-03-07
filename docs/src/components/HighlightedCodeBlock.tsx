import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import { docCodeTheme } from "@/lib/codeHighlight";

SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("diff", diff);
SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("jsx", jsx);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("markdown", markdown);
SyntaxHighlighter.registerLanguage("markup", markup);
SyntaxHighlighter.registerLanguage("tsx", tsx);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("yaml", yaml);

type HighlightedCodeBlockProps = {
  codeText: string;
  className?: string;
  language: string;
  codeProps?: Record<string, unknown>;
};

export default function HighlightedCodeBlock({
  codeText,
  className,
  language,
  codeProps,
}: HighlightedCodeBlockProps) {
  return (
    <SyntaxHighlighter
      language={language}
      style={docCodeTheme}
      customStyle={{ margin: 0, padding: "1.05rem 1.1rem 1.15rem", background: "transparent" }}
      codeTagProps={{ className: className ?? `language-${language}`, ...codeProps }}
      wrapLongLines={false}
    >
      {codeText}
    </SyntaxHighlighter>
  );
}
