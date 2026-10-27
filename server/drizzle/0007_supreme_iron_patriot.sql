CREATE TABLE `favorites` (
	`user_id` text NOT NULL,
	`item_id` text NOT NULL,
	`item_kind` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `favorites_user_created_idx` ON `favorites` (`user_id`,`created_at`);