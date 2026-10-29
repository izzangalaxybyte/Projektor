CREATE TABLE `comic_books` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`series_id` text NOT NULL,
	`path` text NOT NULL,
	`file_name` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`mtime_ms` integer NOT NULL,
	`format` text,
	`indexed_at` text,
	`index_error` text,
	`page_count` integer,
	`pages_json` text,
	`volume` real,
	`chapter` real,
	`bare` integer DEFAULT false NOT NULL,
	`special` integer DEFAULT false NOT NULL,
	`title` text,
	`summary` text,
	`writer` text,
	`year` integer,
	`direction` text,
	`cover_key` text,
	`missing` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`series_id`) REFERENCES `comic_series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `comic_books_path_idx` ON `comic_books` (`path`);--> statement-breakpoint
CREATE INDEX `comic_books_series_idx` ON `comic_books` (`series_id`);--> statement-breakpoint
CREATE INDEX `comic_books_library_idx` ON `comic_books` (`library_id`);--> statement-breakpoint
CREATE TABLE `comic_progress` (
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`page` integer NOT NULL,
	`page_count` integer NOT NULL,
	`finished` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `book_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `comic_books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comic_progress_user_updated_idx` ON `comic_progress` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `comic_series` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`folder_key` text NOT NULL,
	`title` text NOT NULL,
	`sort_title` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `comic_series_folder_idx` ON `comic_series` (`library_id`,`folder_key`);