import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  useMemo,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { Button } from "@rome-os/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@rome-os/ui/dropdown-menu";
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  FileJson,
  FileImage,
  Eye,
  EyeOff,
  Copy,
  MoreHorizontal,
  ChevronsUpDown,
  LoaderCircle,
  FileText,
  FileDown,
  UnfoldVertical,
  ExternalLink,
} from "lucide-react";
import { compressedTree, pathParts, type ReviewFolder } from "../shared/review";
import type { FileEntry } from "../lib/git";
import type { Loaded } from "./types";
import { errorMessage, type Messages } from "./i18n";
export function FileGlyph({
  path,
  size = 16,
}: {
  path: string;
  size?: number;
}) {
  const ext = path.split(".").at(-1)?.toLowerCase();
  if (ext === "md" || ext === "mdx")
    return (
      <span
        aria-hidden
        style={{
          font: "bold 13px system-ui",
          color: "var(--success)",
          width: size,
          flexShrink: 0,
        }}
      >
        M↓
      </span>
    );
  const Icon = ["ts", "tsx", "js", "jsx", "css", "py", "sh"].includes(ext || "")
    ? FileCode2
    : ext === "json"
      ? FileJson
      : ["png", "jpg", "svg", "gif", "bin"].includes(ext || "")
        ? FileImage
        : File;
  return (
    <Icon
      aria-hidden
      size={size}
      style={{ color: "var(--muted-foreground)", flexShrink: 0 }}
    />
  );
}
export function Stats({
  added,
  deleted,
  zero = false,
}: {
  added: number;
  deleted: number;
  zero?: boolean;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        gap: 5,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
        fontSize: 13,
      }}
    >
      {(added > 0 || zero) && (
        <span style={{ color: "var(--success)" }}>+{added}</span>
      )}
      {(deleted > 0 || zero) && (
        <span style={{ color: "var(--destructive)" }}>−{deleted}</span>
      )}
    </span>
  );
}
export const Quiet = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
    label: string;
    children: ReactNode;
    pressed?: boolean;
  }
