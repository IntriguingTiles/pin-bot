require("dotenv").config();
const Discord = require("discord.js");
const Enmap = require("enmap");

const client = new Discord.Client({ intents: [Discord.Intents.FLAGS.GUILDS, Discord.Intents.FLAGS.GUILD_MESSAGES, Discord.Intents.FLAGS.GUILD_MESSAGE_REACTIONS], allowedMentions: [], partials: ["MESSAGE", "CHANNEL", "REACTION"] });

const prefix = "+";

const guildSettings = new Enmap({
    name: "guildSettings",
    fetchAll: false,
    autoFetch: true,
    cloneLevel: "deep"
});

const defaultSettings = {
    pinChannel: null,
    pinReactThreshold: 0, // 0 means this is turned off
    pins: [] // array of message ids that we've posted in the pin channel
};

client.login(process.env.DISCORD_TOKEN);

process.on("unhandledRejection", err => {
    console.error(`Unhandled promise rejection!\n${err.stack}`);
    //client.users.cache.get("221017760111656961").send(err.stack);
});

client.on("error", console.error);
client.on("warn", console.warn);

client.on("ready", () => {
    console.log(`Logged in as ${client.user.username}`);

    client.user.setActivity("+help");
});

client.on("guildCreate", async guild => {
    guildSettings.set(guild.id, defaultSettings);
});

client.on("guildDelete", async guild => {
    guildSettings.delete(guild.id);
});

client.on("channelPinsUpdate", async (ch, date) => {
    // we need to figure out if a message was pinned or unpinned
    if (ch.type !== "GUILD_TEXT") return;
    const settings = guildSettings.get(ch.guild.id);

    if (!settings.pinChannel) return;

    if (Date.now() - date.getTime() < 2000) {
        // message pinned (probably)
        const currentPins = await ch.messages.fetchPinned();
        const msg = currentPins.first();

        if (settings.pinChannel && !settings.pins.includes(msg.id)) {
            const webhooks = await client.channels.cache.get(settings.pinChannel).fetchWebhooks().catch(() => { /* I'm cheating */ }); // throws an error when we don't have access
            if (!webhooks) return;

            /** @type {Discord.Webhook} */
            let webhook;

            if (webhooks.size === 0) {
                // try and make a new webhook
                webhook = await client.channels.cache.get(settings.pinChannel).createWebhook("PinBot", client.user.avatarURL({ format: "png" }), "A webhook is required for impersonation");
            } else {
                webhook = webhooks.first(); // the webhook we use doesn't matter since we override the profile picture and name
            }

            const files = msg.attachments.size !== 0 ? [msg.attachments.first().url] : [];
            let content = undefined;
            if (msg.cleanContent.length > 0) content = msg.cleanContent.replace(/@/g, "@" + String.fromCharCode(8203));
            webhook.send({ content: content, username: msg.author.username, avatarURL: msg.author.displayAvatarURL({ format: "png" }), files: files, embeds: msg.embeds }); // impersonate the author
            settings.pins.push(msg.id);
            guildSettings.set(ch.guild.id, settings);
        }
    }
});

client.on("messageReactionAdd", async (react, user) => {
    if (react.partial) {
        await react.fetch();
        await react.users.fetch();
    }

    if (user.partial) {
        await user.fetch();
    }

    if (react.message.channel.type !== "GUILD_TEXT" || user.id === react.message.author.id || react.emoji.name !== "📌") return;

    const settings = guildSettings.get(react.message.guild.id);

    if (!settings.pinChannel || settings.pinReactThreshold === 0) return;
    if (react.users.cache.filter(u => !u.bot).size !== settings.pinReactThreshold) return;
    if (settings.pins.includes(react.message.id)) return; // message already pinned
    // pin requirements met, let's check if we can impersonate the author of the message
    const pinChannel = client.channels.cache.get(settings.pinChannel);

    if (!pinChannel) return;
    const webhooks = await pinChannel.fetchWebhooks().catch(() => { /* I'm cheating */ }); // throws an error when we don't have access
    if (!webhooks) return;

    let webhook;

    if (webhooks.size === 0) {
        // try and make a new webhook
        webhook = await pinChannel.createWebhook("PinBot", client.user.avatarURL({ format: "png" }), "A webhook is required for impersonation");
    } else {
        webhook = webhooks.first(); // the webhook we use doesn't mater since we override the profile picture and name
    }

    const msg = react.message;
    const files = msg.attachments.size !== 0 ? [msg.attachments.first().url] : [];
    let content = undefined;
    if (msg.cleanContent.length > 0) content = msg.cleanContent.replace(/@/g, "@" + String.fromCharCode(8203));
    webhook.send({ content: content, username: msg.author.username, avatarURL: msg.author.displayAvatarURL({ format: "png" }), files: files, embeds: msg.embeds }); // impersonate the author
    settings.pins.push(msg.id);
    guildSettings.set(msg.guild.id, settings);
});

