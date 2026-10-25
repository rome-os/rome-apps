import { test } from "vitest";
import assert from "node:assert/strict";
import { projectFileUrl, projectLogicalPath } from "../src/shared/projectLink";

test("maps a repo file to its Projects route", () => {
  assert.equal(
    projectFileUrl("/home/rome/.rome/default/projects/rome", "docs/a b.md"),
    "/projects/rome/docs/a%20b.md",
  );
  assert.equal(
    projectFileUrl(
      "/home/rome/.rome/default/projects/default/workstation-core/",
      "README.md",
    ),
    "/projects/default/workstation-core/README.md",
  );
});
test("refuses repos outside projects and path traversal", () => {
  assert.equal(projectFileUrl("/srv/other", "a.md"), undefined);
  assert.equal(
    projectFileUrl("/home/rome/.rome/default/projects/rome", "../x"),
    undefined,
  );
});
test("logical path is unencoded, URL is encoded", () => {
  const repo = "/home/rome/.rome/default/projects/rome";
  assert.equal(
    projectLogicalPath(repo, "docs/a b.md"),
    "projects/rome/docs/a b.md",
  );
  assert.equal(
    projectFileUrl(repo, "docs/a b.md"),
    "/projects/rome/docs/a%20b.md",
  );
});
