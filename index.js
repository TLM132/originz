const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const config = require('./config.json');

const allowedUsers = ["1482671904488685673"];
const GUILD_ID = "1560960745217196054";

const SAVE_FILE = path.join(__dirname, 'save.json');

let saveData = {
  raidLogs: [],
  staffPoints: {},
  tickets: [],
  trustedBotAdders: [],
  adultLogs: []
};

if (fs.existsSync(SAVE_FILE)) {
  try {
    saveData = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
  } catch {
    saveData = {
      raidLogs: [],
      staffPoints: {},
      tickets: [],
      trustedBotAdders: [],
      adultLogs: []
    };
  }
}

function saveAll() {
  try {
    fs.writeFileSync(SAVE_FILE, JSON.stringify(saveData, null, 2));
  } catch (e) {
    console.error('Failed to save data:', e);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.on('ready', async () => {
  const guild = client.guilds.cache.get(GUILD_ID);
  if (guild) {
    await guild.members.fetch();
    console.log(`Bot ready. Cached members: ${guild.members.cache.size}`);
  } else {
    console.log('Bot ready. Guild not found.');
  }
});

/* ------------------------------
   BOT ADDER PROTECTION SYSTEM
--------------------------------*/

client.on('guildMemberAdd', async member => {
  if (!member.user.bot) return;

  const guild = member.guild;
  const logs = await guild.fetchAuditLogs({ type: 28, limit: 1 }).catch(() => null);
  if (!logs) return;
  const entry = logs.entries.first();
  if (!entry) return;

  const adderId = entry.executor.id;

  if (!saveData.trustedBotAdders.includes(adderId)) {
    await member.kick("Untrusted user added a bot").catch(() => {});

    saveData.raidLogs.push({
      message: `Kicked bot ${member.user.tag} added by untrusted user ${adderId}`,
      timestamp: Date.now()
    });
    saveAll();
  } else {
    saveData.raidLogs.push({
      message: `Trusted user ${adderId} added bot ${member.user.tag} (allowed)`,
      timestamp: Date.now()
    });
    saveAll();
  }
});

/* ------------------------------
   ADULT LOGS
--------------------------------*/

function addAdultLog(text) {
  saveData.adultLogs.push(`[${new Date().toLocaleString()}] ${text}`);
  saveAll();
}

client.on('messageDelete', msg => {
  if (!msg.guild) return;
  addAdultLog(`Message deleted in #${msg.channel.name} by ${msg.author?.tag || 'Unknown'}: "${msg.content}"`);
});

client.on('messageUpdate', (o, n) => {
  if (!o.guild) return;
  addAdultLog(`Message edited in #${o.channel.name} by ${o.author?.tag || 'Unknown'}: "${o.content}" → "${n.content}"`);
});

client.on('guildMemberRemove', m => {
  addAdultLog(`${m.user.tag} left or was kicked from ${m.guild.name}`);
});

client.on('guildBanAdd', b => {
  addAdultLog(`${b.user.tag} was banned from ${b.guild.name}`);
});

client.on('channelCreate', c => {
  addAdultLog(`Channel created in ${c.guild.name}: #${c.name}`);
});

client.on('channelDelete', c => {
  addAdultLog(`Channel deleted in ${c.guild.name}: #${c.name}`);
});

client.on('roleCreate', r => {
  addAdultLog(`Role created in ${r.guild.name}: ${r.name}`);
});

client.on('roleDelete', r => {
  addAdultLog(`Role deleted in ${r.guild.name}: ${r.name}`);
});

/* ------------------------------
   EXPRESS DASHBOARD
--------------------------------*/

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ⭐ FIX: ROOT ROUTE */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

/* ACCESS CHECK */
app.get('/api/access-check', (req, res) => {
  const userId = req.headers['x-user-id'];
  res.json({ allowed: allowedUsers.includes(userId) });
});

/* GUILD DATA */
app.get('/api/guild/data', async (req, res) => {
  const guild = client.guilds.cache.get(GUILD_ID);

  if (!guild) {
    return res.json({ members: [], categories: [], textChannels: [] });
  }

  const members = guild.members.cache
    .filter(m => !m.user.bot)
    .map(m => ({ id: m.user.id, name: m.user.username }));

  const categories = guild.channels.cache
    .filter(ch => ch.type === 4)
    .map(ch => ({ id: ch.id, name: ch.name }));

  const textChannels = guild.channels.cache
    .filter(ch => ch.type === 0)
    .map(ch => ({ id: ch.id, name: ch.name }));

  res.json({ members, categories, textChannels });
});

/* RAID LOGS */
app.get('/api/raid/logs', (req, res) => {
  res.json({ logs: saveData.raidLogs });
});

/* STAFF SYSTEM */
app.post('/api/staff/add-points', (req, res) => {
  const { userId, points } = req.body;
  saveData.staffPoints[userId] = (saveData.staffPoints[userId] || 0) + Number(points);
  saveAll();
  res.json({ success: true });
});

app.get('/api/staff/get-points', (req, res) => {
  const { userId } = req.query;
  res.json({ total: saveData.staffPoints[userId] || 0 });
});

app.get('/api/staff/all-points', (req, res) => {
  const guild = client.guilds.cache.get(GUILD_ID);
  const result = [];

  for (const [id, pts] of Object.entries(saveData.staffPoints)) {
    let name = id;
    if (guild) {
      const m = guild.members.cache.get(id);
      if (m) name = m.user.username;
    }
    result.push({ id, name, points: pts });
  }

  res.json({ points: result });
});

app.post('/api/staff/warn', (req, res) => {
  const { userId, reason } = req.body;
  saveData.raidLogs.push({
    message: `Warned user ${userId}: ${reason}`,
    timestamp: Date.now()
  });
  saveAll();
  res.json({ success: true });
});

app.post('/api/staff/kick', async (req, res) => {
  const { userId } = req.body;
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return res.json({ success: false });

  const member = guild.members.cache.get(userId);
  if (!member) return res.json({ success: false });

  await member.kick('Panel kick').catch(() => {});
  saveData.raidLogs.push({
    message: `Kicked user ${userId} via panel`,
    timestamp: Date.now()
  });
  saveAll();
  res.json({ success: true });
});

app.post('/api/staff/ban', async (req, res) => {
  const { userId } = req.body;
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return res.json({ success: false });

  await guild.members.ban(userId, { reason: 'Panel ban' }).catch(() => {});
  saveData.raidLogs.push({
    message: `Banned user ${userId} via panel`,
    timestamp: Date.now()
  });
  saveAll();
  res.json({ success: true });
});

/* TICKET PANEL */
app.post('/api/tickets/create', async (req, res) => {
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return res.json({ success: false });

  const channel = guild.channels.cache.get(req.body.panelChannelId);
  if (!channel) return res.json({ success: false });

  const title = req.body.title?.trim() || "New Ticket";
  const description = req.body.description?.trim() || "Click the button below to open a ticket.";

  let customId = `open_ticket_${Date.now()}`;

  try {
    await channel.send({
      embeds: [{
        title,
        description,
        color: 0xff6a00
      }],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(customId)
            .setLabel('Open Ticket')
            .setStyle(ButtonStyle.Primary)
        )
      ]
    });
  } catch {
    return res.json({ success: false });
  }

  saveData.tickets.push({
    id: saveData.tickets.length + 1,
    title,
    description,
    category: req.body.category,
    panelChannelId: req.body.panelChannelId,
    ticketChannelId: null,
    open: true
  });
  saveAll();

  res.json({ success: true });
});

