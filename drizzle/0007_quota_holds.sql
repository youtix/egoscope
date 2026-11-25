CREATE TABLE "quota_holds" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "quota_holds_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"limit_key" text NOT NULL,
	"period_start_at" timestamp with time zone NOT NULL,
	"amount" bigint NOT NULL,
	"held_at" timestamp with time zone NOT NULL
);
