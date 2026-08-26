import * as React from "react";
import { CheckCircle, Circle, Loader2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type TimelineStatus = "completed" | "in-progress" | "pending" | "error";

interface TimelineProps extends React.HTMLAttributes<HTMLOListElement> {
  size?: "sm" | "md" | "lg";
  iconsize?: "sm" | "md" | "lg";
  orientation?: "vertical" | "horizontal";
}

const Timeline = React.forwardRef<HTMLOListElement, TimelineProps>(
  ({ className, size = "md", iconsize = "sm", orientation = "vertical", children, ...props }, ref) => {
    const items = React.Children.toArray(children);

    if (items.length === 0) {
      return <TimelineEmpty />;
    }

    return (
      <ol
        ref={ref}
        aria-label="Timeline"
        className={cn(
          "relative flex w-full flex-col",
          orientation === "horizontal" && "flex-row overflow-x-auto pb-3",
          size === "sm" && "gap-3",
          size === "md" && "gap-4",
          size === "lg" && "gap-6",
          className,
        )}
        {...props}
      >
        {React.Children.map(children, (child, index) => {
          if (React.isValidElement<TimelineItemProps>(child)) {
            return React.cloneElement(child, {
              iconsize,
              showConnector: index !== items.length - 1,
              orientation,
            });
          }
          return child;
        })}
      </ol>
    );
  },
);
Timeline.displayName = "Timeline";

interface TimelineItemProps extends React.LiHTMLAttributes<HTMLLIElement> {
  date?: string;
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  status?: TimelineStatus;
  showConnector?: boolean;
  iconsize?: "sm" | "md" | "lg";
  orientation?: "vertical" | "horizontal";
}

const TimelineItem = React.forwardRef<HTMLLIElement, TimelineItemProps>(
  (
    {
      className,
      date,
      title,
      description,
      icon,
      status = "completed",
      showConnector = true,
      iconsize = "sm",
      orientation = "vertical",
      children,
      ...props
    },
    ref,
  ) => (
    <li
      ref={ref}
      className={cn(
        "relative w-full",
        orientation === "horizontal" && "w-40 min-w-40 shrink-0 sm:w-44 sm:min-w-44",
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          orientation === "horizontal"
            ? "flex flex-col items-center gap-2 text-center"
            : "grid grid-cols-[minmax(5.5rem,auto)_auto_1fr] items-start gap-3",
        )}
        {...(status === "in-progress" ? { "aria-current": "step" } : {})}
      >
        <div className={cn("flex flex-col justify-start pt-0.5", orientation === "horizontal" && "order-3 pt-0")}>
          <TimelineTime className={cn(orientation === "vertical" && "text-right")}>{date}</TimelineTime>
        </div>

        <div className={cn("flex items-center", orientation === "vertical" ? "flex-col" : "w-full justify-center")}>
          <TimelineIcon icon={icon} status={status} iconSize={iconsize} />
          {showConnector && (
            <TimelineConnector
              status={status}
              orientation={orientation}
            />
          )}
        </div>

        <TimelineContent className={cn(orientation === "horizontal" && "items-center px-2")}>
          <TimelineHeader>
            <TimelineTitle>{title}</TimelineTitle>
          </TimelineHeader>
          {description && <TimelineDescription>{description}</TimelineDescription>}
          {children}
        </TimelineContent>
      </div>
    </li>
  ),
);
TimelineItem.displayName = "TimelineItem";

interface TimelineTimeProps extends React.HTMLAttributes<HTMLTimeElement> {
  date?: string | Date | number;
  format?: Intl.DateTimeFormatOptions;
}

const TimelineTime = React.forwardRef<HTMLTimeElement, TimelineTimeProps>(
  ({ className, date, format, children, ...props }, ref) => {
    const formattedDate = React.useMemo(() => {
      if (!date) return "";
      const dateObj = new Date(date);
      if (Number.isNaN(dateObj.getTime())) return "";
      return new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        ...format,
      }).format(dateObj);
    }, [date, format]);

    return (
      <time
        ref={ref}
        dateTime={date ? new Date(date).toISOString() : undefined}
        className={cn("text-xs font-medium tabular-nums text-muted-foreground", className)}
        {...props}
      >
        {children || formattedDate}
      </time>
    );
  },
);
TimelineTime.displayName = "TimelineTime";

const TimelineConnector = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { status?: TimelineStatus; orientation?: "vertical" | "horizontal" }
>(({ className, status = "completed", orientation = "vertical", ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      orientation === "vertical" ? "mt-2 h-8 w-0.5" : "absolute left-1/2 top-3.5 h-0.5 w-full translate-x-4",
      status === "completed" && "bg-primary/60",
      status === "in-progress" && "bg-gradient-to-b from-primary/70 to-border",
      status === "pending" && "bg-border",
      status === "error" && "bg-destructive/60",
      className,
    )}
    {...props}
  />
));
TimelineConnector.displayName = "TimelineConnector";

const TimelineHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center gap-2", className)} {...props} />
  ),
);
TimelineHeader.displayName = "TimelineHeader";

const TimelineTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, children, ...props }, ref) => (
  <h3 ref={ref} className={cn("max-w-full whitespace-normal break-words text-sm font-semibold leading-tight", className)} {...props}>
    {children}
  </h3>
));
TimelineTitle.displayName = "TimelineTitle";

const TimelineIcon = ({
  icon,
  status = "completed",
  iconSize = "sm",
}: {
  icon?: React.ReactNode;
  status?: TimelineStatus;
  iconSize?: "sm" | "md" | "lg";
}) => {
  const sizeClasses = {
    sm: "h-7 w-7",
    md: "h-9 w-9",
    lg: "h-11 w-11",
  };

  const iconSizeClasses = {
    sm: "h-3.5 w-3.5",
    md: "h-4 w-4",
    lg: "h-5 w-5",
  };

  const fallbackIcon =
    status === "completed" ? (
      <CheckCircle />
    ) : status === "in-progress" ? (
      <Loader2 className="animate-spin" />
    ) : status === "error" ? (
      <XCircle />
    ) : (
      <Circle />
    );

  return (
    <div
      className={cn(
        "relative z-10 flex items-center justify-center rounded-full ring-4 ring-background",
        sizeClasses[iconSize],
        status === "completed" && "bg-primary text-primary-foreground",
        status === "in-progress" && "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200",
        status === "pending" && "bg-muted text-muted-foreground",
        status === "error" && "bg-destructive text-destructive-foreground",
      )}
    >
      <div className={cn("flex items-center justify-center [&>svg]:h-full [&>svg]:w-full", iconSizeClasses[iconSize])}>
        {icon || fallbackIcon}
      </div>
    </div>
  );
};

const TimelineDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("max-w-full whitespace-normal break-words text-xs text-muted-foreground", className)} {...props} />
));
TimelineDescription.displayName = "TimelineDescription";

const TimelineContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex min-w-0 flex-col gap-1 pb-1", className)} {...props} />
  ),
);
TimelineContent.displayName = "TimelineContent";

const TimelineEmpty = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col items-center justify-center p-6 text-center", className)}
      {...props}
    >
      <p className="text-sm text-muted-foreground">{children || "No timeline items to display"}</p>
    </div>
  ),
);
TimelineEmpty.displayName = "TimelineEmpty";

export {
  Timeline,
  TimelineItem,
  TimelineConnector,
  TimelineHeader,
  TimelineTitle,
  TimelineIcon,
  TimelineDescription,
  TimelineContent,
  TimelineTime,
  TimelineEmpty,
};
