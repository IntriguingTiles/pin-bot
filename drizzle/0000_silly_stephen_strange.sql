CREATE TABLE `guild_settings` (
	`guildId` text PRIMARY KEY NOT NULL,
	`pinChannel` text,
	`pinReactThreshold` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pins` (
	`guildId` text NOT NULL,
	`msgId` text NOT NULL,
	PRIMARY KEY(`guildId`, `msgId`),
	FOREIGN KEY (`guildId`) REFERENCES `guild_settings`(`guildId`) ON UPDATE no action ON DELETE cascade
);
