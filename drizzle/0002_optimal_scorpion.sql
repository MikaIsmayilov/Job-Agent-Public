ALTER TABLE `jobs` ADD `job_type` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `experience_level` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `role_family` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `source_site` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `tailored_path` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `tailored_at` text;--> statement-breakpoint
CREATE INDEX `jobs_role_family_idx` ON `jobs` (`role_family`);