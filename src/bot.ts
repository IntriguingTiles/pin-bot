import { ActivityType, BaseGuildTextChannel, ChannelType, Client, Events, GatewayIntentBits, InteractionContextType, MessageFlags, MessageFlagsBitField, Partials, PermissionsBitField, SlashCommandBuilder } from "discord.js";
import { eq } from "drizzle-orm";
import { loadEnvFile } from "node:process";
import { db } from "./db/index.js";
import { guildSettings, pins } from "./db/schema.js";

try {
    loadEnvFile();
} catch {/**/ }

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
    ],
    partials: [
        Partials.User,
        Partials.GuildMember,
        Partials.Message,
        Partials.Reaction
    ],
    presence: {
        activities: [
            {
                type: ActivityType.Watching,
                name: "📌"
            }
        ]
    }
});

const guildSettingsCache = new Map<string, typeof guildSettings.$inferSelect>();

process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled promise rejection!", promise, reason);
});

client.on("error", console.error);
client.on("warn", console.warn);

client.on(Events.ClientReady, async readyClient => {
    console.log("Logged in as", readyClient.user.tag);
    console.log("Syncing commands...");
    await readyClient.application.commands.set(commands);
    console.log("Done.");
});

client.on(Events.GuildCreate, async guild => {
    await db.insert(guildSettings).values({ guildId: guild.id }).onConflictDoNothing();
});

client.on(Events.GuildDelete, async guild => {
    await db.delete(guildSettings).where(eq(guildSettings.guildId, guild.id));
});

client.on(Events.ChannelPinsUpdate, async (ch, lastPinTimestamp) => {
    if (ch.isDMBased()) return;
    const settings = await getGuildSettings(ch.guild.id);

    // this is here in case d.js makes some breaking change to fix their typings
    lastPinTimestamp satisfies Date;

    if (!settings.pinChannel || !lastPinTimestamp) return;

    // this awful type forcing needs to be done because d.js has incorrect typings
    // lPT is not Date but rather a number
    const timestamp = lastPinTimestamp as unknown as number;

    if (Date.now() - timestamp <= 2000) {
        // message pinned (probably)
        const currentPins = await ch.messages.fetchPins();
        const msg = currentPins.items[0];

        if (await isAlreadyPinned(ch.guild.id, msg.message.id)) return;

        try {
            await msg.message.forward(settings.pinChannel);
            await db.insert(pins).values({ guildId: ch.guild.id, msgId: msg.message.id });
        } catch (err) {
            console.error("Failed to forward message:\n", err);
        }
    }
});

client.on(Events.MessageReactionAdd, async (react, user) => {
    if (react.partial) {
        await react.fetch();
        await react.users.fetch();
    }

    if (user.partial) await user.fetch();
    if (react.message.partial) await react.message.fetch();

    if (react.message.channel.isDMBased() || !react.message.guild || !react.message.author || user.id === react.message.author.id || react.emoji.name !== "📌") {
        return;
    }

    const settings = await getGuildSettings(react.message.guild.id);

    if (!settings.pinChannel || settings.pinReactThreshold === 0) return;
    if (react.users.cache.filter(u => !u.bot && u.id !== react.message.author?.id).size < settings.pinReactThreshold) return;
    if (await isAlreadyPinned(react.message.guild.id, react.message.id)) return;

    try {
        await react.message.forward(settings.pinChannel);
        await db.insert(pins).values({ guildId: react.message.guild.id, msgId: react.message.id });
    } catch (err) {
        console.error("Failed to forward message:\n", err);
    }
});

