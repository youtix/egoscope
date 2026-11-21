import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { LongText } from './long-text';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

const PROMPT = 'You are a research assistant.\n\n  Return JSON: {"format": "1.0", "events": []}';

const FOLD = { showAllLabel: 'Show all', showLessLabel: 'Show less' };

describe('LongText', () => {
  it('[IHM-63] keeps the text as written, in a region named for screen readers', () => {
    render(<LongText label="Prompt" text={PROMPT} id="prompt" />);

    const region = screen.getByRole('region', { name: 'Prompt' });
    expect(region).toHaveTextContent(PROMPT, { normalizeWhitespace: false });
    expect(region).toHaveAttribute('id', 'prompt');
    expect(region).toHaveClass('whitespace-pre-wrap', 'break-words');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('[IHM-63] starts folded when told, and unfolds and folds again from its button', async () => {
    const user = userEvent.setup();
    render(<LongText label="Prompt" text={PROMPT} fold={FOLD} />);

    const region = screen.getByRole('region', { name: 'Prompt' });
    expect(region).toHaveClass('max-h-[12lh]', 'overflow-hidden');
    await user.click(screen.getByRole('button', { name: 'Show all' }));
    expect(region).not.toHaveClass('max-h-[12lh]');
    await user.click(screen.getByRole('button', { name: 'Show less' }));
    expect(region).toHaveClass('max-h-[12lh]');
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules, folded and not', async () => {
    const { container } = render(
      <div>
        <LongText label="Prompt" text={PROMPT} fold={FOLD} />
        <LongText label="Pasted result" text={PROMPT} />
      </div>,
    );

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
