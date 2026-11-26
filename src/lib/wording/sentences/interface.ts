/**
 * The fixed sentences of 12 Interface and access in English (glossary section 7), by
 * name, in commented groups, one per screen or task, each naming the requirements it
 * serves.
 */
export const interfaceSentences = {
  // The short notice of the profile and validation screens, which links to Method and
  // limits (IHM-50)
  shortNotice: 'A measure of the past, an unproven hypothesis, no betting recommendation',

  // Home at first launch (IHM-53)
  firstLaunchPresentation:
    'Egoscope measures how followed players played after public events. It does not predict games or give betting advice.',

  // Empty states, each with the action that fills it: no player (IHM-54); no validated
  // type (IHM-55, CA-IHM-13); a player without a backtest, a type without a case of the
  // backtest of {date}, nothing to do, and in Lot 2 no alert and no press source (IHM-56)
  addPlayer: 'Add a player',
  noValidatedType: 'no validated type',
  noBacktestYet: 'no backtest yet',
  requestBacktest: 'Request a backtest',
  noEventOfType: 'no event of this type found by the backtest of {date}',
  nothingToDo: 'Nothing to do right now',
  noAlertYet: 'an alert is produced when a profiled player has a new event',
  noPressSource: 'detection cannot work',

  // The figures of ui/figures: the split of the valid cases by origin, "7 valid cases:
  // 5 historical, 2 tracked", which names only the origins that hold cases (IHM-46,
  // CL-IHM-24); the active filter of a profile list and its total, '3 "probable"
  // profiles of 41' (IHM-49); the link of the short notice (IHM-50, IHM-69)
  bothOrigins: '{k} valid {k|case|cases}: {historical} historical, {tracked} tracked',
  historicalOnly: '{k} valid {k|case|cases}: {k} historical',
  trackedOnly: '{k} valid {k|case|cases}: {k} tracked',
  filterSummary: '{k} "{filter}" {k|profile|profiles} of {total}',
  methodAndLimits: 'Method and limits',

  // The consequence that the to-do list gives each open incident, in plain words (IHM-20,
  // TRV-42)
  incidentConsequencePressSourceDown: 'Articles from this source are no longer collected.',
  incidentConsequenceCollectionImpossible: 'No article is collected until a source answers again.',
  incidentConsequencePressSourceSilent: 'Events that only this source reports may be missed.',
  incidentConsequenceFeedTooShort: 'Articles published between two collection runs may be missed.',
  incidentConsequenceQuotaReached: 'The service stops working until this is resolved.',
  incidentConsequenceQuotaWarning: 'The service may stop working before its quota renews.',
  incidentConsequenceDatabaseVolumeWarning:
    'The database may soon be full and stop accepting new data.',
  incidentConsequenceStatsSourceUnavailable: 'Statistics are no longer updated.',
  incidentConsequenceStatsSourceSchemaChanged:
    'The statistics file that changed is not read, so its figures are not updated.',
  incidentConsequenceTaskNotRun: 'The task did not run, so its work is late.',
  incidentConsequenceBackupFailed: 'Your data has no recent backup.',
  incidentConsequenceLoginsRefused: 'You cannot sign in until logins are allowed again.',
  incidentConsequenceTelegramLinkBroken: 'Telegram messages are not delivered.',
  incidentConsequenceExportReminder: 'Your data has no recent full export.',

  // The navigation shell (IHM-16, CL-IHM-25): the entries of the navigation bar and of the
  // More menu, named after the code values of the glossary's NavigationEntry and
  // MoreMenuEntry sets (the menu's Method and limits is methodAndLimits above), and what
  // screen readers say of the count on the Home entry (IHM-61)
  home: 'Home',
  players: 'Players',
  alerts: 'Alerts',
  types: 'Types',
  more: 'More',
  backtestRequests: 'Backtest requests',
  profiles: 'Profiles',
  settings: 'Settings',
  appStatus: 'App status',
  activityJournal: 'Activity journal',
  help: 'Help',
  detectedEvents: 'Detected events',
  validationTable: 'Validation table',
  collectionAndDetection: 'Collection and detection',
  todoCount: '{n} to do',

  // The titles of the other screens of module map section 3.3, which each screen's task
  // keeps or replaces by the name of the object it shows (IHM-17); the screen of an
  // identifier that matches no object (CL-IHM-19); the error screen, which says what the
  // owner can do (edge case « Erreur du serveur »); what screen readers say while a screen
  // loads (IHM-60)
  playerPage: 'Player page',
  editIdentity: 'Edit identity',
  deletePlayerData: 'Delete player data',
  profileDetail: 'Profile detail',
  caseDetail: 'Case detail',
  eventPage: 'Event page',
  correctEvent: 'Correct an event',
  withdrawEvent: 'Withdraw and erase this event',
  request: 'Request',
  importScreen: 'Import',
  typeSheet: 'Type sheet',
  editTypeSheet: 'Edit the type sheet',
  validation: 'Validation',
  split: 'Split',
  eventsToReview: 'Events to review',
  generalTrend: 'General trend',
  merge: 'Merge',
  exploreNewTypes: 'Explore new types',
  account: 'Account',
  display: 'Display',
  parameters: 'Parameters',
  notifications: 'Notifications',
  alertSheet: 'Alert sheet',
  pressSources: 'Press sources',
  addPressSource: 'Add a press source',
  editPressSource: 'Edit a press source',
  collectionJournal: 'Collection journal',
  runDetail: 'Run detail',
  classificationQueue: 'Classification queue',
  notRelevantArticles: 'Not-relevant articles',
  detectionJournal: 'Detection journal',
  modelInstructions: 'Model instructions',
  article: 'Article',
  itemNoLongerExists: 'This item no longer exists',
  goToHome: 'Go to Home',
  somethingWentWrong: 'Something went wrong',
  screenNotShown:
    'The app could not show this screen. Try again, and if it fails again, try later.',
  tryAgain: 'Try again',
  loadingScreen: 'Loading the screen',

  // The login screen (IHM-06, IHM-07, TRV-61): what screen readers say while it checks
  // the device's session, its title, which its button repeats, its one field, the lockout
  // with its end time (glossary section 3.13), why nothing can be sent meanwhile, and the
  // refusals; how the device's session ended, named after the code values of the
  // glossary's SessionEndReason set (IHM-08, CL-TRV-05); and the description of the
  // device that a session keeps (IHM-06)
  checkingSession: "Checking this device's session",
  logIn: 'Log in',
  password: 'Password',
  showPassword: 'Show the password',
  loginLockedUntil: 'Login locked until {time}',
  loginsRefusedMeanwhile:
    'Logins are refused after repeated wrong passwords, until the time shown above.',
  notLoggedIn: 'You are not logged in',
  typePassword: 'Type your password.',
  wrongPassword: 'This password is wrong: type it again.',
  passwordNotChecked: 'The app cannot check your password right now: try again in a few minutes.',
  endedExpired: 'Session expired',
  endedLoggedOut: 'Logged out',
  endedPasswordChanged: 'Password changed',
  endedReset: 'Password reset',
  endedRestored: 'Data restored',
  deviceDescription: '{browser} on {system}',
  unknownDevice: 'Unknown device',

  // The "Choose your password" screen, the only one open while the initial password is in
  // use (TRV-57, TRV-60, IHM-06, CL-TRV-15): its title, what it does, its field, its
  // button and its refusals
  choosePassword: 'Choose your password',
  choosePasswordPurpose:
    'Replace the initial password with one of at least {k} {k|character|characters}. Every other device is then logged out.',
  newPassword: 'New password',
  savePassword: 'Save the password',
  passwordNotSaved: 'Your password was not saved',
  passwordTooShort: 'This password is too short: use at least {k} {k|character|characters}.',
  passwordNotStored: 'The app cannot save your password right now: try again in a few minutes.',

  // The device pieces of every screen (IHM-03, IHM-57, IHM-58), F-offline: the offline
  // banner over a screen with its copy's date or without a copy, the reason of an action
  // that needs the server, and the banner of a new version with its reload
  offlineCopyFrom: 'Offline — data from {date} at {time}',
  offlineWithoutCopy: 'Offline — this screen is not available offline.',
  unavailableOffline: 'Unavailable offline: connect to the internet to do this.',
  newVersionAvailable: 'New version available',
  reloadApp: 'Reload the app',
  reloadWaitsForDraft: 'The app reloads once your draft is saved.',

  // An area adds its groups above this line, one commented group per screen or task.
} as const;
