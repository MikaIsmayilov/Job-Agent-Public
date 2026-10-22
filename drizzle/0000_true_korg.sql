CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`company` text NOT NULL,
	`location` text NOT NULL,
	`work_mode` text NOT NULL,
	`salary` text NOT NULL,
	`posted_at` text NOT NULL,
	`source` text NOT NULL,
	`source_url` text,
	`score` integer NOT NULL,
	`status` text NOT NULL,
	`skills_json` text NOT NULL,
	`gaps_json` text NOT NULL,
	`summary` text NOT NULL,
	`raw_description` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_created_at_idx` ON `jobs` (`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);