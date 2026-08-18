require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const { createClient } = require('@libsql/client');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const SITE_URL = process.env.SITE_URL;

// ID do cargo que libera o /vip — quem atingir 3000 XP ganha esse cargo automaticamente
const VIP_ROLE_ID = process.env.VIP_ROLE_ID;

// XP necessário pra ganhar o cargo VIP
const XP_PARA_VIP = 3000;

// ---------- Turso ----------
const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function initDB() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS xp (
      user_id  TEXT PRIMARY KEY,
      xp       INTEGER DEFAULT 0,
      level    INTEGER DEFAULT 0
    )
  `);
}

async function getXP(userId) {
  const res = await db.execute({ sql: 'SELECT xp, level FROM xp WHERE user_id = ?', args: [userId] });
  if (!res.rows.length) return { xp: 0, level: 0 };
  return { xp: Number(res.rows[0].xp), level: Number(res.rows[0].level) };
}

async function addXP(userId, quantidade) {
  // Insere se não existir, depois soma o XP
  await db.execute({
    sql: `INSERT INTO xp (user_id, xp, level) VALUES (?, ?, 0)
          ON CONFLICT(user_id) DO UPDATE SET xp = xp + ?`,
    args: [userId, quantidade, quantidade],
  });

  // Recalcula nível: 1 nível a cada 100 XP
  const { xp } = await getXP(userId);
  const novoLevel = Math.floor(xp / 100);

  await db.execute({
    sql: 'UPDATE xp SET level = ? WHERE user_id = ?',
    args: [novoLevel, userId],
  });

  return { xp, level: novoLevel };
}

// ---------- Cooldown de XP (em memória) ----------
// Guarda o timestamp da última mensagem que deu XP por usuário
const cooldowns = new Map();
const COOLDOWN_MS = 60 * 1000; // 1 minuto

function podaGanharXP(userId) {
  const agora = Date.now();
  const ultimo = cooldowns.get(userId) || 0;
  if (agora - ultimo < COOLDOWN_MS) return false;
  cooldowns.set(userId, agora);
  return true;
}

// Limpa cooldowns antigos a cada 5 minutos
setInterval(() => {
  const agora = Date.now();
  for (const [id, ts] of cooldowns.entries()) {
    if (agora - ts > COOLDOWN_MS) cooldowns.delete(id);
  }
}, 5 * 60 * 1000);

// ---------- Bot ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const commands = [
  new SlashCommandBuilder()
    .setName('order')
    .setDescription('Abre o painel pra criar ou editar seu cargo VIP pessoal.'),
  new SlashCommandBuilder()
    .setName('orderxp')
    .setDescription('Mostra seu XP e nível atual.'),
  new SlashCommandBuilder()
    .setName('orderxpadd')
    .setDescription('[ADMIN] Adiciona XP a um usuário.')
    .addUserOption((opt) =>
      opt.setName('usuario').setDescription('Usuário que vai receber o XP').setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt.setName('quantidade').setDescription('Quantidade de XP (1-9999)').setRequired(true).setMinValue(1).setMaxValue(9999)
    ),
].map((c) => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const route = GUILD_ID
    ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
    : Routes.applicationCommands(CLIENT_ID);
  await rest.put(route, { body: commands });
  console.log('Slash commands registrados.');
}

client.once(Events.ClientReady, async () => {
  console.log(`Bot online como ${client.user.tag}`);
  await initDB();
  await registerCommands();
});

// ---------- Comandos /order e /orderxp ----------
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // /order — abre o painel VIP
  if (interaction.commandName === 'order') {
    const embed = new EmbedBuilder()
      .setTitle('Seu Cargo VIP')
      .setDescription('Clique no botão abaixo pra escolher o nome e a cor do seu cargo pessoal.')
      .setColor(0x8b5cf6);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Abrir Painel VIP')
        .setStyle(ButtonStyle.Link)
        .setURL(SITE_URL)
    );

    try {
      await interaction.reply({ embeds: [embed], components: [row], flags: 64 });
    } catch (err) {
      if (err.code !== 10062) console.error('[Interaction] Erro inesperado:', err);
    }
  }

  // /orderxpadd — adiciona XP (só admin)
  if (interaction.commandName === 'orderxpadd') {
    const ADMIN_ID = process.env.ADMIN_ID;

    if (interaction.user.id !== ADMIN_ID) {
      return interaction.reply({ content: '❌ Você não tem permissão para usar esse comando.', flags: 64 });
    }

    const alvo = interaction.options.getUser('usuario');
    const quantidade = interaction.options.getInteger('quantidade');

    try {
      const { xp, level } = await addXP(alvo.id, quantidade);
      const xpAntes = xp - quantidade;

      // Verifica se cruzou o limite do VIP com essa adição
      if (xpAntes < XP_PARA_VIP && xp >= XP_PARA_VIP) {
        const member = await interaction.guild.members.fetch(alvo.id).catch(() => null);
        if (member) {
          const fakeMessage = { channel: interaction.channel };
          await darCargoVIP(alvo.id, fakeMessage);
        }
      }

      const embed = new EmbedBuilder()
        .setColor(0x4fd1c5)
        .setTitle('✅ XP Adicionado')
        .addFields(
          { name: 'Usuário', value: `<@${alvo.id}>`, inline: true },
          { name: 'XP Adicionado', value: `+${quantidade}`, inline: true },
          { name: 'XP Total', value: `${xp}`, inline: true },
          { name: 'Nível Atual', value: `${level}`, inline: true },
        );

      await interaction.reply({ embeds: [embed], flags: 64 });
    } catch (err) {
      console.error('[OrderXPAdd] Erro:', err);
      await interaction.reply({ content: '❌ Erro ao adicionar XP.', flags: 64 });
    }
  }
  if (interaction.commandName === 'orderxp') {
    try {
      const { xp, level } = await getXP(interaction.user.id);
      const faltam = Math.max(0, XP_PARA_VIP - xp);
      const temVip = xp >= XP_PARA_VIP;

      const embed = new EmbedBuilder()
        .setColor(temVip ? 0x8b5cf6 : 0x4fd1c5)
        .setTitle(`XP de ${interaction.member?.displayName || interaction.user.username}`)
        .addFields(
          { name: 'Nível', value: String(level), inline: true },
          { name: 'XP Total', value: String(xp), inline: true },
          {
            name: temVip ? 'Status' : 'Faltam',
            value: temVip ? '✅ VIP desbloqueado!' : `${faltam} XP para o VIP`,
            inline: true,
          }
        );

      await interaction.reply({ embeds: [embed], flags: 64 });
    } catch (err) {
      if (err.code !== 10062) console.error('[OrderXP Command] Erro:', err);
    }
  }
});

// ---------- Sistema de XP por mensagem ----------
client.on(Events.MessageCreate, async (message) => {
  // Ignora bots, mensagens fora de servidores e mensagens muito curtas
  if (message.author.bot) return;
  if (message.guildId !== GUILD_ID) return;
  if (message.content.trim().length < 3) return;

  const userId = message.author.id;

  // Verifica cooldown
  if (!podaGanharXP(userId)) return;

  // Sorteia XP entre 5 e 15
  const ganho = Math.floor(Math.random() * 11) + 5;

  try {
    const { xp, level } = await addXP(userId, ganho);

    // Verifica se acabou de atingir o VIP (passou de < 3000 pra >= 3000)
    const xpAntes = xp - ganho;
    if (xpAntes < XP_PARA_VIP && xp >= XP_PARA_VIP) {
      await darCargoVIP(userId, message);
    }
  } catch (err) {
    console.error('[XP] Erro ao processar XP:', err.message);
  }
});

// ---------- Dá o cargo VIP automaticamente ----------
async function darCargoVIP(userId, message) {
  if (!VIP_ROLE_ID) {
    console.warn('[VIP] VIP_ROLE_ID não definido — cargo não atribuído.');
    return;
  }

  try {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${userId}/roles/${VIP_ROLE_ID}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bot ${TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!res.ok) {
      console.error('[VIP] Falha ao dar cargo VIP:', await res.text());
      return;
    }

    // Manda parabéns no canal onde a pessoa mandou a mensagem
    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle('🎉 Novo VIP!')
      .setDescription(
        `<@${userId}> chegou a **3000 XP** e desbloqueou o cargo VIP!\n\nUse \`/order\` para criar seu cargo personalizado.`
      );

    await message.channel.send({ embeds: [embed] });
    console.log(`[VIP] Cargo VIP dado para ${userId}`);
  } catch (err) {
    console.error('[VIP] Erro ao dar cargo VIP:', err.message);
  }
}

// Evita que erros não tratados derrubem o processo
client.on('error', (err) => console.error('[Discord Client Error]', err));

client.login(TOKEN);
