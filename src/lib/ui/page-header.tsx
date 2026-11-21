import type { ReactNode } from 'react';

export type PageHeaderProps = Readonly<{
  /** The screen's title, its only first-level heading. */
  title: string;
  /** A sentence under the title, such as the zone in which the screen states its times. */
  description?: string;
  /** The screen's main actions, which wrap under the title on a phone. */
  actions?: ReactNode;
}>;

/** The top of a screen: its title, what it is about, and its main actions within a thumb's reach. */
export function PageHeader({ title, description, actions }: PageHeaderProps): ReactNode {
  return (
    <header className="flex flex-col gap-3">
      <h1 className="text-2xl leading-tight font-semibold sm:text-3xl">{title}</h1>
      {description !== undefined && <p className="text-ink-muted">{description}</p>}
      {actions !== undefined && <div className="flex flex-wrap gap-3">{actions}</div>}
    </header>
  );
}
