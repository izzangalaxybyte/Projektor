CREATE TABLE `episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`show_id` text NOT NULL,
	`season_id` text,
	`season_number` integer,
	`episode_number` integer,
	`absolute_number` integer,
	`title` text,
	`overview` text,
	`air_date` text,
	`still_key` text,
	`runtime_ms` integer,
	`tmdb_id` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `episodes_show_season_episode_idx` ON `episodes` (`show_id`,`season_number`,`episode_number`);--> statement-breakpoint
CREATE TABLE `libraries` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`last_scanned_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `library_paths` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`path` text NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_paths_unique_idx` ON `library_paths` (`library_id`,`path`);--> statement-breakpoint
CREATE TABLE `media_files` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`path` text NOT NULL,
	`file_name` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`mtime_ms` integer NOT NULL,
	`probed_at` text,
	`container` text,
	`duration_ms` integer,
	`bitrate` integer,
	`probe_json` text,
	`missing` integer DEFAULT false NOT NULL,
	`movie_id` text,
	`episode_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_files_path_idx` ON `media_files` (`path`);--> statement-breakpoint
CREATE INDEX `media_files_library_idx` ON `media_files` (`library_id`);--> statement-breakpoint
CREATE INDEX `media_files_movie_idx` ON `media_files` (`movie_id`);--> statement-breakpoint
CREATE INDEX `media_files_episode_idx` ON `media_files` (`episode_id`);--> statement-breakpoint
CREATE TABLE `movies` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`title` text NOT NULL,
	`sort_title` text NOT NULL,
	`year` integer,
	`tmdb_id` integer,
	`overview` text,
	`tagline` text,
	`genres_json` text DEFAULT '[]' NOT NULL,
	`rating` integer,
	`release_date` text,
	`runtime_ms` integer,
	`poster_key` text,
	`backdrop_key` text,
	`needs_review` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `movies_library_idx` ON `movies` (`library_id`);--> statement-breakpoint
CREATE INDEX `movies_tmdb_idx` ON `movies` (`tmdb_id`);--> statement-breakpoint
CREATE TABLE `playback_state` (
	`user_id` text NOT NULL,
	`item_id` text NOT NULL,
	`item_kind` text NOT NULL,
	`position_ms` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`watched` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `playback_user_updated_idx` ON `playback_state` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `seasons` (
	`id` text PRIMARY KEY NOT NULL,
	`show_id` text NOT NULL,
	`season_number` integer NOT NULL,
	`title` text,
	`overview` text,
	`poster_key` text,
	`tmdb_id` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seasons_show_number_idx` ON `seasons` (`show_id`,`season_number`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`device_name` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_idx` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shows` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`title` text NOT NULL,
	`sort_title` text NOT NULL,
	`year` integer,
	`tmdb_id` integer,
	`anilist_id` integer,
	`overview` text,
	`genres_json` text DEFAULT '[]' NOT NULL,
	`rating` integer,
	`first_air_date` text,
	`poster_key` text,
	`backdrop_key` text,
	`needs_review` integer DEFAULT true NOT NULL,
	`season_offset` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shows_library_idx` ON `shows` (`library_id`);--> statement-breakpoint
CREATE INDEX `shows_tmdb_idx` ON `shows` (`tmdb_id`);--> statement-breakpoint
CREATE TABLE `streams` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`stream_index` integer NOT NULL,
	`type` text NOT NULL,
	`codec` text NOT NULL,
	`language` text,
	`title` text,
	`is_default` integer DEFAULT false NOT NULL,
	`is_forced` integer DEFAULT false NOT NULL,
	`width` integer,
	`height` integer,
	`channels` integer,
	FOREIGN KEY (`file_id`) REFERENCES `media_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `streams_file_index_idx` ON `streams` (`file_id`,`stream_index`);--> statement-breakpoint
CREATE TABLE `subtitles` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`source` text NOT NULL,
	`stream_index` integer,
	`language` text,
	`title` text,
	`format` text NOT NULL,
	`vtt_path` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `media_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `subtitles_file_idx` ON `subtitles` (`file_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`pin_hash` text NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`avatar_color` text NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
