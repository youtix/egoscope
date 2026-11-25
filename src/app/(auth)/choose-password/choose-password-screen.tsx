import 'server-only';

import { redirect } from 'next/navigation';

import { currentSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/log';
import { getParam } from '@/lib/params';
import { Notice, PageHeader } from '@/lib/ui';
import { formatCount, sentence } from '@/lib/wording';

import { choosePasswordAction } from './actions';
import { ChoosePasswordForm } from './choose-password-form';
import { logInAddress } from './log-in-address';

import type { ReactNode } from 'react';

/** The query of the address: the screen to return to once the password is chosen. */
export type ChoosePasswordQuery = Readonly<Record<string, string | string[] | undefined>>;

/** The screen while the server cannot save a password, whose cause only the server log names. */
function unavailable(cause: string): ReactNode {
  logger.error('The "Choose your password" screen could not check the session.', { cause });
  return (
    <>
      <PageHeader title={sentence('interface.choosePassword')} />
      <Notice tone="danger" message={sentence('interface.passwordNotStored')} />
    </>
  );
}

/**
 * "Choose your password", the only screen that opens while the account uses its initial
 * password (TRV-57, IHM-06, CA-TRV-30, CA-IHM-19): for a device whose session is open on
 * the initial password, the form, with the minimum length and the logout of every other
 * device that the choice brings (TRV-60, CL-TRV-15); any other device goes to the login
 * page, which sends it where it belongs.
 */
export async function ChoosePasswordScreen({
  query,
}: Readonly<{ query: Promise<ChoosePasswordQuery> }>): Promise<ReactNode> {
  const { next } = await query;
  const session = await currentSession();
  if (!session.ok) {
    return unavailable(session.error.kind);
  }
  const state = session.value;
  if (state.state !== 'open' || state.session.passwordStatus !== 'initial') {
    redirect(logInAddress(next));
  }
  const database = await getDb();
  if (!database.ok) {
    return unavailable(database.error.kind);
  }
  const k = formatCount(await getParam(database.db, 'auth.passwordMinLength'));
  return (
    <>
      <PageHeader
        title={sentence('interface.choosePassword')}
        description={sentence('interface.choosePasswordPurpose', { k })}
      />
      <ChoosePasswordForm action={choosePasswordAction.bind(null, next)} />
    </>
  );
}
