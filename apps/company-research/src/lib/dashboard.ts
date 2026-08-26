export interface CompanySearchCandidate {
  id: string;
  canonicalName: string;
  domain: string | null;
  websiteUrl: string | null;
}

export interface CompanyResearchReportSections {
  companyOverview: string;
  teamReport: string;
  customersAndMetrics: string;
  contentReport: string;
  financialReport: string;
}

export interface CompanyResearchReportRow {
  reportType: string;
  reportContent: string | null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function stripUrlDecorators(value: string): string {
  return value
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .trim();
}

export function normalizeCompanySearchQuery(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return normalizeWhitespace(stripUrlDecorators(value)).toLowerCase();
}

export function buildCompanyResearchReportSections(
  reports: ReadonlyArray<CompanyResearchReportRow> | null | undefined,
): CompanyResearchReportSections {
  const reportMap = new Map<string, string>();

  for (const report of reports ?? []) {
    const reportType = report.reportType.trim().toLowerCase();
    if (!reportType || reportMap.has(reportType)) {
      continue;
    }
    reportMap.set(reportType, normalizeWhitespace(report.reportContent ?? ""));
  }

  return {
    companyOverview: reportMap.get("company") ?? "",
    teamReport: reportMap.get("team") ?? "",
    customersAndMetrics: reportMap.get("marketing") ?? "",
    contentReport: reportMap.get("content") ?? "",
    financialReport: reportMap.get("financials") ?? "",
  };
}

export function scoreCompanySearchCandidate(
  company: CompanySearchCandidate,
  rawQuery: string | null | undefined,
): number {
  const query = normalizeCompanySearchQuery(rawQuery);
  if (!query) {
    return 0;
  }

  const canonicalName = company.canonicalName.trim().toLowerCase();
  const domain = normalizeCompanySearchQuery(company.domain);
  const website = normalizeCompanySearchQuery(company.websiteUrl);

  if (domain && domain === query) {
    return 500;
  }
  if (canonicalName === query) {
    return 460;
  }
  if (website && website === query) {
    return 430;
  }
  if (domain && domain.startsWith(query)) {
    return 360;
  }
  if (canonicalName.startsWith(query)) {
    return 320;
  }
  if (website && website.startsWith(query)) {
    return 280;
  }
  if (domain && domain.includes(query)) {
    return 220;
  }
  if (canonicalName.includes(query)) {
    return 180;
  }
  if (website && website.includes(query)) {
    return 140;
  }
  return 0;
}
