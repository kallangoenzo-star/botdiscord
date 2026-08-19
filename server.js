require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const security = require('./security');
const { createClient } = require('@libsql/client');

const {
  CLIENT_ID,
  CLIENT_SECRET,
  DISCORD_TOKEN,
  GUILD_ID,
  SITE_URL,
  SESSION_SECRET,
  PORT,
  TURSO_URL,
  TURSO_AUTH_TOKEN,
} = process.env;

const REDIRECT_URI = `${SITE_URL}/auth/callback`;

// Categoria "Voice Channels" onde as calls privadas vão ser criadas
const CATEGORIA_VOZ_ID = process.env.CATEGORIA_VOZ_ID || '1538714895988695051';

// Bits de permissão do Discord que a gente usa pra montar a call privada
const PERM = {
  MANAGE_GUILD: 8,
  MANAGE_CHANNELS: 16,
  VIEW_CHANNEL: 1024,
  CONNECT: 1048576,
  SPEAK: 2097152,
  PRIORITY_SPEAKER: 256,
  MUTE_MEMBERS: 4194304,
  DEAFEN_MEMBERS: 8388608,
  MOVE_MEMBERS: 16777216,
};
const PERM_NEGAR_TODO_MUNDO = String(PERM.VIEW_CHANNEL | PERM.CONNECT);
const PERM_PERMITIR_CARGO = String(PERM.VIEW_CHANNEL | PERM.CONNECT | PERM.SPEAK);
const PERM_PERMITIR_DONO = String(
  PERM.MANAGE_GUILD |
    PERM.VIEW_CHANNEL |
    PERM.CONNECT |
    PERM.SPEAK |
    PERM.PRIORITY_SPEAKER |
    PERM.MUTE_MEMBERS |
    PERM.DEAFEN_MEMBERS |
    PERM.MOVE_MEMBERS |
    PERM.MANAGE_CHANNELS
);

// ---------- Turso (libsql) ----------
const db = createClient({
  url: TURSO_URL,
  authToken: TURSO_AUTH_TOKEN,
});