/* TICKET BUTTON HANDLER */
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  if (interaction.customId.startsWith("open_ticket_")) {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return;

    const ticketChannel = await guild.channels.create({
      name: `ticket-${interaction.user.username}`,
      type: 0,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: ['ViewChannel'] },
        { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages'] }
      ]
    }).catch(() => null);

    if (!ticketChannel) {
      return interaction.reply({ content: "Failed to create ticket channel.", ephemeral: true });
    }

    await interaction.reply({
      content: `Your ticket has been created: <#${ticketChannel.id}>`,
      ephemeral: true
    });

    await ticketChannel.send({
      embeds: [{
        title: "Ticket Opened",
        description: `Welcome <@${interaction.user.id}>!\nA staff member will be with you shortly.`,
        color: 0xff6a00
      }],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`close_ticket_${ticketChannel.id}`)
            .setLabel('Close Ticket')
            .setStyle(ButtonStyle.Danger)
        )
      ]
    });

    const t = saveData.tickets.find(x => x.open && x.ticketChannelId === null);
    if (t) {
      t.ticketChannelId = ticketChannel.id;
      saveAll();
    }
  }

  if (interaction.customId.startsWith("close_ticket_")) {
    const channelId = interaction.customId.split("_")[2];
    const channel = interaction.guild.channels.cache.get(channelId);

    await interaction.reply({ content: "Closing ticket...", ephemeral: true });
    if (channel) await channel.delete().catch(() => {});

    saveData.tickets = saveData.tickets.map(t => {
      if (t.ticketChannelId === channelId) {
        return { ...t, open: false };
      }
      return t;
    });
    saveAll();
  }
});

