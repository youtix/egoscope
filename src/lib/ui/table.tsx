import { useId } from 'react';

import { cx } from './class-names';

import type { ReactNode } from 'react';

/** A column: the key of its cells, its header, and whether it holds numbers. */
export type TableColumn = Readonly<{
  key: string;
  header: string;
  /** Numbers align on the right, in figures of one width, and never break (IHM-60). */
  numeric?: boolean;
}>;

/** A row: its key, and its cells by column key, as the screen wrote them. */
export type TableRow = Readonly<{ key: string; cells: Readonly<Record<string, ReactNode>> }>;

export type TableProps = Readonly<{
  /** What the table lists, which names it for screen readers and on a phone. */
  caption: string;
  columns: readonly TableColumn[];
  rows: readonly TableRow[];
}>;

/**
 * A table on a wide screen; on a phone, one block per row, its first cell as its
 * title and the others under their headers, so nothing scrolls sideways (IHM-01).
 * The switch follows the room that the table has, which shrinks as the phone's
 * text grows (IHM-60). Only one of the two forms is shown at a time, and screen
 * readers read only that one.
 */
export function Table({ caption, columns, rows }: TableProps): ReactNode {
  const captionId = useId();
  const [first, ...others] = columns;
  return (
    <div className="@container">
      <table className="hidden w-full border-collapse text-left @2xl:table">
        <caption className="mb-2 text-left font-semibold">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cx(
                  'border-b-2 border-line-strong px-3 py-2 font-semibold',
                  column.numeric === true && 'text-right',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-line">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cx(
                    'px-3 py-2 align-top',
                    column.numeric === true && 'text-right whitespace-nowrap tabular-nums',
                  )}
                >
                  {row.cells[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-col gap-3 @2xl:hidden">
        <p id={captionId} className="font-semibold">
          {caption}
        </p>
        <ul aria-labelledby={captionId} className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.key} className="rounded-xl border border-line bg-surface p-4">
              {first !== undefined && <p className="font-semibold">{row.cells[first.key]}</p>}
              <dl className="mt-2 flex flex-col gap-1">
                {others.map((column) => (
                  <div key={column.key} className="flex flex-wrap justify-between gap-x-4">
                    <dt className="text-ink-muted">{column.header}</dt>
                    <dd className={cx(column.numeric === true && 'tabular-nums')}>
                      {row.cells[column.key]}
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
