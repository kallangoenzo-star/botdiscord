const crypto = require('crypto');

// ========== 1. RATE LIMITING ==========
const rateLimitStore = new Map();
const MAX_REQUESTS_PER_10S = 5;

// Limites por hora para cada ação POST
const HOURLY_LIMITS = {
  'vip-update': 20,
  'call-update': 10,
  'compartilhar': 15,
  'revogar': 15,
  'buscar-membros': 30,
  'api-me': 60,
};

function checkRateLimit(userId, action = 'default') {
  const now = Date.now();
  const key = `${userId}-${action}`;

  if (!rateLimitStore.has(key)) {
    rateLimitStore.set(key, { requests: [], lastHour: [] });
  }

  const record = rateLimitStore.get(key);

  // Limpa requisições antigas
  record.requests = record.requests.filter(t => now - t < 10000);
  record.lastHour = record.lastHour.filter(t => now - t < 3600000);

  // Limite de 10s
  if (record.requests.length >= MAX_REQUESTS_PER_10S) {
    return { allowed: false, reason: 'Muitos requests em pouco tempo. Tenta de novo em alguns segundos.' };
  }

  // Limite horário por ação
  const hourlyLimit = HOURLY_LIMITS[action];
  if (hourlyLimit && record.lastHour.length >= hourlyLimit) {
    return { allowed: false, reason: `Limite de ${hourlyLimit} ações por hora atingido.` };
  }

  record.requests.push(now);
  if (hourlyLimit) record.lastHour.push(now);

  return { allowed: true };
}

// Limpa rate limit a cada 1h
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    record.requests = record.requests.filter(t => now - t < 10000);
    record.lastHour = record.lastHour.filter(t => now - t < 3600000);
    if (record.requests.length === 0 && record.lastHour.length === 0) {
      rateLimitStore.delete(key);
    }
  }
}, 3600000);

// ========== 2. CSRF TOKEN ==========
function generateCSRFToken() {
  return crypto.randomBytes(32).toString('hex');
}

