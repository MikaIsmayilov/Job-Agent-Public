CREATE TABLE IF NOT EXISTS `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`finished_at` text NOT NULL,
	`ok` integer NOT NULL,
	`summary` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `mail_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`reason` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`sender` text DEFAULT '' NOT NULL,
	`candidate_ids` text NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	`resolution` text
);
