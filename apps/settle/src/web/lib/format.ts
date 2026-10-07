import { buildAppUrl } from "@rome-os/app-web-sdk";
import { favorWord, formatFavors, type RequestView } from "../../shared/model";

export function favors(n: number): string {
  return `${formatFavors(n)} ${favorWord(n)}`;
}

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const shortFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** "Oct 4, 2026". Date-only strings (YYYY-MM-DD) are read as local calendar dates. */
export function longDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(d.getTime()) ? "" : dateFmt.format(d);
}

export function shortDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.getFullYear() === new Date().getFullYear() ? shortFmt.format(d) : dateFmt.format(d);
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : timeFmt.format(d);
}

export function isOverdue(r: Pick<RequestView, "status" | "dueDate">): boolean {
  if (r.status !== "open" || !r.dueDate) return false;
  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return r.dueDate < ymd;
}

/** The payer link. Prefer the server's absolute link; fall back to this host. */
export function payLink(r: Pick<RequestView, "id" | "link">): string {
  if (/^https?:\/\//.test(r.link)) return r.link;
  try {
    return buildAppUrl(`p/${r.id}`);
  } catch {
    return `${window.location.origin}/apps/settle/p/${r.id}`;
  }
}

export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = value;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      el.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
