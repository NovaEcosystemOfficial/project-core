import type { ReactNode } from "react";

type StatusItem = {
  label: string;
  value: ReactNode;
};

type StatusListProps = {
  items: StatusItem[];
  className?: string;
};

export function StatusList({ items, className }: StatusListProps) {
  const classes = ["ui-status-list", className].filter(Boolean).join(" ");

  return (
    <dl className={classes}>
      {items.map((item) => (
        <div key={item.label} className="ui-status-row">
          <dt className="ui-status-label">{item.label}</dt>
          <dd className="ui-status-value">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
