CREATE TABLE "installation" (
	"id" smallint PRIMARY KEY NOT NULL,
	"first_started_at" timestamp with time zone NOT NULL,
	CONSTRAINT "installation_id_check" CHECK ("installation"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "sequence_counters" (
	"name" text PRIMARY KEY NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sequence_counters_last_value_check" CHECK ("sequence_counters"."last_value" >= 0)
);
