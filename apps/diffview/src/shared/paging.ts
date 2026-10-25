/**
 * Paging contract shared by server and client. Patches are delivered in pages of the files that
 * actually carry a text diff ("pageable"), in list order; a cursor is an index into that sequence.
 */
export interface Pageable {
  binary: boolean;
  collapsed: boolean;
  added: number;
  deleted: number;
}
/** Binary, collapsed (lock/generated/huge) and empty files are not paged; they load on request. */
export const isPageable = (f: Pageable) =>
  !f.binary && !f.collapsed && f.added + f.deleted > 0;

export const PAGE_MAX_FILES = 150;
export const PAGE_MAX_LINES = 4000;
export const PAGE_MAX_BYTES = 1024 * 1024;

/**
 * Where a page that starts at `cursor` ends (exclusive). A page always holds at least one file,
 * and stops before exceeding the file, changed-line or (when known) byte budget.
 */
export function pageEnd(
  items: { added: number; deleted: number }[],
  cursor: number,
  bytesOf?: (index: number) => number,
) {
  let lines = 0,
    bytes = 0,
    end = cursor;
  while (end < items.length && end - cursor < PAGE_MAX_FILES) {
    const l = items[end].added + items[end].deleted;
    const b = bytesOf ? bytesOf(end) : 0;
    if (
      end > cursor &&
      (lines + l > PAGE_MAX_LINES || bytes + b > PAGE_MAX_BYTES)
    )
      break;
    lines += l;
    bytes += b;
    end++;
  }
  return end;
}

/** How many pageable files, from the one in focus on, the viewer keeps loaded ahead of itself. */
export const PAGE_LOOKAHEAD = 150;