function verifyCSRFToken(token, sessionToken) {
  if (!token || !sessionToken) return false;
  if (typeof token !== 'string' || typeof sessionToken !== 'string') return false;
  // Usa timingSafeEqual para prevenir timing attacks
  try {
    const a = Buffer.from(token, 'utf8');
    const b = Buffer.from(sessionToken, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ========== 3. INPUT SANITIZATION ==========
function sanitizeInput(input) {
  if (typeof input !== 'string') return '';
  return input
    .trim()
    .replace(/[\x00-\x1F\x7F]/g, '')       // Remove caracteres de controle
    .replace(/[\u200B-\u200D\uFEFF]/g, '')  // Remove zero-width characters
    .replace(/\u202E/g, '')                  // Remove RTL override
    .slice(0, 100);
}

function validateHexColor(hex) {
  return /^#[0-9A-Fa-f]{6}$/.test(hex);
}

function validateUserId(id) {
  return /^\d{15,25}$/.test(id);
}

// ========== 4. PERMISSION CHECK ==========
async function verifyUserHasRole(userId, roleId, headers) {
  try {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members/${userId}`,
      { headers }
    );
    if (!res.ok) return false;
    const member = await res.json();
    return member.roles.includes(roleId);
  } catch {
    return false;
  }
}

// Verifica se usuário tem o cargo VIP de acesso
async function verifyUserHasVipAccess(userId, headers) {
  const VIP_ROLE_ID = process.env.VIP_ROLE_ID;
  if (!VIP_ROLE_ID) return false;
  return verifyUserHasRole(userId, VIP_ROLE_ID, headers);
}

// ========== 5. AUDIT LOGGING ==========
async function logAudit(action, userId, details) {
  const LOGS_CHANNEL_ID = process.env.LOGS_CHANNEL_ID || '1539053493979971646';
  const timestamp = new Date().toISOString();

  // Sanitiza os valores dos detalhes antes de logar
  const safeDetails = {};
  for (const [key, value] of Object.entries(details)) {
    safeDetails[key] = sanitizeInput(String(value)).slice(0, 200);
  }

  const message = {
    content: `**[${action}]** <@${userId}> | ${timestamp}`,
    embeds: [{
      title: `Ação: ${action}`,
      description: `**Usuário:** <@${userId}> (${userId})\n**Timestamp:** ${timestamp}`,
      fields: Object.entries(safeDetails).map(([key, value]) => ({
        name: key,
        value: String(value).slice(0, 1024),
        inline: false,
      })),
      color: action.includes('Erro') ? 16711680 : 3066993,
      timestamp,
    }],
  };

  try {
    await fetch(
      `https://discord.com/api/v10/channels/${LOGS_CHANNEL_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      }
    );
  } catch (err) {
    console.error('Erro ao enviar log:', err);
  }
}

// ========== 5b. LOG DE ABERTURA DE PAINEL (dados sensíveis no Turso) ==========
async function logAuditPainel(userId, username, ip, pais, cidade, userAgent) {
  const LOGS_CHANNEL_ID = process.env.LOGS_CHANNEL_ID || '1539053493979971646';
  const timestamp = new Date().toISOString();
  const logId = `painel_${userId}_${Date.now()}`;
  const expiraEm = Date.now() + 60 * 60 * 1000; // 1 hora

  // Valida IP antes de usar — previne path injection na URL da geolocalização
  const ipSeguro = /^[\d.:a-fA-F]+$/.test(ip) ? ip : 'desconhecido';

  try {
    const { createClient } = require('@libsql/client');
    const db = createClient({
      url: process.env.TURSO_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });

    await db.execute(`
      CREATE TABLE IF NOT EXISTS painel_logs (
        log_id     TEXT PRIMARY KEY,
        user_id    TEXT,
        username   TEXT,
        ip         TEXT,
        pais       TEXT,
        cidade     TEXT,
        user_agent TEXT,
        timestamp  TEXT,
        expira_em  INTEGER
      )
    `);

    await db.execute({
      sql: `INSERT INTO painel_logs (log_id, user_id, username, ip, pais, cidade, user_agent, timestamp, expira_em)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [logId, userId, username, ipSeguro, pais, cidade, userAgent.slice(0, 300), timestamp, expiraEm],
    });

    // Limpa logs expirados
    await db.execute({
      sql: 'DELETE FROM painel_logs WHERE expira_em < ?',
      args: [Date.now()],
    });
  } catch (err) {
    console.error('[PainelLog] Erro ao salvar no Turso:', err.message);
  }

  // Log público — sem IP, sem user-agent
  const message = {
    embeds: [{
      title: '🖥️ Abertura de Painel VIP',
      description: `**Usuário:** <@${userId}> (${username})\n**Quando:** ${timestamp}`,
      fields: [
        { name: 'País', value: pais, inline: true },
        { name: 'Cidade', value: cidade, inline: true },
      ],
      color: 3066993,
      timestamp,
    }],
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 2,
        label: '🔍 Ver detalhes (admin)',
        custom_id: `painel_log:${logId}`,
      }],
    }],
  };

  try {
    await fetch(
      `https://discord.com/api/v10/channels/${LOGS_CHANNEL_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      }
    );
  } catch (err) {
    console.error('Erro ao enviar log de painel:', err);
  }
}

async function getPainelLogData(logId) {
  try {
    const { createClient } = require('@libsql/client');
    const db = createClient({
      url: process.env.TURSO_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });

    const res = await db.execute({
      sql: 'SELECT * FROM painel_logs WHERE log_id = ? AND expira_em > ?',
      args: [logId, Date.now()],
    });

    if (!res.rows.length) return null;
    const r = res.rows[0];
    return {
      userId: r.user_id,
      username: r.username,
      ip: r.ip,
      pais: r.pais,
      cidade: r.cidade,
      userAgent: r.user_agent,
      timestamp: r.timestamp,
    };
  } catch (err) {
    console.error('[PainelLog] Erro ao buscar no Turso:', err.message);
    return null;
  }
}

// ========== 6. HTTPS CHECK ==========
function requireHTTPS(req, res, next) {
  if (process.env.NODE_ENV === 'production') {
    if (req.header('x-forwarded-proto') !== 'https' && !req.secure) {
      return res.status(403).json({ erro: 'HTTPS obrigatório' });
    }
  }
  next();
}

// ========== 7. SESSION TIMEOUT ==========
function sessionTimeout(req, res, next) {
  if (req.session.user) {
    const now = Date.now();
    if (!req.session.lastActivity) {
      req.session.lastActivity = now;
    } else if (now - req.session.lastActivity > 30 * 60 * 1000) {
      req.session.destroy(() => {
        return res.status(401).json({ erro: 'Sessão expirada por inatividade.' });
      });
      return;
    }
    req.session.lastActivity = now;
  }
  next();
}

// ========== 8. OAUTH2 STATE PARAMETER ==========
function generateOAuth2State() {
  return crypto.randomBytes(32).toString('hex');
}

function verifyOAuth2State(state, sessionState) {
  if (!state || !sessionState) return false;
  if (typeof state !== 'string' || typeof sessionState !== 'string') return false;

  const a = Buffer.from(state, 'utf8');
  const b = Buffer.from(sessionState, 'utf8');

  if (a.length !== b.length) return false;

  try {
    return crypto.timingSafeEqual(a, b);
  } catch (err) {
    console.error('Erro ao verificar OAuth2 State:', err.message);
    return false;
  }
}

// ========== 9. SECURITY HEADERS ==========
function securityHeaders(req, res, next) {
  // CSP sem unsafe-inline para scripts — usa nonce seria ideal mas exige refactor do HTML
  // Mantemos unsafe-inline apenas para styles (necessário pelo CSS inline do app)
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self'; " +
    "style-src 'self' 'unsafe-inline' fonts.googleapis.com; " +
    "font-src fonts.gstatic.com; " +
    "img-src 'self' https://cdn.discordapp.com https://discordapp.com https://raw.githubusercontent.com data:; " +
    "connect-src 'self' https://discord.com https://cdn.discordapp.com"
  );
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), payment=(), usb=()');
  next();
}

// ========== 10. VALIDATE REDIRECT URI ==========
function validateRedirectURI(redirectUri, allowedUri) {
  return redirectUri === allowedUri;
}

module.exports = {
  checkRateLimit,
  generateCSRFToken,
  verifyCSRFToken,
  sanitizeInput,
  validateHexColor,
  validateUserId,
  verifyUserHasRole,
  verifyUserHasVipAccess,
  logAudit,
  logAuditPainel,
  getPainelLogData,
  requireHTTPS,
  sessionTimeout,
  generateOAuth2State,
  verifyOAuth2State,
  securityHeaders,
  validateRedirectURI,
};
