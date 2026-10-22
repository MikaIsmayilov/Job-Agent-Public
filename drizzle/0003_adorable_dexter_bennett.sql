ALTER TABLE `jobs` ADD `sponsorship` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `sponsorship_note` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `tags_json` text DEFAULT '[]' NOT NULL;