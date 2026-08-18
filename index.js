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

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const SITE_URL = process.env.SITE_URL;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName('vip')
    .setDescription('Abre o painel pra criar ou editar seu cargo VIP pessoal.'),
].map((c) => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const route = GUILD_ID
    ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
    : Routes.applicationCommands(CLIENT_ID);
  await rest.put(route, { body: commands });
  console.log('Slash command /vip registrado.');
}

client.once(Events.ClientReady, async () => {
  console.log(`Bot online como ${client.user.tag}`);
  await registerCommands();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'vip') return;

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

  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
});

client.login(TOKEN);
