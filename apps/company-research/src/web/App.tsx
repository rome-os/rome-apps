import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  getCurrentAppPath,
  navigateToApp,
  subscribeToAppPath,
  type RomeAppBootstrap,
} from "@rome-os/app-web-sdk";
import { renderReportMarkdown } from "./report-markdown";
import "./styles.css";

type AppSectionKey = "overview" | "team" | "marketing" | "financials";

type AppRoute =
  | { kind: "home" }
  | {
      kind: "company";
      companyId: string;
    };

interface SearchCompany {
  id: string;
  canonicalName: string;
  domain: string | null;
  websiteUrl: string | null;
  latestRun: {
    id: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
}

interface SearchResponse {
  query: string;
  normalizedQuery: string;
  trackedCompanies: number;
  count: number;
  companies: SearchCompany[];
}

interface UrlResearchResponse {
  accepted: boolean;
  companyName: string;
  domain: string;
  websiteUrl: string;
}

interface DashboardCompany {
  id: string;
  canonicalName: string;
  domain: string | null;
  websiteUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DashboardRun {
  id: string;
  status: "running" | "success" | "partial" | "error";
  scheduledFor: string | null;
  startedAt: string | null;
  completedAt: string | null;
  promptVersion: string | null;
  extractorVersion: string | null;
  error: string | null;
  createdAt: string;
}

interface DashboardSchedule {
  cadenceMonths: number;
  isActive: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
}

interface DashboardAttributes {
  commonName: string | null;
  foundingDate: string | null;
  hqLocation: string | null;
  primaryGeographies: string[];
  companyStage: string | null;
  businessModelType: string | null;
  companyValueProposition: string | null;
  industryTags: string[];
  marketCategory: string | null;
  customerSegmentsServed: string[];
}

interface DashboardProduct {
  id: string;
  productName: string;
  productCategory: string | null;
  valueProposition: string | null;
  targetCustomerIcp: string | null;
  isPrimary: boolean;
}

interface DashboardSocialPage {
  id: string;
  platform: string;
  pageUrl: string;
  handle: string | null;
  isOfficial: boolean;
}

interface DashboardPersonRole {
  id: string;
  fullName: string | null;
  linkedinUrl: string | null;
  websiteUrl: string | null;
  roleType: string;
  title: string | null;
  department: string | null;
  bio: string | null;
  isCurrent: boolean | null;
  startDate: string | null;
  endDate: string | null;
}

interface DashboardJobPost {
  id: string;
  jobTitle: string;
  department: string | null;
  location: string | null;
  employmentType: string | null;
  postedAt: string | null;
  externalUrl: string | null;
  description: string | null;
  status: string | null;
}

interface DashboardRelationship {
  id: string;
  relationshipType: "customer" | "competitor";
  relationshipStrength: string | null;
  relatedCompany: {
    id: string;
    canonicalName: string;
    domain: string | null;
    websiteUrl: string | null;
  } | null;
}

interface DashboardEvent {
  id: string;
  eventCategory: string;
  headline: string;
  summary: string | null;
  eventDate: string | null;
  externalUrl: string | null;
  sourceName: string | null;
}

interface DashboardMetric {
  id: string;
  metricYear: number;
  annualRevenue: number | null;
  originalRevenueType: string | null;
  originalRevenueValue: string | null;
  originalRevenueCurrency: string | null;
  profit: number | null;
  originalProfitType: string | null;
  originalProfitValue: string | null;
  originalProfitCurrency: string | null;
  headcountTotal: number | null;
  activeUsers: number | null;
  activeUsersType: "dau" | "wau" | "mau" | "unknown" | null;
  payingCustomers: number | null;
}

interface DashboardValuationEntry {
  financingRoundId: string;
  roundType: string;
  roundLabel: string | null;
  announcedAt: string | null;
  amountRaised: number | null;
  amountRaisedCurrency: string | null;
  valuation: number;
  valuationCurrency: string | null;
  valuationBasis: "post_money" | "pre_money";
}

interface DashboardRoundInvestor {
  id: string;
  entityId: string;
  displayName: string;
  entityType: string;
  investorType: string | null;
  investorRole: string;
  websiteUrl: string | null;
}

interface DashboardFinancialRound {
  id: string;
  roundType: string;
  roundLabel: string | null;
  announcedAt: string | null;
  amountRaised: number | null;
  amountRaisedCurrency: string | null;
  preMoneyValuation: number | null;
  preMoneyValuationCurrency: string | null;
  postMoneyValuation: number | null;
  postMoneyValuationCurrency: string | null;
  totalCapitalRaised: number | null;
  totalCapitalRaisedCurrency: string | null;
  investors: DashboardRoundInvestor[];
}

interface DashboardLatestRound {
  financingRoundId: string;
  roundType: string;
  roundLabel: string | null;
  announcedAt: string | null;
  amountRaised: number | null;
  amountRaisedCurrency: string | null;
  totalCapitalRaised: number | null;
  totalCapitalRaisedCurrency: string | null;
  valuation: number | null;
  valuationCurrency: string | null;
  valuationBasis: "post_money" | "pre_money" | null;
  investors: DashboardRoundInvestor[];
}

interface DashboardPayload {
  company: DashboardCompany;
  schedule: DashboardSchedule | null;
  activeRun: DashboardRun | null;
  runs: DashboardRun[];
  reports: {
    companyOverview: string;
    teamReport: string;
    customersAndMetrics: string;
    contentReport: string;
    financialReport: string;
  };
  overview: {
    attributes: DashboardAttributes | null;
    products: DashboardProduct[];
    socialPages: DashboardSocialPage[];
  };
  team: {
    people: DashboardPersonRole[];
    jobPosts: DashboardJobPost[];
  };
  customersAndMetrics: {
    customers: DashboardRelationship[];
    competitors: DashboardRelationship[];
    notableEvents: DashboardEvent[];
    metricHighlights: DashboardMetric[];
  };
  financials: {
    latestMetric: DashboardMetric | null;
    metrics: DashboardMetric[];
    rounds: DashboardFinancialRound[];
    latestRound: DashboardLatestRound | null;
    latestValuation: DashboardValuationEntry | null;
    valuationHistory: DashboardValuationEntry[];
  };
}

const SECTION_TABS: Array<{ key: AppSectionKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "team", label: "Team" },
  { key: "financials", label: "Financials" },
  { key: "marketing", label: "Marketing" },
];

function normalizeRoute(path: string): AppRoute {
  const segments = path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments[0] === "company" && segments[1]) {
    return { kind: "company", companyId: segments[1] };
  }
  return { kind: "home" };
}

