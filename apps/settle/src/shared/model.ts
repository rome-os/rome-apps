// Shared between the API, actions and the web bundle. Keep it dependency-free.

export const APP_ID = "settle";

/**
 * Favor prices a request can carry. Rome Cloud fixes a favor-gated action's
 * price in its action.yaml, so every tier is its own `settle:pay_<amount>`
 * action. Adding a tier = add the number here and run `pnpm gen:tiers`.
 */
export const TIERS = [1, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000] as const;
export type Tier = (typeof TIERS)[number];

/** Rome Cloud's favor price: 25,000 favors = $100. */
export const FAVORS_PER_USD = 250;

export function isTier(value: unknown): value is Tier {
  return typeof value === "number" && (TIERS as readonly number[]).includes(value);
}

export function tierActionName(amount: Tier): string {
  return `pay_${amount}`;
}

export function formatFavors(n: number): string {
  return n.toLocaleString("en-US");
}

export function favorWord(n: number): string {
  return n === 1 ? "favor" : "favors";
}

/** "$100", "$2.50", "<$0.01" — for display next to a favor amount. */
export function usdFor(favors: number): string {
  if (favors === 0) return "$0";
  const usd = favors / FAVORS_PER_USD;
  if (usd < 0.01) return "<$0.01";
  if (Number.isInteger(usd)) return `$${usd.toLocaleString("en-US")}`;
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type RequestStatus = "open" | "paid" | "void";
export type PaidVia = "favors" | "manual";
export type PaymentStatus = "awaiting" | "paid" | "declined" | "failed";
export type EventKind =
  | "created"
  | "edited"
  | "viewed"
  | "payment_started"
  | "paid"
  | "declined"
  | "marked_paid"
  | "voided"
  | "reopened"
  | "duplicate_payment";

/** How the person who sent the request introduces themselves on the pay page. */
export interface Profile {
  name: string;
  title: string;
  company: string;
  bio: string;
  website: string;
  hasAvatar: boolean;
  /** Bumped when the avatar changes, for cache-busting. */
  avatarVersion: number;
}

export interface ActivityView {
  kind: EventKind;
  detail: string;
  at: string;
}

/** Guardian view of a request. */
export interface RequestView {
  id: string;
  item: string;
  details: string;
  recipientName: string;
  recipientEmail: string;
  amount: number;
  dueDate: string | null;
  status: RequestStatus;
  paidVia: PaidVia | null;
  payerEmail: string | null;
  paidAt: string | null;
  viewCount: number;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  voidedAt: string | null;
  /** Payment started on Rome Cloud but not settled yet. */
  pendingPayment: boolean;
  /** Absolute payer link when the public origin is known, else the app path. */
  link: string;
  activity?: ActivityView[];
}

export interface DashboardView {
  profile: Profile;
  requests: RequestView[];
  totals: { collected: number; outstanding: number; paidCount: number; openCount: number };
  origin: string;
}

/** What the payer sees. Never includes the recipient email or internal notes. */
export interface PublicRequestView {
  id: string;
  item: string;
  details: string;
  recipientName: string;
  amount: number;
  dueDate: string | null;
  status: RequestStatus;
  paidAt: string | null;
  createdAt: string;
  profile: Profile;
  viewer: {
    kind: "guardian" | "visitor" | "anonymous";
    email: string | null;
    /** This visitor is the one who paid. */
    isPayer: boolean;
    /** This visitor has a payment in flight on Rome Cloud. */
    pendingPaymentId: string | null;
  };
}

/** Empty until the owner fills in "Your profile"; the pay page falls back to {@link payeeName}. */
export const DEFAULT_PROFILE: Omit<Profile, "hasAvatar" | "avatarVersion"> = {
  name: "",
  title: "",
  company: "",
  bio: "",
  website: "",
};

/** The name shown to payers, with a neutral fallback while the profile is unset. */
export function payeeName(profile: Pick<Profile, "name">): string {
  return profile.name.trim() || "Your contact";
}