// Garante que as tabelas existem ao iniciar
async function initDB() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS vip_roles (
      user_id   TEXT PRIMARY KEY,
      role_id   TEXT,
      channel_id TEXT,
      membros   TEXT DEFAULT '[]'
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS xp (
      user_id  TEXT PRIMARY KEY,
      xp       INTEGER DEFAULT 0,
      level    INTEGER DEFAULT 0
    )
  `);
  console.log('[DB] Tabelas prontas.');
}

// Busca registro de um usuário
async function getRegistro(userId) {
  const res = await db.execute({
    sql: 'SELECT * FROM vip_roles WHERE user_id = ?',
    args: [userId],
  });
  if (!res.rows.length) return null;
  const row = res.rows[0];
  return {
    roleId: row.role_id || null,
    channelId: row.channel_id || null,
    membros: JSON.parse(row.membros || '[]'),
  };
}

// Salva/atualiza registro de um usuário
async function saveRegistro(userId, { roleId, channelId, membros }) {
  await db.execute({
    sql: `INSERT INTO vip_roles (user_id, role_id, channel_id, membros)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            role_id    = excluded.role_id,
            channel_id = excluded.channel_id,
            membros    = excluded.membros`,
    args: [userId, roleId || null, channelId || null, JSON.stringify(membros || [])],
  });
}

// Retorna todos os roleIds cadastrados (pra reordenação VIP)
async function getAllRoleIds() {
  const res = await db.execute('SELECT role_id FROM vip_roles WHERE role_id IS NOT NULL');
  return res.rows.map((r) => r.role_id).filter(Boolean);
}

// ---------- Helpers Discord ----------
const headersBot = {
  Authorization: `Bot ${DISCORD_TOKEN}`,
  'Content-Type': 'application/json',
};

async function aplicarCargoCompartilhado(roleId, membros) {
  if (!roleId || !Array.isArray(membros) || !membros.length) return;
  const ids = [...new Set(membros.filter(Boolean))];
  for (const targetId of ids) {
    try {
      const res = await fetch(
        `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${targetId}/roles/${roleId}`,
        { method: 'PUT', headers: headersBot }
      );
      if (!res.ok) {
        console.warn(`[Cargo Compartilhado] Falha ao aplicar cargo para ${targetId}:`, await res.text());
      }
    } catch (err) {
      console.warn(`[Cargo Compartilhado] Erro ao aplicar cargo para ${targetId}:`, err.message);
    }
  }
}

async function reposicionarCargoVIPAcimaDosAntigos(roleId) {
  if (!roleId) return;
  try {
    const rolesRes = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/roles`, { headers: headersBot });
    if (!rolesRes.ok) {
      console.warn('[VIP Order] Falha ao buscar roles do servidor:', await rolesRes.text());
      return;
    }

    const roles = await rolesRes.json();
    const idsVip = await getAllRoleIds();

    const vipRoles = roles.filter((role) => idsVip.includes(role.id));
    if (!vipRoles.length) return;

    vipRoles.sort((a, b) => (Number(b.position) || 0) - (Number(a.position) || 0));

    const maxVipPosition = Math.max(...vipRoles.map((r) => Number(r.position) || 0));
    const reorder = [{ id: roleId, position: maxVipPosition + 1 }];
    vipRoles.forEach((role, index) => {
      if (role.id !== roleId) {
        reorder.push({ id: role.id, position: maxVipPosition - index });
      }
    });

    const reorderRes = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/roles`, {
      method: 'PATCH',
      headers: headersBot,
      body: JSON.stringify(reorder),
    });

    if (!reorderRes.ok) {
      console.warn('[VIP Order] Falha ao reordenar cargos VIP:', await reorderRes.text());
      return;
    }
    console.log(`[VIP Order] Cargo ${roleId} movido para o topo dos cargos VIP.`);
  } catch (err) {
    console.warn('[VIP Order] Erro ao reposicionar cargo VIP:', err.message);
  }
}

// Busca dados básicos de um membro pelo ID
async function buscarMembro(userId) {
  const r = await fetch(
    `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${userId}`,
    { headers: headersBot }
  );
  if (!r.ok) return null;
  const m = await r.json();
  const avatarUrl = m.user.avatar
    ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png?size=64`
    : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(m.user.id) % 5n)}.png`;
  return {
    id: m.user.id,
    displayName: m.nick || m.user.global_name || m.user.username,
    avatarUrl,
  };
}

// ---------- Express ----------
const app = express();
// Garante que SESSION_SECRET está definido em produção
if (process.env.NODE_ENV === 'production' && !SESSION_SECRET) {
  console.error('[FATAL] SESSION_SECRET não definido em produção. Encerrando.');
  process.exit(1);
}

app.set('trust proxy', 1);
app.use(security.requireHTTPS);
app.use(security.securityHeaders);
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    proxy: process.env.NODE_ENV === 'production',
    cookie: {
      maxAge: 1000 * 60 * 60,
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
    },
  })
);
app.use(security.sessionTimeout);

// ---------- 1) Login ----------
app.get('/auth/login', (req, res) => {
  req.session.regenerate((err) => {
    if (err) {
      console.error('[OAuth2 Login] Falha ao regenerar sessão:', err);
      return res.status(500).send('Erro ao iniciar login do Discord.');
    }

    const state = security.generateOAuth2State();
    req.session.oauthState = state;
    req.session.user = null;
    req.session.csrfToken = null;

    req.session.save((saveErr) => {
      if (saveErr) {
        console.error('[OAuth2 Login] Falha ao salvar sessão:', saveErr);
        return res.status(500).send('Erro ao iniciar login do Discord.');
      }

      console.log('[OAuth2 Login] State gerado e persistido:', state.slice(0, 10) + '...');

      const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: 'identify',
        state,
        prompt: 'login',
      });

      res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
    });
  });
});

// ---------- 2) Callback ----------
app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  const sessionState = req.session.oauthState;

  console.log('[OAuth2 Callback]', {
    codeRecebido: !!code,
    stateRecebido: !!state,
    stateNaSessao: !!sessionState,
    stateRecebidoValor: state ? String(state).slice(0, 10) + '...' : 'null',
    stateNaSessaoValor: sessionState ? String(sessionState).slice(0, 10) + '...' : 'null',
  });

  if (!state) {
    await security.logAudit('OAuth2 Erro', 'unknown', { motivo: 'State parameter não recebido' });
    return res.redirect('/?erro=state_invalido');
  }

  if (!sessionState) {
    await security.logAudit('OAuth2 Erro', 'unknown', { motivo: 'State não na sessão' });
    return res.redirect('/?erro=state_invalido');
  }

  if (!security.verifyOAuth2State(String(state), String(sessionState))) {
    await security.logAudit('OAuth2 State Mismatch', 'unknown', { motivo: 'State não corresponde' });
    return res.redirect('/?erro=state_invalido');
  }

  req.session.oauthState = null;

  if (!code) {
    await security.logAudit('OAuth2 Erro', 'unknown', { motivo: 'Code não recebido' });
    return res.redirect('/?erro=sem_code');
  }

  try {
    if (!security.validateRedirectURI(REDIRECT_URI, REDIRECT_URI)) {
      await security.logAudit('Redirect URI Inválido', 'unknown', { redirect_uri: REDIRECT_URI });
      return res.redirect('/?erro=redirect_invalido');
    }

    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('--- Discord recusou a troca de token ---');
      console.error('Status HTTP:', tokenRes.status);
      console.error('Resposta do Discord:', tokenData);
      await security.logAudit('Token Exchange Falhou', 'unknown', { status: tokenRes.status, erro: tokenData.error });
      return res.redirect('/?erro=token_falhou');
    }

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const user = await userRes.json();

    const memberRes = await fetch(
      `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${user.id}`,
      { headers: headersBot }
    );

    if (!memberRes.ok) {
      await security.logAudit('Login Recusado - Não é Membro', user.id, { username: user.username });
      return res.redirect('/?erro=nao_eh_membro');
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      displayName: user.global_name || user.username,
      avatar: user.avatar,
    };

    console.log('[OAuth2] Login bem-sucedido:', user.username);

    // Coleta IP e geolocalização para audit log
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'desconhecido';
    let pais = 'desconhecido';
    let cidade = 'desconhecido';
    try {
      const geoRes = await fetch(`https://ip-api.com/json/${encodeURIComponent(ip)}?fields=country,city,status&lang=pt-BR`);
      const geo = await geoRes.json();
      if (geo.status === 'success') {
        pais = geo.country || 'desconhecido';
        cidade = geo.city || 'desconhecido';
      }
    } catch {
      // falha silenciosa, não impede o login
    }

    await security.logAuditPainel(
      user.id,
      user.username,
      ip,
      pais,
      cidade,
      req.headers['user-agent']?.slice(0, 200) || 'desconhecido'
    );
    res.redirect('/');
  } catch (err) {
    console.error('[OAuth2] Erro no callback:', err);
    await security.logAudit('Erro no Callback OAuth2', 'unknown', { erro: String(err.message).slice(0, 200) });
    res.redirect('/?erro=falha_login');
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ---------- 3) /api/me ----------
app.get('/api/me', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ logado: false });

  const rateCheck = security.checkRateLimit(req.session.user.id, 'api-me');
  if (!rateCheck.allowed) return res.status(429).json({ logado: false, erro: rateCheck.reason });

  const { id, avatar } = req.session.user;
  const registro = await getRegistro(id);

  const avatarUrl = avatar
    ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=128`
    : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(id) % 5n)}.png`;

  let membros = [];
  if (registro?.membros?.length) {
    const resultados = await Promise.all(registro.membros.map(buscarMembro));
    membros = resultados.filter(Boolean);
  }

  if (!req.session.csrfToken) {
    req.session.csrfToken = security.generateCSRFToken();
  }

  // Verifica se o usuário tem o cargo VIP de acesso (VIP_ROLE_ID) no Discord
  const VIP_ROLE_ID = process.env.VIP_ROLE_ID;
  let temCargoVip = false;
  if (VIP_ROLE_ID) {
    try {
      const memberRes = await fetch(
        `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${id}`,
        { headers: headersBot }
      );
      if (memberRes.ok) {
        const member = await memberRes.json();
        temCargoVip = Array.isArray(member.roles) && member.roles.includes(VIP_ROLE_ID);
      }
    } catch {
      // se falhar a checagem, mantém false
    }
  }

  res.json({
    logado: true,
    user: req.session.user,
    avatarUrl,
    cargoAtual: registro?.roleId || null,
    callAtual: registro?.channelId || null,
    membros,
    csrfToken: req.session.csrfToken,
    temCargoVip,
  });
});

