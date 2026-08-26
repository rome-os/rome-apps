import { describe, expect, it } from "vitest";
import {
  buildCompanyResearchReportSections,
  normalizeCompanySearchQuery,
  scoreCompanySearchCandidate,
} from "./dashboard.js";

describe("buildCompanyResearchReportSections", () => {
  it("maps stored report rows into dashboard sections", () => {
    const sections = buildCompanyResearchReportSections([
      { reportType: "company", reportContent: "# Overview\nAcme" },
      { reportType: "team", reportContent: "## Team\nJane Doe" },
      { reportType: "marketing", reportContent: "Marketing detail" },
      { reportType: "content", reportContent: "Content detail" },
      { reportType: "financials", reportContent: "Revenue detail" },
    ]);

    expect(sections).toEqual({
      companyOverview: "# Overview\nAcme",
      teamReport: "## Team\nJane Doe",
      customersAndMetrics: "Marketing detail",
      contentReport: "Content detail",
      financialReport: "Revenue detail",
    });
  });

  it("returns empty strings when reports are missing", () => {
    expect(buildCompanyResearchReportSections([])).toEqual({
      companyOverview: "",
      teamReport: "",
      customersAndMetrics: "",
      contentReport: "",
      financialReport: "",
    });
  });
});

describe("normalizeCompanySearchQuery", () => {
  it("normalizes urls into comparable domains", () => {
    expect(normalizeCompanySearchQuery("https://www.Acme.com/about")).toBe("acme.com");
  });

  it("strips query strings, hashes, and ports from url-like search input", () => {
    expect(normalizeCompanySearchQuery("https://acme.com?ref=1#hero")).toBe("acme.com");
    expect(normalizeCompanySearchQuery("www.acme.com:8443/about?ref=1")).toBe("acme.com");
  });
});

describe("scoreCompanySearchCandidate", () => {
  const company = {
    id: "acme",
    canonicalName: "Acme Corporation",
    domain: "acme.com",
    websiteUrl: "https://acme.com",
  };

  it("prioritizes exact domain matches over partial name matches", () => {
    expect(scoreCompanySearchCandidate(company, "acme.com")).toBeGreaterThan(
      scoreCompanySearchCandidate(company, "acme"),
    );
  });

  it("returns zero for non-matching companies", () => {
    expect(scoreCompanySearchCandidate(company, "globex")).toBe(0);
  });
});