function formatRelative(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const diffMinutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (Math.abs(diffMinutes) < 60) {
    return diffMinutes >= 0 ? `${diffMinutes}m ago` : `in ${Math.abs(diffMinutes)}m`;
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 48) {
    return diffHours >= 0 ? `${diffHours}h ago` : `in ${Math.abs(diffHours)}h`;
  }
  const diffDays = Math.round(diffHours / 24);
  return diffDays >= 0 ? `${diffDays}d ago` : `in ${Math.abs(diffDays)}d`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatCurrencyAmount(
  value: number | null | undefined,
  currency: string | null | undefined = "USD",
): string {
  if (value === null || value === undefined) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency ?? "USD",
      maximumFractionDigits: 0,
      notation: value >= 1_000_000 ? "compact" : "standard",
    }).format(value);
  } catch {
    return `${currency ?? "USD"} ${formatInteger(value)}`;
  }
}

function formatMoney(value: number | null | undefined): string {
  return formatCurrencyAmount(value, "USD");
}

function formatInteger(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat().format(value);
}

function formatActiveUsersType(
  value: DashboardMetric["activeUsersType"],
): "DAU" | "WAU" | "MAU" | null {
  switch (value) {
    case "dau":
      return "DAU";
    case "wau":
      return "WAU";
    case "mau":
      return "MAU";
    default:
      return null;
  }
}

function formatActiveUsersLabel(value: DashboardMetric["activeUsersType"]): string {
  const typeLabel = formatActiveUsersType(value);
  return typeLabel ? `Active Users (${typeLabel})` : "Active Users";
}

function formatActiveUsersCell(metric: DashboardMetric): string {
  const count = formatInteger(metric.activeUsers);
  const typeLabel = formatActiveUsersType(metric.activeUsersType);
  return typeLabel && count !== "—" ? `${typeLabel} ${count}` : count;
}

function formatPayingCustomersCell(metric: DashboardMetric): string {
  return formatInteger(metric.payingCustomers);
}