// ---------- 4) Criar ou editar o cargo VIP ----------
app.post('/api/vip', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ erro: 'Não logado.' });

  const userId = req.session.user.id;

  const rateCheck = security.checkRateLimit(userId, 'vip-update');
  if (!rateCheck.allowed) {
    await security.logAudit('Rate Limit Violado', userId, { endpoint: '/api/vip', reason: rateCheck.reason });
    return res.status(429).json({ erro: rateCheck.reason });
  }

  if (!security.verifyCSRFToken(req.body.csrfToken, req.session.csrfToken)) {
    await security.logAudit('CSRF Token Inválido', userId, { endpoint: '/api/vip' });
    return res.status(403).json({ erro: 'Token de segurança inválido.' });
  }

  // Verifica se usuário tem cargo VIP de acesso
  const temVip = await security.verifyUserHasVipAccess(userId, headersBot);
  if (!temVip) {
    return res.status(403).json({ erro: 'Você precisa ter o cargo VIP para usar esta função.' });
  }

  const { nome, cor, cor2, gradiente } = req.body;
  const nomeClean = security.sanitizeInput(nome);

  if (!nomeClean || nomeClean.length < 3 || nomeClean.length > 32) {
    await security.logAudit('Validação Falhou', userId, { motivo: 'Nome inválido', nome: nomeClean });
    return res.status(400).json({ erro: 'Nome precisa ter entre 3 e 32 caracteres.' });
  }

  if (!security.validateHexColor(cor) || (gradiente && !security.validateHexColor(cor2 || ''))) {
    await security.logAudit('Validação Falhou', userId, { motivo: 'Cor HEX inválida' });
    return res.status(400).json({ erro: 'Cor HEX inválida.' });
  }

  const registro = (await getRegistro(userId)) || { roleId: null, channelId: null, membros: [] };
  const headers = headersBot;

  const corInt = parseInt(cor.replace('#', ''), 16);
  const corPayload = gradiente
    ? { colors: { primary_color: corInt, secondary_color: parseInt(cor2.replace('#', ''), 16), tertiary_color: null } }
    : { colors: { primary_color: corInt, secondary_color: null, tertiary_color: null } };

  try {
    let { roleId } = registro;
    let role;

    if (roleId) {
      const checkRes = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/roles`, { headers });
      const roles = await checkRes.json();
      role = roles.find((r) => r.id === roleId);
    }

    if (role) {
      const hasRole = await security.verifyUserHasRole(userId, roleId, headers);
      if (!hasRole) {
        const addRes = await fetch(
          `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${userId}/roles/${roleId}`,
          { method: 'PUT', headers }
        );
        if (!addRes.ok) await security.logAudit('Erro ao Re-adicionar Cargo', userId, { roleId });
      }

      const editRes = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/roles/${roleId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ name: nomeClean, ...corPayload }),
      });
      if (!editRes.ok) throw new Error(await editRes.text());

      await saveRegistro(userId, { roleId, channelId: registro.channelId, membros: registro.membros });
      await reposicionarCargoVIPAcimaDosAntigos(roleId);
      await aplicarCargoCompartilhado(roleId, registro.membros);
      await security.logAudit('Cargo Atualizado', userId, { nomeAntigo: role.name, nomeNovo: nomeClean, roleId, cor });
    } else {
      const createRes = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/roles`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: nomeClean,
          ...corPayload,
          permissions: '0',
          hoist: true,
          mentionable: false,
        }),
      });
      if (!createRes.ok) throw new Error(await createRes.text());
      const novoCargo = await createRes.json();
      roleId = novoCargo.id;

      const addRes = await fetch(
        `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${userId}/roles/${roleId}`,
        { method: 'PUT', headers }
      );
      if (!addRes.ok) throw new Error(await addRes.text());

      await saveRegistro(userId, { roleId, channelId: null, membros: [] });
      await reposicionarCargoVIPAcimaDosAntigos(roleId);
      await security.logAudit('Cargo Criado', userId, { nome: nomeClean, roleId, cor });
    }

    res.json({ ok: true, nome: nomeClean, cor });
  } catch (err) {
    console.error(err);
    const texto = String(err.message || '');
    const precisaBoost = texto.includes('secondary_color') || texto.includes('BOOST');
    await security.logAudit('Erro ao Criar/Editar Cargo', userId, { erro: texto.slice(0, 200), precisaBoost });
    res.status(500).json({
      erro: precisaBoost
        ? 'Cor com gradiente exige que o servidor tenha Nível de Boost 2 ou superior.'
        : 'Falha ao criar/editar o cargo. Confira se o cargo do bot está acima na hierarquia e tem permissão "Manage Roles".',
    });
  }
});

