import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, onTestFinished } from 'vitest';

import { Button } from './button';
import { GlossaryTerm } from './figures/glossary-term';
import { PageHeader } from './page-header';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

const TYPE_SHEET_DEFINITION =
  'The definition of an event type: what it covers, its inclusion and exclusion criteria, and an example.';

/**
 * Hides the definitions that are not open, as the browser's own style sheet does. jsdom
 * has neither that rule nor the popover API, so a definition is never open here: a real
 * browser opens and closes it in e2e/ui-gallery.spec.ts.
 */
function hideClosedDefinitions(): void {
  const rule = document.createElement('style');
  rule.textContent = '[popover] { display: none; }';
  document.head.append(rule);
  onTestFinished(() => {
    rule.remove();
  });
}

describe('PageHeader', () => {
  it('gives the screen its only first-level heading, its sentence and its actions', () => {
    render(
      <PageHeader
        title="Players"
        description="Times in Paris time."
        actions={<Button label="Add a player" variant="primary" />}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Players' })).toBeVisible();
    expect(screen.getByText('Times in Paris time.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add a player' })).toBeVisible();
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    const { container } = render(
      <main>
        <PageHeader
          title="Players"
          description="Times in Paris time."
          actions={<Button label="Add a player" />}
        />
      </main>,
    );

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });

  describe('with a glossary term in its title', () => {
    it("[IHM-15] gives the screen its only first-level heading, named by the term's label while the definition is closed", async () => {
      hideClosedDefinitions();
      render(
        <main>
          <PageHeader title={<GlossaryTerm term="typeSheet" />} />
        </main>,
      );

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading).toHaveAccessibleName('Type sheet');
      await userEvent.tab();

      const term = within(heading).getByRole('button', { name: 'Type sheet' });
      expect(term).toHaveFocus();
      expect(term).toHaveAttribute(
        'popovertarget',
        screen.getByText(TYPE_SHEET_DEFINITION, { exact: true }).id,
      );
      expect(screen.getByText(TYPE_SHEET_DEFINITION, { exact: true })).not.toBeVisible();
    });

    it('[IHM-15] [IHM-61] passes the WCAG 2.2 AA rules while the definition is closed', async () => {
      hideClosedDefinitions();
      const { container } = render(
        <main>
          <PageHeader
            title={<GlossaryTerm term="typeSheet" />}
            description="Times in Paris time."
            actions={<Button label="Edit the type" />}
          />
        </main>,
      );

      await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
    });
  });
});
