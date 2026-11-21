import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { FormField } from './form-field';
import { Textarea } from './textarea';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

describe('Textarea', () => {
  it('takes several lines, from its stored value on', async () => {
    const user = userEvent.setup();
    render(
      <FormField name="comment" label="Comment">
        <Textarea defaultValue="First line." rows={6} />
      </FormField>,
    );

    const comment = screen.getByRole('textbox', { name: 'Comment' });
    await user.type(comment, '{Enter}Second line.');

    expect(comment).toHaveValue('First line.\nSecond line.');
    expect(comment).toHaveAttribute('rows', '6');
  });

  it('shows four lines unless told otherwise', () => {
    render(
      <FormField name="comment" label="Comment">
        <Textarea />
      </FormField>,
    );

    expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveAttribute('rows', '4');
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    const { container } = render(
      <FormField name="comment" label="Comment" hint="Why the case is excluded.">
        <Textarea />
      </FormField>,
    );

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