function formatEnumLabel(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function trimDescription(value: string | null | undefined, limit: number): string {
  const normalized = value?.trim();
  if (!normalized) return "";
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit).trimEnd()}…`;
}

function formatRoundLabel(roundType: string, roundLabel: string | null | undefined): string {
  return roundLabel?.trim() || formatEnumLabel(roundType);
}

// ── Shared components ──

function StatusPill({ status }: { status: string }) {
  return <span className={`status-pill status-${status}`}>{formatEnumLabel(status)}</span>;
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-card">
      <h4>{title}</h4>
      <p>{body}</p>
    </div>
  );
}

function Chips({ values }: { values: string[] }) {
  if (values.length === 0) return <span style={{ color: "var(--text-tertiary)" }}>—</span>;
  return (
    <div className="chip-row">
      {values.map((v) => (
        <span className="chip" key={v}>
          {v}
        </span>
      ))}
    </div>
  );
}

function extractPlainPreview(markdown: string, maxLen: number): string {
  const plain = markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/\[(.+?)\]\[[^\]]*\]/g, "$1")
    .replace(/^\[[^\]]+\]:\s+.+$/gm, "")
    .replace(/!\[.*?\]\(.+?\)/g, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
  if (plain.length <= maxLen) return plain;
  return `${plain.slice(0, maxLen).trimEnd()}…`;
}

function CollapsibleReport({
  label,
  markdown,
}: {
  label: string;
  markdown: string;
}) {
  const [open, setOpen] = useState(false);
  const html = useMemo(() => (markdown.trim() ? renderReportMarkdown(markdown) : ""), [markdown]);
  const preview = useMemo(() => extractPlainPreview(markdown, 280), [markdown]);

  if (!markdown.trim()) return null;

  return (
    <div className="report-card">
      <div className="report-card-header">
        <h2>Research Report</h2>
        <span style={{ fontSize: 12, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>{label}</span>
      </div>
      <p className="report-preview">{preview}</p>
      <button type="button" className="report-toggle" onClick={() => setOpen(!open)}>
        <span className={`toggle-arrow${open ? " open" : ""}`}>&#9654;</span>
        {open ? "Hide full report" : "Read full report"}
      </button>
      {open && (
        <div className="report-content">
          <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      )}
    </div>
  );
}

// ── Overview section ──

function OverviewSection({ dashboard }: { dashboard: DashboardPayload }) {
  const attributes = dashboard.overview.attributes;
  const latestMetric = dashboard.financials.latestMetric;
  const hasProfileData = Boolean(attributes || latestMetric);

  return (
    <>
      <div className="section-card">
        <div className="section-card-header">
          <h2>Company Profile</h2>
        </div>
        {hasProfileData ? (
          <div className="facts-grid">
            <div className="fact-item">
              <span className="fact-label">Name</span>
              <p className="fact-value">{attributes?.commonName ?? dashboard.company.canonicalName}</p>
            </div>
            <div className="fact-item">
              <span className="fact-label">Founded</span>
              <p className="fact-value">{attributes?.foundingDate ?? "—"}</p>
            </div>
            <div className="fact-item">
              <span className="fact-label">Headquarters</span>
              <p className="fact-value">{attributes?.hqLocation ?? "—"}</p>
            </div>
            <div className="fact-item">
              <span className="fact-label">Stage</span>
              <p className="fact-value">{attributes?.companyStage ?? "—"}</p>
            </div>
            <div className="fact-item">
              <span className="fact-label">Business Model</span>
              <p className="fact-value">{attributes?.businessModelType ?? "—"}</p>
            </div>
            <div className="fact-item">
              <span className="fact-label">Market Category</span>
              <p className="fact-value">{attributes?.marketCategory ?? "—"}</p>
            </div>
            {latestMetric && (
              <div className="fact-item">
                <span className="fact-label">{formatActiveUsersLabel(latestMetric.activeUsersType)}</span>
                <p className="fact-value">{formatInteger(latestMetric.activeUsers)}</p>
                <p className="fact-text">As of {latestMetric.metricYear}</p>
              </div>
            )}
            {latestMetric && (
              <div className="fact-item">
                <span className="fact-label">Paying Customers</span>
                <p className="fact-value">{formatInteger(latestMetric.payingCustomers)}</p>
                <p className="fact-text">As of {latestMetric.metricYear}</p>
              </div>
            )}
            <div className="fact-item full-width">
              <span className="fact-label">Value Proposition</span>
              <p className="fact-text">{attributes?.companyValueProposition ?? "—"}</p>
            </div>
            <div className="fact-item full-width">
              <span className="fact-label">Geographies</span>
              <Chips values={attributes?.primaryGeographies ?? []} />
            </div>
            <div className="fact-item full-width">
              <span className="fact-label">Industry Tags</span>
              <Chips values={attributes?.industryTags ?? []} />
            </div>
            <div className="fact-item full-width">
              <span className="fact-label">Customer Segments</span>
              <Chips values={attributes?.customerSegmentsServed ?? []} />
            </div>
          </div>
        ) : (
          <EmptyCard title="No profile data" body="Research has not yet populated company attributes." />
        )}
      </div>

      {dashboard.overview.products.length > 0 && (
        <div className="section-card">
          <div className="section-card-header">
            <h2>Products</h2>
            <span className="count">{dashboard.overview.products.length}</span>
          </div>
          {dashboard.overview.products.map((product) => (
            <div className="list-item" key={product.id}>
              <div className="list-item-header">
                <div>
                  <h4>{product.productName}</h4>
                  <p className="subtitle">{product.productCategory ?? "Uncategorized"}</p>
                </div>
                {product.isPrimary && <span className="badge badge-primary">Primary</span>}
              </div>
              {product.valueProposition && <p className="description">{product.valueProposition}</p>}
              {product.targetCustomerIcp && (
                <p className="description" style={{ color: "var(--text-tertiary)" }}>
                  ICP: {product.targetCustomerIcp}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {dashboard.overview.socialPages.length > 0 && (
        <div className="section-card">
          <div className="section-card-header">
            <h2>Online Presence</h2>
          </div>
          {dashboard.overview.socialPages.map((page) => (
            <a
              className="social-link"
              href={page.pageUrl}
              key={page.id}
              rel="noreferrer"
              target="_blank"
            >
              <div>
                <h4>{formatEnumLabel(page.platform)}</h4>
                <p>{page.handle ?? page.pageUrl}</p>
              </div>
              <span className={`badge ${page.isOfficial ? "badge-success" : "badge-muted"}`}>
                {page.isOfficial ? "Official" : "Unofficial"}
              </span>
            </a>
          ))}
        </div>
      )}

      <CollapsibleReport label="research report" markdown={dashboard.reports.companyOverview} />
    </>
  );
}

// ── Team section ──

function PersonList({ people }: { people: DashboardPersonRole[] }) {
  return (
    <>
      {people.map((person) => (
        <div className="list-item" key={person.id}>
          <div className="list-item-header">
            <div>
              <h4>{person.websiteUrl ? (
                <a href={person.websiteUrl} rel="noreferrer" target="_blank" style={{ color: "inherit" }}>
                  {person.fullName ?? "Unknown"}
                </a>
              ) : (person.fullName ?? "Unknown")}</h4>
              <p className="subtitle">{person.title ?? formatEnumLabel(person.roleType)}</p>
            </div>
            <div className="badge-row">
              <span className="badge badge-primary">{formatEnumLabel(person.roleType)}</span>
              {person.isCurrent !== null && (
                <span className={`badge ${person.isCurrent ? "badge-success" : "badge-muted"}`}>
                  {person.isCurrent ? "Current" : "Past"}
                </span>
              )}
            </div>
          </div>
          {person.department && (
            <p className="description" style={{ color: "var(--text-tertiary)" }}>
              {formatEnumLabel(person.department)}
            </p>
          )}
          {person.bio && <p className="description">{trimDescription(person.bio, 220)}</p>}
          {person.linkedinUrl && (
            <div className="meta-row">
              <a href={person.linkedinUrl} rel="noreferrer" target="_blank">
                LinkedIn
              </a>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

function TeamSection({ dashboard }: { dashboard: DashboardPayload }) {
  const leadership = dashboard.team.people.filter((p) => p.isCurrent !== false);
  const alumni = dashboard.team.people.filter((p) => p.isCurrent === false);

  return (
    <>
      <div className="section-card">
        <div className="section-card-header">
          <h2>Leadership</h2>
          <span className="count">{leadership.length}</span>
        </div>
        {leadership.length ? (
          <PersonList people={leadership} />
        ) : (
          <EmptyCard title="No team data" body="No leadership information was captured." />
        )}
      </div>

      {alumni.length > 0 && (
        <div className="section-card">
          <div className="section-card-header">
            <h2>Alumni</h2>
            <span className="count">{alumni.length}</span>
          </div>
          <PersonList people={alumni} />
        </div>
      )}

      {dashboard.team.jobPosts.length > 0 && (
        <div className="section-card">
          <div className="section-card-header">
            <h2>Open Roles</h2>
            <span className="count">{dashboard.team.jobPosts.length}</span>
          </div>
          {dashboard.team.jobPosts.map((job) => {
            const content = (
              <>
                <div className="list-item-header">
                  <div>
                    <h4>{job.jobTitle}</h4>
                    <p className="subtitle">
                      {[job.location, job.employmentType].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  {job.department && <span className="badge badge-muted">{formatEnumLabel(job.department)}</span>}
                </div>
                {job.description && <p className="description">{trimDescription(job.description, 200)}</p>}
                <div className="meta-row">
                  {job.postedAt && <span>Posted {job.postedAt}</span>}
                </div>
              </>
            );
            return job.externalUrl ? (
              <a className="list-item" key={job.id} href={job.externalUrl} rel="noreferrer" target="_blank" style={{ textDecoration: "none", color: "inherit" }}>
                {content}
              </a>
            ) : (
              <div className="list-item" key={job.id}>
                {content}
              </div>
            );
          })}
        </div>
      )}

      <CollapsibleReport label="team report" markdown={dashboard.reports.teamReport} />
    </>
  );
}

// ── Customers & Metrics section ──

function RelationshipPanel({
  title,
  rows,
  emptyText,
}: {
  title: string;
  rows: DashboardRelationship[];
  emptyText: string;
}) {
  return (
    <div className="section-card">
      <div className="section-card-header">
        <h2>{title}</h2>
        <span className="count">{rows.length}</span>
      </div>
      {rows.length ? (
        rows.map((row) => {
          const url = row.relatedCompany?.websiteUrl || (row.relatedCompany?.domain ? `https://${row.relatedCompany.domain}` : null);
          const Tag = url ? "a" : "div";
          const linkProps = url ? { href: url, target: "_blank", rel: "noopener noreferrer" } : {};
          return (
            <Tag className="list-item" key={row.id} {...linkProps}>
              <div className="list-item-header">
                <div>
                  <h4>{row.relatedCompany?.canonicalName ?? "Unknown"}</h4>
                  <p className="subtitle">{row.relatedCompany?.domain ?? "—"}</p>
                </div>
                {row.relationshipStrength && (
                  <span className="badge badge-muted">{formatEnumLabel(row.relationshipStrength)}</span>
                )}
              </div>
            </Tag>
          );
        })
      ) : (
        <EmptyCard title={`No ${title.toLowerCase()}`} body={emptyText} />
      )}
    </div>
  );
}

