const crypto = require('crypto');

// ========== 1. RATE LIMITING ==========
const rateLimitStore = new Map();
const MAX_REQUESTS_PER_10S = 5;
const MAX_UPDATES_PER_HOUR = 20;

function checkRateLimit(userId, action = 'default') {
  const now = Date.now();
  const key = `${userId}-${action}`;
  
  if (!rateLimitStore.has(key)) {
    rateLimitStore.set(key, { requests: [], lastHour: [] });
  }
  
  const record = rateLimitStore.get(key);
  
  // Limpa requisições antigas (> 10s)
  record.requests = record.requests.filter(t => now - t < 10000);
  
  // Limpa log de última hora
  record.lastHour = record.lastHour.filter(t => now - t < 3600000);
  
  // Verifica limite de 10s
  if (record.requests.length >= MAX_REQUESTS_PER_10S) {
    return { allowed: false, reason: 'Muitos requests em pouco tempo. Tenta de novo em alguns segundos.' };
  }
  
  // Verifica limite de 1h pra updates (POST)
  if (action === 'vip-update' && record.lastHour.length >= MAX_UPDATES_PER_HOUR) {
    return { allowed: false, reason: 'Limite de 20 atualizações por hora atingido.' };
  }
  
  record.requests.push(now);
  if (action === 'vip-update') record.lastHour.push(now);
  
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
  return token && sessionToken && token === sessionToken;
}

// ========== 3. INPUT SANITIZATION ==========
function sanitizeInput(input) {
  if (typeof input !== 'string') return '';
  return input
    .trim()
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove caracteres de controle
    .slice(0, 100); // Limita tamanho
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

// ========== 5. AUDIT LOGGING ==========
async function logAudit(action, userId, details) {
  const LOGS_CHANNEL_ID = '1539053493979971646';
  
  const timestamp = new Date().toISOString();
  const message = {
    content: `**[${action}]** <@${userId}> | ${timestamp}`,
    embeds: [{
      title: `Ação: ${action}`,
      description: `**Usuário:** <@${userId}> (${userId})\n**Timestamp:** ${timestamp}`,
      fields: Object.entries(details).map(([key, value]) => ({
        name: key,
        value: String(value).slice(0, 1024),
        inline: false,
      })),
      color: action.includes('Erro') ? 16711680 : 3066993, // Vermelho ou Azul
      timestamp: new Date().toISOString(),
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
    } else if (now - req.session.lastActivity > 30 * 60 * 1000) { // 30min
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
  // Validação simples e segura do state
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
  // Content Security Policy - Bloqueia conteúdo malicioso
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' fonts.googleapis.com; font-src fonts.gstatic.com; img-src 'self' https://cdn.discordapp.com https://discordapp.com data:; connect-src 'self' https://discord.com https://cdn.discordapp.com");
  
  // Força HTTPS por 1 ano
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  
  // Impede clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Previne MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Ativa proteção XSS do navegador
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Desabilita referrer info
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Permissions Policy (ex-Feature-Policy)
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), payment=(), usb=()');
  
  next();
}

// ========== 10. VALIDATE REDIRECT URI ==========
function validateRedirectURI(redirectUri, allowedUri) {
  // Apenas permite o redirect URI exato que foi registrado
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
  logAudit,
  requireHTTPS,
  sessionTimeout,
  generateOAuth2State,
  verifyOAuth2State,
  securityHeaders,
  validateRedirectURI,
};
