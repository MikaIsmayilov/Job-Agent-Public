CREATE TABLE `application_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`due_date` text DEFAULT '' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`completed` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
