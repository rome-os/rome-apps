/** Logical Rome path ("projects/<project>/<file>") of a repo file, or undefined outside `projects/`. */
export function projectLogicalPath(
  repo: string,
  path: string,
): string | undefined {
  const marker = "/projects/";
  const at = repo.indexOf(marker);
  if (at < 0) return undefined;
  const root = repo.slice(at + marker.length).replace(/\/+$/, "");
  const segments = [...root.split("/"), ...path.split("/")].filter(Boolean);
  if (!segments.length || segments.some((s) => s === "." || s === ".."))
    return undefined;
  return "projects/" + segments.join("/");
}
/** Route of a repo file in Rome's Projects view, or undefined when the repo is outside `projects/`. */
export function projectFileUrl(repo: string, path: string): string | undefined {
  const logical = projectLogicalPath(repo, path);
  return logical && "/" + logical.split("/").map(encodeURIComponent).join("/");
}
