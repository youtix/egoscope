import { describe, expect, it } from 'vitest';

import { WEBHOOK_SETTINGS } from './types';

describe('WEBHOOK_SETTINGS', () => {
  it('[TEL-29] registers the webhook for messages and membership changes, over one connection, with the pending updates dropped', () => {
    expect(WEBHOOK_SETTINGS).toStrictEqual({
      allowedUpdates: ['message', 'my_chat_member'],
      maxConnections: 1,
      dropPendingUpdates: true,
    });
  });
});
