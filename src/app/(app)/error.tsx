'use client';

import { Button, PageHeader } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import type { ReactNode } from 'react';

/**
 * What a screen shows when the server fails to answer: what happened and what the owner can
 * do, in plain words (IHM-12, edge case « Erreur du serveur »). It takes the place of the
 * screen alone, inside the navigation, and trying again renders the screen afresh without
 * reloading the page, so what the device keeps, its drafts among them, stays as it was.
 */
export default function ScreenError({ retry }: Readonly<{ retry: () => void }>): ReactNode {
  return (
    <PageHeader
      title={sentence('interface.somethingWentWrong')}
      description={sentence('interface.screenNotShown')}
      actions={<Button label={sentence('interface.tryAgain')} variant="primary" onClick={retry} />}
    />
  );
}
