import NextForm from 'next/form';

import { Button } from './button';
import { FormField } from './form-field';
import { Select } from './select';
import { TextInput } from './text-input';

import type { SelectOption } from './select';
import type { Route } from 'next';
import type { ReactNode } from 'react';

/** The filter of a list by state: its label, the name of its parameter, its states and the one shown. */
export type StateFilter = Readonly<{
  label: string;
  name: string;
  options: readonly SelectOption[];
  value: string;
}>;

/** The search of a list by name: its label, the name of its parameter, and the text searched. */
export type NameSearch = Readonly<{ label: string; name: string; value: string }>;

/** One item of a list: its key, and what the screen shows of it. */
export type ListItem = Readonly<{ key: string; content: ReactNode }>;

export type PagedListProps<T extends string> = Readonly<{
  /** What the list holds, which names it for screen readers. */
  label: string;
  /** The path of the screen, which the filter reloads with its values as parameters. */
  path: Route<T>;
  stateFilter: StateFilter;
  /** The search by player or type name, where the list can be long (IHM-18). */
  search?: NameSearch;
  /** The label of the button that applies the filter and the search. */
  applyLabel: string;
  /** The items of the slice shown. */
  items: readonly ListItem[];
  /** What shows instead of an empty slice, which says why and how to fill it (IHM-56). */
  emptyState: ReactNode;
  /** The move to the other slices, when there are any. */
  pagination?: ReactNode;
}>;

/**
 * A long list, loaded by slices, filtered by state and searched by name (IHM-18):
 * the filter is a form of the screen's own address, so a filtered slice can be
 * reloaded, shared and reached with the back button, and it works before the
 * page's code has loaded. The filter applies on its button, never on its own while
 * the owner is still choosing.
 */
export function PagedList<T extends string>({
  label,
  path,
  stateFilter,
  search,
  applyLabel,
  items,
  emptyState,
  pagination,
}: PagedListProps<T>): ReactNode {
  return (
    <div className="flex flex-col gap-4">
      <NextForm
        action={path}
        scroll={false}
        role="search"
        aria-label={label}
        className="flex flex-wrap items-end gap-3"
      >
        <div className="min-w-0 flex-1 basis-48">
          <FormField name={stateFilter.name} label={stateFilter.label}>
            <Select options={stateFilter.options} defaultValue={stateFilter.value} />
          </FormField>
        </div>
        {search !== undefined && (
          <div className="min-w-0 flex-1 basis-48">
            <FormField name={search.name} label={search.label}>
              <TextInput type="search" defaultValue={search.value} enterKeyHint="search" />
            </FormField>
          </div>
        )}
        <Button type="submit" label={applyLabel} />
      </NextForm>
      {items.length === 0 ? (
        emptyState
      ) : (
        <ul aria-label={label} className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.key}>{item.content}</li>
          ))}
        </ul>
      )}
      {pagination}
    </div>
  );
}