// ---------- 5) Buscar membros pelo nome ----------
app.get('/api/buscar-membros', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ erro: 'Não logado.' });

  const rateCheck = security.checkRateLimit(req.session.user.id, 'buscar-membros');
  if (!rateCheck.allowed) return res.status(429).json({ erro: rateCheck.reason });

  const q = security.sanitizeInput((req.query.q || '').trim());
  if (q.length < 2) return res.json({ resultados: [] });

  const registro = await getRegistro(req.session.user.id);
  if (!registro?.roleId) {
    return res.status(400).json({ erro: 'Você precisa criar seu cargo VIP primeiro.' });
  }

  try {
    const r = await fetch(
      `https://discord.com/api/v10/guilds/${GUILD_ID}/members/search?query=${encodeURIComponent(q)}&limit=8`,
      { headers: headersBot }
    );
    if (!r.ok) throw new Error(await r.text());
    const membros = await r.json();

    const resultados = membros
      .filter((m) => m.user.id !== req.session.user.id)
      .map((m) => ({
        id: m.user.id,
        displayName: m.nick || m.user.global_name || m.user.username,
        avatarUrl: m.user.avatar
          ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png?size=64`
          : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(m.user.id) % 5n)}.png`,
        jaTem: registro.membros.includes(m.user.id),
      }));

    res.json({ resultados });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Falha ao buscar membros.' });
  }
});

