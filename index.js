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
  fs.writeFileSync(SAVE_FILE, JSON.stringify(saveData, null, 2));
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
  if (guild) await guild.members.fetch();
  console.log("Bot ready.");
});

/* ------------------------------
   EXPRESS DASHBOARD
--------------------------------*/

const app = express();
app.use(bodyParser.json());

/* ⭐ DEBUG LOG TO CONFIRM FILE EXISTS */
console.log("Checking dashboard file:", path.join(__dirname, "public", "dashboard.html"));
console.log("Directory listing of /public:");
try {
  console.log(fs.readdirSync(path.join(__dirname, "public")));
} catch (e) {
  console.log("PUBLIC FOLDER NOT FOUND");
}

/* ⭐ ROOT ROUTE — GUARANTEED WORKING */
app.get("/", (req, res) => {
  const filePath = path.join(__dirname, "public", "dashboard.html");
  console.log("Serving root file:", filePath);

  res.sendFile(filePath, err => {
    if (err) {
      console.error("ROOT ROUTE ERROR:", err);
      res.status(500).send("Dashboard file not found on server.");
    }
  });
});

/* STATIC FILES */
app.use(express.static(path.join(__dirname, 'public')));

/* ------------------------------
   ACCESS CHECK
--------------------------------*/

app.get('/api/access-check', (req, res) => {
  const userId = req.headers['x-user-id'];
  res.json({ allowed: allowedUsers.includes(userId) });
});

/* ------------------------------
   GUILD DATA
--------------------------------*/

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

/* ------------------------------
   RAID LOGS
--------------------------------*/

app.get('/api/raid/logs', (req, res) => {
  res.json({ logs: saveData.raidLogs });
});

/* ------------------------------
   STAFF SYSTEM
--------------------------------*/

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

/* ------------------------------
   WARN / KICK / BAN
--------------------------------*/

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
  const guild = client.guilds.cache.get(GUILD_ID);
  const member = guild.members.cache.get(req.body.userId);
  if (member) await member.kick("Panel kick").catch(() => {});
  saveAll();
  res.json({ success: true });
});

app.post('/api/staff/ban', async (req, res) => {
  const guild = client.guilds.cache.get(GUILD_ID);
  await guild.members.ban(req.body.userId, { reason: "Panel ban" }).catch(() => {});
  saveAll();
  res.json({ success: true });
});

/* ------------------------------
   TICKETS
--------------------------------*/

app.post('/api/tickets/create', async (req, res) => {
  const guild = client.guilds.cache.get(GUILD_ID);
  const channel = guild.channels.cache.get(req.body.panelChannelId);

  const title = req.body.title || "New Ticket";
  const description = req.body.description || "Click below to open a ticket.";

  await channel.send({
    embeds: [{ title, description, color: 0xff6a00 }],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`open_ticket_${Date.now()}`)
          .setLabel('Open Ticket')
          .setStyle(ButtonStyle.Primary)
      )
    ]
  });

  saveData.tickets.push({
    id: saveData.tickets.length + 1,
    title,
    description,
    category: req.body.category,
    panelChannelId: req.body.panelChannelId,
    open: true
  });

  saveAll();
  res.json({ success: true });
});

/* ------------------------------
   TICKET LIST
--------------------------------*/

app.get('/api/tickets/list', (req, res) => {
  res.json({ tickets: saveData.tickets });
});

/* ------------------------------
   CLOSE ALL TICKETS
--------------------------------*/

app.post('/api/tickets/close-all', async (req, res) => {
  const guild = client.guilds.cache.get(GUILD_ID);
  guild.channels.cache.forEach(async ch => {
    if (ch.name.startsWith("ticket-")) await ch.delete().catch(() => {});
  });
  saveData.tickets = [];
  saveAll();
  res.json({ success: true });
});

/* ------------------------------
   TRUSTED BOT ADDERS
--------------------------------*/

app.post('/api/bots/add-trusted', (req, res) => {
  const executorId = req.headers['x-user-id'];
  const { userId } = req.body;

  if (!allowedUsers.includes(executorId)) {
    return res.json({ success: false, error: "Not allowed" });
  }

  if (!saveData.trustedBotAdders.includes(userId)) {
    saveData.trustedBotAdders.push(userId);
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
  saveAll();
  res.json({ success: true });
});

app.get('/api/bots/trusted-list', (req, res) => {
  const guild = client.guilds.cache.get(GUILD_ID);
  const list = saveData.trustedBotAdders.map(id => {
    const m = guild.members.cache.get(id);
    return m ? `${m.user.username} (${id})` : id;
  });
  res.json({ trusted: list });
});

/* ------------------------------
   ADULT LOGS
--------------------------------*/

app.get('/api/adult/logs', (req, res) => {
  res.json({ logs: saveData.adultLogs.slice().reverse() });
});

/* ------------------------------
   SAVE ALL
--------------------------------*/

app.post('/api/save-all', (req, res) => {
  saveAll();
  res.json({ success: true });
});

/* ------------------------------
   START SERVER
--------------------------------*/

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Dashboard running on port ${PORT}`);
});

client.login(config.token);
