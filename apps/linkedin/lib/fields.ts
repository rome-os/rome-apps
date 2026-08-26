const PERSON_SECTION_NAMES = [
  "main_profile",
  "experience",
  "education",
  "interests",
  "honors",
  "languages",
  "contact_info",
  "posts",
] as const;

const COMPANY_SECTION_NAMES = ["about", "posts", "jobs"] as const;

export type PersonSectionName = (typeof PERSON_SECTION_NAMES)[number];
export type CompanySectionName = (typeof COMPANY_SECTION_NAMES)[number];

export const PERSON_SECTIONS: Record<PersonSectionName, { suffix: string; overlay: boolean }> = {
  main_profile: { suffix: "/", overlay: false },
  experience: { suffix: "/details/experience/", overlay: false },
  education: { suffix: "/details/education/", overlay: false },
  interests: { suffix: "/details/interests/", overlay: false },
  honors: { suffix: "/details/honors/", overlay: false },
  languages: { suffix: "/details/languages/", overlay: false },
  contact_info: { suffix: "/overlay/contact-info/", overlay: true },
  posts: { suffix: "/recent-activity/all/", overlay: false },
};

export const COMPANY_SECTIONS: Record<CompanySectionName, { suffix: string; overlay: boolean }> = {
  about: { suffix: "/about/", overlay: false },
  posts: { suffix: "/posts/", overlay: false },
  jobs: { suffix: "/jobs/", overlay: false },
};

export function parsePersonSections(
  sections: string | undefined,
): { requested: Set<PersonSectionName>; unknown: string[] } {
  const requested = new Set<PersonSectionName>(["main_profile"]);
  const unknown: string[] = [];
  if (!sections) {
    return { requested, unknown };
  }

  for (const rawName of sections.split(",")) {
    const name = rawName.trim().toLowerCase();
    if (!name) {
      continue;
    }
    if (name in PERSON_SECTIONS) {
      requested.add(name as PersonSectionName);
    } else {
      unknown.push(name);
    }
  }

  return { requested, unknown };
}

export function parseCompanySections(
  sections: string | undefined,
): { requested: Set<CompanySectionName>; unknown: string[] } {
  const requested = new Set<CompanySectionName>(["about"]);
  const unknown: string[] = [];
  if (!sections) {
    return { requested, unknown };
  }

  for (const rawName of sections.split(",")) {
    const name = rawName.trim().toLowerCase();
    if (!name) {
      continue;
    }
    if (name in COMPANY_SECTIONS) {
      requested.add(name as CompanySectionName);
    } else {
      unknown.push(name);
    }
  }

  return { requested, unknown };
}
