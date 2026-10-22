ALTER TABLE `jobs` ADD `canonical_url` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `source_http_status` integer;--> statement-breakpoint
ALTER TABLE `jobs` ADD `record_type` text DEFAULT 'imported' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `verification_status` text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `source_kind` text DEFAULT 'webpage' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `fetched_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `verified_at` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `date_posted` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `valid_through` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `content_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `evidence_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE INDEX `jobs_canonical_url_idx` ON `jobs` (`canonical_url`);--> statement-breakpoint
CREATE INDEX `jobs_content_hash_idx` ON `jobs` (`content_hash`);--> statement-breakpoint
CREATE INDEX `jobs_verification_idx` ON `jobs` (`verification_status`);