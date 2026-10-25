/** Repository membership follows the selected project directory, never the active diff selection. */
export function groupRepositories<T extends { path: string }>(
  repos: T[],
  directory: string,
) {
  const root = directory.replace(/\/+$/, "");
  const current: T[] = [];
  const others: T[] = [];
  for (const repo of repos) {
    (root && (repo.path === root || repo.path.startsWith(root + "/"))
      ? current
      : others
    ).push(repo);
  }
  return { current, others };
}