function MarketingSection({ dashboard }: { dashboard: DashboardPayload }) {
  return (
    <>
      <div className="split-panels">
        <RelationshipPanel
          title="Customers"
          rows={dashboard.customersAndMetrics.customers}
          emptyText="No customer relationships captured."
        />
        <RelationshipPanel
          title="Competitors"
          rows={dashboard.customersAndMetrics.competitors}
          emptyText="No competitor relationships captured."
        />
      </div>

      {dashboard.customersAndMetrics.notableEvents.length > 0 && (
        <div className="section-card">
          <div className="section-card-header">
            <h2>Notable Events</h2>
            <span className="count">{dashboard.customersAndMetrics.notableEvents.length}</span>
          </div>
          {dashboard.customersAndMetrics.notableEvents.map((event) => {
            const cardContent = (
              <>
                <div className="list-item-header">
                  <div>
                    <h4>{event.headline}</h4>
                    <p className="subtitle">
                      {[event.sourceName, event.eventDate].filter(Boolean).join(" · ") ||
                        formatEnumLabel(event.eventCategory)}
                    </p>
                  </div>
                  <span className="badge badge-muted">{formatEnumLabel(event.eventCategory)}</span>
                </div>
                {event.summary && <p className="description">{event.summary}</p>}
              </>
            );
            return event.externalUrl ? (
              <a className="list-item" key={event.id} href={event.externalUrl} rel="noreferrer" target="_blank" style={{ display: "block", textDecoration: "none", color: "inherit", cursor: "pointer" }}>
                {cardContent}
              </a>
            ) : (
              <div className="list-item" key={event.id}>
                {cardContent}
              </div>
            );
          })}
        </div>
      )}

      <CollapsibleReport label="marketing report" markdown={dashboard.reports.customersAndMetrics} />
      <CollapsibleReport label="content strategy report" markdown={dashboard.reports.contentReport} />
    </>
  );
}

