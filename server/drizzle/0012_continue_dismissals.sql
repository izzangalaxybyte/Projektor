CREATE TABLE `continue_dismissals` (
	`user_id` text NOT NULL,
	`item_id` text NOT NULL,
	`dismissed_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