client.on(Events.InteractionCreate, async intr => {
    if (!intr.guild || !intr.guild.members.me || !intr.isChatInputCommand()) return;

    if (intr.commandName === "config") {
        const guildSettings = await getGuildSettings(intr.guild.id);
        const subcommand = intr.options.getSubcommandGroup(false) ?? intr.options.getSubcommand();

        switch (subcommand) {
            case "show": {
                const content = `Forwarding pinned messages to: ${guildSettings.pinChannel ? `<#${guildSettings.pinChannel}>` : "nowhere"}
📌 reaction auto-pinning: ${guildSettings.pinReactThreshold > 0 ? `${guildSettings.pinReactThreshold} 📌 reactions required` : "disabled"}`;
                intr.reply({ content, flags: MessageFlags.Ephemeral });
                break;
            }
            case "pin-channel":
                if (intr.options.getSubcommand() === "unset") {
                    updateGuildSettings(intr.guild.id, { pinChannel: null });
                    intr.reply("Unset the pinned messages channel.");
                } else {
                    const ch = intr.options.getChannel("channel", true, [ChannelType.GuildText]);

                    if (!ch.permissionsFor(intr.guild.members.me).has(PermissionsBitField.Flags.ViewChannel))
                        return intr.reply({ content: `I don't have permission to view ${ch}.`, flags: MessageFlagsBitField.Flags.Ephemeral });
                    if (!ch.permissionsFor(intr.guild.members.me).has(PermissionsBitField.Flags.SendMessages))
                        return intr.reply({ content: `I don't have permission to send messages in ${ch}.`, flags: MessageFlagsBitField.Flags.Ephemeral });
                    if (!ch.permissionsFor(intr.guild.members.me).has(PermissionsBitField.Flags.EmbedLinks))
                        return intr.reply({ content: `I don't have permission to send embeds in ${ch}.`, flags: MessageFlagsBitField.Flags.Ephemeral });
                    if (!ch.permissionsFor(intr.guild.members.me).has(PermissionsBitField.Flags.AttachFiles))
                        return intr.reply({ content: `I don't have permission to attach files in ${ch}.`, flags: MessageFlagsBitField.Flags.Ephemeral });

                    updateGuildSettings(intr.guild.id, { pinChannel: ch.id });
                    let content = `Successfully set the pinned messages channel to ${ch}.`;
                    if (!ch.nsfw && intr.guild.channels.cache.filter(c => c instanceof BaseGuildTextChannel && c.nsfw).size > 0) {
                        content += "\n\nNote that messages in NSFW channels cannot be forwarded to non-NSFW channels.";
                    }
                    intr.reply(content);
                }
                break;
            case "react-threshold":
                if (intr.options.getSubcommand() === "unset") {
                    updateGuildSettings(intr.guild.id, { pinReactThreshold: 0 });
                    intr.reply("Disabled 📌 reaction auto-pinning.");
                } else {
                    const threshold = intr.options.getInteger("threshold", true);
                    updateGuildSettings(intr.guild.id, { pinReactThreshold: threshold });
                    intr.reply(`Set 📌 reaction auto-pinning threshold to ${threshold}.`);
                }
                break;
        }
    }
});

const commands = [
    new SlashCommandBuilder()
        .setName("config")
        .setDescription("Configure PinBot's settings.")
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
        .setContexts(InteractionContextType.Guild)
        .addSubcommand(cmd =>
            cmd.setName("show")
                .setDescription("View the current configuration.")
        )
        .addSubcommandGroup(cmdGroup =>
            cmdGroup.setName("pin-channel")
                .setDescription("Manage the channel where pinned messages will be forwarded to.")
                .addSubcommand(cmd =>
                    cmd.setName("set")
                        .setDescription("Set the channel where pinned messages will be forwarded to.")
                        .addChannelOption(option =>
                            option.setName("channel")
                                .setDescription("The channel to forward pinned messages to.")
                                .addChannelTypes(ChannelType.GuildText)
                                .setRequired(true)
                        )
                )
                .addSubcommand(cmd =>
                    cmd.setName("unset")
                        .setDescription("Unset the pinned messages channel.")
                )
        )
        .addSubcommandGroup(cmdGroup =>
            cmdGroup.setName("react-threshold")
                .setDescription("Manage 📌 reaction auto-pinning.")
                .addSubcommand(cmd =>
                    cmd.setName("set")
                        .setDescription("Set the number of 📌 reactions required to auto-pin a message.")
                        .addIntegerOption(option =>
                            option.setName("threshold")
                                .setDescription("The number of 📌 reactions required to auto-pin a message.")
                                .setMinValue(1)
                                .setRequired(true)
                        )
                )
                .addSubcommand(cmd =>
                    cmd.setName("unset")
                        .setDescription("Disable 📌 reaction auto-pinning.")
                )
        ).toJSON()
];

async function getGuildSettings(guildId: string): Promise<typeof guildSettings.$inferSelect> {
    const cached = guildSettingsCache.get(guildId);
    if (cached) return cached;

    await db.insert(guildSettings).values({ guildId }).onConflictDoNothing();
    const settings = await db.query.guildSettings.findFirst({ where: (table, { eq }) => eq(table.guildId, guildId) });

    if (!settings) throw new Error(`guildSettings missing for guild ${guildId}`);

    guildSettingsCache.set(guildId, settings);
    return settings;
}

async function updateGuildSettings(guildId: string, data: Partial<Omit<typeof guildSettings.$inferInsert, "guildId">>) {
    await db.update(guildSettings).set(data).where(eq(guildSettings.guildId, guildId));
    guildSettingsCache.delete(guildId);
}

async function isAlreadyPinned(guildId: string, msgId: string) {
    return await db.query.pins.findFirst({ where: (table, { eq }) => eq(table.guildId, guildId) && eq(table.msgId, msgId) });
}

process.on("SIGINT", async () => {
    await client.destroy();
    process.exit(0);
});

client.login(process.env.TOKEN);
