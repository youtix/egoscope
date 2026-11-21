CREATE TABLE "backtest_coverage_periods" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "backtest_coverage_periods_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" uuid NOT NULL,
	"event_type_id" text NOT NULL,
	"start_on" date NOT NULL,
	"end_on" date NOT NULL,
	"sheet_version_number" smallint NOT NULL,
	"origin" text NOT NULL,
	"import_id" integer,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backtest_coverage_periods_period_check" CHECK ("backtest_coverage_periods"."start_on" <= "backtest_coverage_periods"."end_on"),
	CONSTRAINT "backtest_coverage_periods_sheet_version_number_check" CHECK ("backtest_coverage_periods"."sheet_version_number" >= 0),
	CONSTRAINT "backtest_coverage_periods_origin_check" CHECK ("backtest_coverage_periods"."origin" IN ('import', 'merge', 'split')),
	CONSTRAINT "backtest_coverage_periods_import_check" CHECK (("backtest_coverage_periods"."origin" = 'import') = ("backtest_coverage_periods"."import_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "backtest_request_events" (
	"backtest_request_id" integer NOT NULL,
	"player_event_id" integer NOT NULL,
	"attached_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backtest_request_events_backtest_request_id_player_event_id_pk" PRIMARY KEY("backtest_request_id","player_event_id")
);
--> statement-breakpoint
CREATE TABLE "backtest_request_types" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "backtest_request_types_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"backtest_request_id" integer NOT NULL,
	"event_type_id" text NOT NULL,
	"sheet_version_number" smallint NOT NULL,
	"period_start_on" date,
	"period_end_on" date NOT NULL,
	"is_requested" boolean DEFAULT true NOT NULL,
	CONSTRAINT "backtest_request_types_key" UNIQUE("backtest_request_id","event_type_id"),
	CONSTRAINT "backtest_request_types_period_check" CHECK ("backtest_request_types"."period_start_on" IS NULL OR "backtest_request_types"."period_start_on" <= "backtest_request_types"."period_end_on")
);
--> statement-breakpoint
CREATE TABLE "backtest_requests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "backtest_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"reference" text NOT NULL,
	"player_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"trigger" text NOT NULL,
	"trigger_event_type_id" text,
	"trigger_import_id" integer,
	"status" text DEFAULT 'to_do' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_on" date NOT NULL,
	"imported_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"cancellation_reason_code" text,
	"cancellation_reason_text" text,
	"prompt_text" text NOT NULL,
	"prompt_produced_at" timestamp with time zone NOT NULL,
	"last_copied_at" timestamp with time zone,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "backtest_requests_reference_key" UNIQUE("reference"),
	CONSTRAINT "backtest_requests_reference_check" CHECK ("backtest_requests"."reference" ~ '^REQ-[0-9]{4}-[0-9]{4,}$'),
	CONSTRAINT "backtest_requests_kind_check" CHECK ("backtest_requests"."kind" IN ('initial', 'supplement', 'full_redo')),
	CONSTRAINT "backtest_requests_trigger_check" CHECK ("backtest_requests"."trigger" IN ('manual_action', 'detection', 'type_validated', 'type_reactivated', 'type_broadened', 'incomplete_import')),
	CONSTRAINT "backtest_requests_status_check" CHECK ("backtest_requests"."status" IN ('to_do', 'imported', 'canceled')),
	CONSTRAINT "backtest_requests_cancellation_reason_code_check" CHECK ("backtest_requests"."cancellation_reason_code" IN ('player_withdrawn')),
	CONSTRAINT "backtest_requests_imported_check" CHECK (("backtest_requests"."status" = 'imported') = ("backtest_requests"."imported_at" IS NOT NULL)),
	CONSTRAINT "backtest_requests_canceled_check" CHECK ("backtest_requests"."status" <> 'canceled' OR "backtest_requests"."canceled_at" IS NOT NULL),
	CONSTRAINT "backtest_requests_cancellation_reason_check" CHECK (("backtest_requests"."cancellation_reason_code" IS NULL OR "backtest_requests"."canceled_at" IS NOT NULL) AND ("backtest_requests"."cancellation_reason_text" IS NULL OR "backtest_requests"."canceled_at" IS NOT NULL)),
	CONSTRAINT "backtest_requests_trigger_type_check" CHECK (("backtest_requests"."trigger_event_type_id" IS NOT NULL) = ("backtest_requests"."trigger" IN ('type_validated', 'type_reactivated', 'type_broadened'))),
	CONSTRAINT "backtest_requests_trigger_import_check" CHECK ("backtest_requests"."trigger_import_id" IS NULL OR "backtest_requests"."trigger" = 'incomplete_import')
);
--> statement-breakpoint
CREATE TABLE "calendar_derivation_requests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "calendar_derivation_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"player_id" uuid,
	"event_type_id" text,
	"cause" text NOT NULL,
	"follows_owner_change" boolean NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"progress_cursor" text,
	CONSTRAINT "calendar_derivation_requests_kind_check" CHECK ("calendar_derivation_requests"."kind" IN ('regular', 'full')),
	CONSTRAINT "calendar_derivation_requests_cause_check" CHECK ("calendar_derivation_requests"."cause" IN ('statistics_update', 'collection_pass', 'history_stored', 'type_validated', 'type_reactivated', 'type_changed', 'birthday_changed', 'mapping_changed', 'team_history_changed', 'team_change_entered')),
	CONSTRAINT "calendar_derivation_requests_regular_check" CHECK (("calendar_derivation_requests"."kind" = 'regular') = ("calendar_derivation_requests"."cause" IN ('statistics_update', 'collection_pass'))),
	CONSTRAINT "calendar_derivation_requests_follows_owner_change_check" CHECK ("calendar_derivation_requests"."follows_owner_change" = ("calendar_derivation_requests"."cause" IN ('type_validated', 'type_reactivated', 'type_changed', 'birthday_changed', 'mapping_changed', 'team_change_entered')))
);
--> statement-breakpoint
CREATE TABLE "case_history_entries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "case_history_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"case_id" integer NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"status_reason" text,
	"measured_game_id" integer,
	"normalized_gap" double precision,
	"gap_status" text,
	"cause" text NOT NULL,
	CONSTRAINT "case_history_entries_status_check" CHECK ("case_history_entries"."status" IN ('awaiting_game', 'measured', 'excluded', 'not_measurable')),
	CONSTRAINT "case_history_entries_status_reason_check" CHECK ("case_history_entries"."status_reason" IN ('game_not_played_yet', 'statistics_pending', 'mapping_not_established', 'baseline_building', 'precedence_to_verify', 'dating_to_verify', 'no_game_within_window', 'box_score_incomplete', 'box_score_suspect', 'box_score_unavailable', 'insufficient_baseline', 'season_not_covered', 'precedence_not_established', 'derived_game_missed')),
	CONSTRAINT "case_history_entries_gap_status_check" CHECK ("case_history_entries"."gap_status" IN ('provisional', 'final')),
	CONSTRAINT "case_history_entries_cause_check" CHECK ("case_history_entries"."cause" IN ('new_cases', 'stats_correction', 'baseline_updated', 'manual_decision', 'event_dismissed', 'parameter_change', 'recalculation', 'event_corrected_or_removed', 'event_reinstated', 'taxonomy_changed'))
);
--> statement-breakpoint
CREATE TABLE "case_manual_decisions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "case_manual_decisions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"case_id" integer NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"exclusion_reason" text,
	"reinstatement_reason" text,
	"comment" text,
	"previous_status" text NOT NULL,
	"measured_game_id" integer NOT NULL,
	CONSTRAINT "case_manual_decisions_kind_check" CHECK ("case_manual_decisions"."kind" IN ('exclude', 'reinstate')),
	CONSTRAINT "case_manual_decisions_exclusion_reason_check" CHECK ("case_manual_decisions"."exclusion_reason" IN ('playing_time', 'injury_return', 'unusual_stakes', 'opponent_strength', 'other_confounding_factor')),
	CONSTRAINT "case_manual_decisions_reinstatement_reason_check" CHECK ("case_manual_decisions"."reinstatement_reason" IN ('incorrect_context_indication', 'criterion_unsuited_to_case')),
	CONSTRAINT "case_manual_decisions_previous_status_check" CHECK ("case_manual_decisions"."previous_status" IN ('measured', 'excluded')),
	CONSTRAINT "case_manual_decisions_exclusion_check" CHECK (("case_manual_decisions"."kind" = 'exclude') = ("case_manual_decisions"."exclusion_reason" IS NOT NULL AND "case_manual_decisions"."reinstatement_reason" IS NULL AND "case_manual_decisions"."previous_status" = 'measured')),
	CONSTRAINT "case_manual_decisions_reinstatement_check" CHECK (("case_manual_decisions"."kind" = 'reinstate') = ("case_manual_decisions"."reinstatement_reason" IS NOT NULL AND "case_manual_decisions"."exclusion_reason" IS NULL AND "case_manual_decisions"."previous_status" = 'excluded')),
	CONSTRAINT "case_manual_decisions_comment_check" CHECK ("case_manual_decisions"."comment" IS NOT NULL OR ("case_manual_decisions"."exclusion_reason" IS DISTINCT FROM 'other_confounding_factor' AND "case_manual_decisions"."reinstatement_reason" IS DISTINCT FROM 'criterion_unsuited_to_case'))
);
--> statement-breakpoint
CREATE TABLE "case_review_flags" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "case_review_flags_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"case_id" integer NOT NULL,
	"flag" text NOT NULL,
	"measured_game_id" integer NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	CONSTRAINT "case_review_flags_key" UNIQUE("case_id","flag"),
	CONSTRAINT "case_review_flags_flag_check" CHECK ("case_review_flags"."flag" IN ('first_game_with_new_team', 'ejection', 'manual_decision_to_review'))
);
--> statement-breakpoint
CREATE TABLE "case_triggered_criteria" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "case_triggered_criteria_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"case_id" integer NOT NULL,
	"criterion" text NOT NULL,
	"condition" text,
	"triggering_values" jsonb NOT NULL,
	CONSTRAINT "case_triggered_criteria_key" UNIQUE NULLS NOT DISTINCT("case_id","criterion","condition"),
	CONSTRAINT "case_triggered_criteria_criterion_check" CHECK ("case_triggered_criteria"."criterion" IN ('playing_time_too_low', 'injury_return', 'unusual_stakes', 'opponent_strength', 'co_occurring', 'manual')),
	CONSTRAINT "case_triggered_criteria_condition_check" CHECK ("case_triggered_criteria"."condition" IN ('flagged', 'calculated')),
	CONSTRAINT "case_triggered_criteria_conditioned_criterion_check" CHECK ("case_triggered_criteria"."condition" IS NULL OR "case_triggered_criteria"."criterion" IN ('injury_return', 'unusual_stakes'))
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" uuid NOT NULL,
	"event_type_id" text NOT NULL,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"status_reason" text,
	"reference_instant_at" timestamp with time zone,
	"reference_instant_origin" text NOT NULL,
	"measured_game_id" integer,
	"team_games_missed_before" smallint,
	"playing_time_threshold_minutes" double precision,
	"measured_minutes" double precision,
	"has_rounded_minutes" boolean,
	"measured_game_score" double precision,
	"performance_index" double precision,
	"baseline_season" text,
	"baseline_phase" text,
	"baseline_game_count" smallint,
	"baseline_mean" double precision,
	"baseline_standard_deviation" double precision,
	"baseline_status" text,
	"baseline_is_partial" boolean,
	"normalized_gap" double precision,
	"gap_status" text,
	"opponent_strength_not_evaluable" boolean DEFAULT false NOT NULL,
	"stakes_not_evaluable" boolean DEFAULT false NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "cases_id_player_type_key" UNIQUE("id","player_id","event_type_id"),
	CONSTRAINT "cases_origin_check" CHECK ("cases"."origin" IN ('historical', 'tracked')),
	CONSTRAINT "cases_status_check" CHECK ("cases"."status" IN ('awaiting_game', 'measured', 'excluded', 'not_measurable')),
	CONSTRAINT "cases_status_reason_check" CHECK ("cases"."status_reason" IN ('game_not_played_yet', 'statistics_pending', 'mapping_not_established', 'baseline_building', 'precedence_to_verify', 'dating_to_verify', 'no_game_within_window', 'box_score_incomplete', 'box_score_suspect', 'box_score_unavailable', 'insufficient_baseline', 'season_not_covered', 'precedence_not_established', 'derived_game_missed')),
	CONSTRAINT "cases_reference_instant_origin_check" CHECK ("cases"."reference_instant_origin" IN ('known_instant', 'date_only', 'known_in_advance', 'uncertain_precedence_shift')),
	CONSTRAINT "cases_baseline_phase_check" CHECK ("cases"."baseline_phase" IN ('regular_season', 'postseason')),
	CONSTRAINT "cases_baseline_status_check" CHECK ("cases"."baseline_status" IN ('final', 'provisional', 'building', 'insufficient')),
	CONSTRAINT "cases_gap_status_check" CHECK ("cases"."gap_status" IN ('provisional', 'final')),
	CONSTRAINT "cases_reasoned_status_check" CHECK (("cases"."status" IN ('awaiting_game', 'not_measurable')) = ("cases"."status_reason" IS NOT NULL)),
	CONSTRAINT "cases_awaiting_reason_check" CHECK ("cases"."status_reason" IS NULL OR ("cases"."status" = 'awaiting_game') = ("cases"."status_reason" IN ('game_not_played_yet', 'statistics_pending', 'mapping_not_established', 'baseline_building', 'precedence_to_verify', 'dating_to_verify'))),
	CONSTRAINT "cases_measurement_check" CHECK ("cases"."status" NOT IN ('measured', 'excluded') OR ("cases"."measured_game_id", "cases"."performance_index", "cases"."baseline_season", "cases"."baseline_phase", "cases"."baseline_game_count", "cases"."baseline_mean", "cases"."baseline_standard_deviation", "cases"."baseline_status", "cases"."baseline_is_partial", "cases"."normalized_gap", "cases"."gap_status") IS NOT NULL),
	CONSTRAINT "cases_gameless_reason_check" CHECK (NOT ("cases"."status_reason" IN ('season_not_covered', 'no_game_within_window', 'precedence_not_established', 'mapping_not_established', 'precedence_to_verify', 'dating_to_verify')) OR "cases"."measured_game_id" IS NULL),
	CONSTRAINT "cases_game_reason_check" CHECK (NOT ("cases"."status_reason" IN ('box_score_incomplete', 'box_score_suspect', 'box_score_unavailable', 'insufficient_baseline', 'derived_game_missed', 'baseline_building')) OR "cases"."measured_game_id" IS NOT NULL),
	CONSTRAINT "cases_reference_instant_check" CHECK (("cases"."reference_instant_origin" = 'known_in_advance') = ("cases"."reference_instant_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "deleted_player_entries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "deleted_player_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"fingerprint" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deleted_player_entries_fingerprint_key" UNIQUE("fingerprint"),
	CONSTRAINT "deleted_player_entries_fingerprint_check" CHECK (octet_length("deleted_player_entries"."fingerprint") = 32)
);
--> statement-breakpoint
CREATE TABLE "event_corrections" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_corrections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_event_id" integer NOT NULL,
	"corrected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"field" text NOT NULL,
	"before_value" text,
	"after_value" text,
	CONSTRAINT "event_corrections_field_check" CHECK ("event_corrections"."field" IN ('player', 'event_type', 'reference_date', 'description', 'sources', 'injury_return', 'game_stakes', 'research_confidence', 'unverified_note', 'article_detached', 'event_merged_in', 'player_added', 'rescued')),
	CONSTRAINT "event_corrections_values_check" CHECK ("event_corrections"."field" NOT IN ('description', 'unverified_note', 'sources', 'article_detached', 'event_merged_in', 'player_added', 'rescued') OR ("event_corrections"."before_value" IS NULL AND "event_corrections"."after_value" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "event_import_warnings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_import_warnings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_event_id" integer NOT NULL,
	"import_id" integer,
	"kind" text NOT NULL,
	"field" text,
	"source_drop_cause" text,
	"related_position" smallint,
	"related_player_event_id" integer,
	CONSTRAINT "event_import_warnings_kind_check" CHECK ("event_import_warnings"."kind" IN ('attached_to_surviving_type', 'type_not_declared_covered', 'outside_declared_period', 'possible_statistics', 'source_dropped', 'source_outlet_or_title_missing', 'confidence_defaulted', 'context_defaulted', 'text_too_long_ignored', 'text_quotation_mark_ignored', 'shared_link', 'non_standard_date', 'time_ignored', 'possible_citation_marker')),
	CONSTRAINT "event_import_warnings_source_drop_cause_check" CHECK ("event_import_warnings"."source_drop_cause" IN ('incomplete_address', 'home_page', 'disallowed_domain', 'publication_date_missing', 'publication_date_malformed', 'publication_date_in_future')),
	CONSTRAINT "event_import_warnings_source_dropped_check" CHECK (("event_import_warnings"."kind" = 'source_dropped') = ("event_import_warnings"."source_drop_cause" IS NOT NULL)),
	CONSTRAINT "event_import_warnings_source_position_check" CHECK (("event_import_warnings"."kind" IN ('source_dropped', 'source_outlet_or_title_missing')) = ("event_import_warnings"."related_position" IS NOT NULL)),
	CONSTRAINT "event_import_warnings_shared_link_check" CHECK (("event_import_warnings"."kind" = 'shared_link') = ("event_import_warnings"."related_player_event_id" IS NOT NULL)),
	CONSTRAINT "event_import_warnings_text_field_check" CHECK (("event_import_warnings"."kind" IN ('possible_statistics', 'text_too_long_ignored', 'text_quotation_mark_ignored', 'possible_citation_marker')) = ("event_import_warnings"."field" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "event_marks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_marks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_event_id" integer NOT NULL,
	"mark" text NOT NULL,
	"status" text DEFAULT 'set' NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "event_marks_event_mark_key" UNIQUE("player_event_id","mark"),
	CONSTRAINT "event_marks_mark_check" CHECK ("event_marks"."mark" IN ('dating_to_verify', 'possible_historical_duplicate', 'description_to_review')),
	CONSTRAINT "event_marks_status_check" CHECK ("event_marks"."status" IN ('set', 'lifted'))
);
--> statement-breakpoint
CREATE TABLE "event_sources" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_sources_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_event_id" integer NOT NULL,
	"position" smallint NOT NULL,
	"url" text NOT NULL,
	"cleaned_url" text NOT NULL,
	"outlet" text,
	"title" text,
	"publication_date_on" date NOT NULL,
	"publication_at" timestamp with time zone,
	"publication_offset_minutes" smallint,
	"publication_precision" text,
	"added_by_import_id" integer,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"link_status" text,
	"link_checked_at" timestamp with time zone,
	"spot_check_verdict" text,
	CONSTRAINT "event_sources_publication_precision_check" CHECK ("event_sources"."publication_precision" IN ('exact', 'approximate')),
	CONSTRAINT "event_sources_link_status_check" CHECK ("event_sources"."link_status" IN ('not_found')),
	CONSTRAINT "event_sources_spot_check_verdict_check" CHECK ("event_sources"."spot_check_verdict" IN ('consistent', 'inconsistent', 'inaccessible')),
	CONSTRAINT "event_sources_publication_check" CHECK (CASE WHEN "event_sources"."publication_precision" IS NULL THEN ("event_sources"."publication_at" IS NULL) = ("event_sources"."publication_offset_minutes" IS NULL) ELSE "event_sources"."publication_at" IS NOT NULL END)
);
--> statement-breakpoint
CREATE TABLE "event_status_changes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_status_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_event_id" integer NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"to_status" text NOT NULL,
	"dismissal_reason" text,
	"dismissal_comment" text,
	CONSTRAINT "event_status_changes_to_status_check" CHECK ("event_status_changes"."to_status" IN ('detected', 'dismissed')),
	CONSTRAINT "event_status_changes_dismissal_reason_check" CHECK ("event_status_changes"."dismissal_reason" IN ('not_an_event', 'no_validated_type_fits', 'old_fact', 'non_public_or_unverifiable', 'duplicate_of_historical_event', 'other')),
	CONSTRAINT "event_status_changes_dismissed_check" CHECK ("event_status_changes"."to_status" <> 'dismissed' OR "event_status_changes"."dismissal_reason" IS NOT NULL),
	CONSTRAINT "event_status_changes_dismissal_comment_check" CHECK ("event_status_changes"."dismissal_reason" <> 'other' OR "event_status_changes"."dismissal_comment" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" uuid NOT NULL,
	"event_type_id" text NOT NULL,
	"sheet_event_type_id" text NOT NULL,
	"sheet_version_number" smallint NOT NULL,
	"origin" text NOT NULL,
	"type_link_mark" text,
	"reference_date_on" date,
	"reference_at" timestamp with time zone,
	"reference_offset_minutes" smallint,
	"reference_date_precision" text,
	"description" text NOT NULL,
	"injury_return" text DEFAULT 'unknown' NOT NULL,
	"injury_return_origin" text,
	"game_stakes" text DEFAULT 'unknown' NOT NULL,
	"game_stakes_origin" text,
	"case_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"research_confidence" text,
	"unverified_note" text,
	"precedence" text,
	"origin_import_id" integer,
	"detected_status" text,
	"dismissal_reason" text,
	"dismissal_comment" text,
	"dismissed_at" timestamp with time zone,
	"detection_confidence" smallint,
	"reference_date_rule" text,
	"classification_origin" text,
	"derived_game_id" integer,
	CONSTRAINT "events_origin_check" CHECK ("events"."origin" IN ('detected', 'historical', 'calendar')),
	CONSTRAINT "events_type_link_mark_check" CHECK ("events"."type_link_mark" IN ('to_requalify', 'to_distribute')),
	CONSTRAINT "events_reference_date_precision_check" CHECK ("events"."reference_date_precision" IN ('exact', 'approximate', 'none')),
	CONSTRAINT "events_injury_return_check" CHECK ("events"."injury_return" IN ('yes', 'no', 'unknown')),
	CONSTRAINT "events_injury_return_origin_check" CHECK ("events"."injury_return_origin" IN ('research', 'classification', 'user')),
	CONSTRAINT "events_game_stakes_check" CHECK ("events"."game_stakes" IN ('high', 'normal', 'unknown')),
	CONSTRAINT "events_game_stakes_origin_check" CHECK ("events"."game_stakes_origin" IN ('research', 'classification', 'user')),
	CONSTRAINT "events_research_confidence_check" CHECK ("events"."research_confidence" IN ('high', 'medium', 'low')),
	CONSTRAINT "events_precedence_check" CHECK ("events"."precedence" IN ('established', 'uncertain', 'not_established', 'to_verify')),
	CONSTRAINT "events_detected_status_check" CHECK ("events"."detected_status" IN ('detected', 'dismissed')),
	CONSTRAINT "events_dismissal_reason_check" CHECK ("events"."dismissal_reason" IN ('not_an_event', 'no_validated_type_fits', 'old_fact', 'non_public_or_unverifiable', 'duplicate_of_historical_event', 'other')),
	CONSTRAINT "events_detection_confidence_check" CHECK ("events"."detection_confidence" BETWEEN 0 AND 100),
	CONSTRAINT "events_reference_date_rule_check" CHECK ("events"."reference_date_rule" IN ('earliest_source', 'coverage_threshold')),
	CONSTRAINT "events_classification_origin_check" CHECK ("events"."classification_origin" IN ('model', 'user')),
	CONSTRAINT "events_historical_check" CHECK ("events"."origin" <> 'historical' OR (("events"."reference_date_on", "events"."reference_date_precision", "events"."research_confidence", "events"."precedence", "events"."origin_import_id") IS NOT NULL AND ("events"."reference_at" IS NULL) = ("events"."reference_offset_minutes" IS NULL) AND "events"."reference_date_precision" = CASE WHEN "events"."reference_at" IS NULL THEN 'approximate' ELSE 'exact' END AND ("events"."detected_status", "events"."dismissal_reason", "events"."dismissal_comment", "events"."dismissed_at", "events"."detection_confidence", "events"."reference_date_rule", "events"."classification_origin", "events"."derived_game_id") IS NULL)),
	CONSTRAINT "events_detected_check" CHECK ("events"."origin" <> 'detected' OR (("events"."detected_status", "events"."reference_at", "events"."reference_date_precision", "events"."reference_date_rule", "events"."classification_origin") IS NOT NULL AND ("events"."reference_date_on", "events"."reference_offset_minutes", "events"."research_confidence", "events"."unverified_note", "events"."precedence", "events"."origin_import_id", "events"."derived_game_id") IS NULL)),
	CONSTRAINT "events_calendar_check" CHECK ("events"."origin" <> 'calendar' OR (("events"."derived_game_id", "events"."reference_date_on") IS NOT NULL AND ("events"."reference_at", "events"."reference_offset_minutes", "events"."reference_date_precision", "events"."type_link_mark", "events"."research_confidence", "events"."unverified_note", "events"."precedence", "events"."origin_import_id", "events"."detected_status", "events"."dismissal_reason", "events"."dismissal_comment", "events"."dismissed_at", "events"."detection_confidence", "events"."reference_date_rule", "events"."classification_origin") IS NULL)),
	CONSTRAINT "events_dismissed_check" CHECK (("events"."detected_status" = 'dismissed') = ("events"."dismissal_reason" IS NOT NULL AND "events"."dismissed_at" IS NOT NULL)),
	CONSTRAINT "events_dismissal_comment_check" CHECK ("events"."dismissal_reason" <> 'other' OR "events"."dismissal_comment" IS NOT NULL),
	CONSTRAINT "events_injury_return_with_origin_check" CHECK ("events"."injury_return" = 'unknown' OR "events"."injury_return_origin" IS NOT NULL),
	CONSTRAINT "events_game_stakes_with_origin_check" CHECK ("events"."game_stakes" = 'unknown' OR "events"."game_stakes_origin" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "general_trends" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "general_trends_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_type_id" text NOT NULL,
	"view" text NOT NULL,
	"event_count" integer NOT NULL,
	"case_count" integer NOT NULL,
	"grouped_event_count" integer NOT NULL,
	"awaiting_count" integer NOT NULL,
	"valid_count" integer NOT NULL,
	"excluded_count" integer NOT NULL,
	"manually_excluded_count" integer NOT NULL,
	"not_measurable_count" integer NOT NULL,
	"co_occurring_count" integer NOT NULL,
	"provisional_gap_count" integer NOT NULL,
	"historical_valid_count" integer NOT NULL,
	"tracked_valid_count" integer NOT NULL,
	"tally_reasons" jsonb NOT NULL,
	"exit_counts" jsonb NOT NULL,
	"low_research_confidence_count" integer NOT NULL,
	"mean_gap" double precision,
	"gap_dispersion" double precision,
	"retained_dispersion" double precision,
	"expected_noise" double precision,
	"signal_to_noise" double precision,
	"range_low" double precision,
	"range_high" double precision,
	"above_zero_count" integer NOT NULL,
	"below_zero_count" integer NOT NULL,
	"verdict_level" text NOT NULL,
	"verdict_direction" text,
	"is_fragile" boolean NOT NULL,
	"profile_confidence" text NOT NULL,
	"confidence_step_down_reasons" text[] DEFAULT '{}' NOT NULL,
	"control_case_count" integer NOT NULL,
	"control_mean_gap" double precision,
	"control_range_low" double precision,
	"control_range_high" double precision,
	"control_verdict_level" text NOT NULL,
	"control_verdict_direction" text,
	"depends_on_manual_exclusions" boolean NOT NULL,
	"valid_case_threshold" smallint NOT NULL,
	"parameter_snapshot_id" integer NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"distinct_player_count" integer NOT NULL,
	"top_contributor_valid_count" integer NOT NULL,
	CONSTRAINT "general_trends_key" UNIQUE("event_type_id","view"),
	CONSTRAINT "general_trends_view_check" CHECK ("general_trends"."view" IN ('all_cases', 'historical_only', 'tracked_only')),
	CONSTRAINT "general_trends_verdict_level_check" CHECK ("general_trends"."verdict_level" IN ('inconclusive', 'possible', 'probable')),
	CONSTRAINT "general_trends_verdict_direction_check" CHECK ("general_trends"."verdict_direction" IN ('increase', 'decrease')),
	CONSTRAINT "general_trends_profile_confidence_check" CHECK ("general_trends"."profile_confidence" IN ('low', 'medium', 'high')),
	CONSTRAINT "general_trends_confidence_step_down_reasons_check" CHECK ("general_trends"."confidence_step_down_reasons" <@ ARRAY['high_dispersion', 'high_doubtful_share', 'fragile_verdict', 'dominant_player']),
	CONSTRAINT "general_trends_control_verdict_level_check" CHECK ("general_trends"."control_verdict_level" IN ('inconclusive', 'possible', 'probable')),
	CONSTRAINT "general_trends_control_verdict_direction_check" CHECK ("general_trends"."control_verdict_direction" IN ('increase', 'decrease')),
	CONSTRAINT "general_trends_event_count_check" CHECK ("general_trends"."event_count" = "general_trends"."case_count" + "general_trends"."grouped_event_count"),
	CONSTRAINT "general_trends_case_count_check" CHECK ("general_trends"."case_count" = "general_trends"."awaiting_count" + "general_trends"."valid_count" + "general_trends"."excluded_count" + "general_trends"."not_measurable_count"),
	CONSTRAINT "general_trends_valid_count_check" CHECK ("general_trends"."valid_count" = "general_trends"."historical_valid_count" + "general_trends"."tracked_valid_count"),
	CONSTRAINT "general_trends_verdict_check" CHECK (("general_trends"."verdict_level" = 'inconclusive') = ("general_trends"."verdict_direction" IS NULL)),
	CONSTRAINT "general_trends_control_verdict_check" CHECK (("general_trends"."control_verdict_level" = 'inconclusive') = ("general_trends"."control_verdict_direction" IS NULL)),
	CONSTRAINT "general_trends_mean_gap_check" CHECK (("general_trends"."valid_count" = 0) = ("general_trends"."mean_gap" IS NULL)),
	CONSTRAINT "general_trends_gap_dispersion_check" CHECK (("general_trends"."valid_count" < 2) = ("general_trends"."gap_dispersion" IS NULL)),
	CONSTRAINT "general_trends_control_range_check" CHECK (("general_trends"."control_range_low" IS NULL) = ("general_trends"."control_mean_gap" IS NULL) AND ("general_trends"."control_range_high" IS NULL) = ("general_trends"."control_mean_gap" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "import_event_outcomes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "import_event_outcomes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"import_id" integer NOT NULL,
	"position" integer,
	"outcome" text NOT NULL,
	"player_event_id" integer,
	"event_type_as_read" text,
	"date_as_read" text,
	"reason" text,
	CONSTRAINT "import_event_outcomes_position_check" CHECK ("import_event_outcomes"."position" >= 1),
	CONSTRAINT "import_event_outcomes_outcome_check" CHECK ("import_event_outcomes"."outcome" IN ('added', 'added_with_warning', 'duplicate_not_added', 'ignored', 'refused')),
	CONSTRAINT "import_event_outcomes_ignore_reason_check" CHECK ("import_event_outcomes"."outcome" <> 'ignored' OR "import_event_outcomes"."reason" IN ('type_not_validated', 'type_not_requested', 'outside_requested_period', 'before_first_nba_game', 'calendar_derived_type', 'split_type_ignored')),
	CONSTRAINT "import_event_outcomes_refusal_reason_check" CHECK ("import_event_outcomes"."outcome" <> 'refused' OR "import_event_outcomes"."reason" IN ('type_missing', 'type_unknown', 'public_date_missing', 'public_date_malformed', 'public_date_nonexistent', 'description_missing', 'description_too_long', 'description_quotation_mark', 'no_valid_source', 'source_before_public_date')),
	CONSTRAINT "import_event_outcomes_set_aside_check" CHECK (("import_event_outcomes"."outcome" IN ('ignored', 'refused')) = ("import_event_outcomes"."reason" IS NOT NULL) AND ("import_event_outcomes"."outcome" IN ('ignored', 'refused')) = ("import_event_outcomes"."position" IS NOT NULL) AND ("import_event_outcomes"."outcome" NOT IN ('ignored', 'refused') OR "import_event_outcomes"."player_event_id" IS NULL)),
	CONSTRAINT "import_event_outcomes_recorded_check" CHECK ("import_event_outcomes"."outcome" NOT IN ('added', 'added_with_warning', 'duplicate_not_added') OR ("import_event_outcomes"."event_type_as_read", "import_event_outcomes"."date_as_read", "import_event_outcomes"."reason") IS NULL)
);
--> statement-breakpoint
CREATE TABLE "import_possible_duplicates" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "import_possible_duplicates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"import_id" integer NOT NULL,
	"result_player_event_id" integer,
	"existing_player_event_id" integer,
	"answer" text NOT NULL,
	CONSTRAINT "import_possible_duplicates_answer_check" CHECK ("import_possible_duplicates"."answer" IN ('same_fact', 'distinct_facts', 'keep_as_distinct'))
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "imports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"sequence_number" integer NOT NULL,
	"backtest_request_id" integer NOT NULL,
	"player_id" uuid NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mode" text NOT NULL,
	"format_version" text DEFAULT '1.0' NOT NULL,
	"truncation_recovered" boolean DEFAULT false NOT NULL,
	"declared_limitations" text[] DEFAULT '{}' NOT NULL,
	"unverified_lead_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"coverage_gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deleted_by_replacement_count" integer DEFAULT 0 NOT NULL,
	"deleted_corrected_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "imports_sequence_number_key" UNIQUE("sequence_number"),
	CONSTRAINT "imports_mode_check" CHECK ("imports"."mode" IN ('first_import', 'addition', 'replacement')),
	CONSTRAINT "imports_format_version_check" CHECK ("imports"."format_version" IN ('1.0'))
);
--> statement-breakpoint
CREATE TABLE "profile_value_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "profile_value_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"sensitivity_profile_id" integer,
	"general_trend_id" integer,
	"effective_at" timestamp with time zone NOT NULL,
	"valid_count" integer NOT NULL,
	"mean_gap" double precision,
	"verdict_level" text NOT NULL,
	"verdict_direction" text,
	"profile_confidence" text NOT NULL,
	CONSTRAINT "profile_value_versions_verdict_level_check" CHECK ("profile_value_versions"."verdict_level" IN ('inconclusive', 'possible', 'probable')),
	CONSTRAINT "profile_value_versions_verdict_direction_check" CHECK ("profile_value_versions"."verdict_direction" IN ('increase', 'decrease')),
	CONSTRAINT "profile_value_versions_profile_confidence_check" CHECK ("profile_value_versions"."profile_confidence" IN ('low', 'medium', 'high')),
	CONSTRAINT "profile_value_versions_subject_check" CHECK (("profile_value_versions"."sensitivity_profile_id" IS NULL) <> ("profile_value_versions"."general_trend_id" IS NULL)),
	CONSTRAINT "profile_value_versions_verdict_check" CHECK (("profile_value_versions"."verdict_level" = 'inconclusive') = ("profile_value_versions"."verdict_direction" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "recalculation_jobs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "recalculation_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scope" text NOT NULL,
	"player_ids" uuid[],
	"event_type_ids" text[],
	"game_ids" integer[],
	"cause" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"progress_cursor" text,
	"parameter_snapshot_id" integer,
	CONSTRAINT "recalculation_jobs_scope_check" CHECK ("recalculation_jobs"."scope" IN ('import', 'statistics_update', 'event_or_case_change', 'full')),
	CONSTRAINT "recalculation_jobs_cause_check" CHECK ("recalculation_jobs"."cause" IN ('new_cases', 'stats_correction', 'baseline_updated', 'manual_decision', 'event_dismissed', 'parameter_change', 'recalculation', 'event_corrected_or_removed', 'event_reinstated', 'taxonomy_changed')),
	CONSTRAINT "recalculation_jobs_status_check" CHECK ("recalculation_jobs"."status" IN ('pending', 'running')),
	CONSTRAINT "recalculation_jobs_full_scope_check" CHECK (("recalculation_jobs"."scope" = 'full') = ("recalculation_jobs"."player_ids" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "sensitivity_profiles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sensitivity_profiles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" uuid NOT NULL,
	"event_type_id" text NOT NULL,
	"view" text NOT NULL,
	"event_count" integer NOT NULL,
	"case_count" integer NOT NULL,
	"grouped_event_count" integer NOT NULL,
	"awaiting_count" integer NOT NULL,
	"valid_count" integer NOT NULL,
	"excluded_count" integer NOT NULL,
	"manually_excluded_count" integer NOT NULL,
	"not_measurable_count" integer NOT NULL,
	"co_occurring_count" integer NOT NULL,
	"provisional_gap_count" integer NOT NULL,
	"historical_valid_count" integer NOT NULL,
	"tracked_valid_count" integer NOT NULL,
	"tally_reasons" jsonb NOT NULL,
	"exit_counts" jsonb NOT NULL,
	"low_research_confidence_count" integer NOT NULL,
	"mean_gap" double precision,
	"gap_dispersion" double precision,
	"retained_dispersion" double precision,
	"expected_noise" double precision,
	"signal_to_noise" double precision,
	"range_low" double precision,
	"range_high" double precision,
	"above_zero_count" integer NOT NULL,
	"below_zero_count" integer NOT NULL,
	"verdict_level" text NOT NULL,
	"verdict_direction" text,
	"is_fragile" boolean NOT NULL,
	"profile_confidence" text NOT NULL,
	"confidence_step_down_reasons" text[] DEFAULT '{}' NOT NULL,
	"control_case_count" integer NOT NULL,
	"control_mean_gap" double precision,
	"control_range_low" double precision,
	"control_range_high" double precision,
	"control_verdict_level" text NOT NULL,
	"control_verdict_direction" text,
	"depends_on_manual_exclusions" boolean NOT NULL,
	"valid_case_threshold" smallint NOT NULL,
	"parameter_snapshot_id" integer NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sensitivity_profiles_key" UNIQUE("player_id","event_type_id","view"),
	CONSTRAINT "sensitivity_profiles_view_check" CHECK ("sensitivity_profiles"."view" IN ('all_cases', 'historical_only', 'tracked_only')),
	CONSTRAINT "sensitivity_profiles_verdict_level_check" CHECK ("sensitivity_profiles"."verdict_level" IN ('inconclusive', 'possible', 'probable')),
	CONSTRAINT "sensitivity_profiles_verdict_direction_check" CHECK ("sensitivity_profiles"."verdict_direction" IN ('increase', 'decrease')),
	CONSTRAINT "sensitivity_profiles_profile_confidence_check" CHECK ("sensitivity_profiles"."profile_confidence" IN ('low', 'medium', 'high')),
	CONSTRAINT "sensitivity_profiles_confidence_step_down_reasons_check" CHECK ("sensitivity_profiles"."confidence_step_down_reasons" <@ ARRAY['high_dispersion', 'high_doubtful_share', 'fragile_verdict']),
	CONSTRAINT "sensitivity_profiles_control_verdict_level_check" CHECK ("sensitivity_profiles"."control_verdict_level" IN ('inconclusive', 'possible', 'probable')),
	CONSTRAINT "sensitivity_profiles_control_verdict_direction_check" CHECK ("sensitivity_profiles"."control_verdict_direction" IN ('increase', 'decrease')),
	CONSTRAINT "sensitivity_profiles_event_count_check" CHECK ("sensitivity_profiles"."event_count" = "sensitivity_profiles"."case_count" + "sensitivity_profiles"."grouped_event_count"),
	CONSTRAINT "sensitivity_profiles_case_count_check" CHECK ("sensitivity_profiles"."case_count" = "sensitivity_profiles"."awaiting_count" + "sensitivity_profiles"."valid_count" + "sensitivity_profiles"."excluded_count" + "sensitivity_profiles"."not_measurable_count"),
	CONSTRAINT "sensitivity_profiles_valid_count_check" CHECK ("sensitivity_profiles"."valid_count" = "sensitivity_profiles"."historical_valid_count" + "sensitivity_profiles"."tracked_valid_count"),
	CONSTRAINT "sensitivity_profiles_verdict_check" CHECK (("sensitivity_profiles"."verdict_level" = 'inconclusive') = ("sensitivity_profiles"."verdict_direction" IS NULL)),
	CONSTRAINT "sensitivity_profiles_control_verdict_check" CHECK (("sensitivity_profiles"."control_verdict_level" = 'inconclusive') = ("sensitivity_profiles"."control_verdict_direction" IS NULL)),
	CONSTRAINT "sensitivity_profiles_mean_gap_check" CHECK (("sensitivity_profiles"."valid_count" = 0) = ("sensitivity_profiles"."mean_gap" IS NULL)),
	CONSTRAINT "sensitivity_profiles_gap_dispersion_check" CHECK (("sensitivity_profiles"."valid_count" < 2) = ("sensitivity_profiles"."gap_dispersion" IS NULL)),
	CONSTRAINT "sensitivity_profiles_control_range_check" CHECK (("sensitivity_profiles"."control_range_low" IS NULL) = ("sensitivity_profiles"."control_mean_gap" IS NULL) AND ("sensitivity_profiles"."control_range_high" IS NULL) = ("sensitivity_profiles"."control_mean_gap" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "tally_exits" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tally_exits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" uuid NOT NULL,
	"event_type_id" text NOT NULL,
	"exit_reason" text NOT NULL,
	"exited_at" timestamp with time zone,
	"import_id" integer,
	"deletion_reason" text,
	"deletion_detail" text,
	"public_date_on" date,
	"public_at" timestamp with time zone,
	CONSTRAINT "tally_exits_exit_reason_check" CHECK ("tally_exits"."exit_reason" IN ('merged', 'deleted', 'replaced_at_import', 'erased', 'no_longer_derived')),
	CONSTRAINT "tally_exits_deletion_reason_check" CHECK ("tally_exits"."deletion_reason" IN ('inaccurate_fact_or_false_source', 'outside_type_criteria', 'duplicate', 'other')),
	CONSTRAINT "tally_exits_deleted_check" CHECK (("tally_exits"."exit_reason" = 'deleted') = ("tally_exits"."deletion_reason" IS NOT NULL AND "tally_exits"."public_date_on" IS NOT NULL AND "tally_exits"."exited_at" IS NOT NULL)),
	CONSTRAINT "tally_exits_dated_check" CHECK ("tally_exits"."exited_at" IS NULL OR "tally_exits"."exit_reason" = 'deleted'),
	CONSTRAINT "tally_exits_deletion_detail_check" CHECK (("tally_exits"."deletion_detail" IS NOT NULL) = ("tally_exits"."deletion_reason" IS NOT DISTINCT FROM 'other')),
	CONSTRAINT "tally_exits_import_check" CHECK ("tally_exits"."import_id" IS NULL OR "tally_exits"."exit_reason" = 'replaced_at_import')
);
--> statement-breakpoint
CREATE TABLE "verdict_history_entries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "verdict_history_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"sensitivity_profile_id" integer,
	"general_trend_id" integer,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"old_verdict_level" text NOT NULL,
	"old_verdict_direction" text,
	"old_profile_confidence" text NOT NULL,
	"new_verdict_level" text NOT NULL,
	"new_verdict_direction" text,
	"new_profile_confidence" text NOT NULL,
	"cause" text NOT NULL,
	CONSTRAINT "verdict_history_entries_old_verdict_level_check" CHECK ("verdict_history_entries"."old_verdict_level" IN ('inconclusive', 'possible', 'probable')),
	CONSTRAINT "verdict_history_entries_old_verdict_direction_check" CHECK ("verdict_history_entries"."old_verdict_direction" IN ('increase', 'decrease')),
	CONSTRAINT "verdict_history_entries_old_profile_confidence_check" CHECK ("verdict_history_entries"."old_profile_confidence" IN ('low', 'medium', 'high')),
	CONSTRAINT "verdict_history_entries_new_verdict_level_check" CHECK ("verdict_history_entries"."new_verdict_level" IN ('inconclusive', 'possible', 'probable')),
	CONSTRAINT "verdict_history_entries_new_verdict_direction_check" CHECK ("verdict_history_entries"."new_verdict_direction" IN ('increase', 'decrease')),
	CONSTRAINT "verdict_history_entries_new_profile_confidence_check" CHECK ("verdict_history_entries"."new_profile_confidence" IN ('low', 'medium', 'high')),
	CONSTRAINT "verdict_history_entries_cause_check" CHECK ("verdict_history_entries"."cause" IN ('new_cases', 'stats_correction', 'baseline_updated', 'manual_decision', 'event_dismissed', 'parameter_change', 'recalculation', 'event_corrected_or_removed', 'event_reinstated', 'taxonomy_changed')),
	CONSTRAINT "verdict_history_entries_subject_check" CHECK (("verdict_history_entries"."sensitivity_profile_id" IS NULL) <> ("verdict_history_entries"."general_trend_id" IS NULL)),
	CONSTRAINT "verdict_history_entries_change_check" CHECK (("verdict_history_entries"."old_verdict_level", "verdict_history_entries"."old_verdict_direction", "verdict_history_entries"."old_profile_confidence") IS DISTINCT FROM ("verdict_history_entries"."new_verdict_level", "verdict_history_entries"."new_verdict_direction", "verdict_history_entries"."new_profile_confidence"))
);
--> statement-breakpoint
CREATE TABLE "withdrawal_fingerprints" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "withdrawal_fingerprints_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"fingerprint" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawal_fingerprints_fingerprint_key" UNIQUE("fingerprint"),
	CONSTRAINT "withdrawal_fingerprints_fingerprint_check" CHECK (octet_length("withdrawal_fingerprints"."fingerprint") = 32)
);
--> statement-breakpoint
CREATE TABLE "withdrawn_event_counter" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "withdrawn_event_counter_id_check" CHECK ("withdrawn_event_counter"."id" = 1),
	CONSTRAINT "withdrawn_event_counter_value_check" CHECK ("withdrawn_event_counter"."value" >= 0)
);
--> statement-breakpoint
ALTER TABLE "event_types" DROP CONSTRAINT "event_types_name_check";--> statement-breakpoint
ALTER TABLE "event_types" DROP CONSTRAINT "event_types_merged_into_check";--> statement-breakpoint
ALTER TABLE "event_types" DROP CONSTRAINT "event_types_entered_reason_check";--> statement-breakpoint
ALTER TABLE "followed_players" DROP CONSTRAINT "followed_players_display_name_check";--> statement-breakpoint
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_case_reference_check";--> statement-breakpoint
ALTER TABLE "mapping_candidates" DROP CONSTRAINT "mapping_candidates_first_season_check";--> statement-breakpoint
ALTER TABLE "mapping_candidates" DROP CONSTRAINT "mapping_candidates_last_season_check";--> statement-breakpoint
ALTER TABLE "player_name_variants" DROP CONSTRAINT "player_name_variants_text_check";--> statement-breakpoint
ALTER TABLE "seasons" DROP CONSTRAINT "seasons_season_check";--> statement-breakpoint
ALTER TABLE "backtest_coverage_periods" ADD CONSTRAINT "backtest_coverage_periods_player_id_followed_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."followed_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_coverage_periods" ADD CONSTRAINT "backtest_coverage_periods_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_coverage_periods" ADD CONSTRAINT "backtest_coverage_periods_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_request_events" ADD CONSTRAINT "backtest_request_events_player_event_id_events_id_fk" FOREIGN KEY ("player_event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_request_events" ADD CONSTRAINT "backtest_request_events_backtest_request_id_fk" FOREIGN KEY ("backtest_request_id") REFERENCES "public"."backtest_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_request_types" ADD CONSTRAINT "backtest_request_types_backtest_request_id_fk" FOREIGN KEY ("backtest_request_id") REFERENCES "public"."backtest_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_request_types" ADD CONSTRAINT "backtest_request_types_sheet_version_fk" FOREIGN KEY ("event_type_id","sheet_version_number") REFERENCES "public"."type_sheet_versions"("event_type_id","version_number") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_requests" ADD CONSTRAINT "backtest_requests_player_id_followed_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."followed_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_requests" ADD CONSTRAINT "backtest_requests_trigger_event_type_id_event_types_id_fk" FOREIGN KEY ("trigger_event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_requests" ADD CONSTRAINT "backtest_requests_trigger_import_id_imports_id_fk" FOREIGN KEY ("trigger_import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_derivation_requests" ADD CONSTRAINT "calendar_derivation_requests_player_id_followed_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."followed_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_derivation_requests" ADD CONSTRAINT "calendar_derivation_requests_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_history_entries" ADD CONSTRAINT "case_history_entries_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_history_entries" ADD CONSTRAINT "case_history_entries_measured_game_id_games_id_fk" FOREIGN KEY ("measured_game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_manual_decisions" ADD CONSTRAINT "case_manual_decisions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_manual_decisions" ADD CONSTRAINT "case_manual_decisions_measured_game_id_games_id_fk" FOREIGN KEY ("measured_game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_review_flags" ADD CONSTRAINT "case_review_flags_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_review_flags" ADD CONSTRAINT "case_review_flags_measured_game_id_games_id_fk" FOREIGN KEY ("measured_game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_triggered_criteria" ADD CONSTRAINT "case_triggered_criteria_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_player_id_followed_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."followed_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_measured_game_id_games_id_fk" FOREIGN KEY ("measured_game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_corrections" ADD CONSTRAINT "event_corrections_player_event_id_events_id_fk" FOREIGN KEY ("player_event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_import_warnings" ADD CONSTRAINT "event_import_warnings_player_event_id_events_id_fk" FOREIGN KEY ("player_event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_import_warnings" ADD CONSTRAINT "event_import_warnings_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_import_warnings" ADD CONSTRAINT "event_import_warnings_related_player_event_id_events_id_fk" FOREIGN KEY ("related_player_event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_marks" ADD CONSTRAINT "event_marks_player_event_id_events_id_fk" FOREIGN KEY ("player_event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_player_event_id_events_id_fk" FOREIGN KEY ("player_event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_added_by_import_id_imports_id_fk" FOREIGN KEY ("added_by_import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_status_changes" ADD CONSTRAINT "event_status_changes_player_event_id_events_id_fk" FOREIGN KEY ("player_event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_player_id_followed_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."followed_players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_origin_import_id_imports_id_fk" FOREIGN KEY ("origin_import_id") REFERENCES "public"."imports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_derived_game_id_games_id_fk" FOREIGN KEY ("derived_game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_sheet_version_fk" FOREIGN KEY ("sheet_event_type_id","sheet_version_number") REFERENCES "public"."type_sheet_versions"("event_type_id","version_number") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_case_fk" FOREIGN KEY ("case_id","player_id","event_type_id") REFERENCES "public"."cases"("id","player_id","event_type_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_trends" ADD CONSTRAINT "general_trends_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_trends" ADD CONSTRAINT "general_trends_parameter_snapshot_id_fk" FOREIGN KEY ("parameter_snapshot_id") REFERENCES "public"."parameter_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_event_outcomes" ADD CONSTRAINT "import_event_outcomes_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_event_outcomes" ADD CONSTRAINT "import_event_outcomes_player_event_id_events_id_fk" FOREIGN KEY ("player_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_possible_duplicates" ADD CONSTRAINT "import_possible_duplicates_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_possible_duplicates" ADD CONSTRAINT "import_possible_duplicates_result_player_event_id_events_id_fk" FOREIGN KEY ("result_player_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_possible_duplicates" ADD CONSTRAINT "import_possible_duplicates_existing_player_event_id_fk" FOREIGN KEY ("existing_player_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_backtest_request_id_backtest_requests_id_fk" FOREIGN KEY ("backtest_request_id") REFERENCES "public"."backtest_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_player_id_followed_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."followed_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_value_versions" ADD CONSTRAINT "profile_value_versions_general_trend_id_general_trends_id_fk" FOREIGN KEY ("general_trend_id") REFERENCES "public"."general_trends"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_value_versions" ADD CONSTRAINT "profile_value_versions_sensitivity_profile_id_fk" FOREIGN KEY ("sensitivity_profile_id") REFERENCES "public"."sensitivity_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recalculation_jobs" ADD CONSTRAINT "recalculation_jobs_parameter_snapshot_id_fk" FOREIGN KEY ("parameter_snapshot_id") REFERENCES "public"."parameter_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensitivity_profiles" ADD CONSTRAINT "sensitivity_profiles_player_id_followed_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."followed_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensitivity_profiles" ADD CONSTRAINT "sensitivity_profiles_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensitivity_profiles" ADD CONSTRAINT "sensitivity_profiles_parameter_snapshot_id_fk" FOREIGN KEY ("parameter_snapshot_id") REFERENCES "public"."parameter_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_exits" ADD CONSTRAINT "tally_exits_player_id_followed_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."followed_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_exits" ADD CONSTRAINT "tally_exits_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tally_exits" ADD CONSTRAINT "tally_exits_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdict_history_entries" ADD CONSTRAINT "verdict_history_entries_general_trend_id_general_trends_id_fk" FOREIGN KEY ("general_trend_id") REFERENCES "public"."general_trends"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdict_history_entries" ADD CONSTRAINT "verdict_history_entries_sensitivity_profile_id_fk" FOREIGN KEY ("sensitivity_profile_id") REFERENCES "public"."sensitivity_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backtest_coverage_periods_player_type_idx" ON "backtest_coverage_periods" USING btree ("player_id","event_type_id","start_on");--> statement-breakpoint
CREATE UNIQUE INDEX "backtest_requests_one_to_do_key" ON "backtest_requests" USING btree ("player_id") WHERE "backtest_requests"."status" = 'to_do';--> statement-breakpoint
CREATE INDEX "backtest_requests_to_do_idx" ON "backtest_requests" USING btree ("created_at") WHERE "backtest_requests"."status" = 'to_do';--> statement-breakpoint
CREATE INDEX "backtest_requests_copied_idx" ON "backtest_requests" USING btree ("last_copied_at") WHERE "backtest_requests"."status" = 'to_do';--> statement-breakpoint
CREATE INDEX "backtest_requests_player_idx" ON "backtest_requests" USING btree ("player_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_derivation_requests_scope_key" ON "calendar_derivation_requests" USING btree ("kind",coalesce("player_id"::text, ''),coalesce("event_type_id", '')) WHERE "calendar_derivation_requests"."lease_expires_at" IS NULL;--> statement-breakpoint
CREATE INDEX "case_history_entries_case_idx" ON "case_history_entries" USING btree ("case_id","recorded_at");--> statement-breakpoint
CREATE INDEX "case_manual_decisions_case_idx" ON "case_manual_decisions" USING btree ("case_id","decided_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cases_player_type_game_key" ON "cases" USING btree ("player_id","event_type_id","measured_game_id") WHERE "cases"."measured_game_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "cases_player_type_idx" ON "cases" USING btree ("player_id","event_type_id");--> statement-breakpoint
CREATE INDEX "cases_type_status_idx" ON "cases" USING btree ("event_type_id","status");--> statement-breakpoint
CREATE INDEX "cases_player_game_idx" ON "cases" USING btree ("player_id","measured_game_id");--> statement-breakpoint
CREATE INDEX "cases_player_baseline_season_idx" ON "cases" USING btree ("player_id","baseline_season");--> statement-breakpoint
CREATE INDEX "cases_awaiting_idx" ON "cases" USING btree ("status_reason") WHERE "cases"."status" = 'awaiting_game';--> statement-breakpoint
CREATE INDEX "event_corrections_event_idx" ON "event_corrections" USING btree ("player_event_id","corrected_at");--> statement-breakpoint
CREATE INDEX "event_import_warnings_event_idx" ON "event_import_warnings" USING btree ("player_event_id");--> statement-breakpoint
CREATE INDEX "event_import_warnings_related_idx" ON "event_import_warnings" USING btree ("related_player_event_id");--> statement-breakpoint
CREATE INDEX "event_sources_event_idx" ON "event_sources" USING btree ("player_event_id","position");--> statement-breakpoint
CREATE INDEX "event_sources_cleaned_url_idx" ON "event_sources" USING btree ("cleaned_url");--> statement-breakpoint
CREATE INDEX "event_sources_unchecked_idx" ON "event_sources" USING btree ("id") WHERE "event_sources"."link_checked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "events_calendar_game_key" ON "events" USING btree ("player_id","event_type_id","derived_game_id") WHERE "events"."origin" = 'calendar';--> statement-breakpoint
CREATE INDEX "events_case_idx" ON "events" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "events_player_type_idx" ON "events" USING btree ("player_id","event_type_id");--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("event_type_id") WHERE "events"."type_link_mark" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "events_player_reference_date_idx" ON "events" USING btree ("player_id","reference_date_on");--> statement-breakpoint
CREATE INDEX "events_player_reference_at_idx" ON "events" USING btree ("player_id","reference_at");--> statement-breakpoint
CREATE INDEX "events_origin_import_idx" ON "events" USING btree ("origin_import_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_event_outcomes_position_key" ON "import_event_outcomes" USING btree ("import_id","position") WHERE "import_event_outcomes"."position" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "import_event_outcomes_event_idx" ON "import_event_outcomes" USING btree ("player_event_id");--> statement-breakpoint
CREATE INDEX "import_possible_duplicates_event_idx" ON "import_possible_duplicates" USING btree ("existing_player_event_id");--> statement-breakpoint
CREATE INDEX "import_possible_duplicates_result_idx" ON "import_possible_duplicates" USING btree ("result_player_event_id");--> statement-breakpoint
CREATE INDEX "imports_player_idx" ON "imports" USING btree ("player_id","imported_at");--> statement-breakpoint
CREATE INDEX "imports_request_idx" ON "imports" USING btree ("backtest_request_id","imported_at");--> statement-breakpoint
CREATE INDEX "profile_value_versions_profile_idx" ON "profile_value_versions" USING btree ("sensitivity_profile_id","effective_at");--> statement-breakpoint
CREATE INDEX "profile_value_versions_trend_idx" ON "profile_value_versions" USING btree ("general_trend_id","effective_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recalculation_jobs_one_running_key" ON "recalculation_jobs" USING btree ((true)) WHERE "recalculation_jobs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "sensitivity_profiles_type_view_idx" ON "sensitivity_profiles" USING btree ("event_type_id","view");--> statement-breakpoint
CREATE INDEX "tally_exits_player_type_idx" ON "tally_exits" USING btree ("player_id","event_type_id");--> statement-breakpoint
CREATE INDEX "tally_exits_type_idx" ON "tally_exits" USING btree ("event_type_id");--> statement-breakpoint
CREATE INDEX "verdict_history_entries_profile_idx" ON "verdict_history_entries" USING btree ("sensitivity_profile_id","changed_at");--> statement-breakpoint
CREATE INDEX "verdict_history_entries_trend_idx" ON "verdict_history_entries" USING btree ("general_trend_id","changed_at");--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_backtest_request_id_backtest_requests_id_fk" FOREIGN KEY ("backtest_request_id") REFERENCES "public"."backtest_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_exploration_event_type_id_event_types_id_fk" FOREIGN KEY ("exploration_event_type_id") REFERENCES "public"."event_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_player_id_followed_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."followed_players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_player_event_id_events_id_fk" FOREIGN KEY ("player_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_backtest_request_id_backtest_requests_id_fk" FOREIGN KEY ("backtest_request_id") REFERENCES "public"."backtest_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_facts" ADD CONSTRAINT "outbox_facts_backtest_request_id_backtest_requests_id_fk" FOREIGN KEY ("backtest_request_id") REFERENCES "public"."backtest_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_facts" ADD CONSTRAINT "outbox_facts_deadline_game_id_games_id_fk" FOREIGN KEY ("deadline_game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_facts" ADD CONSTRAINT "outbox_facts_player_event_id_events_id_fk" FOREIGN KEY ("player_event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_facts" ADD CONSTRAINT "outbox_facts_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restore_report_events" ADD CONSTRAINT "restore_report_events_player_event_id_events_id_fk" FOREIGN KEY ("player_event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_name_check" CHECK ("event_types"."name" ~ '[^\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]');--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_merged_into_check" CHECK ("event_types"."merged_into_type_id" IS NULL OR "event_types"."withdrawal_reason_kind" IS NOT DISTINCT FROM 'merged_into');--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_entered_reason_check" CHECK (("event_types"."withdrawal_reason_kind" IS NOT DISTINCT FROM 'entered') = ("event_types"."withdrawal_reason" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "followed_players" ADD CONSTRAINT "followed_players_display_name_check" CHECK ("followed_players"."display_name" ~ '[^\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]');--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_case_reference_check" CHECK ("journal_entries"."case_id" IS NULL OR ("journal_entries"."player_id", "journal_entries"."event_type_id", "journal_entries"."backtest_request_id", "journal_entries"."import_id") IS NULL);--> statement-breakpoint
ALTER TABLE "mapping_candidates" ADD CONSTRAINT "mapping_candidates_first_season_check" CHECK (CASE WHEN "mapping_candidates"."first_season" !~ '^[0-9]{4}-[0-9]{2}$' THEN false ELSE right("mapping_candidates"."first_season", 2)::integer = (left("mapping_candidates"."first_season", 4)::integer + 1) % 100 END);--> statement-breakpoint
ALTER TABLE "mapping_candidates" ADD CONSTRAINT "mapping_candidates_last_season_check" CHECK (CASE WHEN "mapping_candidates"."last_season" !~ '^[0-9]{4}-[0-9]{2}$' THEN false ELSE right("mapping_candidates"."last_season", 2)::integer = (left("mapping_candidates"."last_season", 4)::integer + 1) % 100 END);--> statement-breakpoint
ALTER TABLE "player_name_variants" ADD CONSTRAINT "player_name_variants_text_check" CHECK ("player_name_variants"."text" ~ '[^\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]');--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_season_check" CHECK (CASE WHEN "seasons"."season" !~ '^[0-9]{4}-[0-9]{2}$' THEN false ELSE right("seasons"."season", 2)::integer = (left("seasons"."season", 4)::integer + 1) % 100 END);--> statement-breakpoint
ALTER TABLE "type_illustration_sources" ADD CONSTRAINT "type_illustration_sources_publication_check" CHECK (("type_illustration_sources"."publication_at" IS NULL) = ("type_illustration_sources"."publication_offset_minutes" IS NULL));