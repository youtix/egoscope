import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { useActionState } from 'react';
import { describe, expect, it } from 'vitest';

import { Button } from './button';
import { ChangedElsewhereNotice } from './changed-elsewhere-notice';
import { DefinitionList } from './definition-list';
import { Form } from './form';
import { FormField } from './form-field';
import { Textarea } from './textarea';

import type { ReactNode } from 'react';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

// The version that another device saved while the owner was editing.
const CURRENT_DEFINITION = 'A public criticism of the player by a teammate.';

/**
 * An edit screen whose save always finds the object changed elsewhere, as the
 * service refuses a stale version (CL-IHM-18).
 */
function DefinitionEdit(): ReactNode {
  // The save answers nothing yet, or the current version when the object changed elsewhere.
  const [current, dispatch] = useActionState(
    (): string | undefined => CURRENT_DEFINITION,
    undefined,
  );
  return (
    <Form action={dispatch} errorSummaryTitle="The definition was not saved">
      {current !== undefined && (
        <ChangedElsewhereNotice
          title="Changed elsewhere"
          message="This type changed on another device or in a scheduled task. Your input is kept below: compare it with the current version, then save again."
          currentVersionTitle="Current version"
        >
          <DefinitionList items={[{ term: 'Definition', details: current }]} />
        </ChangedElsewhereNotice>
      )}
      <FormField name="definition" label="Definition">
        <Textarea defaultValue="A public criticism." />
      </FormField>
      <Button type="submit" label="Save" variant="primary" />
    </Form>
  );
}

describe('ChangedElsewhereNotice', () => {
  it('[CL-IHM-18] shows the current version beside the input, which stays visible to be applied again', async () => {
    const user = userEvent.setup();
    render(<DefinitionEdit />);

    const definition = screen.getByRole('textbox', { name: 'Definition' });
    await user.clear(definition);
    await user.type(definition, 'A public remark of the player by a coach.');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const notice = await screen.findByRole('alert');
    expect(within(notice).getByRole('heading', { name: 'Changed elsewhere' })).toBeVisible();
    expect(
      within(notice).getByText(/changed on another device or in a scheduled task/u),
    ).toBeVisible();
    expect(within(notice).getByRole('heading', { name: 'Current version' })).toBeVisible();
    expect(within(notice).getByText(CURRENT_DEFINITION)).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Definition' })).toHaveValue(
      'A public remark of the player by a coach.',
    );
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules inside its form', async () => {
    const user = userEvent.setup();
    const { container } = render(<DefinitionEdit />);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
