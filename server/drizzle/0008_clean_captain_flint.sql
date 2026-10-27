CREATE TABLE `track_preferences` (
	`user_id` text NOT NULL,
	`show_id` text NOT NULL,
	`audio_set` integer DEFAULT false NOT NULL,
	`audio_language` text,
	`audio_title` text,
	`subtitle_set` integer DEFAULT false NOT NULL,
	`subtitle_off` integer DEFAULT false NOT NULL,
	`subtitle_language` text,
	`subtitle_title` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `show_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade
);
