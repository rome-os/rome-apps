import * as React from "react";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";
import { type ButtonProps, buttonVariants } from "@/components/ui/button";

const Pagination = ({ className, ...props }: React.ComponentProps<"nav">) => (
  <nav
    role="navigation"
    aria-label="pagination"
    className={cn("mx-auto flex w-full justify-center", className)}
    {...props}
  />
);
Pagination.displayName = "Pagination";

const PaginationContent = React.forwardRef<
  HTMLUListElement,
  React.ComponentProps<"ul">
>(({ className, ...props }, ref) => (
  <ul
    ref={ref}
    className={cn("flex flex-row items-center gap-1", className)}
    {...props}
  />
));
PaginationContent.displayName = "PaginationContent";

const PaginationItem = React.forwardRef<
  HTMLLIElement,
  React.ComponentProps<"li">
>(({ className, ...props }, ref) => (
  <li ref={ref} className={cn("", className)} {...props} />
));
PaginationItem.displayName = "PaginationItem";

type PaginationLinkProps = {
  isActive?: boolean;
  disabled?: boolean;
} & Pick<ButtonProps, "size"> &
  Omit<React.ComponentProps<"button">, "disabled">;

const PaginationLink = ({
  className,
  isActive,
  disabled,
  size = "icon",
  type = "button",
  onClick,
  ...props
}: PaginationLinkProps) => (
  <button
    type={type}
    disabled={disabled}
    aria-current={isActive ? "page" : undefined}
    onClick={disabled ? undefined : onClick}
    className={cn(
      "inline-flex items-center justify-center rounded-md text-sm font-medium transition-all duration-150",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
      size === "icon" ? "h-8 w-8" : "h-8 px-3",
      isActive
        ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
        : "hover:bg-accent hover:text-accent-foreground",
      disabled && "pointer-events-none opacity-40",
      className,
    )}
    {...props}
  />
);
PaginationLink.displayName = "PaginationLink";

const PaginationPrevious = ({
  className,
  disabled,
  ...props
}: React.ComponentProps<typeof PaginationLink>) => (
  <PaginationLink
    aria-label="Go to previous page"
    size="sm"
    disabled={disabled}
    className={cn("gap-1 pl-1.5 pr-2.5 text-xs", className)}
    {...props}
  >
    <ChevronLeft className="h-3.5 w-3.5" />
    <span>Prev</span>
  </PaginationLink>
);
PaginationPrevious.displayName = "PaginationPrevious";

const PaginationNext = ({
  className,
  disabled,
  ...props
}: React.ComponentProps<typeof PaginationLink>) => (
  <PaginationLink
    aria-label="Go to next page"
    size="sm"
    disabled={disabled}
    className={cn("gap-1 pl-2.5 pr-1.5 text-xs", className)}
    {...props}
  >
    <span>Next</span>
    <ChevronRight className="h-3.5 w-3.5" />
  </PaginationLink>
);
PaginationNext.displayName = "PaginationNext";

const PaginationEllipsis = ({
  className,
  ...props
}: React.ComponentProps<"span">) => (
  <span
    aria-hidden
    className={cn(
      "flex h-8 w-8 items-center justify-center text-muted-foreground",
      className,
    )}
    {...props}
  >
    <MoreHorizontal className="h-4 w-4" />
    <span className="sr-only">More pages</span>
  </span>
);
PaginationEllipsis.displayName = "PaginationEllipsis";

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
};
