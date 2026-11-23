CREATE TABLE `subtask_links` (
	`subtask_id` integer NOT NULL,
	`pr_key` text NOT NULL,
	PRIMARY KEY(`subtask_id`, `pr_key`)
);
--> statement-breakpoint
CREATE INDEX `subtask_links_pr_idx` ON `subtask_links` (`pr_key`);--> statement-breakpoint
CREATE TABLE `subtasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_number` integer NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`assignee` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subtasks_ticket_number_uidx` ON `subtasks` (`ticket_number`,`number`);--> statement-breakpoint
ALTER TABLE `tickets` ADD `subtask_seq` integer DEFAULT 0 NOT NULL;