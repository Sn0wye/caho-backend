ALTER TABLE "rounds" ADD COLUMN "status" varchar(255) DEFAULT 'PLAYING' NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "play_deadline" timestamp;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "judge_deadline" timestamp;