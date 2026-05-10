-- v353.5: trip share tokens. One row per shareable read-only URL.
-- Cascades on trip delete. Idempotent — CREATE IF NOT EXISTS won't
-- error on re-run.

CREATE TABLE IF NOT EXISTS `share_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000) NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `share_tokens_trip_id_idx` ON `share_tokens` (`trip_id`);
