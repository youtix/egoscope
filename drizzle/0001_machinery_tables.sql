CREATE TABLE "accounts" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"password_hash" text NOT NULL,
	"password_status" text NOT NULL,
	"initial_password_fingerprint" text NOT NULL,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"login_locked_until" timestamp with time zone,
	"all_sessions_ended_at" timestamp with time zone,
	"all_sessions_end_reason" text,
	CONSTRAINT "accounts_id_check" CHECK ("accounts"."id" = 1),
	CONSTRAINT "accounts_password_status_check" CHECK ("accounts"."password_status" IN ('initial', 'chosen')),
	CONSTRAINT "accounts_all_sessions_end_reason_check" CHECK ("accounts"."all_sessions_end_reason" IN ('logged_out', 'password_changed', 'reset', 'restored')),
	CONSTRAINT "accounts_all_sessions_ended_check" CHECK (("accounts"."all_sessions_ended_at" IS NULL) = ("accounts"."all_sessions_end_reason" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "backups" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "backups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"object_name" text,
	"size_bytes" bigint,
	"failure_cause" text,
	"deleted_at" timestamp with time zone,
	"deletion_failed_at" timestamp with time zone,
	CONSTRAINT "backups_kind_check" CHECK ("backups"."kind" IN ('weekly', 'manual', 'before_update')),
	CONSTRAINT "backups_status_check" CHECK ("backups"."status" IN ('done', 'failed')),
	CONSTRAINT "backups_failure_cause_check" CHECK ("backups"."failure_cause" IN ('missing_key', 'missing_token', 'storage_unreachable', 'storage_not_private', 'upload_failed', 'verification_failed')),
	CONSTRAINT "backups_done_check" CHECK (("backups"."status" = 'done') = ("backups"."object_name" IS NOT NULL)),
	CONSTRAINT "backups_failed_check" CHECK (("backups"."status" = 'failed') = ("backups"."failure_cause" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "database_activity_minutes" (
	"minute_at" timestamp with time zone NOT NULL,
	"instance_id" text NOT NULL,
	CONSTRAINT "database_activity_minutes_minute_at_instance_id_pk" PRIMARY KEY("minute_at","instance_id")
);
--> statement-breakpoint
CREATE TABLE "database_size_samples" (
	"sampled_on" date PRIMARY KEY NOT NULL,
	"size_bytes" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "drafts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"backtest_request_id" integer,
	"exploration_event_type_id" text,
	"text" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"origin_device" text NOT NULL,
	CONSTRAINT "drafts_kind_check" CHECK ("drafts"."kind" IN ('research_result', 'exploration_response')),
	CONSTRAINT "drafts_import_check" CHECK (("drafts"."kind" = 'research_result') = ("drafts"."backtest_request_id" IS NOT NULL)),
	CONSTRAINT "drafts_exploration_check" CHECK ("drafts"."exploration_event_type_id" IS NULL OR "drafts"."kind" = 'exploration_response')
);
--> statement-breakpoint
CREATE TABLE "export_downloads" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "export_downloads_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"downloaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "export_downloads_kind_check" CHECK ("export_downloads"."kind" IN ('full', 'players', 'events', 'cases', 'profiles'))
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "incidents_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"cause_key" text DEFAULT '' NOT NULL,
	"service_role" text,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	"quota_causes" text[] DEFAULT '{}' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "incidents_kind_check" CHECK ("incidents"."kind" IN ('press_source_down', 'collection_impossible', 'press_source_silent', 'feed_too_short', 'quota_reached', 'quota_warning', 'database_volume_warning', 'stats_source_unavailable', 'stats_source_schema_changed', 'task_not_run', 'backup_failed', 'logins_refused', 'telegram_link_broken', 'export_reminder')),
	CONSTRAINT "incidents_service_role_check" CHECK ("incidents"."service_role" IN ('hosting', 'database', 'stats_source', 'language_model', 'news_feeds', 'notifications', 'trigger_service', 'backup_storage')),
	CONSTRAINT "incidents_status_check" CHECK ("incidents"."status" IN ('open', 'closed')),
	CONSTRAINT "incidents_quota_causes_check" CHECK ("incidents"."quota_causes" <@ ARRAY['limit_reached', 'refused_before_limit', 'not_answering']),
	CONSTRAINT "incidents_closed_check" CHECK (("incidents"."status" = 'closed') = ("incidents"."closed_at" IS NOT NULL)),
	CONSTRAINT "incidents_quota_reached_check" CHECK (("incidents"."kind" = 'quota_reached') = ("incidents"."quota_causes" <> '{}'))
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "journal_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"category" text NOT NULL,
	"level" text NOT NULL,
	"message_key" text NOT NULL,
	"message_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"player_id" uuid,
	"player_event_id" integer,
	"event_type_id" text,
	"backtest_request_id" integer,
	"import_id" integer,
	"case_id" integer,
	"incident_id" integer,
	"task_run_id" integer,
	"lot2_object_kind" text,
	"lot2_object_id" integer,
	CONSTRAINT "journal_entries_category_check" CHECK ("journal_entries"."category" IN ('task_pass', 'profile_recalculation', 'service_failure', 'incident', 'user_action', 'import_refused', 'parameter_change', 'login_refused', 'login_lockout', 'telegram_message', 'trigger_refused')),
	CONSTRAINT "journal_entries_level_check" CHECK ("journal_entries"."level" IN ('info', 'warning', 'incident')),
	CONSTRAINT "journal_entries_lot2_object_kind_check" CHECK ("journal_entries"."lot2_object_kind" IN ('press_source', 'article', 'alert_sheet', 'notification_message')),
	CONSTRAINT "journal_entries_lot2_object_check" CHECK (("journal_entries"."lot2_object_kind" IS NULL) = ("journal_entries"."lot2_object_id" IS NULL)),
	CONSTRAINT "journal_entries_event_reference_check" CHECK ("journal_entries"."player_event_id" IS NULL OR ("journal_entries"."player_id", "journal_entries"."event_type_id", "journal_entries"."case_id", "journal_entries"."backtest_request_id", "journal_entries"."import_id") IS NULL),
	CONSTRAINT "journal_entries_case_reference_check" CHECK ("journal_entries"."case_id" IS NULL OR ("journal_entries"."player_id", "journal_entries"."event_type_id") IS NULL)
);
--> statement-breakpoint
CREATE TABLE "journal_technical_details" (
	"journal_entry_id" integer PRIMARY KEY NOT NULL,
	"details" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_failures" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "login_failures_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_facts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "outbox_facts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"backtest_request_id" integer,
	"deadline_game_id" integer,
	"player_event_id" integer,
	"event_type_id" text,
	"incident_id" integer,
	"lot2_subject_id" integer,
	"pass_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "outbox_facts_fact_key" UNIQUE NULLS NOT DISTINCT("kind","backtest_request_id","deadline_game_id","player_event_id","event_type_id","incident_id","lot2_subject_id"),
	CONSTRAINT "outbox_facts_kind_check" CHECK ("outbox_facts"."kind" IN ('backtest_request_to_do', 'backtest_request_deadline_changed', 'alert_sheet_produced', 'alert_sheet_updated', 'tracked_result_ready', 'type_proposal_new', 'incident_opened', 'incident_closed')),
	CONSTRAINT "outbox_facts_subject_check" CHECK (("outbox_facts"."backtest_request_id" IS NOT NULL) = ("outbox_facts"."kind" IN ('backtest_request_to_do', 'backtest_request_deadline_changed')) AND ("outbox_facts"."deadline_game_id" IS NOT NULL) = ("outbox_facts"."kind" IN ('backtest_request_deadline_changed')) AND ("outbox_facts"."player_event_id" IS NOT NULL) = ("outbox_facts"."kind" IN ('backtest_request_deadline_changed')) AND ("outbox_facts"."event_type_id" IS NOT NULL) = ("outbox_facts"."kind" IN ('type_proposal_new')) AND ("outbox_facts"."incident_id" IS NOT NULL) = ("outbox_facts"."kind" IN ('incident_opened', 'incident_closed')) AND ("outbox_facts"."lot2_subject_id" IS NOT NULL) = ("outbox_facts"."kind" IN ('alert_sheet_produced', 'alert_sheet_updated', 'tracked_result_ready')))
);
--> statement-breakpoint
CREATE TABLE "parameter_changes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "parameter_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"parameter_key" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"old_value" jsonb NOT NULL,
	"new_value" jsonb NOT NULL,
	"affects_calculations" boolean NOT NULL,
	"journal_entry_id" integer
);
--> statement-breakpoint
CREATE TABLE "parameter_overrides" (
	"parameter_key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "parameter_overrides_parameter_key_check" CHECK ("parameter_overrides"."parameter_key" IN ('players.maxActive', 'players.indicativeMin', 'players.prolongedAbsenceGames', 'players.exposureWindowDays', 'collection.times', 'collection.readAttempts', 'collection.maxArticleAgeDays', 'collection.titleDedupWindowHours', 'collection.excerptMaxLength', 'collection.notRelevantRetentionDays', 'collection.dedupTraceRetentionDays', 'collection.failedRunsBeforeDown', 'collection.silencePeriodDays', 'collection.indicatorWindowDays', 'detection.threshold', 'detection.confidenceBandWidth', 'detection.classificationAttempts', 'detection.groupingWindowHours', 'detection.priorityHorizonHours', 'detection.queueResumeIntervalHours', 'languageModel.primaryModel', 'languageModel.fallbackModel', 'backtests.maxSourcesPerEvent', 'imports.maxPastedTextMegabytes', 'imports.duplicateMaxDateGapDays', 'imports.maxSourceLeadDays', 'imports.spotCheckSources', 'imports.linkCheckEnabled', 'imports.linkCheckTimeoutSeconds', 'imports.disallowedSourceDomains', 'games.minutesFloor', 'games.minutesAverageShare', 'games.minBaselineGames', 'games.postseasonBaseline', 'games.partialBaselineShare', 'games.dailyUpdateDelayHours', 'games.correctionWindowDays', 'games.boxScoreUnavailableAfterDays', 'games.retryFirstDelayHours', 'games.retryIntervalHours', 'games.incidentAfterHours', 'games.quotaReserveShare', 'sensitivity.maxAttachmentDays', 'sensitivity.coOccurringCasesDoubtful', 'sensitivity.injuryReturnMinGamesMissed', 'sensitivity.injuryReturnFirstGames', 'sensitivity.allPlayoffGamesUnusualStakes', 'sensitivity.opponentWinShareLow', 'sensitivity.opponentWinShareHigh', 'sensitivity.opponentMinGames', 'sensitivity.minValidCases', 'sensitivity.possibleSignalToNoise', 'sensitivity.possibleMeanGap', 'sensitivity.probableSignalToNoise', 'sensitivity.probableMeanGap', 'sensitivity.confidenceMediumFromCases', 'sensitivity.confidenceHighFromCases', 'sensitivity.confidenceDispersionDrop', 'sensitivity.confidenceDoubtfulShareDrop', 'sensitivity.trendMinPlayers', 'sensitivity.trendMaxTopShare', 'sensitivity.countsBelowCases', 'alerts.confidenceVigilanceMargin', 'tracking.categoryThreshold', 'tracking.minTrackedCasesForAssessment', 'notifications.enabled', 'notifications.quietHours', 'notifications.urgentException', 'notifications.category.backtestRequests', 'notifications.category.alerts', 'notifications.category.trackedResults', 'notifications.category.typeProposals', 'notifications.category.incidents', 'notifications.inconclusiveAlerts', 'notifications.incidentEnd', 'notifications.reminderEnabled', 'notifications.reminderLeadHours', 'notifications.alertGroupingThreshold', 'notifications.maxDetailedFacts', 'notifications.dailyCap', 'notifications.retryIntervalsMinutes', 'notifications.catchUpIntervalMinutes', 'notifications.incidentReminderDays', 'notifications.incidentRecurrenceGraceHours', 'notifications.linkCodeValidityMinutes', 'display.timeZone', 'display.listPageSize', 'display.deadlineSoonHours', 'display.draftRetentionDays', 'display.researchToolUrl', 'events.maxDescriptionLength', 'quotas.statsSource.requestsPerDay', 'quotas.statsSource.megabytesPerDay', 'quotas.workersAi.neuronsPerDay', 'quotas.workersAi.requestsPerMinute', 'quotas.groq.requestsPerMinute', 'quotas.groq.requestsPerDay', 'quotas.groq.tokensPerMinute', 'quotas.groq.tokensPerDay', 'quotas.database.capacityMegabytes', 'quotas.database.computeHoursPerMonth', 'quotas.database.transferMegabytesPerMonth', 'quotas.hosting.invocationsPerMonth', 'quotas.hosting.activeCpuHoursPerMonth', 'quotas.hosting.memoryGbHoursPerMonth', 'quotas.hosting.runtimeCacheReadsPerMonth', 'quotas.hosting.runtimeCacheWritesPerMonth', 'quotas.hosting.schedulesRunsPerMonth', 'quotas.telegram.messagesPerSecond', 'quotas.backupStorage.maxFileMegabytes', 'quotas.backupStorage.requestsPerHour', 'quotas.warningShare', 'quotas.databaseWarningShare', 'scheduler.statsUpdateTime', 'scheduler.statsUpdateCutoff', 'scheduler.statsProbeIntervalMinutes', 'scheduler.statsLateDaysBeforeIncident', 'scheduler.purgeTime', 'scheduler.missedRunMarginHours', 'scheduler.expectedTickIntervalMinutes', 'journal.retentionDays', 'backups.weekday', 'backups.time', 'backups.kept', 'backups.exportReminderDays', 'auth.passwordMinLength', 'auth.loginFailureThreshold', 'auth.loginFailureWindowMinutes', 'auth.lockoutMinutes', 'auth.sessionIdleDays'))
);
--> statement-breakpoint
CREATE TABLE "parameter_snapshots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "parameter_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"values" jsonb NOT NULL,
	"values_hash" text NOT NULL,
	CONSTRAINT "parameter_snapshots_values_hash_unique" UNIQUE("values_hash")
);
--> statement-breakpoint
CREATE TABLE "quota_usage" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "quota_usage_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"limit_key" text NOT NULL,
	"period_start_at" timestamp with time zone NOT NULL,
	"used" bigint DEFAULT 0 NOT NULL,
	"warning_given_at" timestamp with time zone,
	"reached_at" timestamp with time zone,
	"resets_at" timestamp with time zone,
	CONSTRAINT "quota_usage_key" UNIQUE("limit_key","period_start_at")
);
--> statement-breakpoint
CREATE TABLE "restore_report_events" (
	"restore_report_id" integer NOT NULL,
	"player_event_id" integer NOT NULL,
	CONSTRAINT "restore_report_events_restore_report_id_player_event_id_pk" PRIMARY KEY("restore_report_id","player_event_id")
);
--> statement-breakpoint
CREATE TABLE "restore_reports" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "restore_reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"restored_at" timestamp with time zone DEFAULT now() NOT NULL,
	"backup_created_at" timestamp with time zone NOT NULL,
	"source_kind" text NOT NULL,
	"table_counts" jsonb NOT NULL,
	"players_deleted_again" integer NOT NULL,
	"events_withdrawn_again" integer NOT NULL,
	"ledger_carried_over" boolean NOT NULL,
	"older_than_horizon" boolean NOT NULL,
	"consistency_check_passed" boolean NOT NULL,
	CONSTRAINT "restore_reports_source_kind_check" CHECK ("restore_reports"."source_kind" IN ('backup', 'full_export'))
);
--> statement-breakpoint
CREATE TABLE "scheduler_lease" (
	"id" smallint PRIMARY KEY NOT NULL,
	"pass_id" uuid,
	"expires_at" timestamp with time zone,
	CONSTRAINT "scheduler_lease_id_check" CHECK ("scheduler_lease"."id" = 1),
	CONSTRAINT "scheduler_lease_holder_check" CHECK (("scheduler_lease"."pass_id" IS NULL) = ("scheduler_lease"."expires_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"token_hash" "bytea" NOT NULL,
	"device" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "sessions_end_reason_check" CHECK ("sessions"."end_reason" IN ('expired', 'logged_out', 'password_changed', 'reset', 'restored')),
	CONSTRAINT "sessions_ended_check" CHECK (("sessions"."ended_at" IS NULL) = ("sessions"."end_reason" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "task_runs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "task_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"task_key" text NOT NULL,
	"trigger" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"progress_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"result" text,
	"parent_run_id" integer,
	"pass_id" uuid,
	"competition_day_on" date,
	"probe_count" smallint,
	"last_refresh_seen_at" timestamp with time zone,
	"cursor" text,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "task_runs_task_key_check" CHECK ("task_runs"."task_key" IN ('statistics-update', 'statistics-fetch', 'calendar-derivation', 'recalculation', 'link-check', 'purge', 'backup', 'news-collection', 'detection', 'classification-resume', 'game-tracking', 'notification-dispatch')),
	CONSTRAINT "task_runs_trigger_check" CHECK ("task_runs"."trigger" IN ('scheduled', 'on_demand')),
	CONSTRAINT "task_runs_result_check" CHECK ("task_runs"."result" IN ('succeeded', 'failed', 'interrupted', 'source_late')),
	CONSTRAINT "task_runs_finished_check" CHECK (("task_runs"."finished_at" IS NULL) = ("task_runs"."result" IS NULL)),
	CONSTRAINT "task_runs_waiting_check" CHECK ("task_runs"."started_at" IS NOT NULL OR ("task_runs"."trigger" = 'on_demand' AND "task_runs"."result" IS NULL)),
	CONSTRAINT "task_runs_pass_check" CHECK ("task_runs"."started_at" IS NULL OR "task_runs"."pass_id" IS NOT NULL),
	CONSTRAINT "task_runs_statistics_update_check" CHECK ("task_runs"."task_key" = 'statistics-update' OR ("task_runs"."competition_day_on", "task_runs"."probe_count", "task_runs"."last_refresh_seen_at") IS NULL),
	CONSTRAINT "task_runs_source_late_check" CHECK ("task_runs"."result" <> 'source_late' OR "task_runs"."task_key" = 'statistics-update')
);
--> statement-breakpoint
CREATE TABLE "ui_state" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"onboarding_guide_hidden" boolean DEFAULT false NOT NULL,
	"first_profile_viewed_at" timestamp with time zone,
	"in_progress_banner_hidden_at" timestamp with time zone,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ui_state_id_check" CHECK ("ui_state"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_task_run_id_task_runs_id_fk" FOREIGN KEY ("task_run_id") REFERENCES "public"."task_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_technical_details" ADD CONSTRAINT "journal_technical_details_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_facts" ADD CONSTRAINT "outbox_facts_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parameter_changes" ADD CONSTRAINT "parameter_changes_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restore_report_events" ADD CONSTRAINT "restore_report_events_restore_report_id_restore_reports_id_fk" FOREIGN KEY ("restore_report_id") REFERENCES "public"."restore_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_parent_run_id_task_runs_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."task_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backups_stored_idx" ON "backups" USING btree ("started_at") WHERE "backups"."status" = 'done' AND "backups"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "drafts_import_key" ON "drafts" USING btree ("backtest_request_id") WHERE "drafts"."kind" = 'research_result';--> statement-breakpoint
CREATE UNIQUE INDEX "drafts_exploration_key" ON "drafts" USING btree (coalesce("exploration_event_type_id", '')) WHERE "drafts"."kind" = 'exploration_response';--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_open_cause_key" ON "incidents" USING btree ("kind","cause_key") WHERE "incidents"."status" = 'open';--> statement-breakpoint
CREATE INDEX "incidents_status_idx" ON "incidents" USING btree ("status","opened_at");--> statement-breakpoint
CREATE INDEX "journal_entries_occurred_idx" ON "journal_entries" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "journal_entries_category_idx" ON "journal_entries" USING btree ("category","occurred_at");--> statement-breakpoint
CREATE INDEX "journal_entries_incident_idx" ON "journal_entries" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "journal_entries_event_idx" ON "journal_entries" USING btree ("player_event_id");--> statement-breakpoint
CREATE INDEX "journal_entries_player_idx" ON "journal_entries" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "login_failures_occurred_idx" ON "login_failures" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "outbox_facts_pending_idx" ON "outbox_facts" USING btree ("pass_id","created_at") WHERE "outbox_facts"."consumed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "parameter_changes_calculation_idx" ON "parameter_changes" USING btree ("changed_at") WHERE "parameter_changes"."affects_calculations";--> statement-breakpoint
CREATE UNIQUE INDEX "task_runs_one_running_key" ON "task_runs" USING btree ("task_key") WHERE "task_runs"."started_at" IS NOT NULL AND "task_runs"."result" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "task_runs_one_requested_key" ON "task_runs" USING btree ("task_key") WHERE "task_runs"."started_at" IS NULL;--> statement-breakpoint
CREATE INDEX "task_runs_task_started_idx" ON "task_runs" USING btree ("task_key","started_at");--> statement-breakpoint
CREATE INDEX "task_runs_task_due_idx" ON "task_runs" USING btree ("task_key","due_at");--> statement-breakpoint
CREATE INDEX "task_runs_day_idx" ON "task_runs" USING btree ("competition_day_on") WHERE "task_runs"."task_key" = 'statistics-update';--> statement-breakpoint
CREATE INDEX "task_runs_pass_idx" ON "task_runs" USING btree ("pass_id");