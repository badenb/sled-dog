CREATE TABLE `workspace_settings` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`archive_after` integer DEFAULT 30 NOT NULL,
	`archive_unit` text DEFAULT 'days' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tickets` ADD `closed_at` text;--> statement-breakpoint
ALTER TABLE `tickets` ADD `archived_at` text;--> statement-breakpoint
CREATE INDEX `tickets_archived_idx` ON `tickets` (`archived_at`);
--> statement-breakpoint
-- Backfill: tickets that are already done or canceled get closed_at = updated_at, the best information available.
UPDATE `tickets` SET `closed_at` = `updated_at` WHERE `status` IN ('done', 'canceled');
