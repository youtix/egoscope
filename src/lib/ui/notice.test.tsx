import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { Notice } from './notice';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

describe('Notice', () => {
  it('[IHM-61] writes a result in words, in a region that screen readers announce in turn', () => {
    render(<Notice tone="success" message="The import is saved." />);

    expect(screen.getByRole('status')).toHaveTextContent('The import is saved.');
  });

  it('announces a failure at once', () => {
    render(<Notice tone="danger" message="The import was refused." />);

    expect(screen.getByRole('alert')).toHaveTextContent('The import was refused.');
  });

  it('keeps an empty region before any result, so that the result is announced when it comes', () => {
    const { rerender } = render(<Notice tone="info" message={undefined} />);

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    rerender(<Notice tone="info" message="The statistics are on their way." />);
    expect(screen.getByRole('status')).toHaveTextContent('The statistics are on their way.');
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules in each tone', async () => {
    const { container } = render(
      <div>
        <Notice tone="info" message="The statistics are on their way." />
        <Notice tone="success" message="The import is saved." />
        <Notice tone="warning" message="Three events were refused." />
        <Notice tone="danger" message="The import was refused." />
      </div>,
    );

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
