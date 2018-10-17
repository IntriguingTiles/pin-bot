require("dotenv").config();
const Discord = require("discord.js");
const Enamp = require("enmap");

const client = new Discord.Client({ disableEveryone: true });

const prefix = "+";

const cachedPins = new Map();

const guildSettings = new Enamp({
    name: "guildSettings",
    fetchAll: false,
    autoFetch: true,
    cloneLevel: "deep"
});

const defaultSettings = {
    pinChannel: null,
    logChannel: null,
    pinReactThreshold: 0, // 0 means this is turned off
    pins: [] // array of message ids that we've posted in the pin channel
};

client.login(process.env.DISCORD_TOKEN);

process.on("unhandledRejection", err => {
    console.error(`Unhandled promise rejection!\n${err.stack}`);
    client.users.get("221017760111656961").send(err.stack);
});

client.on("error", console.error);
client.on("warn", console.warn);

client.on("ready", () => {
    console.log(`Logged in as ${client.user.username}`);

    // cache pins
    guildSettings.fetchEverything();
    guildSettings.filter(gs => gs.logChannel || gs.pinChannel).forEach((gs, id) => {
        client.guilds.get(id).channels.filter(ch => ch.type === "text" && ch.permissionsFor(client.user).has("VIEW_CHANNEL")).forEach(async ch => {
            const pins = await ch.fetchPinnedMessages();
            cachedPins.set(ch.id, pins);
            console.log(ch.name);
        });
    });
    guildSettings.evict(client.guilds.keyArray());

    client.user.setActivity("+help");
});

client.on("guildCreate", async guild => {
    guildSettings.set(guild.id, defaultSettings);
    guild.channels.filter(ch => ch.type === "text" && ch.permissionsFor(client.user).has("VIEW_CHANNEL")).forEach(async ch => {
        const pins = await ch.fetchPinnedMessages();
        cachedPins.set(ch.id, pins);
        console.log(ch.name);
    });
});

client.on("guildDelete", async guild => {
    guildSettings.delete(guild.id);
    guild.channels.forEach(ch => cachedPins.delete(ch.id));
});

client.on("channelCreate", async ch => {
    // channel created, fetch the pins and add it to our map
    if (ch.type !== "text") return;
    if (!guildSettings.get(ch.guild.id)) return;
    if (!guildSettings.get(ch.guild.id).logChannel && !guildSettings.get(ch.guild.id).pinChannel) return;
    const pins = await ch.fetchPinnedMessages();
    cachedPins.set(ch.id, pins);
});

client.on("channelDelete", async ch => {
    // channel deleted, remove it from our map
    if (ch.type !== "text") return;
    if (cachedPins.has(ch.id)) cachedPins.delete(ch.id);
});

client.on("channelPinsUpdate", async ch => {
    // we need to figure out if a message was pinned or unpinned for logging purposes
    if (ch.type !== "text") return;
    const settings = guildSettings.get(ch.guild.id);

    if (!settings.pinChannel && !settings.logChannel) return;

    const currentPins = await ch.fetchPinnedMessages();
    const previousPins = cachedPins.get(ch.id);
    let size;

    if (!previousPins) size = 0;
    else size = previousPins.size;

    if (currentPins.size > size) {
        // message pinned
        const msg = currentPins.first();
        if (settings.logChannel) {

            const embed = new Discord.RichEmbed;

            embed.setAuthor(msg.author.tag, msg.author.displayAvatarURL);
            embed.setDescription(`**Message sent by ${msg.author} pinned in ${ch}**\n${msg.content}`);
            embed.setFooter(`ID: ${msg.id}`);
            embed.setTimestamp();
            embed.setColor(0x23D160);
            if (msg.attachments.size !== 0) embed.setImage(msg.attachments.first().url);

            client.channels.get(settings.logChannel).send({ embed }).catch(() => { });
        }

        if (settings.pinChannel && !settings.pins.includes(msg.id)) {
            const webhooks = await client.channels.get(settings.pinChannel).fetchWebhooks().catch(() => { /* I'm cheating */ }); // throws an error when we don't have access
            if (!webhooks) return;

            let webhook;

            if (webhooks.size === 0) {
                // try and make a new webhook
                webhook = await client.channels.get(settings.pinChannel).createWebhook("PinBot", client.user.avatarURL, "A webhook is required for impersonation");
            } else {
                webhook = webhooks.array()[0]; // the webhook we use doesn't mater since we override the profile picture and name
            }

            const files = msg.attachments.size !== 0 ? [msg.attachments.first().url] : [];
            webhook.send(msg.cleanContent, { username: msg.author.username, avatarURL: msg.author.displayAvatarURL, files, disableEveryone: true }); // impersonate the author
            settings.pins.push(msg.id);
            guildSettings.set(ch.guild.id, settings);
        }
    } else if (currentPins.size < previousPins.size && settings.logChannel) {
        // message unpinned
        const embed = new Discord.RichEmbed;

        previousPins.forEach(pin => {

            if (!currentPins.has(pin.id)) {
                // found the removed pin
                const msg = pin;

                embed.setAuthor(msg.author.tag, msg.author.displayAvatarURL);
                embed.setDescription(`**Message sent by ${msg.author} unpinned in ${ch}**\n${msg.content}`);
                embed.setFooter(`ID: ${msg.id}`);
                embed.setTimestamp();
                embed.setColor(0xFF470F);
                if (msg.attachments.size !== 0) embed.setImage(msg.attachments.first().url);

                client.channels.get(settings.logChannel).send({ embed }).catch(() => { });
            }
        });
    }
    cachedPins.set(ch.id, currentPins);
});

