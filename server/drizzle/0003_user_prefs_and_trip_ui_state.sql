-- v353.2: server-side prefs + per-trip UI state
--
-- Adds user_prefs table (one JSON blob per user — paceHours and
-- future cross-device prefs) and ui_state column on trips (per-trip
-- UI flags that should follow the trip across devices, separate
-- from device-local UI like panel widths).
--
-- Idempotent: ALTER TABLE for an existing column would fail, but
-- ui_state is new on trips, so the ADD COLUMN runs once cleanly.

CREATE TABLE `user_prefs` (
	`user_id` text PRIMARY KEY NOT NULL,
	`prefs` text DEFAULT '{}' NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now') * 1000) NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `trips` ADD COLUMN `ui_state` text DEFAULT '{}';