client.on("messageCreate", async msg => {
    if (msg.channel.type !== "GUILD_TEXT") return;
    if (!msg.content.startsWith(prefix)) return;
    if (!msg.channel.permissionsFor(client.user).has("SEND_MESSAGES")) return;
    if (msg.author.bot) return;

    const args = msg.content.split(" ").slice(1);
    const cmd = msg.content.slice(prefix.length).split(" ")[0];

    if (!guildSettings.has(msg.guild.id)) guildSettings.set(msg.guild.id, defaultSettings);
    const settings = guildSettings.get(msg.guild.id);

    switch (cmd) {
        case "help":
            msg.channel.send(`Commands list: \`\`\`
${prefix}set pins <channel>
${prefix}set reacts <number of reactions required to auto-pin a message>
${prefix}unset pins
${prefix}unset reacts
${prefix}help\`\`\``);
            break;
        case "set":
            if (!msg.member.permissions.has("MANAGE_GUILD", true) && msg.author.id !== "221017760111656961") return msg.channel.send("You need to have Manage Server permissions to use this command!");
            switch (args[0]) {
                case "pins":
                    if (msg.mentions.channels.size !== 1) return msg.channel.send(`Usage: ${prefix}set pins <channel>`, { code: "" });
                    if (msg.mentions.channels.first().guild.id !== msg.guild.id) return msg.channel.send("That channel isn't in this server!");
                    if (msg.mentions.channels.first().type !== "GUILD_TEXT") return msg.channel.send("Not a text channel!");
                    settings.pinChannel = msg.mentions.channels.first().id;
                    guildSettings.set(msg.guild.id, settings);
                    return msg.channel.send("Successfully set pin channel! Make sure I have permission to manage webhooks!");
                case "reacts":
                    if (args.length !== 2) return msg.channel.send(`Usage: ${prefix}set reacts <number of reactions required to auto-pin a message>`, { code: "" });
                    if (isNaN(parseInt(args[1]))) return msg.channel.send("Not a number!");
                    settings.pinReactThreshold = parseInt(args[1]);
                    guildSettings.set(msg.guild.id, settings);
                    return msg.channel.send("Successfully set react threshold!");
            }
            break;
        case "unset":
            if (!msg.member.permissions.has("MANAGE_GUILD", true) && msg.author.id !== "221017760111656961") return msg.channel.send("You need to have Manage Server permissions to use this command!");
            switch (args[0]) {
                case "pins":
                    settings.pinChannel = defaultSettings.pinChannel;
                    guildSettings.set(msg.guild.id, settings);
                    return msg.channel.send("Successfully unset pin channel!");
                case "reacts":
                    settings.pinReactThreshold = defaultSettings.pinReactThreshold;
                    guildSettings.set(msg.guild.id, settings);
                    return msg.channel.send("Successfully unset react threshold");
            }
            break;
        case "eval":
            if (msg.author.id !== "221017760111656961") return;

            try {
                const code = args.join(" ");
                let evaled = eval(code);

                if (typeof evaled !== "string")
                    evaled = require("util").inspect(evaled);

                msg.channel.send(clean(evaled), { code: "xl" }).catch(() => msg.channel.send("Result too big to send."));
            } catch (err) {
                msg.channel.send(`\`ERROR\` \`\`\`xl\n${clean(err)}\n\`\`\``);
            }
            break;
    }
});

process.on("SIGINT", async () => {
    guildSettings.close();
    await client.destroy();
    process.exit(0);
});

process.on("message", async msg => {
    if (msg === "shutdown") {
        guildSettings.close();
        await client.destroy();
        process.exit(0);
    }
});

function clean(text) {
    if (typeof (text) === "string")
        return text.replace(/`/g, "`" + String.fromCharCode(8203)).replace(/@/g, "@" + String.fromCharCode(8203));
    else
        return text;
}