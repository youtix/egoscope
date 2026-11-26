CREATE TABLE "alert_sheet_caveats" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "alert_sheet_caveats_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"alert_sheet_id" integer NOT NULL,
	"kind" text NOT NULL,
	"event_type_id" text,
	"player_event_id" integer,
	"known_context_reasons" text[],
	"computed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "alert_sheet_caveats_uq" UNIQUE NULLS NOT DISTINCT("alert_sheet_id","kind","event_type_id","player_event_id"),
	CONSTRAINT "alert_sheet_caveats_kind_check" CHECK ("alert_sheet_caveats"."kind" IN ('small_sample', 'effect_direction', 'known_context', 'several_events', 'confidence_near_threshold', 'dating_to_verify', 'incomplete_or_earlier_version', 'late_sheet', 'type_not_covered', 'confounder_not_separable')),
	CONSTRAINT "alert_sheet_caveats_known_context_reasons_check" CHECK ("alert_sheet_caveats"."known_context_reasons" <@ ARRAY['high_stakes', 'injury_return_flagged', 'opponent_strength']),
	CONSTRAINT "alert_sheet_caveats_known_context_check" CHECK (("alert_sheet_caveats"."kind" = 'known_context') = ("alert_sheet_caveats"."known_context_reasons" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "alert_sheet_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "alert_sheet_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"alert_sheet_section_id" integer NOT NULL,
	"player_event_id" integer NOT NULL,
	"added_at" timestamp with time zone NOT NULL,
	"detection_confidence_at_issue" smallint,
	CONSTRAINT "alert_sheet_events_detection_confidence_at_issue_check" CHECK ("alert_sheet_events"."detection_confidence_at_issue" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "alert_sheet_expected_games" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "alert_sheet_expected_games_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"alert_sheet_id" integer NOT NULL,
	"state" text NOT NULL,
	"game_id" integer,
	"scheduled_start_at" timestamp with time zone,
	"opponent_team_id" integer,
	"is_home" boolean,
	"passed_game_id" integer,
	"unknown_reason" text,
	"recorded_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"supersession_reason" text,
	CONSTRAINT "alert_sheet_expected_games_state_check" CHECK ("alert_sheet_expected_games"."state" IN ('current', 'superseded', 'unknown')),
	CONSTRAINT "alert_sheet_expected_games_game_check" CHECK (("alert_sheet_expected_games"."state" = 'unknown') = ("alert_sheet_expected_games"."game_id" IS NULL)),
	CONSTRAINT "alert_sheet_expected_games_unknown_reason_check" CHECK ("alert_sheet_expected_games"."unknown_reason" IN ('offseason', 'schedule_not_published', 'stats_source_unavailable', 'player_without_team')),
	CONSTRAINT "alert_sheet_expected_games_unknown_check" CHECK (("alert_sheet_expected_games"."state" = 'unknown') = ("alert_sheet_expected_games"."unknown_reason" IS NOT NULL)),
	CONSTRAINT "alert_sheet_expected_games_superseded_check" CHECK (("alert_sheet_expected_games"."state" = 'superseded') = ("alert_sheet_expected_games"."superseded_at" IS NOT NULL)),
	CONSTRAINT "alert_sheet_expected_games_supersession_reason_check" CHECK ("alert_sheet_expected_games"."supersession_reason" IN ('postponed', 'brought_forward', 'canceled', 'player_did_not_play', 'reference_date_moved')),
	CONSTRAINT "alert_sheet_expected_games_supersession_check" CHECK (("alert_sheet_expected_games"."state" = 'superseded') = ("alert_sheet_expected_games"."supersession_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "alert_sheet_outcomes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "alert_sheet_outcomes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"alert_sheet_event_id" integer NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"shown_gap" double precision,
	"shown_gap_status" text,
	"shown_baseline_mean" double precision,
	"shown_baseline_deviation" double precision,
	"shown_baseline_status" text,
	"shown_category" text,
	CONSTRAINT "alert_sheet_outcomes_shown_gap_status_check" CHECK ("alert_sheet_outcomes"."shown_gap_status" IN ('provisional', 'final')),
	CONSTRAINT "alert_sheet_outcomes_shown_gap_check" CHECK (("alert_sheet_outcomes"."shown_gap" IS NULL) = ("alert_sheet_outcomes"."shown_gap_status" IS NULL)),
	CONSTRAINT "alert_sheet_outcomes_shown_baseline_status_check" CHECK ("alert_sheet_outcomes"."shown_baseline_status" IN ('final', 'provisional', 'building', 'insufficient')),
	CONSTRAINT "alert_sheet_outcomes_shown_category_check" CHECK ("alert_sheet_outcomes"."shown_category" IN ('confirmed', 'refuted', 'neutral', 'no_forecast'))
);
--> statement-breakpoint
CREATE TABLE "alert_sheet_sections" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "alert_sheet_sections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"alert_sheet_id" integer NOT NULL,
	"kind" text NOT NULL,
	"event_type_id" text NOT NULL,
	"added_at" timestamp with time zone NOT NULL,
	"profile_state" text NOT NULL,
	"frozen_at" timestamp with time zone,
	"profile_status_notice" text,
	"type_not_covered" boolean DEFAULT false NOT NULL,
	"profile_changed_since_issue_at" timestamp with time zone,
	"vacated_by_event_id" integer,
	CONSTRAINT "alert_sheet_sections_kind_check" CHECK ("alert_sheet_sections"."kind" IN ('initial', 'later_event', 'type_change')),
	CONSTRAINT "alert_sheet_sections_profile_state_check" CHECK ("alert_sheet_sections"."profile_state" IN ('pending', 'frozen')),
	CONSTRAINT "alert_sheet_sections_frozen_check" CHECK (("alert_sheet_sections"."profile_state" = 'frozen') = ("alert_sheet_sections"."frozen_at" IS NOT NULL)),
	CONSTRAINT "alert_sheet_sections_profile_status_notice_check" CHECK ("alert_sheet_sections"."profile_status_notice" IN ('recalculation_in_progress', 'no_measured_case_yet')),
	CONSTRAINT "alert_sheet_sections_notice_check" CHECK ("alert_sheet_sections"."profile_status_notice" IS NULL OR "alert_sheet_sections"."profile_state" = 'frozen')
);
--> statement-breakpoint
CREATE TABLE "alert_sheet_snapshots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "alert_sheet_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"alert_sheet_section_id" integer,
	"alert_sheet_outcome_id" integer,
	"kind" text NOT NULL,
	"mean_gap" double precision,
	"range_low" double precision,
	"range_high" double precision,
	"valid_count" integer NOT NULL,
	"historical_count" integer,
	"tracked_count" integer,
	"excluded_count" integer,
	"player_count" integer,
	"verdict_level" text NOT NULL,
	"verdict_direction" text,
	"profile_confidence" text NOT NULL,
	"fragile" boolean,
	"valid_case_threshold" integer,
	"computed_at" timestamp with time zone NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "alert_sheet_snapshots_owner_check" CHECK (num_nonnulls("alert_sheet_snapshots"."alert_sheet_section_id", "alert_sheet_snapshots"."alert_sheet_outcome_id") = 1),
	CONSTRAINT "alert_sheet_snapshots_kind_check" CHECK ("alert_sheet_snapshots"."kind" IN ('profile', 'trend')),
	CONSTRAINT "alert_sheet_snapshots_outcome_kind_check" CHECK ("alert_sheet_snapshots"."alert_sheet_outcome_id" IS NULL OR "alert_sheet_snapshots"."kind" = 'profile'),
	CONSTRAINT "alert_sheet_snapshots_range_check" CHECK ("alert_sheet_snapshots"."range_high" >= "alert_sheet_snapshots"."range_low"),
	CONSTRAINT "alert_sheet_snapshots_valid_count_check" CHECK ("alert_sheet_snapshots"."valid_count" >= 0),
	CONSTRAINT "alert_sheet_snapshots_verdict_level_check" CHECK ("alert_sheet_snapshots"."verdict_level" IN ('inconclusive', 'possible', 'probable')),
	CONSTRAINT "alert_sheet_snapshots_verdict_direction_check" CHECK ("alert_sheet_snapshots"."verdict_direction" IN ('increase', 'decrease')),
	CONSTRAINT "alert_sheet_snapshots_verdict_check" CHECK (("alert_sheet_snapshots"."verdict_level" = 'inconclusive') = ("alert_sheet_snapshots"."verdict_direction" IS NULL)),
	CONSTRAINT "alert_sheet_snapshots_profile_confidence_check" CHECK ("alert_sheet_snapshots"."profile_confidence" IN ('low', 'medium', 'high'))
);
--> statement-breakpoint
CREATE TABLE "alert_sheet_updates" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "alert_sheet_updates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"alert_sheet_id" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"player_event_id" integer,
	"alert_sheet_section_id" integer,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "alert_sheet_updates_kind_check" CHECK ("alert_sheet_updates"."kind" IN ('event_added', 'source_added', 'event_dismissed', 'event_reinstated', 'expected_game_changed', 'late_mark_changed', 'context_corrected', 'attachment_corrected', 'profile_values_entered', 'profile_changed_since_issue', 'caveats_changed', 'status_changed', 'outcome_recorded', 'outcome_value_changed', 'event_no_longer_applies')),
	CONSTRAINT "alert_sheet_updates_outcome_event_check" CHECK ("alert_sheet_updates"."kind" NOT IN ('outcome_recorded', 'outcome_value_changed') OR "alert_sheet_updates"."player_event_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "alert_sheets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "alert_sheets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" uuid NOT NULL,
	"team_id_at_production" integer,
	"produced_at" timestamp with time zone NOT NULL,
	"profile_values_entered_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"cancellation_reason" text,
	"is_late" boolean DEFAULT false NOT NULL,
	"caveats_frozen_at" timestamp with time zone,
	CONSTRAINT "alert_sheets_profile_values_entered_check" CHECK ("alert_sheets"."profile_values_entered_at" >= "alert_sheets"."produced_at"),
	CONSTRAINT "alert_sheets_status_check" CHECK ("alert_sheets"."status" IN ('open', 'closed', 'canceled')),
	CONSTRAINT "alert_sheets_cancellation_reason_check" CHECK ("alert_sheets"."cancellation_reason" IN ('all_events_dismissed', 'attachment_corrected', 'event_no_longer_applies')),
	CONSTRAINT "alert_sheets_canceled_check" CHECK (("alert_sheets"."status" = 'canceled') = ("alert_sheets"."cancellation_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "article_attachments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "article_attachments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"article_id" integer NOT NULL,
	"player_event_id" integer NOT NULL,
	"classification_fact_id" integer NOT NULL,
	"attached_at" timestamp with time zone NOT NULL,
	"is_reference" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_parts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "article_parts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"article_id" integer NOT NULL,
	"player_id" uuid NOT NULL,
	"recognized_by" text NOT NULL,
	"recognized_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"queue_entry_kind" text,
	"queued_at" timestamp with time zone,
	"cycle_attempts" smallint DEFAULT 0 NOT NULL,
	"classification_failed_at" timestamp with time zone,
	"not_relevant_reason" text,
	CONSTRAINT "article_parts_recognized_by_check" CHECK ("article_parts"."recognized_by" IN ('prefilter', 'owner')),
	CONSTRAINT "article_parts_status_check" CHECK ("article_parts"."status" IN ('pending', 'classified', 'closed')),
	CONSTRAINT "article_parts_queue_entry_kind_check" CHECK ("article_parts"."queue_entry_kind" IN ('first_classification', 'automatic_reclassification', 'owner_request')),
	CONSTRAINT "article_parts_queue_entry_check" CHECK (("article_parts"."status" = 'pending') = ("article_parts"."queue_entry_kind" IS NOT NULL)),
	CONSTRAINT "article_parts_queued_check" CHECK (("article_parts"."status" = 'pending') = ("article_parts"."queued_at" IS NOT NULL)),
	CONSTRAINT "article_parts_cycle_attempts_check" CHECK ("article_parts"."cycle_attempts" BETWEEN 0 AND 5),
	CONSTRAINT "article_parts_failed_check" CHECK ("article_parts"."classification_failed_at" IS NULL OR "article_parts"."status" = 'pending'),
	CONSTRAINT "article_parts_not_relevant_reason_check" CHECK ("article_parts"."not_relevant_reason" IN ('no_fact', 'no_followed_player')),
	CONSTRAINT "article_parts_closed_check" CHECK ("article_parts"."status" <> 'closed' OR "article_parts"."not_relevant_reason" IS NOT DISTINCT FROM 'no_followed_player'),
	CONSTRAINT "article_parts_pending_check" CHECK ("article_parts"."status" <> 'pending' OR "article_parts"."not_relevant_reason" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "article_sightings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "article_sightings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"article_id" integer NOT NULL,
	"press_source_id" integer NOT NULL,
	"feed_item_id" text,
	"first_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "article_sightings_feed_item_id_check" CHECK ("article_sightings"."feed_item_id" <> '')
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "articles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" text NOT NULL,
	"title_key" text NOT NULL,
	"outlet_name" text NOT NULL,
	"link" text NOT NULL,
	"retained_published_at" timestamp with time zone NOT NULL,
	"retained_published_at_precision" text NOT NULL,
	"first_collected_at" timestamp with time zone NOT NULL,
	"language" text NOT NULL,
	"excerpt" text,
	"processing_status" text DEFAULT 'to_analyze' NOT NULL,
	"not_relevant_reasons" text[] DEFAULT '{}' NOT NULL,
	"retention_clock_started_at" timestamp with time zone,
	"first_press_source_id" integer NOT NULL,
	"first_task_run_id" integer,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "articles_title_check" CHECK ("articles"."title" ~ '[^\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]'),
	CONSTRAINT "articles_retained_published_at_check" CHECK ("articles"."retained_published_at" <= "articles"."first_collected_at"),
	CONSTRAINT "articles_retained_published_at_precision_check" CHECK ("articles"."retained_published_at_precision" IN ('exact', 'approximate', 'none')),
	CONSTRAINT "articles_language_check" CHECK ("articles"."language" IN ('en', 'fr')),
	CONSTRAINT "articles_excerpt_check" CHECK (char_length("articles"."excerpt") BETWEEN 1 AND 1000),
	CONSTRAINT "articles_processing_status_check" CHECK ("articles"."processing_status" IN ('to_analyze', 'awaiting_classification', 'not_relevant', 'attached', 'linked_to_proposal')),
	CONSTRAINT "articles_not_relevant_reasons_check" CHECK ("articles"."not_relevant_reasons" <@ ARRAY['no_followed_player', 'no_fact', 'below_threshold', 'below_coverage_threshold', 'old_fact', 'already_reported_by_backtest', 'type_rejected_or_withdrawn', 'proposal_rejected', 'detached_by_user']),
	CONSTRAINT "articles_not_relevant_check" CHECK ("articles"."processing_status" <> 'not_relevant' OR cardinality("articles"."not_relevant_reasons") > 0),
	CONSTRAINT "articles_retention_clock_check" CHECK (("articles"."processing_status" = 'not_relevant') = ("articles"."retention_clock_started_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "case_category_changes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "case_category_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tracked_case_id" integer NOT NULL,
	"changed_at" timestamp with time zone NOT NULL,
	"category" text,
	"normalized_gap" double precision,
	"gap_status" text,
	CONSTRAINT "case_category_changes_category_check" CHECK ("case_category_changes"."category" IN ('confirmed', 'refuted', 'neutral', 'no_forecast')),
	CONSTRAINT "case_category_changes_gap_status_check" CHECK ("case_category_changes"."gap_status" IN ('provisional', 'final'))
);
--> statement-breakpoint
CREATE TABLE "classification_facts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "classification_facts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"classification_result_id" integer NOT NULL,
	"kind" text NOT NULL,
	"event_type_id" text NOT NULL,
	"detection_confidence" smallint,
	"description" text,
	"novelty" text,
	"designated_event_id" integer,
	"timing_hint_on" date,
	"injury_return" text,
	"game_stakes" text,
	"justification" text,
	"suggested_type_name" text,
	"suggested_type_definition" text,
	"outcome" text NOT NULL,
	"not_relevant_reason" text,
	"matched_historical_event_id" integer,
	"superseded_into_event_id" integer,
	CONSTRAINT "classification_facts_kind_check" CHECK ("classification_facts"."kind" IN ('validated_type', 'known_entry', 'new_type')),
	CONSTRAINT "classification_facts_detection_confidence_check" CHECK ("classification_facts"."detection_confidence" BETWEEN 0 AND 100),
	CONSTRAINT "classification_facts_novelty_check" CHECK ("classification_facts"."novelty" IN ('new_fact', 'old_fact', 'known_event')),
	CONSTRAINT "classification_facts_injury_return_check" CHECK ("classification_facts"."injury_return" IN ('yes', 'no', 'unknown')),
	CONSTRAINT "classification_facts_game_stakes_check" CHECK ("classification_facts"."game_stakes" IN ('high', 'normal', 'unknown')),
	CONSTRAINT "classification_facts_outcome_check" CHECK ("classification_facts"."outcome" IN ('attached', 'linked_to_proposal', 'not_relevant', 'superseded')),
	CONSTRAINT "classification_facts_not_relevant_reason_check" CHECK ("classification_facts"."not_relevant_reason" IN ('below_threshold', 'below_coverage_threshold', 'old_fact', 'already_reported_by_backtest', 'type_rejected_or_withdrawn', 'proposal_rejected', 'detached_by_user')),
	CONSTRAINT "classification_facts_designated_check" CHECK ("classification_facts"."designated_event_id" IS NULL OR "classification_facts"."novelty" IS NOT DISTINCT FROM 'known_event'),
	CONSTRAINT "classification_facts_not_relevant_check" CHECK (("classification_facts"."outcome" = 'not_relevant') = ("classification_facts"."not_relevant_reason" IS NOT NULL)),
	CONSTRAINT "classification_facts_matched_check" CHECK ("classification_facts"."matched_historical_event_id" IS NULL OR "classification_facts"."not_relevant_reason" IS NOT DISTINCT FROM 'already_reported_by_backtest'),
	CONSTRAINT "classification_facts_superseded_check" CHECK ("classification_facts"."superseded_into_event_id" IS NULL OR "classification_facts"."outcome" = 'superseded'),
	CONSTRAINT "classification_facts_validated_type_check" CHECK ("classification_facts"."kind" = 'validated_type' OR num_nonnulls("classification_facts"."detection_confidence", "classification_facts"."description", "classification_facts"."novelty", "classification_facts"."designated_event_id", "classification_facts"."timing_hint_on", "classification_facts"."injury_return", "classification_facts"."game_stakes") = 0),
	CONSTRAINT "classification_facts_new_type_check" CHECK ("classification_facts"."kind" = 'new_type' OR num_nonnulls("classification_facts"."suggested_type_name", "classification_facts"."suggested_type_definition") = 0),
	CONSTRAINT "classification_facts_attached_check" CHECK ("classification_facts"."outcome" <> 'attached' OR "classification_facts"."kind" = 'validated_type'),
	CONSTRAINT "classification_facts_linked_check" CHECK ("classification_facts"."outcome" <> 'linked_to_proposal' OR "classification_facts"."kind" IN ('known_entry', 'new_type'))
);
--> statement-breakpoint
CREATE TABLE "classification_incident_details" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "classification_incident_details_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"incident_id" integer NOT NULL,
	"cause" text NOT NULL,
	CONSTRAINT "classification_incident_details_cause_check" CHECK ("classification_incident_details"."cause" IN ('limit_reached', 'refused_before_limit', 'not_answering'))
);
--> statement-breakpoint
CREATE TABLE "classification_results" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "classification_results_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"article_part_id" integer NOT NULL,
	"origin" text NOT NULL,
	"user_action" text,
	"classified_at" timestamp with time zone NOT NULL,
	"instructions_version" text,
	"model_id" text,
	"attempt_number" smallint,
	"validated_types" jsonb NOT NULL,
	"player_corrected_at" timestamp with time zone,
	CONSTRAINT "classification_results_origin_check" CHECK ("classification_results"."origin" IN ('model', 'user')),
	CONSTRAINT "classification_results_user_action_check" CHECK ("classification_results"."user_action" IN ('manual_classification', 'rescue', 'own_event', 'added_player')),
	CONSTRAINT "classification_results_user_check" CHECK (("classification_results"."origin" = 'user') = ("classification_results"."user_action" IS NOT NULL)),
	CONSTRAINT "classification_results_instructions_check" CHECK (("classification_results"."origin" = 'model') = ("classification_results"."instructions_version" IS NOT NULL)),
	CONSTRAINT "classification_results_model_check" CHECK (("classification_results"."origin" = 'model') = ("classification_results"."model_id" IS NOT NULL)),
	CONSTRAINT "classification_results_attempt_number_check" CHECK ("classification_results"."attempt_number" BETWEEN 1 AND 5),
	CONSTRAINT "classification_results_attempt_check" CHECK (("classification_results"."origin" = 'model') = ("classification_results"."attempt_number" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "collection_gaps" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "collection_gaps_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"press_source_id" integer NOT NULL,
	"gap_start_at" timestamp with time zone NOT NULL,
	"gap_end_at" timestamp with time zone NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"task_run_id" integer,
	CONSTRAINT "collection_gaps_period_check" CHECK ("collection_gaps"."gap_end_at" > "collection_gaps"."gap_start_at")
);
--> statement-breakpoint
CREATE TABLE "collection_source_reads" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "collection_source_reads_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"task_run_id" integer NOT NULL,
	"press_source_id" integer NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	"feed_url_read" text NOT NULL,
	"outcome" text NOT NULL,
	"failure_reason" text,
	"read_attempts" smallint NOT NULL,
	"items_read" integer DEFAULT 0 NOT NULL,
	"new_articles" integer DEFAULT 0 NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"too_old" integer DEFAULT 0 NOT NULL,
	"incomplete" integer DEFAULT 0 NOT NULL,
	"unsupported_language" integer DEFAULT 0 NOT NULL,
	"date_anomalies" integer DEFAULT 0 NOT NULL,
	"catch_up_reference_at" timestamp with time zone,
	"permanent_redirect_url" text,
	"uncollected_period_start_at" timestamp with time zone,
	"uncollected_period_end_at" timestamp with time zone,
	"interruption_started_at" timestamp with time zone,
	CONSTRAINT "collection_source_reads_outcome_check" CHECK ("collection_source_reads"."outcome" IN ('success', 'failure')),
	CONSTRAINT "collection_source_reads_failure_reason_check" CHECK ("collection_source_reads"."failure_reason" IN ('unreachable', 'error_response', 'requires_identification', 'unreadable', 'not_a_feed')),
	CONSTRAINT "collection_source_reads_failure_check" CHECK (("collection_source_reads"."outcome" = 'failure') = ("collection_source_reads"."failure_reason" IS NOT NULL)),
	CONSTRAINT "collection_source_reads_read_attempts_check" CHECK ("collection_source_reads"."read_attempts" BETWEEN 1 AND 5),
	CONSTRAINT "collection_source_reads_counters_check" CHECK ("collection_source_reads"."items_read" >= 0 AND "collection_source_reads"."new_articles" >= 0 AND "collection_source_reads"."duplicates" >= 0 AND "collection_source_reads"."too_old" >= 0 AND "collection_source_reads"."incomplete" >= 0 AND "collection_source_reads"."unsupported_language" >= 0 AND "collection_source_reads"."date_anomalies" >= 0),
	CONSTRAINT "collection_source_reads_uncollected_period_check" CHECK (("collection_source_reads"."uncollected_period_start_at" IS NULL) = ("collection_source_reads"."uncollected_period_end_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "dedup_traces" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dedup_traces_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"link_sha256" "bytea" NOT NULL,
	"first_collected_at" timestamp with time zone NOT NULL,
	"article_deleted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dedup_traces_link_sha256_check" CHECK (octet_length("dedup_traces"."link_sha256") = 32)
);
--> statement-breakpoint
CREATE TABLE "detection_runs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "detection_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"task_run_id" integer NOT NULL,
	"articles_received" integer DEFAULT 0 NOT NULL,
	"articles_not_prefiltered_in" integer DEFAULT 0 NOT NULL,
	"articles_classified" integer DEFAULT 0 NOT NULL,
	"articles_classified_without_fact" integer DEFAULT 0 NOT NULL,
	"articles_failed" integer DEFAULT 0 NOT NULL,
	"articles_still_queued" integer DEFAULT 0 NOT NULL,
	"facts_attached_to_existing_event" integer DEFAULT 0 NOT NULL,
	"facts_below_threshold" integer DEFAULT 0 NOT NULL,
	"facts_below_coverage_threshold" integer DEFAULT 0 NOT NULL,
	"facts_old" integer DEFAULT 0 NOT NULL,
	"facts_already_reported_by_backtest" integer DEFAULT 0 NOT NULL,
	"proposals_submitted" integer DEFAULT 0 NOT NULL,
	"occurrences_added" integer DEFAULT 0 NOT NULL,
	"descriptions_replaced" integer DEFAULT 0 NOT NULL,
	"events_created" integer DEFAULT 0 NOT NULL,
	"quota_calls_used" integer DEFAULT 0 NOT NULL,
	"quota_calls_left" integer,
	CONSTRAINT "detection_runs_counters_check" CHECK ("detection_runs"."articles_received" >= 0 AND "detection_runs"."articles_not_prefiltered_in" >= 0 AND "detection_runs"."articles_classified" >= 0 AND "detection_runs"."articles_classified_without_fact" >= 0 AND "detection_runs"."articles_failed" >= 0 AND "detection_runs"."articles_still_queued" >= 0 AND "detection_runs"."facts_attached_to_existing_event" >= 0 AND "detection_runs"."facts_below_threshold" >= 0 AND "detection_runs"."facts_below_coverage_threshold" >= 0 AND "detection_runs"."facts_old" >= 0 AND "detection_runs"."facts_already_reported_by_backtest" >= 0 AND "detection_runs"."proposals_submitted" >= 0 AND "detection_runs"."occurrences_added" >= 0 AND "detection_runs"."descriptions_replaced" >= 0 AND "detection_runs"."events_created" >= 0 AND "detection_runs"."quota_calls_used" >= 0 AND "detection_runs"."quota_calls_left" >= 0)
);
--> statement-breakpoint
CREATE TABLE "exposure_counts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "exposure_counts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" uuid NOT NULL,
	"counted_on" date NOT NULL,
	"article_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "exposure_counts_article_count_check" CHECK ("exposure_counts"."article_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "forecast_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "forecast_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tracked_case_id" integer NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"level" text,
	"direction" text,
	"announced_mean_gap" double precision,
	"case_count" integer,
	"profile_confidence" text,
	CONSTRAINT "forecast_versions_source_check" CHECK ("forecast_versions"."source" IN ('player_profile', 'general_trend', 'none')),
	CONSTRAINT "forecast_versions_level_check" CHECK ("forecast_versions"."level" IN ('possible', 'probable')),
	CONSTRAINT "forecast_versions_direction_check" CHECK ("forecast_versions"."direction" IN ('increase', 'decrease')),
	CONSTRAINT "forecast_versions_profile_confidence_check" CHECK ("forecast_versions"."profile_confidence" IN ('low', 'medium', 'high')),
	CONSTRAINT "forecast_versions_forecast_check" CHECK (CASE WHEN "forecast_versions"."source" IN ('player_profile', 'general_trend') THEN num_nulls("forecast_versions"."level", "forecast_versions"."direction", "forecast_versions"."announced_mean_gap", "forecast_versions"."case_count", "forecast_versions"."profile_confidence") = 0 ELSE num_nonnulls("forecast_versions"."level", "forecast_versions"."direction", "forecast_versions"."announced_mean_gap", "forecast_versions"."case_count", "forecast_versions"."profile_confidence") = 0 END)
);
--> statement-breakpoint
CREATE TABLE "notification_daily_counts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notification_daily_counts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cap_day" date NOT NULL,
	"sent_count" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "notification_daily_counts_sent_count_check" CHECK ("notification_daily_counts"."sent_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notification_message_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notification_message_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"message_id" integer NOT NULL,
	"player_event_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_message_facts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notification_message_facts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"message_id" integer NOT NULL,
	"message_kind" text NOT NULL,
	"backtest_request_id" integer,
	"deadline_game_id" integer,
	"alert_sheet_id" integer,
	"alert_sheet_update_id" integer,
	"case_id" integer,
	"event_type_id" text,
	"incident_id" integer,
	"reminder_number" smallint,
	CONSTRAINT "notification_message_facts_message_kind_check" CHECK ("notification_message_facts"."message_kind" IN ('backtest_request_to_do', 'deadline_changed', 'deadline_reminder', 'alert', 'alert_update', 'tracked_game_result', 'new_type_proposal', 'incident_start', 'incident_reminder', 'incident_end', 'export_reminder', 'link_confirmation', 'test_message', 'pass_digest', 'quiet_hours_digest', 'catch_up', 'daily_cap_reached', 'chat_unlinked_notice')),
	CONSTRAINT "notification_message_facts_reminder_check" CHECK (("notification_message_facts"."message_kind" = 'incident_reminder') = ("notification_message_facts"."reminder_number" IS NOT NULL)),
	CONSTRAINT "notification_message_facts_subject_check" CHECK (num_nonnulls("notification_message_facts"."backtest_request_id", "notification_message_facts"."alert_sheet_id", "notification_message_facts"."alert_sheet_update_id", "notification_message_facts"."case_id", "notification_message_facts"."event_type_id", "notification_message_facts"."incident_id") = 1),
	CONSTRAINT "notification_message_facts_deadline_check" CHECK ("notification_message_facts"."deadline_game_id" IS NULL OR "notification_message_facts"."backtest_request_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "notification_messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notification_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"status" text DEFAULT 'to_send' NOT NULL,
	"is_urgent" boolean DEFAULT false NOT NULL,
	"pass_id" uuid,
	"player_id" uuid,
	"game_id" integer,
	"created_at" timestamp with time zone NOT NULL,
	"scheduled_send_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"text" text,
	"chat_id" bigint,
	"telegram_message_id" bigint,
	"attempt_count" smallint DEFAULT 0 NOT NULL,
	"first_failure_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_failure_kind" text,
	"last_failure_reason" text,
	"discard_reason" text,
	"grouped_into_message_id" integer,
	"cap_day" date,
	CONSTRAINT "notification_messages_kind_check" CHECK ("notification_messages"."kind" IN ('backtest_request_to_do', 'deadline_changed', 'deadline_reminder', 'alert', 'alert_update', 'tracked_game_result', 'new_type_proposal', 'incident_start', 'incident_reminder', 'incident_end', 'export_reminder', 'link_confirmation', 'test_message', 'pass_digest', 'quiet_hours_digest', 'catch_up', 'daily_cap_reached', 'chat_unlinked_notice')),
	CONSTRAINT "notification_messages_status_check" CHECK ("notification_messages"."status" IN ('to_send', 'deferred', 'sent', 'grouped', 'discarded', 'failed')),
	CONSTRAINT "notification_messages_urgent_check" CHECK (NOT "notification_messages"."is_urgent" OR "notification_messages"."kind" IN ('backtest_request_to_do', 'deadline_changed', 'deadline_reminder', 'alert', 'alert_update')),
	CONSTRAINT "notification_messages_text_check" CHECK (char_length("notification_messages"."text") <= 4096),
	CONSTRAINT "notification_messages_last_failure_kind_check" CHECK ("notification_messages"."last_failure_kind" IN ('temporary', 'permanent')),
	CONSTRAINT "notification_messages_last_failure_reason_check" CHECK (char_length("notification_messages"."last_failure_reason") <= 300),
	CONSTRAINT "notification_messages_discard_reason_check" CHECK ("notification_messages"."discard_reason" IN ('moot', 'category_disabled', 'notifications_suspended', 'unlinked', 'daily_cap')),
	CONSTRAINT "notification_messages_attempt_count_check" CHECK ("notification_messages"."attempt_count" >= 0),
	CONSTRAINT "notification_messages_cap_day_check" CHECK (("notification_messages"."kind" = 'daily_cap_reached') = ("notification_messages"."cap_day" IS NOT NULL)),
	CONSTRAINT "notification_messages_sent_check" CHECK (("notification_messages"."status" = 'sent') = ("notification_messages"."sent_at" IS NOT NULL)),
	CONSTRAINT "notification_messages_sent_text_check" CHECK (("notification_messages"."status" = 'sent') = ("notification_messages"."text" IS NOT NULL)),
	CONSTRAINT "notification_messages_chat_check" CHECK (("notification_messages"."status" = 'sent') = ("notification_messages"."chat_id" IS NOT NULL)),
	CONSTRAINT "notification_messages_telegram_message_check" CHECK (("notification_messages"."status" = 'sent') = ("notification_messages"."telegram_message_id" IS NOT NULL)),
	CONSTRAINT "notification_messages_first_failure_check" CHECK (("notification_messages"."attempt_count" = 0) = ("notification_messages"."first_failure_at" IS NULL)),
	CONSTRAINT "notification_messages_last_failure_check" CHECK (("notification_messages"."attempt_count" = 0) = ("notification_messages"."last_failure_at" IS NULL)),
	CONSTRAINT "notification_messages_failures_check" CHECK ("notification_messages"."last_failure_at" >= "notification_messages"."first_failure_at"),
	CONSTRAINT "notification_messages_failure_kind_check" CHECK (("notification_messages"."attempt_count" = 0) = ("notification_messages"."last_failure_kind" IS NULL)),
	CONSTRAINT "notification_messages_discarded_check" CHECK (("notification_messages"."status" = 'discarded') = ("notification_messages"."discard_reason" IS NOT NULL)),
	CONSTRAINT "notification_messages_grouped_check" CHECK ("notification_messages"."grouped_into_message_id" IS NULL OR "notification_messages"."status" = 'grouped')
);
--> statement-breakpoint
CREATE TABLE "press_source_daily_counts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "press_source_daily_counts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"press_source_id" integer NOT NULL,
	"collected_on" date NOT NULL,
	"new_articles" integer DEFAULT 0 NOT NULL,
	"prefilter_kept" integer DEFAULT 0 NOT NULL,
	"exactly_dated" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "press_source_daily_counts_new_articles_check" CHECK ("press_source_daily_counts"."new_articles" >= 0),
	CONSTRAINT "press_source_daily_counts_prefilter_kept_check" CHECK ("press_source_daily_counts"."prefilter_kept" BETWEEN 0 AND "press_source_daily_counts"."new_articles"),
	CONSTRAINT "press_source_daily_counts_exactly_dated_check" CHECK ("press_source_daily_counts"."exactly_dated" BETWEEN 0 AND "press_source_daily_counts"."new_articles")
);
--> statement-breakpoint
CREATE TABLE "press_source_deactivations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "press_source_deactivations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"press_source_id" integer NOT NULL,
	"deactivated_at" timestamp with time zone NOT NULL,
	"reactivated_at" timestamp with time zone,
	CONSTRAINT "press_source_deactivations_reactivated_check" CHECK ("press_source_deactivations"."reactivated_at" > "press_source_deactivations"."deactivated_at")
);
--> statement-breakpoint
CREATE TABLE "press_source_incidents" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "press_source_incidents_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"incident_id" integer NOT NULL,
	"press_source_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "press_sources" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "press_sources_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"outlet_name" text NOT NULL,
	"feed_url" text NOT NULL,
	"feed_url_key" text NOT NULL,
	"language" text NOT NULL,
	"outlet_time_zone" text,
	"silence_period_days" smallint,
	"public_sports_press_attested_at" timestamp with time zone NOT NULL,
	"activation_status" text DEFAULT 'active' NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"health_status" text DEFAULT 'never_read' NOT NULL,
	"health_status_changed_at" timestamp with time zone NOT NULL,
	"first_successful_read_at" timestamp with time zone,
	"last_successful_read_at" timestamp with time zone,
	"last_new_article_at" timestamp with time zone,
	"consecutive_failed_runs" smallint DEFAULT 0 NOT NULL,
	"failure_streak_started_at" timestamp with time zone,
	"proposed_feed_url" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "press_sources_outlet_name_check" CHECK ("press_sources"."outlet_name" ~ '[^\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]'),
	CONSTRAINT "press_sources_feed_url_check" CHECK ("press_sources"."feed_url" ~ '^https?://'),
	CONSTRAINT "press_sources_language_check" CHECK ("press_sources"."language" IN ('en', 'fr')),
	CONSTRAINT "press_sources_silence_period_days_check" CHECK ("press_sources"."silence_period_days" BETWEEN 1 AND 30),
	CONSTRAINT "press_sources_activation_status_check" CHECK ("press_sources"."activation_status" IN ('active', 'deactivated', 'withdrawn')),
	CONSTRAINT "press_sources_withdrawn_check" CHECK (("press_sources"."activation_status" = 'withdrawn') = ("press_sources"."withdrawn_at" IS NOT NULL)),
	CONSTRAINT "press_sources_health_status_check" CHECK ("press_sources"."health_status" IN ('never_read', 'working', 'down', 'silent')),
	CONSTRAINT "press_sources_reads_check" CHECK ("press_sources"."last_successful_read_at" >= "press_sources"."first_successful_read_at"),
	CONSTRAINT "press_sources_consecutive_failed_runs_check" CHECK ("press_sources"."consecutive_failed_runs" >= 0),
	CONSTRAINT "press_sources_failure_streak_check" CHECK (("press_sources"."consecutive_failed_runs" = 0) = ("press_sources"."failure_streak_started_at" IS NULL)),
	CONSTRAINT "press_sources_proposed_feed_url_check" CHECK ("press_sources"."proposed_feed_url" ~ '^https?://')
);
--> statement-breakpoint
CREATE TABLE "regrouping_exits" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "regrouping_exits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_event_id" integer NOT NULL,
	"player_id" uuid NOT NULL,
	"event_type_id" text NOT NULL,
	"overall_subrow" text,
	"gap_in_forecast_direction" double precision,
	CONSTRAINT "regrouping_exits_overall_subrow_check" CHECK ("regrouping_exits"."overall_subrow" IN ('probable_profile', 'possible_profile', 'general_trend')),
	CONSTRAINT "regrouping_exits_gap_check" CHECK ("regrouping_exits"."gap_in_forecast_direction" IS NULL OR "regrouping_exits"."overall_subrow" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "telegram_link_codes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "telegram_link_codes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code_sha256" "bytea" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "telegram_link_codes_code_sha256_check" CHECK (octet_length("telegram_link_codes"."code_sha256") = 32),
	CONSTRAINT "telegram_link_codes_expires_check" CHECK ("telegram_link_codes"."expires_at" >= "telegram_link_codes"."created_at")
);
--> statement-breakpoint
CREATE TABLE "telegram_links" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'not_linked' NOT NULL,
	"status_changed_at" timestamp with time zone NOT NULL,
	"chat_id" bigint,
	"linked_at" timestamp with time zone,
	"last_successful_send_at" timestamp with time zone,
	"inbound_mode" text DEFAULT 'webhook' NOT NULL,
	"last_update_id" bigint,
	"last_update_at" timestamp with time zone,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "telegram_links_id_check" CHECK ("telegram_links"."id" = 1),
	CONSTRAINT "telegram_links_status_check" CHECK ("telegram_links"."status" IN ('not_linked', 'awaiting_confirmation', 'linked', 'broken')),
	CONSTRAINT "telegram_links_chat_check" CHECK (("telegram_links"."status" IN ('linked', 'broken')) = ("telegram_links"."chat_id" IS NOT NULL)),
	CONSTRAINT "telegram_links_linked_check" CHECK (("telegram_links"."chat_id" IS NULL) = ("telegram_links"."linked_at" IS NULL)),
	CONSTRAINT "telegram_links_inbound_mode_check" CHECK ("telegram_links"."inbound_mode" IN ('webhook', 'polling'))
);
--> statement-breakpoint
CREATE TABLE "tracked_case_decisions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tracked_case_decisions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tracked_case_id" integer NOT NULL,
	"kind" text NOT NULL,
	"effect" text NOT NULL,
	"player_event_id" integer,
	"decided_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tracked_case_decisions_kind_check" CHECK ("tracked_case_decisions"."kind" IN ('event_dismissed', 'event_reinstated', 'case_excluded', 'case_reinstated', 'context_corrected', 'reference_date_corrected', 'player_corrected', 'type_corrected', 'dating_mark_lifted')),
	CONSTRAINT "tracked_case_decisions_effect_check" CHECK ("tracked_case_decisions"."effect" IN ('exit', 'entry', 'measured_game_change')),
	CONSTRAINT "tracked_case_decisions_case_decision_check" CHECK ("tracked_case_decisions"."kind" NOT IN ('case_excluded', 'case_reinstated') OR "tracked_case_decisions"."player_event_id" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "tracked_cases" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tracked_cases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"case_id" integer NOT NULL,
	"forecast_state" text,
	"forecast_source" text,
	"forecast_level" text,
	"forecast_direction" text,
	"announced_mean_gap" double precision,
	"forecast_case_count" integer,
	"forecast_profile_confidence" text,
	"forecast_frozen_at" timestamp with time zone,
	"awaiting_late_forecast" boolean DEFAULT false NOT NULL,
	"category" text,
	CONSTRAINT "tracked_cases_forecast_state_check" CHECK ("tracked_cases"."forecast_state" IN ('frozen', 'late', 'none')),
	CONSTRAINT "tracked_cases_forecast_source_check" CHECK ("tracked_cases"."forecast_source" IN ('player_profile', 'general_trend', 'none')),
	CONSTRAINT "tracked_cases_forecast_chosen_check" CHECK (("tracked_cases"."forecast_state" IS NULL) = ("tracked_cases"."forecast_source" IS NULL)),
	CONSTRAINT "tracked_cases_no_forecast_check" CHECK (("tracked_cases"."forecast_state" IS NOT DISTINCT FROM 'none') = ("tracked_cases"."forecast_source" IS NOT DISTINCT FROM 'none')),
	CONSTRAINT "tracked_cases_forecast_level_check" CHECK ("tracked_cases"."forecast_level" IN ('possible', 'probable')),
	CONSTRAINT "tracked_cases_forecast_direction_check" CHECK ("tracked_cases"."forecast_direction" IN ('increase', 'decrease')),
	CONSTRAINT "tracked_cases_forecast_case_count_check" CHECK ("tracked_cases"."forecast_case_count" >= 1),
	CONSTRAINT "tracked_cases_forecast_profile_confidence_check" CHECK ("tracked_cases"."forecast_profile_confidence" IN ('low', 'medium', 'high')),
	CONSTRAINT "tracked_cases_forecast_check" CHECK (CASE WHEN "tracked_cases"."forecast_source" IN ('player_profile', 'general_trend') THEN num_nulls("tracked_cases"."forecast_level", "tracked_cases"."forecast_direction", "tracked_cases"."announced_mean_gap", "tracked_cases"."forecast_case_count", "tracked_cases"."forecast_profile_confidence") = 0 ELSE num_nonnulls("tracked_cases"."forecast_level", "tracked_cases"."forecast_direction", "tracked_cases"."announced_mean_gap", "tracked_cases"."forecast_case_count", "tracked_cases"."forecast_profile_confidence") = 0 END),
	CONSTRAINT "tracked_cases_forecast_frozen_check" CHECK (("tracked_cases"."forecast_state" IS NULL) = ("tracked_cases"."forecast_frozen_at" IS NULL)),
	CONSTRAINT "tracked_cases_awaiting_late_forecast_check" CHECK (NOT "tracked_cases"."awaiting_late_forecast" OR "tracked_cases"."forecast_state" IS NOT DISTINCT FROM 'none'),
	CONSTRAINT "tracked_cases_category_check" CHECK ("tracked_cases"."category" IN ('confirmed', 'refuted', 'neutral', 'no_forecast'))
);
--> statement-breakpoint
CREATE TABLE "tracked_game_results" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tracked_game_results_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tracked_case_id" integer NOT NULL,
	"kind" text NOT NULL,
	"transmitted_at" timestamp with time zone NOT NULL,
	"content" jsonb NOT NULL,
	CONSTRAINT "tracked_game_results_kind_check" CHECK ("tracked_game_results"."kind" IN ('indicative', 'final'))
);
--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_dismissed_check";--> statement-breakpoint
ALTER TABLE "tally_exits" DROP CONSTRAINT "tally_exits_deleted_check";--> statement-breakpoint
ALTER TABLE "alert_sheet_caveats" ADD CONSTRAINT "alert_sheet_caveats_alert_sheet_id_alert_sheets_id_fk" FOREIGN KEY ("alert_sheet_id") REFERENCES "public"."alert_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_sheet_caveats" ADD CONSTRAINT "alert_sheet_caveats_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_sheet_caveats" ADD CONSTRAINT "alert_sheet_caveats_player_event_id_events_id_fk" FOREIGN KEY ("player_event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_sheet_events" ADD CONSTRAINT "alert_sheet_events_player_event_id_events_id_fk" FOREIGN KEY ("player_event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_sheet_events" ADD CONSTRAINT "alert_sheet_events_alert_sheet_section_id_fk" FOREIGN KEY ("alert_sheet_section_id") REFERENCES "public"."alert_sheet_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_sheet_expected_games" ADD CONSTRAINT "alert_sheet_expected_games_alert_sheet_id_alert_sheets_id_fk" FOREIGN KEY ("alert_sheet_id") REFERENCES "public"."alert_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_sheet_expected_games" ADD CONSTRAINT "alert_sheet_expected_games_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_sheet_expected_games" ADD CONSTRAINT "alert_sheet_expected_games_opponent_team_id_teams_id_fk" FOREIGN KEY ("opponent_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_sheet_expected_games" ADD CONSTRAINT "alert_sheet_expected_games_passed_game_id_games_id_fk" FOREIGN KEY ("passed_game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_sheet_outcomes" ADD CONSTRAINT "alert_sheet_outcomes_alert_sheet_event_id_fk" FOREIGN KEY ("alert_sheet_event_id") REFERENCES "public"."alert_sheet_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_sheet_sections" ADD CONSTRAINT "alert_sheet_sections_alert_sheet_id_alert_sheets_id_fk" FOREIGN KEY ("alert_sheet_id") REFERENCES "public"."alert_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_sheet_sections" ADD CONSTRAINT "alert_sheet_sections_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_sheet_sections" ADD CONSTRAINT "alert_sheet_sections_vacated_by_event_id_events_id_fk" FOREIGN KEY ("vacated_by_event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_sheet_snapshots" ADD CONSTRAINT "alert_sheet_snapshots_alert_sheet_section_id_fk" FOREIGN KEY ("alert_sheet_section_id") REFERENCES "public"."alert_sheet_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_sheet_snapshots" ADD CONSTRAINT "alert_sheet_snapshots_alert_sheet_outcome_id_fk" FOREIGN KEY ("alert_sheet_outcome_id") REFERENCES "public"."alert_sheet_outcomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_sheet_updates" ADD CONSTRAINT "alert_sheet_updates_alert_sheet_id_alert_sheets_id_fk" FOREIGN KEY ("alert_sheet_id") REFERENCES "public"."alert_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_sheet_updates" ADD CONSTRAINT "alert_sheet_updates_player_event_id_events_id_fk" FOREIGN KEY ("player_event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_sheet_updates" ADD CONSTRAINT "alert_sheet_updates_alert_sheet_section_id_fk" FOREIGN KEY ("alert_sheet_section_id") REFERENCES "public"."alert_sheet_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_sheets" ADD CONSTRAINT "alert_sheets_player_id_followed_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."followed_players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_sheets" ADD CONSTRAINT "alert_sheets_team_id_at_production_teams_id_fk" FOREIGN KEY ("team_id_at_production") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_attachments" ADD CONSTRAINT "article_attachments_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_attachments" ADD CONSTRAINT "article_attachments_player_event_id_events_id_fk" FOREIGN KEY ("player_event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_attachments" ADD CONSTRAINT "article_attachments_classification_fact_id_fk" FOREIGN KEY ("classification_fact_id") REFERENCES "public"."classification_facts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_parts" ADD CONSTRAINT "article_parts_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_parts" ADD CONSTRAINT "article_parts_player_id_followed_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."followed_players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_sightings" ADD CONSTRAINT "article_sightings_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_sightings" ADD CONSTRAINT "article_sightings_press_source_id_press_sources_id_fk" FOREIGN KEY ("press_source_id") REFERENCES "public"."press_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_first_press_source_id_press_sources_id_fk" FOREIGN KEY ("first_press_source_id") REFERENCES "public"."press_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_first_task_run_id_task_runs_id_fk" FOREIGN KEY ("first_task_run_id") REFERENCES "public"."task_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_category_changes" ADD CONSTRAINT "case_category_changes_tracked_case_id_tracked_cases_id_fk" FOREIGN KEY ("tracked_case_id") REFERENCES "public"."tracked_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_facts" ADD CONSTRAINT "classification_facts_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_facts" ADD CONSTRAINT "classification_facts_designated_event_id_events_id_fk" FOREIGN KEY ("designated_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_facts" ADD CONSTRAINT "classification_facts_matched_historical_event_id_events_id_fk" FOREIGN KEY ("matched_historical_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_facts" ADD CONSTRAINT "classification_facts_superseded_into_event_id_events_id_fk" FOREIGN KEY ("superseded_into_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_facts" ADD CONSTRAINT "classification_facts_classification_result_id_fk" FOREIGN KEY ("classification_result_id") REFERENCES "public"."classification_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_incident_details" ADD CONSTRAINT "classification_incident_details_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_results" ADD CONSTRAINT "classification_results_article_part_id_article_parts_id_fk" FOREIGN KEY ("article_part_id") REFERENCES "public"."article_parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_gaps" ADD CONSTRAINT "collection_gaps_press_source_id_press_sources_id_fk" FOREIGN KEY ("press_source_id") REFERENCES "public"."press_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_gaps" ADD CONSTRAINT "collection_gaps_task_run_id_task_runs_id_fk" FOREIGN KEY ("task_run_id") REFERENCES "public"."task_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_source_reads" ADD CONSTRAINT "collection_source_reads_task_run_id_task_runs_id_fk" FOREIGN KEY ("task_run_id") REFERENCES "public"."task_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_source_reads" ADD CONSTRAINT "collection_source_reads_press_source_id_press_sources_id_fk" FOREIGN KEY ("press_source_id") REFERENCES "public"."press_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detection_runs" ADD CONSTRAINT "detection_runs_task_run_id_task_runs_id_fk" FOREIGN KEY ("task_run_id") REFERENCES "public"."task_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exposure_counts" ADD CONSTRAINT "exposure_counts_player_id_followed_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."followed_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_versions" ADD CONSTRAINT "forecast_versions_tracked_case_id_tracked_cases_id_fk" FOREIGN KEY ("tracked_case_id") REFERENCES "public"."tracked_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_message_events" ADD CONSTRAINT "notification_message_events_player_event_id_events_id_fk" FOREIGN KEY ("player_event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_message_events" ADD CONSTRAINT "notification_message_events_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."notification_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_message_facts" ADD CONSTRAINT "notification_message_facts_deadline_game_id_games_id_fk" FOREIGN KEY ("deadline_game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_message_facts" ADD CONSTRAINT "notification_message_facts_alert_sheet_id_alert_sheets_id_fk" FOREIGN KEY ("alert_sheet_id") REFERENCES "public"."alert_sheets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_message_facts" ADD CONSTRAINT "notification_message_facts_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_message_facts" ADD CONSTRAINT "notification_message_facts_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_message_facts" ADD CONSTRAINT "notification_message_facts_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_message_facts" ADD CONSTRAINT "notification_message_facts_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."notification_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_message_facts" ADD CONSTRAINT "notification_message_facts_backtest_request_id_fk" FOREIGN KEY ("backtest_request_id") REFERENCES "public"."backtest_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_message_facts" ADD CONSTRAINT "notification_message_facts_alert_sheet_update_id_fk" FOREIGN KEY ("alert_sheet_update_id") REFERENCES "public"."alert_sheet_updates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_messages" ADD CONSTRAINT "notification_messages_player_id_followed_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."followed_players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_messages" ADD CONSTRAINT "notification_messages_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_messages" ADD CONSTRAINT "notification_messages_grouped_into_message_id_fk" FOREIGN KEY ("grouped_into_message_id") REFERENCES "public"."notification_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "press_source_daily_counts" ADD CONSTRAINT "press_source_daily_counts_press_source_id_press_sources_id_fk" FOREIGN KEY ("press_source_id") REFERENCES "public"."press_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "press_source_deactivations" ADD CONSTRAINT "press_source_deactivations_press_source_id_press_sources_id_fk" FOREIGN KEY ("press_source_id") REFERENCES "public"."press_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "press_source_incidents" ADD CONSTRAINT "press_source_incidents_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "press_source_incidents" ADD CONSTRAINT "press_source_incidents_press_source_id_press_sources_id_fk" FOREIGN KEY ("press_source_id") REFERENCES "public"."press_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regrouping_exits" ADD CONSTRAINT "regrouping_exits_player_event_id_events_id_fk" FOREIGN KEY ("player_event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regrouping_exits" ADD CONSTRAINT "regrouping_exits_player_id_followed_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."followed_players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regrouping_exits" ADD CONSTRAINT "regrouping_exits_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_case_decisions" ADD CONSTRAINT "tracked_case_decisions_tracked_case_id_tracked_cases_id_fk" FOREIGN KEY ("tracked_case_id") REFERENCES "public"."tracked_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_case_decisions" ADD CONSTRAINT "tracked_case_decisions_player_event_id_events_id_fk" FOREIGN KEY ("player_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_cases" ADD CONSTRAINT "tracked_cases_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_game_results" ADD CONSTRAINT "tracked_game_results_tracked_case_id_tracked_cases_id_fk" FOREIGN KEY ("tracked_case_id") REFERENCES "public"."tracked_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_sheet_events_event_uq" ON "alert_sheet_events" USING btree ("player_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_sheet_expected_games_live_uq" ON "alert_sheet_expected_games" USING btree ("alert_sheet_id") WHERE "alert_sheet_expected_games"."state" IN ('current', 'unknown');--> statement-breakpoint
CREATE INDEX "alert_sheet_expected_games_game_idx" ON "alert_sheet_expected_games" USING btree ("game_id") WHERE "alert_sheet_expected_games"."state" = 'current';--> statement-breakpoint
CREATE UNIQUE INDEX "alert_sheet_outcomes_uq" ON "alert_sheet_outcomes" USING btree ("alert_sheet_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_sheet_sections_uq" ON "alert_sheet_sections" USING btree ("alert_sheet_id","event_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_sheet_sections_initial_uq" ON "alert_sheet_sections" USING btree ("alert_sheet_id") WHERE "alert_sheet_sections"."kind" = 'initial';--> statement-breakpoint
CREATE INDEX "alert_sheet_sections_type_idx" ON "alert_sheet_sections" USING btree ("event_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_sheet_snapshots_section_uq" ON "alert_sheet_snapshots" USING btree ("alert_sheet_section_id","kind") WHERE "alert_sheet_snapshots"."alert_sheet_section_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_sheet_snapshots_outcome_uq" ON "alert_sheet_snapshots" USING btree ("alert_sheet_outcome_id") WHERE "alert_sheet_snapshots"."alert_sheet_outcome_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "alert_sheet_updates_sheet_idx" ON "alert_sheet_updates" USING btree ("alert_sheet_id","occurred_at");--> statement-breakpoint
CREATE INDEX "alert_sheet_updates_event_idx" ON "alert_sheet_updates" USING btree ("player_event_id") WHERE "alert_sheet_updates"."player_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "alert_sheets_player_idx" ON "alert_sheets" USING btree ("player_id","produced_at");--> statement-breakpoint
CREATE INDEX "alert_sheets_status_idx" ON "alert_sheets" USING btree ("status","produced_at");--> statement-breakpoint
CREATE INDEX "alert_sheets_late_idx" ON "alert_sheets" USING btree ("produced_at") WHERE "alert_sheets"."is_late";--> statement-breakpoint
CREATE UNIQUE INDEX "article_attachments_uq" ON "article_attachments" USING btree ("article_id","player_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "article_attachments_fact_uq" ON "article_attachments" USING btree ("classification_fact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "article_attachments_reference_uq" ON "article_attachments" USING btree ("player_event_id") WHERE "article_attachments"."is_reference";--> statement-breakpoint
CREATE INDEX "article_attachments_event_idx" ON "article_attachments" USING btree ("player_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "article_parts_uq" ON "article_parts" USING btree ("article_id","player_id");--> statement-breakpoint
CREATE INDEX "article_parts_eligible_idx" ON "article_parts" USING btree ("queued_at") WHERE "article_parts"."status" = 'pending' AND "article_parts"."classification_failed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "article_parts_failed_idx" ON "article_parts" USING btree ("article_id") WHERE "article_parts"."classification_failed_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "article_parts_player_idx" ON "article_parts" USING btree ("player_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "article_sightings_uq" ON "article_sightings" USING btree ("article_id","press_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "article_sightings_item_uq" ON "article_sightings" USING btree ("press_source_id","feed_item_id") WHERE "article_sightings"."feed_item_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "articles_link_uq" ON "articles" USING btree ("link");--> statement-breakpoint
CREATE INDEX "articles_title_dedup_idx" ON "articles" USING btree ("outlet_name","title_key","retained_published_at");--> statement-breakpoint
CREATE INDEX "articles_to_analyze_idx" ON "articles" USING btree ("first_collected_at") WHERE "articles"."processing_status" = 'to_analyze';--> statement-breakpoint
CREATE INDEX "articles_not_relevant_idx" ON "articles" USING btree ("retention_clock_started_at") WHERE "articles"."processing_status" = 'not_relevant';--> statement-breakpoint
CREATE INDEX "articles_reasons_gin" ON "articles" USING gin ("not_relevant_reasons");--> statement-breakpoint
CREATE INDEX "articles_excerpt_idx" ON "articles" USING btree ("first_collected_at") WHERE "articles"."excerpt" IS NOT NULL AND "articles"."processing_status" = 'attached';--> statement-breakpoint
CREATE INDEX "articles_source_collected_idx" ON "articles" USING btree ("first_press_source_id","first_collected_at");--> statement-breakpoint
CREATE INDEX "articles_run_idx" ON "articles" USING btree ("first_task_run_id");--> statement-breakpoint
CREATE INDEX "articles_retained_idx" ON "articles" USING btree ("retained_published_at");--> statement-breakpoint
CREATE INDEX "case_category_changes_case_idx" ON "case_category_changes" USING btree ("tracked_case_id","changed_at");--> statement-breakpoint
CREATE INDEX "classification_facts_result_idx" ON "classification_facts" USING btree ("classification_result_id");--> statement-breakpoint
CREATE INDEX "classification_facts_designated_idx" ON "classification_facts" USING btree ("designated_event_id") WHERE "classification_facts"."designated_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "classification_facts_matched_idx" ON "classification_facts" USING btree ("matched_historical_event_id") WHERE "classification_facts"."matched_historical_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "classification_facts_superseded_idx" ON "classification_facts" USING btree ("superseded_into_event_id") WHERE "classification_facts"."superseded_into_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "classification_facts_linked_idx" ON "classification_facts" USING btree ("event_type_id") WHERE "classification_facts"."outcome" = 'linked_to_proposal';--> statement-breakpoint
CREATE INDEX "classification_facts_coverage_idx" ON "classification_facts" USING btree ("event_type_id") WHERE "classification_facts"."not_relevant_reason" = 'below_coverage_threshold';--> statement-breakpoint
CREATE UNIQUE INDEX "classification_incident_details_incident_uq" ON "classification_incident_details" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "classification_results_part_idx" ON "classification_results" USING btree ("article_part_id","classified_at");--> statement-breakpoint
CREATE INDEX "collection_gaps_source_idx" ON "collection_gaps" USING btree ("press_source_id","detected_at");--> statement-breakpoint
CREATE INDEX "collection_gaps_run_idx" ON "collection_gaps" USING btree ("task_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_source_reads_uq" ON "collection_source_reads" USING btree ("task_run_id","press_source_id");--> statement-breakpoint
CREATE INDEX "collection_source_reads_source_idx" ON "collection_source_reads" USING btree ("press_source_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dedup_traces_link_uq" ON "dedup_traces" USING btree ("link_sha256");--> statement-breakpoint
CREATE INDEX "dedup_traces_deleted_idx" ON "dedup_traces" USING btree ("article_deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "detection_runs_task_run_uq" ON "detection_runs" USING btree ("task_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exposure_counts_uq" ON "exposure_counts" USING btree ("player_id","counted_on");--> statement-breakpoint
CREATE UNIQUE INDEX "forecast_versions_uq" ON "forecast_versions" USING btree ("tracked_case_id","effective_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_daily_counts_day_uq" ON "notification_daily_counts" USING btree ("cap_day");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_message_events_uq" ON "notification_message_events" USING btree ("message_id","player_event_id");--> statement-breakpoint
CREATE INDEX "notification_message_events_event_idx" ON "notification_message_events" USING btree ("player_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_facts_request_uq" ON "notification_message_facts" USING btree ("backtest_request_id") WHERE "notification_message_facts"."message_kind" IN ('backtest_request_to_do');--> statement-breakpoint
CREATE UNIQUE INDEX "notification_facts_deadline_changed_uq" ON "notification_message_facts" USING btree ("backtest_request_id","deadline_game_id") WHERE "notification_message_facts"."message_kind" IN ('deadline_changed');--> statement-breakpoint
CREATE UNIQUE INDEX "notification_facts_reminder_uq" ON "notification_message_facts" USING btree ("backtest_request_id","deadline_game_id") WHERE "notification_message_facts"."message_kind" IN ('deadline_reminder');--> statement-breakpoint
CREATE UNIQUE INDEX "notification_facts_alert_uq" ON "notification_message_facts" USING btree ("alert_sheet_id") WHERE "notification_message_facts"."message_kind" IN ('alert');--> statement-breakpoint
CREATE UNIQUE INDEX "notification_facts_alert_update_uq" ON "notification_message_facts" USING btree ("alert_sheet_update_id") WHERE "notification_message_facts"."message_kind" IN ('alert_update');--> statement-breakpoint
CREATE UNIQUE INDEX "notification_facts_result_uq" ON "notification_message_facts" USING btree ("case_id") WHERE "notification_message_facts"."message_kind" IN ('tracked_game_result');--> statement-breakpoint
CREATE UNIQUE INDEX "notification_facts_proposal_uq" ON "notification_message_facts" USING btree ("event_type_id") WHERE "notification_message_facts"."message_kind" IN ('new_type_proposal');--> statement-breakpoint
CREATE UNIQUE INDEX "notification_facts_incident_start_uq" ON "notification_message_facts" USING btree ("incident_id") WHERE "notification_message_facts"."message_kind" IN ('incident_start');--> statement-breakpoint
CREATE UNIQUE INDEX "notification_facts_incident_reminder_uq" ON "notification_message_facts" USING btree ("incident_id","reminder_number") WHERE "notification_message_facts"."message_kind" IN ('incident_reminder');--> statement-breakpoint
CREATE UNIQUE INDEX "notification_facts_incident_end_uq" ON "notification_message_facts" USING btree ("incident_id") WHERE "notification_message_facts"."message_kind" IN ('incident_end');--> statement-breakpoint
CREATE UNIQUE INDEX "notification_facts_export_reminder_uq" ON "notification_message_facts" USING btree ("incident_id") WHERE "notification_message_facts"."message_kind" IN ('export_reminder');--> statement-breakpoint
CREATE INDEX "notification_facts_message_idx" ON "notification_message_facts" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "notification_facts_case_idx" ON "notification_message_facts" USING btree ("case_id") WHERE "notification_message_facts"."case_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notification_messages_due_idx" ON "notification_messages" USING btree ("scheduled_send_at") WHERE "notification_messages"."status" IN ('to_send', 'deferred');--> statement-breakpoint
CREATE INDEX "notification_messages_failed_idx" ON "notification_messages" USING btree ("created_at") WHERE "notification_messages"."status" = 'failed';--> statement-breakpoint
CREATE INDEX "notification_messages_created_idx" ON "notification_messages" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_messages_pass_uq" ON "notification_messages" USING btree ("pass_id") WHERE "notification_messages"."kind" = 'pass_digest';--> statement-breakpoint
CREATE UNIQUE INDEX "notification_messages_quiet_uq" ON "notification_messages" USING btree ("scheduled_send_at") WHERE "notification_messages"."kind" = 'quiet_hours_digest';--> statement-breakpoint
CREATE UNIQUE INDEX "notification_messages_cap_uq" ON "notification_messages" USING btree ("cap_day") WHERE "notification_messages"."kind" = 'daily_cap_reached';--> statement-breakpoint
CREATE UNIQUE INDEX "notification_messages_catch_up_uq" ON "notification_messages" USING btree ("kind") WHERE "notification_messages"."kind" = 'catch_up' AND "notification_messages"."status" IN ('to_send', 'deferred');--> statement-breakpoint
CREATE INDEX "notification_messages_player_idx" ON "notification_messages" USING btree ("player_id") WHERE "notification_messages"."player_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "press_source_daily_counts_uq" ON "press_source_daily_counts" USING btree ("press_source_id","collected_on");--> statement-breakpoint
CREATE UNIQUE INDEX "press_source_deactivations_open_uq" ON "press_source_deactivations" USING btree ("press_source_id") WHERE "press_source_deactivations"."reactivated_at" IS NULL;--> statement-breakpoint
CREATE INDEX "press_source_deactivations_source_idx" ON "press_source_deactivations" USING btree ("press_source_id","reactivated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "press_source_incidents_incident_uq" ON "press_source_incidents" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "press_source_incidents_source_idx" ON "press_source_incidents" USING btree ("press_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "press_sources_feed_url_key_uq" ON "press_sources" USING btree ("feed_url_key") WHERE "press_sources"."activation_status" <> 'withdrawn';--> statement-breakpoint
CREATE INDEX "regrouping_exits_pair_idx" ON "regrouping_exits" USING btree ("player_id","event_type_id");--> statement-breakpoint
CREATE INDEX "regrouping_exits_event_idx" ON "regrouping_exits" USING btree ("player_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_link_codes_code_uq" ON "telegram_link_codes" USING btree ("code_sha256");--> statement-breakpoint
CREATE INDEX "tracked_case_decisions_case_idx" ON "tracked_case_decisions" USING btree ("tracked_case_id","decided_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tracked_cases_case_uq" ON "tracked_cases" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "tracked_cases_unfrozen_idx" ON "tracked_cases" USING btree ("id") WHERE "tracked_cases"."forecast_state" IS NULL;--> statement-breakpoint
CREATE INDEX "tracked_cases_late_idx" ON "tracked_cases" USING btree ("id") WHERE "tracked_cases"."awaiting_late_forecast";--> statement-breakpoint
CREATE INDEX "tracked_game_results_case_idx" ON "tracked_game_results" USING btree ("tracked_case_id","transmitted_at");--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_baseline_season_check" CHECK (CASE WHEN "cases"."baseline_season" !~ '^[0-9]{4}-[0-9]{2}$' THEN false ELSE right("cases"."baseline_season", 2)::integer = (left("cases"."baseline_season", 4)::integer + 1) % 100 END);--> statement-breakpoint
ALTER TABLE "event_import_warnings" ADD CONSTRAINT "event_import_warnings_related_position_check" CHECK ("event_import_warnings"."related_position" >= 1);--> statement-breakpoint
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_position_check" CHECK ("event_sources"."position" >= 1);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_dismissed_check" CHECK (("events"."detected_status" = 'dismissed') = ("events"."dismissal_reason" IS NOT NULL AND "events"."dismissed_at" IS NOT NULL) AND ("events"."detected_status" = 'dismissed' OR "events"."dismissal_reason" IS NULL));--> statement-breakpoint
ALTER TABLE "tally_exits" ADD CONSTRAINT "tally_exits_deleted_check" CHECK (CASE WHEN "tally_exits"."exit_reason" = 'deleted' THEN num_nulls("tally_exits"."deletion_reason", "tally_exits"."public_date_on", "tally_exits"."exited_at") = 0 ELSE num_nonnulls("tally_exits"."deletion_reason", "tally_exits"."public_date_on") = 0 END);