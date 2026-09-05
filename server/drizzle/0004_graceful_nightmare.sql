CREATE TABLE `iptv_episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`season_number` integer NOT NULL,
	`episode_number` integer NOT NULL,
	`title` text NOT NULL,
	`container_extension` text DEFAULT 'mp4' NOT NULL,
	`duration_ms` integer,
	`overview` text,
	`image_url` text,
	FOREIGN KEY (`series_id`) REFERENCES `iptv_series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `iptv_episodes_series_idx` ON `iptv_episodes` (`series_id`);--> statement-breakpoint
CREATE TABLE `iptv_movies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category_id` text,
	`logo_url` text,
	`container_extension` text DEFAULT 'mp4' NOT NULL,
	`added_at` text,
	`parsed_title` text NOT NULL,
	`parsed_year` integer,
	`tmdb_id` integer,
	`title` text NOT NULL,
	`year` integer,
	`overview` text,
	`genres_json` text DEFAULT '[]' NOT NULL,
	`rating` integer,
	`runtime_ms` integer,
	`poster_key` text,
	`backdrop_key` text,
	`needs_review` integer DEFAULT true NOT NULL,
	`match_attempted_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `iptv_movies_category_idx` ON `iptv_movies` (`category_id`);--> statement-breakpoint
CREATE INDEX `iptv_movies_title_idx` ON `iptv_movies` (`title`);--> statement-breakpoint
CREATE TABLE `iptv_series` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category_id` text,
	`cover_url` text,
	`parsed_title` text NOT NULL,
	`parsed_year` integer,
	`tmdb_id` integer,
	`title` text NOT NULL,
	`year` integer,
	`overview` text,
	`genres_json` text DEFAULT '[]' NOT NULL,
	`rating` integer,
	`poster_key` text,
	`backdrop_key` text,
	`needs_review` integer DEFAULT true NOT NULL,
	`match_attempted_at` text,
	`episodes_fetched_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `iptv_series_category_idx` ON `iptv_series` (`category_id`);--> statement-breakpoint
CREATE INDEX `iptv_series_title_idx` ON `iptv_series` (`title`);