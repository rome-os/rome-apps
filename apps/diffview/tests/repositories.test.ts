import { test, expect } from "vitest";
import { groupRepositories } from "../src/shared/repositories";

test("current directory includes its own repo and nested repos, never sibling prefixes", () => {
  const paths = [
    "/p/work/a",
    "/p/work",
    "/p/work-extra",
    "/p/else",
    "/p/work/nested/b",
  ];
  const repos = paths.map((path) => ({ path }));
  const groups = groupRepositories(repos, "/p/work/");
  expect(groups.current.map((r) => r.path)).toEqual([
    "/p/work/a",
    "/p/work",
    "/p/work/nested/b",
  ]);
  expect(groups.others.map((r) => r.path)).toEqual([
    "/p/work-extra",
    "/p/else",
  ]);
});
test("an unknown directory never promotes the first-opened or active repository", () => {
  const repos = [{ path: "/p/first-opened" }, { path: "/p/selected" }];
  expect(groupRepositories(repos, "")).toEqual({ current: [], others: repos });
  expect(groupRepositories([], "/p/work")).toEqual({ current: [], others: [] });
});
