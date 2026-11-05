import type { HTMLAttributes, ReactNode } from "react";

type PanelTone = "default" | "muted" | "danger";

type PanelProps = HTMLAttributes<HTMLElement> & {
  title?: string;
  tone?: PanelTone;
  children: ReactNode;
  as?: "section" | "article" | "div";
};

export function Panel({
  title,
  tone = "default",
  children,
  className,
  as: Tag = "section",
  ...props
}: PanelProps) {
  const classes = [
    "ui-panel",
    tone === "muted" ? "ui-panel-muted" : null,
    tone === "danger" ? "ui-panel-danger" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Tag className={classes} {...props}>
      {title ? <h3 className="ui-panel-title">{title}</h3> : null}
      {children}
    </Tag>
  );
}
