'use client';

import { Tabs as BaseTabs } from '@base-ui/react/tabs';

import type { ReactNode } from 'react';

/** One tab: its value, its label, and the panel it shows. */
export type TabItem = Readonly<{ value: string; label: string; panel: ReactNode }>;

export type TabsProps = Readonly<{
  /** What the tabs choose between, which names their list for screen readers. */
  label: string;
  /** The tabs, the first one shown unless `defaultValue` names another. */
  items: readonly TabItem[];
  defaultValue?: string;
}>;

/**
 * Panels of one screen behind tabs: the arrow keys move between the tabs, Enter or
 * Space shows the focused one, and the shown tab is marked by a bar and bold text,
 * not by its color alone (IHM-61). The tabs wrap on a narrow screen.
 */
export function Tabs({ label, items, defaultValue }: TabsProps): ReactNode {
  return (
    <BaseTabs.Root defaultValue={defaultValue ?? items[0]?.value} className="flex flex-col gap-4">
      <BaseTabs.List aria-label={label} className="flex flex-wrap gap-1 border-b-2 border-line">
        {items.map((item) => (
          <BaseTabs.Tab
            key={item.value}
            value={item.value}
            className="-mb-0.5 min-h-touch border-b-4 border-transparent px-4 py-2 font-medium text-ink-muted hover:text-ink data-active:border-accent data-active:font-semibold data-active:text-ink"
          >
            {item.label}
          </BaseTabs.Tab>
        ))}
      </BaseTabs.List>
      {items.map((item) => (
        <BaseTabs.Panel key={item.value} value={item.value}>
          {item.panel}
        </BaseTabs.Panel>
      ))}
    </BaseTabs.Root>
  );
}
