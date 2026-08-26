import { cn } from "@/lib/utils";

/** A pulsing placeholder block used to build loading skeletons. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}
