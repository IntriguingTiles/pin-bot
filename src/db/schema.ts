import { int, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const guildSettings = sqliteTable("guild_settings", {
    guildId: text().primaryKey(),
    pinChannel: text(),
    pinReactThreshold: int().notNull().default(0),
});

export const pins = sqliteTable("pins", {
    guildId: text().notNull().references(() => guildSettings.guildId, { onDelete: "cascade" }),
    msgId: text().notNull(),
}, table => [
    primaryKey({ columns: [table.guildId, table.msgId] })
]);
