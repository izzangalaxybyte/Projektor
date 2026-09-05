CREATE TABLE `recordings` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`channel_name` text NOT NULL,
	`channel_logo_url` text,
	`title` text NOT NULL,
	`description` text,
	`programme_id` text,
	`start_at` text NOT NULL,
	`end_at` text,
	`actual_start_at` text,
	`actual_end_at` text,
	`state` text NOT NULL,
	`file_path` text,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`error` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `recordings_state_start_idx` ON `recordings` (`state`,`start_at`);