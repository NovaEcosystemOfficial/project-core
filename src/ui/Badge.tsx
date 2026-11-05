import type { HTMLAttributes, ReactNode } from "react";

type BadgeTone = "neutral" | "success" | "warning" | "danger";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  children: ReactNode;
};

export function Badge({
  tone = "neutral",
  className,
  children,
  ...props
}: BadgeProps) {
  const classes = ["ui-badge", `ui-badge-${tone}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} {...props}>
      {children}
    </span>
  );
}