client.on("messageReactionAdd", async (react, user) => {
    if (react.message.channel.type !== "text" || user.id === react.message.author.id || react.emoji.name !== "📌") return;

    const settings = guildSettings.get(react.message.guild.id);

    if (!settings.pinChannel || settings.pinReactThreshold === 0) return;
    if (react.users.filter(u => !u.bot).size !== settings.pinReactThreshold) return;
    if (settings.pins.includes(react.message.id)) return; // message already pinned
    // pin requirements met, let's check if we can impersonate the author of the message
    const pinChannel = client.channels.get(settings.pinChannel);

    if (!pinChannel) return;
    const webhooks = await pinChannel.fetchWebhooks().catch(() => { /* I'm cheating */ }); // throws an error when we don't have access
    if (!webhooks) return;

    let webhook;

    if (webhooks.size === 0) {
        // try and make a new webhook
        webhook = await pinChannel.createWebhook("PinBot", client.user.avatarURL, "A webhook is required for impersonation");
    } else {
        webhook = webhooks.array()[0]; // the webhook we use doesn't mater since we override the profile picture and name
    }

    const msg = react.message;
    const files = msg.attachments.size !== 0 ? [msg.attachments.first().url] : [];
    webhook.send(msg.cleanContent, { username: msg.author.username, avatarURL: msg.author.displayAvatarURL, files, embeds: msg.embeds, disableEveryone: true }); // impersonate the author
    settings.pins.push(msg.id);
    guildSettings.set(msg.guild.id, settings);
});

client.on("message", async msg => {
    if (msg.channel.type !== "text") return;
    if (!msg.content.startsWith(prefix)) return;
    if (!msg.channel.permissionsFor(client.user).has("SEND_MESSAGES")) return;
    if (msg.author.bot) return;

    const args = msg.content.split(" ").slice(1);
    const cmd = msg.content.slice(prefix.length).split(" ")[0];

    const settings = guildSettings.get(msg.guild.id);

    switch (cmd) {
        case "help":
            msg.channel.send(`Commands list: \`\`\`
${prefix}set logs <channel>
${prefix}set pins <channel>
${prefix}set reacts <number of reactions required to auto-pin a message>
${prefix}unset logs
${prefix}unset pins
${prefix}unset reacts
${prefix}help\`\`\``);
            break;
        case "set":
            if (!msg.member.permissions.has("MANAGE_GUILD", true) && msg.author.id !== "221017760111656961") return msg.channel.send("You need to have Manage Server permissions to use this command!");
            switch (args[0]) {
                case "logs":
                    if (msg.mentions.channels.size !== 1) return msg.channel.send(`Usage: ${prefix}set logs <channel>`, { code: "" });
                    if (msg.mentions.channels.first().guild.id !== msg.guild.id) return msg.channel.send("That channel isn't in this server!");
                    if (msg.mentions.channels.first().type !== "text") return msg.channel.send("Not a text channel!");
                    settings.logChannel = msg.mentions.channels.first().id;
                    guildSettings.set(msg.guild.id, settings);
                    return msg.channel.send("Successfully set log channel!");
                case "pins":
                    if (msg.mentions.channels.size !== 1) return msg.channel.send(`Usage: ${prefix}set pins <channel>`, { code: "" });
                    if (msg.mentions.channels.first().guild.id !== msg.guild.id) return msg.channel.send("That channel isn't in this server!");
                    if (msg.mentions.channels.first().type !== "text") return msg.channel.send("Not a text channel!");
                    settings.pinChannel = msg.mentions.channels.first().id;
                    guildSettings.set(msg.guild.id, settings);
                    return msg.channel.send("Successfully set pin channel! Make sure I have permission to manage webhooks for this channel!");
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
                case "logs":
                    settings.logChannel = defaultSettings.logChannel;
                    guildSettings.set(msg.guild.id, settings);
                    return msg.channel.send("Successfully unset log channel!");
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

                msg.channel.send(clean(evaled), { code: "xl" }).catch(err => msg.channel.send("Result too big to send."));
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

function clean(text) {
    if (typeof (text) === "string")
        return text.replace(/`/g, "`" + String.fromCharCode(8203)).replace(/@/g, "@" + String.fromCharCode(8203));
    else
        return text;
}