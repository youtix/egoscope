CREATE TABLE "box_scores" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "box_scores_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" uuid NOT NULL,
	"game_id" integer NOT NULL,
	"stats_source" text NOT NULL,
	"source_player_ref" text NOT NULL,
	"status" text NOT NULL,
	"team_id" integer,
	"minutes" smallint,
	"seconds" smallint,
	"has_rounded_minutes" boolean NOT NULL,
	"points" smallint,
	"field_goals_made" smallint,
	"field_goals_attempted" smallint,
	"three_pointers_made" smallint,
	"free_throws_made" smallint,
	"free_throws_attempted" smallint,
	"offensive_rebounds" smallint,
	"defensive_rebounds" smallint,
	"assists" smallint,
	"steals" smallint,
	"blocks" smallint,
	"turnovers" smallint,
	"personal_fouls" smallint,
	"ejected" boolean,
	"failed_checks" text[] DEFAULT '{}' NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "box_scores_player_game_key" UNIQUE("player_id","game_id"),
	CONSTRAINT "box_scores_stats_source_check" CHECK ("box_scores"."stats_source" IN ('sportsdataverse_espn')),
	CONSTRAINT "box_scores_status_check" CHECK ("box_scores"."status" IN ('complete', 'incomplete', 'suspect', 'unavailable')),
	CONSTRAINT "box_scores_failed_checks_check" CHECK ("box_scores"."failed_checks" <@ ARRAY['negative_value', 'made_above_attempted', 'points_mismatch', 'minutes_above_game_length', 'statistic_without_minutes']),
	CONSTRAINT "box_scores_placeholder_check" CHECK ("box_scores"."status" <> 'unavailable' OR (("box_scores"."team_id", "box_scores"."minutes", "box_scores"."seconds", "box_scores"."points", "box_scores"."field_goals_made", "box_scores"."field_goals_attempted", "box_scores"."three_pointers_made", "box_scores"."free_throws_made", "box_scores"."free_throws_attempted", "box_scores"."offensive_rebounds", "box_scores"."defensive_rebounds", "box_scores"."assists", "box_scores"."steals", "box_scores"."blocks", "box_scores"."turnovers", "box_scores"."personal_fouls") IS NULL AND "box_scores"."failed_checks" = '{}')),
	CONSTRAINT "box_scores_team_check" CHECK ("box_scores"."status" = 'unavailable' OR "box_scores"."team_id" IS NOT NULL),
	CONSTRAINT "box_scores_suspect_check" CHECK (("box_scores"."status" = 'suspect') = ("box_scores"."failed_checks" <> '{}'))
);
--> statement-breakpoint
CREATE TABLE "event_type_status_changes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_type_status_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_type_id" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	CONSTRAINT "event_type_status_changes_from_status_check" CHECK ("event_type_status_changes"."from_status" IN ('proposed', 'validated', 'rejected', 'withdrawn')),
	CONSTRAINT "event_type_status_changes_to_status_check" CHECK ("event_type_status_changes"."to_status" IN ('proposed', 'validated', 'rejected', 'withdrawn')),
	CONSTRAINT "event_type_status_changes_transition_check" CHECK ("event_type_status_changes"."from_status" IS NULL OR ("event_type_status_changes"."from_status", "event_type_status_changes"."to_status") IN (('proposed', 'validated'), ('proposed', 'rejected'), ('rejected', 'proposed'), ('validated', 'withdrawn'), ('withdrawn', 'validated'))),
	CONSTRAINT "event_type_status_changes_split_birth_check" CHECK ("event_type_status_changes"."from_status" IS NOT NULL OR "event_type_status_changes"."to_status" = 'validated')
);
--> statement-breakpoint
CREATE TABLE "event_types" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"definition" text,
	"inclusion_criteria" text,
	"exclusion_criteria" text,
	"dating_rule" text,
	"known_in_advance" boolean DEFAULT false NOT NULL,
	"calendar_derivation" text,
	"generic_example" text,
	"documentation_difficulty" text,
	"caution_notes" text,
	"is_intimate_subject" boolean DEFAULT false NOT NULL,
	"coverage_threshold_outlets" smallint,
	"coverage_threshold_days" smallint,
	"switched_off_criterion" text,
	"current_version_number" smallint,
	"rejection_reason" text,
	"rejection_comment" text,
	"withdrawal_reason_kind" text,
	"withdrawal_reason" text,
	"merged_into_type_id" text,
	"split_from_type_id" text,
	"no_fit_reason" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "event_types_id_check" CHECK ("event_types"."id" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("event_types"."id") <= 50),
	CONSTRAINT "event_types_status_check" CHECK ("event_types"."status" IN ('proposed', 'validated', 'rejected', 'withdrawn')),
	CONSTRAINT "event_types_origin_check" CHECK ("event_types"."origin" IN ('scoping', 'exploration', 'detection')),
	CONSTRAINT "event_types_name_check" CHECK (btrim("event_types"."name") <> ''),
	CONSTRAINT "event_types_calendar_derivation_check" CHECK ("event_types"."calendar_derivation" IN ('birthday', 'former_team')),
	CONSTRAINT "event_types_documentation_difficulty_check" CHECK ("event_types"."documentation_difficulty" IN ('easy', 'medium', 'hard')),
	CONSTRAINT "event_types_coverage_threshold_outlets_check" CHECK ("event_types"."coverage_threshold_outlets" BETWEEN 2 AND 10),
	CONSTRAINT "event_types_coverage_threshold_days_check" CHECK ("event_types"."coverage_threshold_days" BETWEEN 1 AND 7),
	CONSTRAINT "event_types_switched_off_criterion_check" CHECK ("event_types"."switched_off_criterion" IN ('playing_time_too_low', 'injury_return', 'unusual_stakes', 'opponent_strength', 'co_occurring')),
	CONSTRAINT "event_types_current_version_number_check" CHECK ("event_types"."current_version_number" >= 1),
	CONSTRAINT "event_types_rejection_reason_check" CHECK ("event_types"."rejection_reason" IN ('not_clean', 'not_datable', 'duplicate_of_existing_type', 'out_of_scope', 'other')),
	CONSTRAINT "event_types_withdrawal_reason_kind_check" CHECK ("event_types"."withdrawal_reason_kind" IN ('entered', 'merged_into', 'split_into')),
	CONSTRAINT "event_types_complete_sheet_check" CHECK ("event_types"."status" NOT IN ('validated', 'withdrawn') OR ("event_types"."current_version_number", "event_types"."definition", "event_types"."inclusion_criteria", "event_types"."exclusion_criteria", "event_types"."dating_rule", "event_types"."generic_example", "event_types"."documentation_difficulty") IS NOT NULL),
	CONSTRAINT "event_types_rejected_check" CHECK (("event_types"."status" = 'rejected') = ("event_types"."rejection_reason" IS NOT NULL)),
	CONSTRAINT "event_types_commented_rejection_check" CHECK ("event_types"."rejection_comment" IS NULL OR "event_types"."rejection_reason" IS NOT NULL),
	CONSTRAINT "event_types_withdrawn_check" CHECK (("event_types"."status" = 'withdrawn') = ("event_types"."withdrawal_reason_kind" IS NOT NULL)),
	CONSTRAINT "event_types_merged_into_check" CHECK ("event_types"."merged_into_type_id" IS NULL OR "event_types"."withdrawal_reason_kind" = 'merged_into'),
	CONSTRAINT "event_types_entered_reason_check" CHECK (("event_types"."withdrawal_reason_kind" = 'entered') = ("event_types"."withdrawal_reason" IS NOT NULL)),
	CONSTRAINT "event_types_coverage_threshold_check" CHECK (("event_types"."coverage_threshold_outlets" IS NULL) = ("event_types"."coverage_threshold_days" IS NULL)),
	CONSTRAINT "event_types_calendar_derived_check" CHECK ("event_types"."calendar_derivation" IS NULL OR ("event_types"."origin" = 'scoping' AND "event_types"."known_in_advance")),
	CONSTRAINT "event_types_detection_proposal_check" CHECK ("event_types"."no_fit_reason" IS NULL OR "event_types"."origin" = 'detection')
);
--> statement-breakpoint
CREATE TABLE "fetch_queue_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fetch_queue_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"stats_source" text NOT NULL,
	"kind" text NOT NULL,
	"season" text,
	"game_id" integer,
	"is_manual_refetch" boolean DEFAULT false NOT NULL,
	"priority" smallint NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"wait_reason" text,
	"lease_expires_at" timestamp with time zone,
	"cursor" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fetch_queue_items_scope_key" UNIQUE NULLS NOT DISTINCT("stats_source","kind","season","game_id","is_manual_refetch"),
	CONSTRAINT "fetch_queue_items_stats_source_check" CHECK ("fetch_queue_items"."stats_source" IN ('sportsdataverse_espn')),
	CONSTRAINT "fetch_queue_items_kind_check" CHECK ("fetch_queue_items"."kind" IN ('publication_probe', 'season_games', 'season_box_scores', 'season_players', 'player_records')),
	CONSTRAINT "fetch_queue_items_priority_check" CHECK ("fetch_queue_items"."priority" BETWEEN 1 AND 5),
	CONSTRAINT "fetch_queue_items_wait_reason_check" CHECK ("fetch_queue_items"."wait_reason" IN ('outage', 'quota')),
	CONSTRAINT "fetch_queue_items_season_unit_check" CHECK (("fetch_queue_items"."kind" IN ('season_games', 'season_box_scores', 'season_players')) = ("fetch_queue_items"."season" IS NOT NULL)),
	CONSTRAINT "fetch_queue_items_refetch_game_check" CHECK ("fetch_queue_items"."game_id" IS NULL OR ("fetch_queue_items"."kind" = 'season_box_scores' AND "fetch_queue_items"."is_manual_refetch"))
);
--> statement-breakpoint
CREATE TABLE "followed_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"display_name_normalized" text NOT NULL,
	"current_team_id" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"birthday_month" smallint,
	"birthday_day" smallint,
	"birthday_origin" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pause_suggestion_declined_at" timestamp with time zone,
	"last_calendar_derivation_at" timestamp with time zone,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "followed_players_display_name_check" CHECK (btrim("followed_players"."display_name") <> ''),
	CONSTRAINT "followed_players_status_check" CHECK ("followed_players"."status" IN ('active', 'paused', 'withdrawn')),
	CONSTRAINT "followed_players_birthday_month_check" CHECK ("followed_players"."birthday_month" BETWEEN 1 AND 12),
	CONSTRAINT "followed_players_birthday_day_check" CHECK ("followed_players"."birthday_day" BETWEEN 1 AND (ARRAY[31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])["followed_players"."birthday_month"]),
	CONSTRAINT "followed_players_birthday_origin_check" CHECK ("followed_players"."birthday_origin" IN ('stats_source', 'owner')),
	CONSTRAINT "followed_players_birthday_check" CHECK (("followed_players"."birthday_month" IS NULL) = ("followed_players"."birthday_day" IS NULL)),
	CONSTRAINT "followed_players_birthday_with_origin_check" CHECK (("followed_players"."birthday_month" IS NULL) = ("followed_players"."birthday_origin" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "games_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"stats_source" text NOT NULL,
	"source_game_ref" text NOT NULL,
	"make_up_source_game_ref" text,
	"season" text NOT NULL,
	"phase" text NOT NULL,
	"status" text NOT NULL,
	"scheduled_start_at" timestamp with time zone NOT NULL,
	"is_start_time_tbd" boolean DEFAULT false NOT NULL,
	"game_day_on" date NOT NULL,
	"home_team_id" integer,
	"away_team_id" integer,
	"home_score" smallint,
	"away_score" smallint,
	"overtime_count" smallint,
	"series_id" integer,
	"game_number" smallint,
	"home_series_wins_before" smallint,
	"away_series_wins_before" smallint,
	"is_elimination_game" boolean,
	"home_lines_published" boolean DEFAULT false NOT NULL,
	"away_lines_published" boolean DEFAULT false NOT NULL,
	"consolidated_at" timestamp with time zone,
	"last_fetched_at" timestamp with time zone NOT NULL,
	"schedule_changed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "games_source_ref_key" UNIQUE("stats_source","source_game_ref"),
	CONSTRAINT "games_stats_source_check" CHECK ("games"."stats_source" IN ('sportsdataverse_espn')),
	CONSTRAINT "games_phase_check" CHECK ("games"."phase" IN ('regular_season', 'play_in', 'playoffs')),
	CONSTRAINT "games_status_check" CHECK ("games"."status" IN ('scheduled', 'in_progress', 'final', 'postponed', 'canceled')),
	CONSTRAINT "games_overtime_count_check" CHECK ("games"."overtime_count" >= 0),
	CONSTRAINT "games_game_number_check" CHECK ("games"."game_number" >= 1),
	CONSTRAINT "games_home_series_wins_before_check" CHECK ("games"."home_series_wins_before" >= 0),
	CONSTRAINT "games_away_series_wins_before_check" CHECK ("games"."away_series_wins_before" >= 0),
	CONSTRAINT "games_regular_season_check" CHECK ("games"."phase" <> 'regular_season' OR ("games"."series_id", "games"."game_number", "games"."home_series_wins_before", "games"."away_series_wins_before", "games"."is_elimination_game") IS NULL),
	CONSTRAINT "games_placeholder_check" CHECK (("games"."home_team_id" IS NOT NULL AND "games"."away_team_id" IS NOT NULL) OR "games"."status" = 'scheduled'),
	CONSTRAINT "games_distinct_teams_check" CHECK ("games"."home_team_id" IS DISTINCT FROM "games"."away_team_id" OR "games"."home_team_id" IS NULL),
	CONSTRAINT "games_final_score_check" CHECK ("games"."status" <> 'final' OR ("games"."home_score" IS NOT NULL AND "games"."away_score" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "mapping_candidates" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mapping_candidates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"mapping_id" integer NOT NULL,
	"source_player_ref" text NOT NULL,
	"display_name" text NOT NULL,
	"current_team_id" integer,
	"first_season" text,
	"last_season" text,
	"team_ids" integer[] DEFAULT '{}' NOT NULL,
	"found_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_preselected" boolean DEFAULT false NOT NULL,
	CONSTRAINT "mapping_candidates_mapping_ref_key" UNIQUE("mapping_id","source_player_ref"),
	CONSTRAINT "mapping_candidates_first_season_check" CHECK ("mapping_candidates"."first_season" ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "mapping_candidates_last_season_check" CHECK ("mapping_candidates"."last_season" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "player_directory_entries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "player_directory_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"stats_source" text NOT NULL,
	"season" text NOT NULL,
	"source_player_ref" text NOT NULL,
	"display_name" text NOT NULL,
	"search_names" text[] NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "player_directory_entries_key" UNIQUE("stats_source","season","source_player_ref"),
	CONSTRAINT "player_directory_entries_stats_source_check" CHECK ("player_directory_entries"."stats_source" IN ('sportsdataverse_espn'))
);
--> statement-breakpoint
CREATE TABLE "player_directory_teams" (
	"entry_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"first_game_on" date NOT NULL,
	"last_game_on" date NOT NULL,
	CONSTRAINT "player_directory_teams_entry_id_team_id_pk" PRIMARY KEY("entry_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "player_indicators" (
	"player_id" uuid PRIMARY KEY NOT NULL,
	"indicator_season" text NOT NULL,
	"games_played_this_season" smallint NOT NULL,
	"average_minutes_this_season" double precision,
	"last_game_played_id" integer,
	"last_game_played_on" date,
	"consecutive_team_games_missed" smallint DEFAULT 0 NOT NULL,
	"first_nba_game_id" integer,
	"first_nba_game_on" date,
	"computed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_name_variants" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "player_name_variants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"normalized_text" text NOT NULL,
	"is_ambiguous" boolean DEFAULT false NOT NULL,
	CONSTRAINT "player_name_variants_player_normalized_key" UNIQUE("player_id","normalized_text"),
	CONSTRAINT "player_name_variants_kind_check" CHECK ("player_name_variants"."kind" IN ('spelling', 'nickname')),
	CONSTRAINT "player_name_variants_text_check" CHECK (btrim("player_name_variants"."text") <> '')
);
--> statement-breakpoint
CREATE TABLE "player_status_changes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "player_status_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" uuid NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"reason" text,
	CONSTRAINT "player_status_changes_from_status_check" CHECK ("player_status_changes"."from_status" IN ('active', 'paused', 'withdrawn')),
	CONSTRAINT "player_status_changes_to_status_check" CHECK ("player_status_changes"."to_status" IN ('active', 'paused', 'withdrawn')),
	CONSTRAINT "player_status_changes_reason_check" CHECK ("player_status_changes"."reason" IN ('prolonged_absence', 'end_of_career', 'left_nba', 'insufficient_exposure', 'other')),
	CONSTRAINT "player_status_changes_transition_check" CHECK (("player_status_changes"."from_status", "player_status_changes"."to_status") IN (('active', 'paused'), ('active', 'withdrawn'), ('paused', 'active'), ('paused', 'withdrawn'), ('withdrawn', 'active')))
);
--> statement-breakpoint
CREATE TABLE "player_team_changes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "player_team_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" uuid NOT NULL,
	"changed_at" timestamp with time zone NOT NULL,
	"previous_team_id" integer,
	"new_team_id" integer,
	"origin" text NOT NULL,
	"game_id" integer,
	CONSTRAINT "player_team_changes_origin_check" CHECK ("player_team_changes"."origin" IN ('observed', 'entered')),
	CONSTRAINT "player_team_changes_distinct_teams_check" CHECK ("player_team_changes"."previous_team_id" IS DISTINCT FROM "player_team_changes"."new_team_id")
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"season" text PRIMARY KEY NOT NULL,
	"stats_source" text NOT NULL,
	"phases_with_lines" text[] DEFAULT '{}' NOT NULL,
	"games_without_lines" integer DEFAULT 0 NOT NULL,
	"coverage_fetched_at" timestamp with time zone,
	CONSTRAINT "seasons_season_check" CHECK ("seasons"."season" ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "seasons_stats_source_check" CHECK ("seasons"."stats_source" IN ('sportsdataverse_espn')),
	CONSTRAINT "seasons_phases_with_lines_check" CHECK ("seasons"."phases_with_lines" <@ ARRAY['regular_season', 'play_in', 'playoffs'])
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "series_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"season" text NOT NULL,
	"phase" text NOT NULL,
	"round" text,
	"team_a_id" integer NOT NULL,
	"team_b_id" integer NOT NULL,
	"wins_needed" smallint NOT NULL,
	"is_rebuilt" boolean NOT NULL,
	CONSTRAINT "series_season_teams_key" UNIQUE("season","phase","team_a_id","team_b_id"),
	CONSTRAINT "series_phase_check" CHECK ("series"."phase" IN ('play_in', 'playoffs')),
	CONSTRAINT "series_round_check" CHECK ("series"."round" IN ('first_round', 'conference_semifinals', 'conference_finals', 'finals', 'play_in_7_vs_8', 'play_in_9_vs_10', 'play_in_8th_seed')),
	CONSTRAINT "series_team_order_check" CHECK ("series"."team_a_id" < "series"."team_b_id"),
	CONSTRAINT "series_wins_needed_check" CHECK ("series"."wins_needed" >= 1)
);
--> statement-breakpoint
CREATE TABLE "stat_corrections" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stat_corrections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" uuid NOT NULL,
	"game_id" integer NOT NULL,
	"element" text NOT NULL,
	"old_value" integer,
	"new_value" integer,
	"corrected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"origin" text NOT NULL,
	CONSTRAINT "stat_corrections_element_check" CHECK ("stat_corrections"."element" IN ('team', 'minutes', 'seconds', 'points', 'field_goals_made', 'field_goals_attempted', 'three_pointers_made', 'free_throws_made', 'free_throws_attempted', 'offensive_rebounds', 'defensive_rebounds', 'assists', 'steals', 'blocks', 'turnovers', 'personal_fouls')),
	CONSTRAINT "stat_corrections_origin_check" CHECK ("stat_corrections"."origin" IN ('correction_window', 'manual_refetch'))
);
--> statement-breakpoint
CREATE TABLE "stats_source_mappings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stats_source_mappings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" uuid NOT NULL,
	"stats_source" text NOT NULL,
	"status" text DEFAULT 'to_establish' NOT NULL,
	"source_player_ref" text,
	"established_at" timestamp with time zone,
	"last_searched_at" timestamp with time zone,
	CONSTRAINT "stats_source_mappings_player_source_key" UNIQUE("player_id","stats_source"),
	CONSTRAINT "stats_source_mappings_source_ref_key" UNIQUE("stats_source","source_player_ref"),
	CONSTRAINT "stats_source_mappings_stats_source_check" CHECK ("stats_source_mappings"."stats_source" IN ('sportsdataverse_espn')),
	CONSTRAINT "stats_source_mappings_status_check" CHECK ("stats_source_mappings"."status" IN ('to_establish', 'established')),
	CONSTRAINT "stats_source_mappings_established_check" CHECK (("stats_source_mappings"."status" = 'established') = ("stats_source_mappings"."source_player_ref" IS NOT NULL AND "stats_source_mappings"."established_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "stats_source_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stats_source_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"stats_source" text NOT NULL,
	"resource" text NOT NULL,
	"season" text,
	"version" text,
	"source_refreshed_at" timestamp with time zone,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "stats_source_versions_key" UNIQUE NULLS NOT DISTINCT("stats_source","resource","season"),
	CONSTRAINT "stats_source_versions_stats_source_check" CHECK ("stats_source_versions"."stats_source" IN ('sportsdataverse_espn')),
	CONSTRAINT "stats_source_versions_resource_check" CHECK ("stats_source_versions"."resource" IN ('publication', 'season_games', 'season_box_scores', 'season_players', 'player_records')),
	CONSTRAINT "stats_source_versions_publication_check" CHECK (("stats_source_versions"."resource" = 'publication') = ("stats_source_versions"."season" IS NULL)),
	CONSTRAINT "stats_source_versions_refreshed_check" CHECK ("stats_source_versions"."source_refreshed_at" IS NULL OR "stats_source_versions"."resource" = 'publication')
);
--> statement-breakpoint
CREATE TABLE "team_seasons" (
	"team_id" integer NOT NULL,
	"season" text NOT NULL,
	"name" text NOT NULL,
	"location" text NOT NULL,
	"abbreviation" text NOT NULL,
	CONSTRAINT "team_seasons_team_id_season_pk" PRIMARY KEY("team_id","season")
);
--> statement-breakpoint
CREATE TABLE "team_source_refs" (
	"team_id" integer NOT NULL,
	"stats_source" text NOT NULL,
	"source_team_ref" text NOT NULL,
	CONSTRAINT "team_source_refs_stats_source_source_team_ref_pk" PRIMARY KEY("stats_source","source_team_ref"),
	CONSTRAINT "team_source_refs_stats_source_check" CHECK ("team_source_refs"."stats_source" IN ('sportsdataverse_espn'))
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "teams_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"abbreviation" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "teams_abbreviation_key" UNIQUE("abbreviation")
);
--> statement-breakpoint
CREATE TABLE "type_illustration_sources" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "type_illustration_sources_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_type_id" text NOT NULL,
	"position" smallint NOT NULL,
	"url" text NOT NULL,
	"outlet" text,
	"title" text,
	"publication_date_on" date NOT NULL,
	"publication_at" timestamp with time zone,
	"publication_offset_minutes" smallint
);
--> statement-breakpoint
CREATE TABLE "type_occurrences" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "type_occurrences_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_type_id" text NOT NULL,
	"player_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_originating_fact" boolean DEFAULT false NOT NULL,
	"justification" text,
	"article_url" text NOT NULL,
	"article_outlet" text,
	"article_title" text,
	"article_published_at" timestamp with time zone NOT NULL,
	"article_publication_precision" text NOT NULL,
	CONSTRAINT "type_occurrences_article_publication_precision_check" CHECK ("type_occurrences"."article_publication_precision" IN ('exact', 'approximate', 'none'))
);
--> statement-breakpoint
CREATE TABLE "type_sheet_changes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "type_sheet_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_type_id" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_kind" text NOT NULL,
	"substantive_scope" text,
	"reason" text,
	"content_before" jsonb NOT NULL,
	"content_after" jsonb NOT NULL,
	"resulting_version_number" smallint,
	CONSTRAINT "type_sheet_changes_change_kind_check" CHECK ("type_sheet_changes"."change_kind" IN ('formal', 'substantive', 'criterion_switch')),
	CONSTRAINT "type_sheet_changes_substantive_scope_check" CHECK ("type_sheet_changes"."substantive_scope" IN ('broadens', 'narrows', 'both')),
	CONSTRAINT "type_sheet_changes_resulting_version_check" CHECK (("type_sheet_changes"."change_kind" = 'substantive') = ("type_sheet_changes"."resulting_version_number" IS NOT NULL)),
	CONSTRAINT "type_sheet_changes_scoped_change_check" CHECK ("type_sheet_changes"."substantive_scope" IS NULL OR "type_sheet_changes"."change_kind" = 'substantive')
);
--> statement-breakpoint
CREATE TABLE "type_sheet_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "type_sheet_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_type_id" text NOT NULL,
	"version_number" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"substantive_scope" text,
	"merge_covers_union" boolean,
	"is_broadening" boolean DEFAULT false NOT NULL,
	"reason" text,
	"content" jsonb NOT NULL,
	"requalified_conforming_count" integer DEFAULT 0 NOT NULL,
	"reassigned_count" integer DEFAULT 0 NOT NULL,
	"erased_count" integer DEFAULT 0 NOT NULL,
	"supplementary_requests_proposed_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "type_sheet_versions_type_number_key" UNIQUE("event_type_id","version_number"),
	CONSTRAINT "type_sheet_versions_version_number_check" CHECK ("type_sheet_versions"."version_number" >= 1),
	CONSTRAINT "type_sheet_versions_kind_check" CHECK ("type_sheet_versions"."kind" IN ('validation', 'substantive_change', 'merge')),
	CONSTRAINT "type_sheet_versions_substantive_scope_check" CHECK ("type_sheet_versions"."substantive_scope" IN ('broadens', 'narrows', 'both')),
	CONSTRAINT "type_sheet_versions_substantive_change_check" CHECK (("type_sheet_versions"."kind" = 'substantive_change') = ("type_sheet_versions"."substantive_scope" IS NOT NULL)),
	CONSTRAINT "type_sheet_versions_merge_check" CHECK (("type_sheet_versions"."kind" = 'merge') = ("type_sheet_versions"."merge_covers_union" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "box_scores" ADD CONSTRAINT "box_scores_player_id_followed_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."followed_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_scores" ADD CONSTRAINT "box_scores_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_scores" ADD CONSTRAINT "box_scores_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_type_status_changes" ADD CONSTRAINT "event_type_status_changes_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_merged_into_type_id_event_types_id_fk" FOREIGN KEY ("merged_into_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_split_from_type_id_event_types_id_fk" FOREIGN KEY ("split_from_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetch_queue_items" ADD CONSTRAINT "fetch_queue_items_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followed_players" ADD CONSTRAINT "followed_players_current_team_id_teams_id_fk" FOREIGN KEY ("current_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_season_seasons_season_fk" FOREIGN KEY ("season") REFERENCES "public"."seasons"("season") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_candidates" ADD CONSTRAINT "mapping_candidates_mapping_id_stats_source_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."stats_source_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_candidates" ADD CONSTRAINT "mapping_candidates_current_team_id_teams_id_fk" FOREIGN KEY ("current_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_directory_entries" ADD CONSTRAINT "player_directory_entries_season_seasons_season_fk" FOREIGN KEY ("season") REFERENCES "public"."seasons"("season") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_directory_teams" ADD CONSTRAINT "player_directory_teams_entry_id_player_directory_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."player_directory_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_directory_teams" ADD CONSTRAINT "player_directory_teams_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_indicators" ADD CONSTRAINT "player_indicators_player_id_followed_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."followed_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_indicators" ADD CONSTRAINT "player_indicators_last_game_played_id_games_id_fk" FOREIGN KEY ("last_game_played_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_indicators" ADD CONSTRAINT "player_indicators_first_nba_game_id_games_id_fk" FOREIGN KEY ("first_nba_game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_name_variants" ADD CONSTRAINT "player_name_variants_player_id_followed_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."followed_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_status_changes" ADD CONSTRAINT "player_status_changes_player_id_followed_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."followed_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_team_changes" ADD CONSTRAINT "player_team_changes_player_id_followed_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."followed_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_team_changes" ADD CONSTRAINT "player_team_changes_previous_team_id_teams_id_fk" FOREIGN KEY ("previous_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_team_changes" ADD CONSTRAINT "player_team_changes_new_team_id_teams_id_fk" FOREIGN KEY ("new_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_team_changes" ADD CONSTRAINT "player_team_changes_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_season_seasons_season_fk" FOREIGN KEY ("season") REFERENCES "public"."seasons"("season") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_team_a_id_teams_id_fk" FOREIGN KEY ("team_a_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_team_b_id_teams_id_fk" FOREIGN KEY ("team_b_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stat_corrections" ADD CONSTRAINT "stat_corrections_player_id_followed_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."followed_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stat_corrections" ADD CONSTRAINT "stat_corrections_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stats_source_mappings" ADD CONSTRAINT "stats_source_mappings_player_id_followed_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."followed_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_seasons" ADD CONSTRAINT "team_seasons_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_seasons" ADD CONSTRAINT "team_seasons_season_seasons_season_fk" FOREIGN KEY ("season") REFERENCES "public"."seasons"("season") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_source_refs" ADD CONSTRAINT "team_source_refs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "type_illustration_sources" ADD CONSTRAINT "type_illustration_sources_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "type_occurrences" ADD CONSTRAINT "type_occurrences_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "type_occurrences" ADD CONSTRAINT "type_occurrences_player_id_followed_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."followed_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "type_sheet_changes" ADD CONSTRAINT "type_sheet_changes_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "type_sheet_versions" ADD CONSTRAINT "type_sheet_versions_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "box_scores_game_idx" ON "box_scores" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "event_type_status_changes_type_idx" ON "event_type_status_changes" USING btree ("event_type_id","changed_at");--> statement-breakpoint
CREATE INDEX "fetch_queue_items_due_idx" ON "fetch_queue_items" USING btree ("priority","next_attempt_at");--> statement-breakpoint
CREATE INDEX "followed_players_display_name_normalized_idx" ON "followed_players" USING btree ("display_name_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "games_make_up_ref_key" ON "games" USING btree ("stats_source","make_up_source_game_ref") WHERE "games"."make_up_source_game_ref" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "games_home_team_start_idx" ON "games" USING btree ("home_team_id","scheduled_start_at");--> statement-breakpoint
CREATE INDEX "games_away_team_start_idx" ON "games" USING btree ("away_team_id","scheduled_start_at");--> statement-breakpoint
CREATE INDEX "games_season_phase_idx" ON "games" USING btree ("season","phase");--> statement-breakpoint
CREATE INDEX "games_game_day_idx" ON "games" USING btree ("game_day_on");--> statement-breakpoint
CREATE INDEX "games_open_status_idx" ON "games" USING btree ("scheduled_start_at") WHERE "games"."status" IN ('scheduled', 'in_progress', 'postponed');--> statement-breakpoint
CREATE INDEX "games_schedule_changed_idx" ON "games" USING btree ("schedule_changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mapping_candidates_preselected_key" ON "mapping_candidates" USING btree ("mapping_id") WHERE "mapping_candidates"."is_preselected";--> statement-breakpoint
CREATE INDEX "player_directory_entries_ref_idx" ON "player_directory_entries" USING btree ("stats_source","source_player_ref");--> statement-breakpoint
CREATE INDEX "player_name_variants_normalized_idx" ON "player_name_variants" USING btree ("normalized_text");--> statement-breakpoint
CREATE INDEX "player_status_changes_player_changed_idx" ON "player_status_changes" USING btree ("player_id","changed_at");--> statement-breakpoint
CREATE INDEX "player_team_changes_player_changed_idx" ON "player_team_changes" USING btree ("player_id","changed_at");--> statement-breakpoint
CREATE INDEX "stat_corrections_player_game_idx" ON "stat_corrections" USING btree ("player_id","game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "type_occurrences_originating_key" ON "type_occurrences" USING btree ("event_type_id") WHERE "type_occurrences"."is_originating_fact";--> statement-breakpoint
CREATE INDEX "type_occurrences_type_idx" ON "type_occurrences" USING btree ("event_type_id");--> statement-breakpoint
CREATE INDEX "type_occurrences_article_idx" ON "type_occurrences" USING btree ("article_url");--> statement-breakpoint
CREATE INDEX "type_sheet_changes_type_idx" ON "type_sheet_changes" USING btree ("event_type_id","changed_at");--> statement-breakpoint
CREATE INDEX "type_sheet_changes_switch_idx" ON "type_sheet_changes" USING btree ("changed_at") WHERE "type_sheet_changes"."change_kind" = 'criterion_switch';