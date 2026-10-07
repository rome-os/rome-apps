import { SERIF_ITALIC as serifItalic, SERIF_NORMAL as serifNormal } from "./font-data";

let registered = false;

/**
 * Register the display face on the document. Fonts added to `document.fonts`
 * are visible inside the app's shadow root; an @font-face rule there is not.
 */
export function registerDisplayFont(): void {
  if (registered || typeof document === "undefined" || !("fonts" in document) || typeof FontFace === "undefined") return;
  registered = true;
  for (const face of [
    new FontFace("Settle Display", `url(${serifNormal}) format("woff2")`, { style: "normal", weight: "400", display: "swap" }),
    new FontFace("Settle Display", `url(${serifItalic}) format("woff2")`, { style: "italic", weight: "400", display: "swap" }),
  ]) {
    document.fonts.add(face);
    face.load().catch(() => undefined);
  }
}
