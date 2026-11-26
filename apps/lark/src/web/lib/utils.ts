// `cn` is the kit's own class merger (clsx + tailwind-merge), re-exported here
// so `@/lib/utils` — the alias a copied shadcn recipe imports, and the one
// `components.json` points at — resolves without a second copy of the helper.
export { cn, type ClassValue } from "@rome-os/ui/cn";
