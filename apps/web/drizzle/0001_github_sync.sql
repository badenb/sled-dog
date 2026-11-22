CREATE TABLE `github_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`last_synced_at` text,
	`last_error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_sources_unique` ON `github_sources` (`organization_id`,`kind`,`name`);--> statement-breakpoint
CREATE TABLE `pull_requests` (
	`key` text PRIMARY KEY NOT NULL,
	`repo` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`state` text NOT NULL,
	`draft` integer DEFAULT false NOT NULL,
	`author` text,
	`head_branch` text,
	`base_branch` text,
	`additions` integer,
	`deletions` integer,
	`review_decision` text,
	`checks` text DEFAULT 'none' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`merged_at` text,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ticket_links` (
	`ticket_number` integer NOT NULL,
	`pr_key` text NOT NULL,
	PRIMARY KEY(`ticket_number`, `pr_key`)
);
--> statement-breakpoint
CREATE INDEX `ticket_links_pr_idx` ON `ticket_links` (`pr_key`);