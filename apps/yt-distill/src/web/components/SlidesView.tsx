/**
 * Render a self-contained reveal.js HTML document inside a sandboxed iframe.
 * `allow-scripts` lets reveal.js run (it loads from a CDN); we deliberately omit
 * `allow-same-origin` so the model-generated document cannot reach the host.
 */
export function SlidesView({ html }: { html: string }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Use the arrow keys to move between slides. Click into the stage first to focus it.
      </p>
      <div className="overflow-hidden rounded-lg border bg-card">
        <iframe
          title="Slides"
          srcDoc={html}
          sandbox="allow-scripts"
          className="h-[70vh] w-full"
        />
      </div>
    </div>
  );
}
