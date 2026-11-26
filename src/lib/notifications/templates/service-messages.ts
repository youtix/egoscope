// The messages outside every category (TEL-16, CL-TEL-02, CL-TEL-07, CL-TEL-19): the link
// confirmation, the test message, the daily cap and the notice of an unlinked chat.

import { formatZoneName } from '@/lib/time';
import { formatCount, sentence } from '@/lib/wording';

import { clock, firstLine, link, message, plain } from './text';

import type { ServiceMessageData } from './data';

/**
 * A service message: the link confirmed, a test that reaches the chat, the daily cap reached
 * with the hour it ends, or the chat no longer linked (TEL-16, CL-TEL-02, CL-TEL-07, CL-TEL-19).
 */
export function serviceMessage(data: ServiceMessageData, zone: string): string {
  switch (data.kind) {
    case 'link_confirmation': {
      return message([
        firstLine(sentence('notifications.linkedTitle')),
        plain(sentence('notifications.linkedChat')),
        plain(sentence('notifications.linkedExplanation')),
        link(data.settingsUrl, sentence('notifications.openSettings')),
      ]);
    }
    case 'test_message': {
      const sent = sentence('notifications.testSent', { at: clock(data.sentAt, zone) });
      return message([
        firstLine(sentence('notifications.testTitle')),
        plain(sent),
        link(data.settingsUrl, sentence('notifications.openSettings')),
      ]);
    }
    case 'daily_cap_reached': {
      const reached = sentence('notifications.capReached', {
        n: formatCount(data.sentCount),
        zone: formatZoneName(zone),
      });
      return message([
        firstLine(sentence('notifications.capTitle')),
        plain(reached),
        link(data.homeUrl, sentence('interface.goToHome')),
      ]);
    }
    case 'chat_unlinked_notice': {
      return message([
        firstLine(sentence('notifications.unlinkedTitle')),
        plain(sentence('notifications.noLongerLinked')),
      ]);
    }
  }
}
