ALTER TABLE `shows` ADD `mal_id` integer;--> statement-breakpoint
ALTER TABLE `shows` ADD `tags_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `shows` ADD `ratings_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `shows` ADD `popularity` integer;--> statement-breakpoint
ALTER TABLE `shows` ADD `age_rating` text;--> statement-breakpoint
ALTER TABLE `shows` ADD `ratings_refreshed_at` text;