// ---------- 6) Compartilhar cargo ----------
app.post('/api/vip/compartilhar', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ erro: 'Não logado.' });

  const userId = req.session.user.id;

  const rateCheck = security.checkRateLimit(userId, 'compartilhar');
  if (!rateCheck.allowed) {
    await security.logAudit('Rate Limit Violado', userId, { endpoint: '/api/vip/compartilhar' });
    return res.status(429).json({ erro: rateCheck.reason });
  }

  if (!security.verifyCSRFToken(req.body.csrfToken, req.session.csrfToken)) {
    await security.logAudit('CSRF Token Inválido', userId, { endpoint: '/api/vip/compartilhar' });
    return res.status(403).json({ erro: 'Token de segurança inválido.' });
  }

  const { targetId } = req.body;

  if (!security.validateUserId(targetId || '')) {
    await security.logAudit('Validação Falhou', userId, { motivo: 'ID inválido', targetId });
    return res.status(400).json({ erro: 'ID de usuário inválido.' });
  }

  if (targetId === userId) {
    return res.status(400).json({ erro: 'Você já tem seu próprio cargo.' });
  }

  const registro = await getRegistro(userId);
  if (!registro?.roleId) {
    return res.status(400).json({ erro: 'Você precisa criar seu cargo VIP primeiro.' });
  }

  if (registro.membros.length >= 10) {
    await security.logAudit('Limite de Compartilhados Atingido', userId, { targetId, limite: 10 });
    return res.status(400).json({ erro: 'Limite de 10 pessoas por cargo compartilhado atingido.' });
  }

  try {
    const addRes = await fetch(
      `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${targetId}/roles/${registro.roleId}`,
      { method: 'PUT', headers: headersBot }
    );
    if (!addRes.ok) throw new Error(await addRes.text());

    if (!registro.membros.includes(targetId)) registro.membros.push(targetId);
    await saveRegistro(userId, registro);

    const membro = await buscarMembro(targetId);
    await security.logAudit('Cargo Compartilhado', userId, { targetId, targetNome: membro?.displayName });
    res.json({ ok: true, membro });
  } catch (err) {
    console.error(err);
    await security.logAudit('Erro ao Compartilhar Cargo', userId, { targetId, erro: String(err.message).slice(0, 100) });
    res.status(500).json({ erro: 'Falha ao compartilhar o cargo com essa pessoa.' });
  }
});