>(function Quiet({ label, children, pressed, className = "", ...props }, ref) {
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      {...props}
      className={`h-8 w-8 shrink-0 rounded-full text-muted-foreground ${pressed ? "bg-accent text-foreground" : ""} ${className}`}
    >
      {children}
    </Button>
  );
});
const HEADER_LINE = "color-mix(in srgb, var(--border) 50%, var(--app-canvas))";
export function DiffHeader({
  file,
  record,
  t,
  onLoad,
  onToggle,
  onViewed,
  viewed,
  queued = false,
  onCopy,
  onOpen,
  openUrl,
  onContext,
  collapsed = false,
  contextAvailable = true,
}: {
  file: FileEntry;
  record?: Loaded;
  t: Messages;
  onLoad: (anyway?: boolean) => void;
  onToggle: () => void;
  onViewed: () => void;
  viewed: boolean;
  /** Waiting for its page to arrive; nothing to click. */
  queued?: boolean;
  onCopy: () => void;
  onOpen?: () => void;
  openUrl?: string;
  onContext: () => void;
  collapsed?: boolean;
  contextAvailable?: boolean;
}) {
  const { directory, basename } = pathParts(file.path);
  const category =
    file.category && file.category !== "primary"
      ? {
          generated: t.categoryGenerated,
          lockfile: t.categoryLockfile,
          test: t.categoryTest,
          fixture: t.categoryFixture,
          snapshot: t.categorySnapshot,
          vendored: t.categoryVendored,
          documentation: t.categoryDocumentation,
        }[file.category]
      : "";
  const label = file.typeChanged
    ? t.unsupported_type_change
    : file.conflicted
      ? t.unmerged_conflict
      : record?.error
        ? errorMessage(record.error, t)
        : record?.binary || file.binary
          ? t.binary
          : record?.truncated
            ? t.large
            : record?.empty
              ? t.noText
              : category
                ? category
                : !record?.item && file.collapsed
                  ? t.generated
                  : "";
  return (
    <div
      className={`dv-header flex h-11 items-center gap-2 border-t bg-[var(--app-canvas)] px-3 text-[13px] ${viewed ? "dv-viewed" : ""}`}
      // The line under a header (when code follows) is drawn as a 1px shadow *below* its box, i.e.
      // on the first pixel row of whatever comes next. When the next file's header is right
      // there (sticky headers are pushed up glued together), that row is also its top border, so
      // the two lines coincide instead of adding up to a 2px rule. The colour is opaque for the same
      // reason: two translucent lines on one row would darken.
      style={{
        borderTopColor: HEADER_LINE,
        boxShadow:
          record?.item && !collapsed ? `0 1px 0 0 ${HEADER_LINE}` : undefined,
      }}
      data-file-path={file.path}
    >
      <button
        className="dv-path-button flex h-full min-w-0 flex-1 items-center gap-2.5 text-left"
        onClick={onToggle}
        disabled={file.typeChanged || file.conflicted}
        aria-label={`${collapsed ? t.expand : t.collapse}: ${file.path}`}
        title={file.oldPath ? file.oldPath + " → " + file.path : file.path}
      >
        <FileGlyph path={file.path} />
        <span
          className={`dv-path min-w-0 truncate ${viewed ? "opacity-50" : ""}`}
          style={{
            direction: "rtl",
            textAlign: "left",
            unicodeBidi: "isolate",
          }}
        >
          <bdi dir="ltr">
            <span className="dv-dir text-muted-foreground">{directory}</span>
            <strong className="font-medium">{basename}</strong>
          </bdi>
        </span>
      </button>
      <span
        className="dv-file-state max-w-[25%] truncate whitespace-nowrap text-xs text-muted-foreground"
        title={label}
      >
        {label}
      </span>
      <Stats added={file.added} deleted={file.deleted} />
      {record?.busy ? (
        <LoaderCircle
          size={14}
          className="animate-spin shrink-0"
          aria-label={t.loading}
        />
      ) : queued && !record ? (
        <LoaderCircle
          size={14}
          className="animate-spin shrink-0 text-muted-foreground"
          aria-label={t.loading}
        />
      ) : (!record || record.error || record.truncated) &&
        !file.binary &&
        !file.typeChanged &&
        file.added + file.deleted > 0 ? (
        <button
          className="rounded-md bg-muted px-2 py-1 text-xs hover:bg-accent"
          disabled={!contextAvailable && !!record?.truncated}
          onClick={() => onLoad(!!record?.truncated)}
        >
          {record?.error ? t.retry : t.load}
        </button>
      ) : null}
      <Button
        variant="ghost"
        size="icon"
        className="dv-icon h-7 w-7 shrink-0 rounded-md text-muted-foreground"
        title={t.viewed}
        aria-label={`${t.viewed}: ${file.path}`}
        aria-pressed={viewed}
        onClick={onViewed}
      >
        {viewed ? <EyeOff size={16} /> : <Eye size={16} />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="dv-icon dv-copy hidden h-7 w-7 shrink-0 rounded-md text-muted-foreground sm:inline-flex"
        title={t.copyPath}
        aria-label={`${t.copyPath}: ${file.path}`}
        onClick={onCopy}
      >
        <Copy size={15} />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="dv-icon h-7 w-7 shrink-0 rounded-md text-muted-foreground"
            aria-label={`${t.fileMenu}: ${file.path}`}
            title={t.fileMenu}
          >
            <MoreHorizontal size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onCopy}>
            <Copy size={14} />
            {t.copyPath}
          </DropdownMenuItem>
          {onOpen && openUrl && (
            <DropdownMenuItem disabled={!openUrl} onSelect={onOpen}>
              <FileText size={14} />
              {t.openFile}
            </DropdownMenuItem>
          )}
          {openUrl && (
            <DropdownMenuItem asChild>
              <a href={openUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={14} />
                {t.openNewTab}
              </a>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            disabled={file.typeChanged || file.conflicted}
            onSelect={onToggle}
          >
            <ChevronsUpDown size={14} />
            {collapsed ? t.expand : t.collapse}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={
              file.binary ||
              file.conflicted ||
              file.typeChanged ||
              !contextAvailable
            }
            onSelect={() => onLoad(true)}
          >
            <FileDown size={14} />
            {t.loadFull}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={
              file.binary ||
              file.conflicted ||
              file.typeChanged ||
              !contextAvailable
            }
            onSelect={onContext}
          >
            <UnfoldVertical size={14} />
            {t.moreContext}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
export function FileTree({
  files,
  selected,
  onSelect,
  viewed,
  t,
}: {
  files: FileEntry[];
  selected: string;
  onSelect: (p: string) => void;
  viewed: Set<string>;
  t: Messages;
}) {
  const tree = useMemo(() => compressedTree(files), [files]);
  const [closed, setClosed] = useState(new Set<string>());
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    setClosed(
      (prev) => new Set([...prev].filter((path) => !selected.startsWith(path))),
    );
    const node = [
      ...(ref.current?.querySelectorAll<HTMLElement>("[data-tree-path]") || []),
    ].find((el) => el.dataset.treePath === selected);
    node?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected]);
  function branch(node: ReviewFolder, level = 0): ReactNode {
    return (
      <>
        {node.folders.map((child) => (
          <div key={child.path}>
            <button
              className="flex h-8 w-full items-center gap-1.5 rounded-lg pr-2 text-left text-[13px] text-muted-foreground hover:bg-muted"
              style={{ paddingLeft: 8 + level * 14 }}
              aria-expanded={!closed.has(child.path)}
              title={child.name}
              onClick={() =>
                setClosed((prev) => {
                  const n = new Set(prev);
                  n.has(child.path) ? n.delete(child.path) : n.add(child.path);
                  return n;
                })
              }
            >
              {closed.has(child.path) ? (
                <ChevronRight size={13} />
              ) : (
                <ChevronDown size={13} />
              )}
              <span className="truncate">{child.name}</span>
            </button>
            {!closed.has(child.path) && branch(child, level + 1)}
          </div>
        ))}
        {node.files.map((f) => (
          <button
            key={f.path}
            data-tree-path={f.path}
            aria-current={selected === f.path ? "true" : undefined}
            title={f.path}
            onClick={() => onSelect(f.path)}
            className={`flex min-h-8 w-full items-center gap-2 rounded-lg pr-2 text-left text-[13px] transition-colors hover:bg-muted ${selected === f.path ? "bg-accent" : ""} ${viewed.has(f.path) ? "opacity-50" : ""}`}
            style={{ paddingLeft: 24 + level * 14 }}
          >
            <FileGlyph path={f.path} size={14} />
            <span className="min-w-0 flex-1 truncate">
              {f.path.split("/").at(-1)}
            </span>
            <Stats added={f.added} deleted={f.deleted} />
          </button>
        ))}
      </>
    );
  }
  return (
    <nav ref={ref} aria-label={t.files} className="px-2 pb-4">
      {branch(tree)}
    </nav>
  );
}

/** One shared pill control: every toolbar trigger uses it so height, border, padding and hover match. */
export const Pill = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(function Pill({ className = "", children, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      {...props}
      className={`inline-flex h-9 min-w-0 shrink-0 items-center gap-2 rounded-full border border-border/60 bg-transparent px-3 text-sm font-normal text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent ${className}`}
    >
      {children}
    </button>
  );
});
