import {
  Button,
  Card,
  DefinitionList,
  EmptyState,
  LinkButton,
  PagedList,
  Pagination,
  Skeleton,
  StatusPill,
  Table,
  Tabs,
} from '@/lib/ui';

import type { ReactNode } from 'react';

// The lines of text that the sample placeholder stands for.
const SAMPLE_LINES = 4;

const COLUMNS = [
  { key: 'name', header: 'Name' },
  { key: 'language', header: 'Language' },
  { key: 'count', header: 'Count', numeric: true },
];

const ROWS = [
  { key: 'first', cells: { name: 'Harbor Gazette', language: 'English', count: '1,204' } },
  { key: 'second', cells: { name: 'Courrier du Sport', language: 'French', count: '87' } },
];

const STATES = {
  label: 'State',
  name: 'state',
  options: [
    { value: 'open', label: 'Open' },
    { value: 'closed', label: 'Closed' },
  ],
  value: 'open',
};

const ITEMS = [
  {
    key: 'first',
    content: (
      <Card title="First sample" headingLevel="h3">
        <p>An item of the list.</p>
      </Card>
    ),
  },
  {
    key: 'second',
    content: (
      <Card title="Second sample" headingLevel="h3">
        <p>Another item.</p>
      </Card>
    ),
  },
];

/** Cards, record facts, the empty state and the loading placeholder. */
export function BlockSamples(): ReactNode {
  return (
    <div className="flex flex-col gap-4">
      <Card title="A card" headingLevel="h3" actions={<Button label="Card action" />}>
        <DefinitionList
          items={[
            { term: 'Name', details: 'Harbor Gazette' },
            { term: 'State', details: <StatusPill label="Open" tone="success" /> },
            {
              term: 'A longer term that wraps',
              details: 'A value long enough to wrap on a phone held upright.',
            },
          ]}
        />
      </Card>
      <EmptyState
        title="Nothing here yet"
        reason="Samples appear once one is added."
        action={<LinkButton href="/" label="Add a sample" variant="primary" />}
        headingLevel="h3"
      />
      <Skeleton label="Loading the samples" lines={SAMPLE_LINES} />
    </div>
  );
}

/** The table, the tabs, the paged list with its filter and its pages, and an empty one. */
export function ListSamples(): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <Table caption="Sample sources" columns={COLUMNS} rows={ROWS} />
      <Tabs
        label="Sample panels"
        items={[
          { value: 'one', label: 'First panel', panel: <p>The first panel.</p> },
          { value: 'two', label: 'Second panel', panel: <p>The second panel.</p> },
        ]}
      />
      <PagedList
        label="Samples"
        path="/dev/ui"
        stateFilter={STATES}
        search={{ label: 'Search by name', name: 'q', value: '' }}
        applyLabel="Apply"
        items={ITEMS}
        emptyState={null}
        pagination={
          <Pagination
            label="Pages of the samples"
            status="Page 2 of 3"
            previous={{ href: '/dev/ui?page=1', label: 'Previous page' }}
            next={{ href: '/dev/ui?page=3', label: 'Next page' }}
          />
        }
      />
      <PagedList
        label="Closed samples"
        path="/dev/ui"
        stateFilter={{ ...STATES, name: 'closedState', value: 'closed' }}
        applyLabel="Apply"
        items={[]}
        emptyState={
          <EmptyState
            title="No closed sample"
            reason="Samples close once their work is done."
            headingLevel="h3"
          />
        }
      />
    </div>
  );
}