// ---------- 7) Revogar cargo compartilhado ----------
app.post('/api/vip/revogar', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ erro: 'Não logado.' });

  const userId = req.session.user.id;

  const rateCheck = security.checkRateLimit(userId, 'revogar');
  if (!rateCheck.allowed) {
    await security.logAudit('Rate Limit Violado', userId, { endpoint: '/api/vip/revogar' });
    return res.status(429).json({ erro: rateCheck.reason });
  }

  if (!security.verifyCSRFToken(req.body.csrfToken, req.session.csrfToken)) {
    await security.logAudit('CSRF Token Inválido', userId, { endpoint: '/api/vip/revogar' });
    return res.status(403).json({ erro: 'Token de segurança inválido.' });
  }

  const { targetId } = req.body;

  if (!security.validateUserId(targetId || '')) {
    await security.logAudit('Validação Falhou', userId, { motivo: 'ID inválido', targetId });
    return res.status(400).json({ erro: 'ID de usuário inválido.' });
  }

  const registro = await getRegistro(userId);
  if (!registro?.roleId) {
    return res.status(400).json({ erro: 'Você não tem cargo VIP.' });
  }

  // Verifica se targetId realmente está na lista antes de chamar a API
  if (!registro.membros.includes(targetId)) {
    return res.status(400).json({ erro: 'Essa pessoa não está na sua lista de compartilhamento.' });
  }

  try {
    const delRes = await fetch(
      `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${targetId}/roles/${registro.roleId}`,
      { method: 'DELETE', headers: headersBot }
    );
    if (!delRes.ok) throw new Error(await delRes.text());

    registro.membros = registro.membros.filter((id) => id !== targetId);
    await saveRegistro(userId, registro);

    await security.logAudit('Cargo Revogado', userId, { targetId });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    await security.logAudit('Erro ao Revogar Cargo', userId, { targetId, erro: String(err.message).slice(0, 100) });
    res.status(500).json({ erro: 'Falha ao remover o cargo dessa pessoa.' });
  }
});

