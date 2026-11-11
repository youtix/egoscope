import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import HomePage from './page';

describe('HomePage', () => {
  it('names the application in its only top-level heading', () => {
    render(<HomePage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Egoscope');
  });

  it('states that the tool has nothing to do with betting', () => {
    render(<HomePage />);

    expect(screen.getByText('It measures. It does not bet.')).toBeVisible();
  });
});