/* TICKET LIST */
app.get('/api/tickets/list', (req, res) => {
  res.json({ tickets: saveData.tickets });
});

app.post('/api/tickets/close-all', async (req, res) => {
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return res.json({ success: false });

  guild.channels.cache.forEach(async ch => {
    if (ch.name.startsWith("ticket-")) {
      await ch.delete().catch(() => {});
    }
  });

  saveData.tickets = [];
  saveAll();
  res.json({ success: true });
});

/* TRUSTED BOT ADDERS */
app.post('/api/bots/add-trusted', (req, res) => {
  const executorId = req.headers['x-user-id'];
  const { userId } = req.body;

  if (!allowedUsers.includes(executorId)) {
    return res.json({ success: false, error: "Not allowed" });
  }

  if (!saveData.trustedBotAdders.includes(userId)) {
    saveData.trustedBotAdders.push(userId);
    saveData.raidLogs.push({
      message: `Trusted bot adder added: ${userId} by ${executorId}`,
      timestamp: Date.now()
    });
    saveAll();
  }

  res.json({ success: true });
});

app.post('/api/bots/remove-trusted', (req, res) => {
  const executorId = req.headers['x-user-id'];
  const { userId } = req.body;

  if (!allowedUsers.includes(executorId)) {
    return res.json({ success: false, error: "Not allowed" });
  }

  saveData.trustedBotAdders = saveData.trustedBotAdders.filter(u => u !== userId);
  saveData.raidLogs.push({
    message: `Trusted bot adder removed: ${userId} by ${executorId}`,
    timestamp: Date.now()
  });
  saveAll();

  res.json({ success: true });
});

app.get('/api/bots/trusted-list', (req, res) => {
  const guild = client.guilds.cache.get(GUILD_ID);

  if (!guild) {
    return res.json({ trusted: saveData.trustedBotAdders });
  }

  const list = saveData.trustedBotAdders.map(id => {
    const member = guild.members.cache.get(id);
    return member ? `${member.user.username} (${id})` : id;
  });

  res.json({ trusted: list });
});

/* ADULT LOGS */
app.get('/api/adult/logs', (req, res) => {
  res.json({ logs: saveData.adultLogs.slice().reverse() });
});

/* SAVE ALL */
app.post('/api/save-all', (req, res) => {
  saveAll();
  res.json({ success: true });
});

/* START SERVER */
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:3000/dashboard.html`);
});

client.login(config.token);
