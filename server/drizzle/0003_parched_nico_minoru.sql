CREATE TABLE `live_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `live_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`number` integer,
	`logo_url` text,
	`category_id` text,
	`epg_channel_id` text,
	`has_archive` integer DEFAULT false NOT NULL,
	`archive_days` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `live_channels_category_idx` ON `live_channels` (`category_id`);--> statement-breakpoint
CREATE INDEX `live_channels_epg_idx` ON `live_channels` (`epg_channel_id`);--> statement-breakpoint
CREATE TABLE `live_programmes` (
	`id` text PRIMARY KEY NOT NULL,
	`epg_channel_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `live_programmes_channel_start_idx` ON `live_programmes` (`epg_channel_id`,`start_at`);