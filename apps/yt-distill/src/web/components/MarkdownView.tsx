import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * A lightweight Markdown renderer for the Summary tab. It uses react-markdown
 * (which ships NO CSS of its own) and styles every element with host semantic
 * tokens, so nothing pulls in relative-URL font stylesheets. No math / mermaid /
 * syntax-highlighting — the summaries are plain prose + bullet lists.
 */

function CodeBlock({ className, children, ...props }: ComponentPropsWithoutRef<"code">) {
  const isBlock = /language-/.test(className ?? "");
  if (isBlock) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }
  return (
    <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]" {...props}>
      {children}
    </code>
  );
}

const components: Components = {
  h1: (p) => <h1 className="mt-6 mb-3 text-xl font-semibold tracking-tight first:mt-0" {...p} />,
  h2: (p) => <h2 className="mt-5 mb-2 text-lg font-semibold tracking-tight first:mt-0" {...p} />,
  h3: (p) => <h3 className="mt-4 mb-2 text-base font-semibold first:mt-0" {...p} />,
  h4: (p) => <h4 className="mt-3 mb-1 text-sm font-semibold first:mt-0" {...p} />,
  p: (p) => <p className="my-3 text-base leading-relaxed first:mt-0" {...p} />,
  ul: (p) => <ul className="my-3 list-disc space-y-1 pl-6" {...p} />,
  ol: (p) => <ol className="my-3 list-decimal space-y-1 pl-6" {...p} />,
  li: (p) => <li className="text-base leading-relaxed" {...p} />,
  a: ({ href, ...p }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline" {...p} />
  ),
  strong: (p) => <strong className="font-semibold" {...p} />,
  em: (p) => <em className="italic" {...p} />,
  blockquote: (p) => (
    <blockquote className="my-3 border-l-2 border-border pl-4 text-muted-foreground" {...p} />
  ),
  hr: () => <hr className="my-4 border-border" />,
  pre: (p) => (
    <pre className="my-3 overflow-x-auto rounded-md border bg-muted p-3 text-sm" {...p} />
  ),
  code: CodeBlock,
  table: (p) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...p} />
    </div>
  ),
  th: (p) => <th className="border border-border px-2 py-1 text-left font-medium" {...p} />,
  td: (p) => <td className="border border-border px-2 py-1 align-top" {...p} />,
};

export function MarkdownView({ markdown }: { markdown: string }) {
  return (
    <div className="text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