// ── Financials section ──

function FinancialsSection({ dashboard }: { dashboard: DashboardPayload }) {
  const latestMetric = dashboard.financials.latestMetric;
  const latestValuation = dashboard.financials.latestValuation;

  return (
    <>
      {(latestMetric || latestValuation) && (
        <div className="section-card">
          <div className="section-card-header">
            <h2>Financial Snapshot</h2>
          </div>
          <div className="highlight-grid">
            {latestMetric && (
              <>
                <div className="highlight-tile">
                  <p className="hl-label">Revenue</p>
                  <p className="hl-value">{formatMoney(latestMetric.annualRevenue)}</p>
                  <p className="hl-hint">{latestMetric.metricYear}</p>
                </div>
                <div className="highlight-tile">
                  <p className="hl-label">Profit</p>
                  <p className="hl-value">{formatMoney(latestMetric.profit)}</p>
                  <p className="hl-hint">{latestMetric.metricYear}</p>
                </div>
                <div className="highlight-tile">
                  <p className="hl-label">{formatActiveUsersLabel(latestMetric.activeUsersType)}</p>
                  <p className="hl-value">{formatInteger(latestMetric.activeUsers)}</p>
                  <p className="hl-hint">{latestMetric.metricYear}</p>
                </div>
                <div className="highlight-tile">
                  <p className="hl-label">Paying Customers</p>
                  <p className="hl-value">{formatInteger(latestMetric.payingCustomers)}</p>
                  <p className="hl-hint">{latestMetric.metricYear}</p>
                </div>
              </>
            )}
            {latestValuation && (
              <div className="highlight-tile">
                <p className="hl-label">Valuation</p>
                <p className="hl-value">
                  {formatCurrencyAmount(latestValuation.valuation, latestValuation.valuationCurrency)}
                </p>
                <p className="hl-hint">
                  {formatRoundLabel(latestValuation.roundType, latestValuation.roundLabel)} · {formatEnumLabel(latestValuation.valuationBasis)}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {dashboard.financials.metrics.length > 0 && (
        <div className="section-card">
          <div className="section-card-header">
            <h2>Annual Metrics</h2>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Year</th>
                  <th>Revenue</th>
                  <th>Basis</th>
                  <th>Profit</th>
                  <th>Active Users</th>
                  <th>Paying Customers</th>
                  <th>Headcount</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.financials.metrics.map((metric) => (
                  <tr key={metric.id}>
                    <td>{metric.metricYear}</td>
                    <td>{formatMoney(metric.annualRevenue)}</td>
                    <td>
                      {metric.originalRevenueValue
                        ? `${metric.originalRevenueType ?? "reported"} ${metric.originalRevenueValue} ${metric.originalRevenueCurrency ?? ""}`.trim()
                        : "—"}
                    </td>
                    <td>{formatMoney(metric.profit)}</td>
                    <td>{formatActiveUsersCell(metric)}</td>
                    <td>{formatPayingCustomersCell(metric)}</td>
                    <td>{formatInteger(metric.headcountTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {dashboard.financials.valuationHistory.length > 0 && (
        <div className="section-card">
          <div className="section-card-header">
            <h2>Valuation History</h2>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Round</th>
                  <th>Valuation</th>
                  <th>Basis</th>
                  <th>Raised</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.financials.valuationHistory.map((entry) => (
                  <tr key={entry.financingRoundId}>
                    <td>{entry.announcedAt ?? "—"}</td>
                    <td>{formatRoundLabel(entry.roundType, entry.roundLabel)}</td>
                    <td>{formatCurrencyAmount(entry.valuation, entry.valuationCurrency)}</td>
                    <td>{formatEnumLabel(entry.valuationBasis)}</td>
                    <td>{formatCurrencyAmount(entry.amountRaised, entry.amountRaisedCurrency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {dashboard.financials.rounds.length > 0 && (
        <div className="section-card">
          <div className="section-card-header">
            <h2>Financing Rounds</h2>
            <span className="count">{dashboard.financials.rounds.length}</span>
          </div>
          {dashboard.financials.rounds.map((round) => (
            <div className="list-item" key={round.id}>
              <div className="list-item-header">
                <div>
                  <h4>{formatRoundLabel(round.roundType, round.roundLabel)}</h4>
                  <p className="subtitle">
                    {[
                      round.announcedAt ?? "Date unknown",
                      formatCurrencyAmount(round.amountRaised, round.amountRaisedCurrency),
                    ].join(" · ")}
                  </p>
                </div>
                <span className="badge badge-muted">
                  {round.investors.length} investor{round.investors.length === 1 ? "" : "s"}
                </span>
              </div>
              {round.investors.length > 0 && (
                <div className="badge-row" style={{ marginTop: 8 }}>
                  {round.investors.map((investor) => {
                    const label = `${investor.displayName}${investor.investorRole !== "participant" ? ` · ${formatEnumLabel(investor.investorRole)}` : ""}`;
                    return investor.websiteUrl ? (
                      <a className="badge badge-primary" href={investor.websiteUrl} rel="noreferrer" target="_blank" key={investor.id} style={{ textDecoration: "none" }}>
                        {label}
                      </a>
                    ) : (
                      <span className="badge badge-primary" key={investor.id}>
                        {label}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <CollapsibleReport label="financial report" markdown={dashboard.reports.financialReport} />
    </>
  );
}

// ── Company dashboard ──

function CompanyDashboard({
  dashboard,
  section,
  onSectionChange,
}: {
  dashboard: DashboardPayload;
  section: AppSectionKey;
  onSectionChange: (section: AppSectionKey) => void;
}) {
  const latestMetric = dashboard.financials.latestMetric;
  const latestRound = dashboard.financials.latestRound;
  const totalRaisedValue = latestRound?.totalCapitalRaised ?? latestRound?.amountRaised;
  const totalRaisedCurrency =
    latestRound?.totalCapitalRaised != null
      ? latestRound.totalCapitalRaisedCurrency
      : latestRound?.amountRaisedCurrency;

  return (
    <>
      <div className="company-header">
        <h1>{dashboard.company.canonicalName}</h1>
        <div className="company-header-meta">
          {dashboard.company.domain && <span>{dashboard.company.domain}</span>}
          {dashboard.company.websiteUrl && (
            <a href={dashboard.company.websiteUrl} rel="noreferrer" target="_blank">
              {dashboard.company.websiteUrl}
            </a>
          )}
          {dashboard.activeRun && <StatusPill status={dashboard.activeRun.status} />}
          <span>Last updated {formatRelative(dashboard.activeRun?.completedAt ?? dashboard.activeRun?.startedAt)}</span>
        </div>
        <div className="company-kpis">
          <div className="kpi-card">
            <p className="kpi-label">Revenue</p>
            <p className="kpi-value">{formatMoney(latestMetric?.annualRevenue)}</p>
            {latestMetric && <p className="kpi-hint">{latestMetric.metricYear}</p>}
          </div>
          <div className="kpi-card">
            <p className="kpi-label">Headcount</p>
            <p className="kpi-value">{formatInteger(latestMetric?.headcountTotal)}</p>
            {latestMetric && <p className="kpi-hint">{latestMetric.metricYear}</p>}
          </div>
          <div className="kpi-card">
            <p className="kpi-label">Valuation / Raised</p>
            <p className="kpi-value">
              {formatCurrencyAmount(latestRound?.valuation, latestRound?.valuationCurrency)} /{" "}
              {formatCurrencyAmount(totalRaisedValue, totalRaisedCurrency)}
            </p>
            {latestRound && (
              <p className="kpi-hint">{formatRoundLabel(latestRound.roundType, latestRound.roundLabel)}</p>
            )}
          </div>
          <div className="kpi-card">
            <p className="kpi-label">Stage</p>
            <p className="kpi-value">{dashboard.overview.attributes?.companyStage ?? "—"}</p>
            {dashboard.overview.attributes?.marketCategory && (
              <p className="kpi-hint">{dashboard.overview.attributes.marketCategory}</p>
            )}
          </div>
        </div>
      </div>

      <div className="tab-bar">
        {SECTION_TABS.map((tab) => (
          <button
            type="button"
            key={tab.key}
            className={`tab-btn${tab.key === section ? " active" : ""}`}
            onClick={() => onSectionChange(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {section === "overview" && <OverviewSection dashboard={dashboard} />}
      {section === "team" && <TeamSection dashboard={dashboard} />}
      {section === "marketing" && <MarketingSection dashboard={dashboard} />}
      {section === "financials" && <FinancialsSection dashboard={dashboard} />}
    </>
  );
}

// ── Main app ──

export default function CompanyResearchApp({ bootstrap }: { bootstrap: RomeAppBootstrap }) {
  const [route, setRoute] = useState<AppRoute>(() => normalizeRoute(getCurrentAppPath()));
  const [section, setSection] = useState<AppSectionKey>("overview");
  const [searchInput, setSearchInput] = useState("");
  const [websiteInput, setWebsiteInput] = useState("");
  const [urlResearchLoading, setUrlResearchLoading] = useState(false);
  const [urlResearchMessage, setUrlResearchMessage] = useState<string | null>(null);
  const [urlResearchError, setUrlResearchError] = useState<string | null>(null);
  const [searchData, setSearchData] = useState<SearchResponse | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(true);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  useEffect(() => subscribeToAppPath((nextPath) => setRoute(normalizeRoute(nextPath))), []);

  useEffect(() => {
    if (route.kind === "company") setSection("overview");
  }, [route]);

  // Search effect
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        setSearchLoading(true);
        setSearchError(null);
        const url = new URL(`${bootstrap.apiBase}/search`, window.location.origin);
        if (searchInput.trim()) url.searchParams.set("query", searchInput.trim());
        url.searchParams.set("limit", "24");
        const response = await fetch(url, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`Search failed (${response.status})`);
        const payload = (await response.json()) as SearchResponse;
        if (!cancelled) setSearchData(payload);
      } catch (error) {
        if (!cancelled) setSearchError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [bootstrap.apiBase, searchInput]);

  // Dashboard effect
  useEffect(() => {
    if (route.kind !== "company") {
      setDashboard(null);
      setDashboardError(null);
      setDashboardLoading(false);
      return;
    }
    const companyId = route.companyId;
    let cancelled = false;
    async function load() {
      try {
        setDashboardLoading(true);
        setDashboardError(null);
        const response = await fetch(
          `${bootstrap.apiBase}/companies/${encodeURIComponent(companyId)}/dashboard`,
          { headers: { Accept: "application/json" } },
        );
        if (!response.ok) throw new Error(`Dashboard failed (${response.status})`);
        const payload = (await response.json()) as DashboardPayload;
        if (!cancelled) setDashboard(payload);
      } catch (error) {
        if (!cancelled) {
          setDashboard(null);
          setDashboardError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) setDashboardLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [bootstrap.apiBase, route]);

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const firstMatch = searchData?.companies[0];
    if (firstMatch) navigateToApp(`company/${firstMatch.id}`);
  }

  async function handleUrlResearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const websiteUrl = websiteInput.trim();
    if (!websiteUrl) return;

    try {
      setUrlResearchLoading(true);
      setUrlResearchError(null);
      setUrlResearchMessage(null);

      const response = await fetch(`${bootstrap.apiBase}/research-from-url`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ website_url: websiteUrl }),
      });
      const payload = (await response.json().catch(() => null)) as
        | UrlResearchResponse
        | { message?: string }
        | null;

      if (!response.ok) {
        throw new Error(
          payload && "message" in payload && payload.message
            ? payload.message
            : `Research request failed (${response.status})`,
        );
      }

      const accepted = payload as UrlResearchResponse;
      setUrlResearchMessage(`Started background research for ${accepted.companyName}.`);
      setWebsiteInput("");
    } catch (error) {
      setUrlResearchError(error instanceof Error ? error.message : String(error));
    } finally {
      setUrlResearchLoading(false);
    }
  }

  // ── Home view ──
  if (route.kind === "home") {
    return (
      <div className="app-shell">
        <header className="app-header">
          <h1>Company Research</h1>
          <p>Search and explore in-depth research reports on companies.</p>
          <p className="app-header-note">
            To use this app, please install chatgpt app first. Also, log in to your chatgpt plus or pro account for the best result.
          </p>
        </header>

        <form className="research-launcher" onSubmit={handleUrlResearchSubmit}>
          <label>
            <span>Research a company website</span>
            <input
              type="url"
              placeholder="https://example.com"
              value={websiteInput}
              onChange={(e) => setWebsiteInput(e.target.value)}
            />
          </label>
          <button disabled={urlResearchLoading || websiteInput.trim().length === 0} type="submit">
            {urlResearchLoading ? "Starting..." : "Start research"}
          </button>
        </form>

        {urlResearchMessage && <div className="success-banner">{urlResearchMessage}</div>}
        {urlResearchError && <div className="error-banner">{urlResearchError}</div>}

        <form onSubmit={handleSearchSubmit}>
          <div className="search-bar">
            <span className="search-icon">&#x1F50D;</span>
            <label>
              <span className="sr-only">Search companies</span>
              <input
                type="search"
                placeholder="Search by company name or domain..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </label>
          </div>
        </form>

        <div className="search-stats">
          <span>{searchData?.trackedCompanies ?? 0} companies researched</span>
          {searchInput.trim() && <span>{searchData?.count ?? 0} results</span>}
        </div>

        {searchError && <div className="error-banner">{searchError}</div>}

        {searchLoading && <div className="loading-state">Loading companies...</div>}

        {!searchLoading && !searchError && searchData && searchData.companies.length === 0 && (
          <div className="empty-state">
            <h3>No companies found</h3>
            <p>
              {searchInput.trim()
                ? "Try a different search term or domain."
                : "No companies have been researched yet."}
            </p>
          </div>
        )}

        {!searchLoading && searchData && searchData.companies.length > 0 && (
          <div className="company-grid">
            {searchData.companies.map((company) => (
              <button
                type="button"
                className="company-card"
                key={company.id}
                onClick={() => navigateToApp(`company/${company.id}`)}
              >
                <div className="company-card-header">
                  <div>
                    <h3>{company.canonicalName}</h3>
                    <p className="domain">{company.domain ?? company.websiteUrl ?? "—"}</p>
                  </div>
                  {company.latestRun && <StatusPill status={company.latestRun.status} />}
                </div>
                <div className="card-meta">
                  <span>
                    {company.latestRun
                      ? `Researched ${formatRelative(company.latestRun.completedAt ?? company.latestRun.startedAt)}`
                      : "—"}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Company view ──
  return (
    <div className="app-shell">
      <div className="company-page">
        <div className="page-top-bar">
          <button className="back-button" onClick={() => navigateToApp("")} type="button">
            &#8592; Back
          </button>
        </div>

        {dashboardError && <div className="error-banner">{dashboardError}</div>}

        {dashboardLoading && <div className="loading-state">Loading company data...</div>}

        {!dashboardLoading && dashboard && (
          <CompanyDashboard dashboard={dashboard} section={section} onSectionChange={setSection} />
        )}
      </div>
    </div>
  );
}

