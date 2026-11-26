// The texts of the message catalogue (TEL-04 to TEL-16, module map §2.5, an internal file of
// the module): each kind's data, as the notifications domain model writes it (section 5), made
// into the HTML that Telegram reads. A message is a first line "Egoscope · category — subject"
// in bold, then one idea per line, then its links (TEL-08); every fixed text comes from
// `@/lib/wording`, every number from its formatters, and every clock time is in the owner's
// zone and names it, a game's US date following when it differs (TEL-04, CL-TEL-03). The
// addresses arrive absolute in the data, built by the composer from `@/lib/navigation`
// (TEL-07); nothing here reads the clock, the environment or the database. Each family of
// messages has its file in `templates/`, its data in `templates/data.ts`.

import { alertMessage, alertUpdate } from './templates/alerts';
import { digest } from './templates/digests';
import { exportReminder, incident, incidentEnd } from './templates/incidents';
import { newTypeProposal } from './templates/proposals';
import { backtestRequest, deadlineChanged, deadlineReminder } from './templates/requests';
import { trackedGameResult } from './templates/results';
import { serviceMessage } from './templates/service-messages';

import type { DigestData, IncidentData, ServiceMessageData, TemplateData } from './templates/data';

type EventMessageData = Exclude<TemplateData, DigestData | IncidentData | ServiceMessageData>;

const isDigest = (data: TemplateData): data is DigestData =>
  data.kind === 'pass_digest' || data.kind === 'quiet_hours_digest' || data.kind === 'catch_up';
const isIncident = (data: TemplateData): data is IncidentData =>
  data.kind === 'incident_start' || data.kind === 'incident_reminder';
const isServiceMessage = (data: TemplateData): data is ServiceMessageData =>
  data.kind === 'link_confirmation' ||
  data.kind === 'test_message' ||
  data.kind === 'daily_cap_reached' ||
  data.kind === 'chat_unlinked_notice';

/** The message of one fact: a request, an alert, a result, a proposal, an incident's end. */
function eventMessage(data: EventMessageData, zone: string): string {
  switch (data.kind) {
    case 'backtest_request_to_do': {
      return backtestRequest(data, zone);
    }
    case 'deadline_changed': {
      return deadlineChanged(data, zone);
    }
    case 'deadline_reminder': {
      return deadlineReminder(data, zone);
    }
    case 'alert': {
      return alertMessage(data, zone);
    }
    case 'alert_update': {
      return alertUpdate(data, zone);
    }
    case 'tracked_game_result': {
      return trackedGameResult(data, zone);
    }
    case 'new_type_proposal': {
      return newTypeProposal(data, zone);
    }
    case 'incident_end': {
      return incidentEnd(data, zone);
    }
    case 'export_reminder': {
      return exportReminder(data, zone);
    }
  }
}

/**
 * The text of a message in Telegram's HTML mode, from its data and the owner's zone, the
 * `display.timeZone` setting (TEL-04 to TEL-16, TEL-21, CL-TEL-02 to CL-TEL-21): the first
 * line "Egoscope · category — subject", one idea per line, its links last, every value
 * escaped; a digest kept within MESSAGE_MAX_LENGTH by whole lines (CL-TEL-14).
 */
export function renderMessage(data: TemplateData, zone: string): string {
  if (isDigest(data)) {
    return digest(data, zone);
  }
  if (isIncident(data)) {
    return incident(data, zone);
  }
  if (isServiceMessage(data)) {
    return serviceMessage(data, zone);
  }
  return eventMessage(data, zone);
}