// ---------- 8) Criar ou atualizar call de voz privada ----------
app.post('/api/vip/call', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ erro: 'Não logado.' });

  const userId = req.session.user.id;

  const rateCheck = security.checkRateLimit(userId, 'call-update');
  if (!rateCheck.allowed) {
    await security.logAudit('Rate Limit Violado', userId, { endpoint: '/api/vip/call' });
    return res.status(429).json({ erro: rateCheck.reason });
  }

  if (!security.verifyCSRFToken(req.body.csrfToken, req.session.csrfToken)) {
    await security.logAudit('CSRF Token Inválido', userId, { endpoint: '/api/vip/call' });
    return res.status(403).json({ erro: 'Token de segurança inválido.' });
  }

  // Verifica se usuário tem cargo VIP de acesso
  const temVip = await security.verifyUserHasVipAccess(userId, headersBot);
  if (!temVip) {
    return res.status(403).json({ erro: 'Você precisa ter o cargo VIP para usar esta função.' });
  }

  const registro = await getRegistro(userId);
  if (!registro?.roleId) {
    return res.status(400).json({ erro: 'Você precisa criar seu cargo VIP primeiro.' });
  }

  const nomeCallRaw = (req.body.nome || 'Call Privada').trim();
  const nomeCall = security.sanitizeInput(nomeCallRaw).slice(0, 100);

  if (!nomeCall || nomeCall.length < 1) {
    await security.logAudit('Validação Falhou', userId, { motivo: 'Nome da call inválido' });
    return res.status(400).json({ erro: 'Nome da call inválido.' });
  }

  const permissionOverwrites = [
    { id: GUILD_ID, type: 0, deny: PERM_NEGAR_TODO_MUNDO, allow: '0' },
    { id: registro.roleId, type: 0, allow: PERM_PERMITIR_CARGO, deny: '0' },
    { id: userId, type: 1, allow: PERM_PERMITIR_DONO, deny: '0' },
  ];

  try {
    let { channelId } = registro;
    let canalExiste = false;

    if (channelId) {
      const checkRes = await fetch(`https://discord.com/api/v10/channels/${channelId}`, { headers: headersBot });
      canalExiste = checkRes.ok;
    }

    if (canalExiste) {
      const editRes = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
        method: 'PATCH',
        headers: headersBot,
        body: JSON.stringify({ name: nomeCall, permission_overwrites: permissionOverwrites }),
      });
      if (!editRes.ok) throw new Error(await editRes.text());
      await security.logAudit('Call Atualizada', userId, { channelId, nome: nomeCall });
    } else {
      const createRes = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/channels`, {
        method: 'POST',
        headers: headersBot,
        body: JSON.stringify({
          name: nomeCall,
          type: 2,
          parent_id: CATEGORIA_VOZ_ID,
          permission_overwrites: permissionOverwrites,
        }),
      });
      if (!createRes.ok) throw new Error(await createRes.text());
      const canal = await createRes.json();
      channelId = canal.id;
      registro.channelId = channelId;
      await saveRegistro(userId, registro);
      await security.logAudit('Call Criada', userId, { channelId, nome: nomeCall });
    }

    res.json({ ok: true, nome: nomeCall });
  } catch (err) {
    console.error(err);
    const texto = String(err.message || '');
    const semPermissao = texto.includes('Missing Permissions') || texto.includes('50013');
    await security.logAudit('Erro ao Criar/Atualizar Call', userId, { erro: texto.slice(0, 200), semPermissao });
    res.status(500).json({
      erro: semPermissao
        ? 'O bot não tem permissão "Manage Channels", ou a categoria de voz está fora do alcance dele na hierarquia.'
        : 'Falha ao criar/editar a call de voz.',
    });
  }
});

// ---------- 9) Leaderboard — top 20 ----------
app.get('/api/leaderboard', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ erro: 'Não logado.' });

  try {
    // Top 20 por XP
    const top = await db.execute(
      'SELECT user_id, xp, level FROM xp ORDER BY xp DESC LIMIT 20'
    );

    // Busca nomes e avatares dos membros do Discord sequencialmente para evitar rate limiting
    const entries = [];
    for (let i = 0; i < top.rows.length; i++) {
      const row = top.rows[i];
      const userId = row.user_id;
      let displayName = userId;
      let avatarUrl = `https://cdn.discordapp.com/embed/avatars/0.png`;

      try {
        const r = await fetch(
          `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${userId}`,
          { headers: headersBot }
        );
        if (r.ok) {
          const m = await r.json();
          displayName = m.nick || m.user.global_name || m.user.username;
          avatarUrl = m.user.avatar
            ? `https://cdn.discordapp.com/avatars/${userId}/${m.user.avatar}.png?size=64`
            : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(userId) % 5n)}.png`;
        } else {
          console.warn(`[Leaderboard] Falha ao buscar membro ${userId}:`, r.status);
        }
      } catch (err) {
        console.warn(`[Leaderboard] Erro ao buscar membro ${userId}:`, err.message);
        // mantém fallback
      }

      entries.push({
        posicao: i + 1,
        userId,
        displayName,
        avatarUrl,
        xp: Number(row.xp),
        level: Number(row.level),
      });

      // Pequeno delay para evitar rate limiting
      if (i < top.rows.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Posição do usuário logado (pode estar fora do top 20)
    const meuId = req.session.user.id;
    let minha = entries.find((e) => e.userId === meuId) || null;

    if (!minha) {
      const res2 = await db.execute({
        sql: 'SELECT xp, level FROM xp WHERE user_id = ?',
        args: [meuId],
      });
      if (res2.rows.length) {
        const countRes = await db.execute({
          sql: 'SELECT COUNT(*) as pos FROM xp WHERE xp > ?',
          args: [res2.rows[0].xp],
        });
        minha = {
          posicao: Number(countRes.rows[0].pos) + 1,
          userId: meuId,
          xp: Number(res2.rows[0].xp),
          level: Number(res2.rows[0].level),
        };
      } else {
        minha = { posicao: null, userId: meuId, xp: 0, level: 0 };
      }
    }

    res.json({ ranking: entries, eu: minha });
  } catch (err) {
    console.error('[Leaderboard]', err);
    res.status(500).json({ erro: 'Falha ao buscar leaderboard.' });
  }
});

// ---------- 10) XP do usuário logado ----------
app.get('/api/xp/me', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ erro: 'Não logado.' });

  try {
    const r = await db.execute({
      sql: 'SELECT xp, level FROM xp WHERE user_id = ?',
      args: [req.session.user.id],
    });

    if (!r.rows.length) return res.json({ xp: 0, level: 0, posicao: null });

    const xp = Number(r.rows[0].xp);
    const level = Number(r.rows[0].level);

    const countRes = await db.execute({
      sql: 'SELECT COUNT(*) as pos FROM xp WHERE xp > ?',
      args: [xp],
    });
    const posicao = Number(countRes.rows[0].pos) + 1;

    res.json({ xp, level, posicao });
  } catch (err) {
    console.error('[XP/me]', err);
    res.status(500).json({ erro: 'Falha ao buscar XP.' });
  }
});

// ---------- Ping (mantém Render acordado) ----------
app.get('/ping', (req, res) => res.status(200).send('pong'));

// ---------- Inicia servidor ----------
initDB()
  .then(() => {
    app.listen(PORT || 3000, () => {
      console.log(`Site VIP rodando em ${SITE_URL || `http://localhost:${PORT || 3000}`}`);
    });

    // Self-ping a cada 14 min em produção
    if (process.env.NODE_ENV === 'production' && SITE_URL) {
      setInterval(async () => {
        try {
          const res = await fetch(`${SITE_URL}/ping`);
          console.log(`[Self-ping] ${new Date().toISOString()} — status ${res.status}`);
        } catch (err) {
          console.warn(`[Self-ping] Falhou: ${err.message}`);
        }
      }, 14 * 60 * 1000);
      console.log('[Self-ping] Ativado — ping a cada 14 minutos.');
    }
  })
  .catch((err) => {
    console.error('[DB] Falha ao inicializar banco:', err);
    process.exit(1);
  });
