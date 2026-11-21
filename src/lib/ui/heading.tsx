import { createElement } from 'react';

import type { ReactNode } from 'react';

/** The level of a heading below the page's own, which PageHeader gives. */
export type HeadingLevel = 'h2' | 'h3' | 'h4';

type HeadingProps = Readonly<{
  level: HeadingLevel;
  className: string;
  children: ReactNode;
}>;

/** A heading at `level`, so that a component fits the outline of the screen that holds it. */
export function Heading({ level, className, children }: HeadingProps): ReactNode {
  return createElement(level, { className }, children);
}
