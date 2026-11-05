import type { ReactNode } from "react";

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
};

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: PageHeaderProps) {
  return (
    <header className="ui-page-header">
      <div className="ui-page-header-row">
        <div>
          {eyebrow ? <p className="ui-page-header-eyebrow">{eyebrow}</p> : null}
          <h2 className="ui-page-header-title">{title}</h2>
        </div>
        {actions ? <div className="ui-page-header-actions">{actions}</div> : null}
      </div>
      {description ? (
        <p className="ui-page-header-description">{description}</p>
      ) : null}
    </header>
  );
}
