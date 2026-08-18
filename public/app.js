// ============================================================
// Estado global
// ============================================================
let csrfToken = '';
let meuUserId = '';
let temVip = false;
const XP_PARA_VIP = 3000;

// ============================================================
// Roda de cores (só inicializada quando a aba VIP abrir)
// ============================================================
let rodaInicializada = false;
let lightness = 50;
const cores = { c1: '#8b5cf6', c2: '#4fd1c5' };
let slotAtivo = 'c1';
let gradienteAtivo = false;
let nomeDiscordReal = 'você';

function inicializarRoda() {
  if (rodaInicializada) return;
  
  const canvas = document.getElementById('colorWheel');
  if (!canvas) return; // Se o elemento não existir, não inicializa
  
  rodaInicializada = true;
  const ctx = canvas.getContext('2d');
  const radius = canvas.width / 2;

  function desenharRoda() {
    const img = ctx.createImageData(canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const dx = x - radius;
        const dy = y - radius;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const i = (y * canvas.width + x) * 4;
        if (dist <= radius) {
          const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 180;
          const sat = Math.min(dist / radius, 1) * 100;
          const [r, g, b] = hslParaRgb(angle, sat, lightness);
          img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
        } else {
          img.data[i + 3] = 0;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function hslParaRgb(h, s, l) {
    s /= 100; l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r, g, b;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }

  function rgbParaHex(r, g, b) {
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  let arrastando = false;

  function pegarCorDoPonto(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    const px = ctx.getImageData(
      Math.min(Math.max(x, 0), canvas.width - 1),
      Math.min(Math.max(y, 0), canvas.height - 1),
      1, 1
    ).data;
    if (px[3] === 0) return;
    aplicarCor(rgbParaHex(px[0], px[1], px[2]), false);
  }

  canvas.addEventListener('mousedown', (e) => { arrastando = true; pegarCorDoPonto(e.clientX, e.clientY); });
  window.addEventListener('mousemove', (e) => { if (arrastando) pegarCorDoPonto(e.clientX, e.clientY); });
  window.addEventListener('mouseup', () => (arrastando = false));
  canvas.addEventListener('touchstart', (e) => { arrastando = true; const t = e.touches[0]; pegarCorDoPonto(t.clientX, t.clientY); });
  canvas.addEventListener('touchmove', (e) => { if (arrastando) { const t = e.touches[0]; pegarCorDoPonto(t.clientX, t.clientY); } e.preventDefault(); }, { passive: false });
  window.addEventListener('touchend', () => (arrastando = false));

  const lightSlider = document.getElementById('lightSlider');
  lightSlider.addEventListener('input', () => { lightness = Number(lightSlider.value); desenharRoda(); });

  const hexInput = document.getElementById('hexInput');
  hexInput.addEventListener('change', () => {
    let v = hexInput.value.trim();
    if (!v.startsWith('#')) v = '#' + v;
    if (/^#[0-9A-Fa-f]{6}$/.test(v)) aplicarCor(v, true);
  });

  document.getElementById('tabCor1').addEventListener('click', () => trocarSlot('c1'));
  document.getElementById('tabCor2').addEventListener('click', () => trocarSlot('c2'));

  document.getElementById('gradienteToggle').addEventListener('change', (e) => {
    gradienteAtivo = e.target.checked;
    document.getElementById('tabCor2').classList.toggle('oculta', !gradienteAtivo);
    if (!gradienteAtivo) trocarSlot('c1');
    atualizarPreview();
  });

  document.getElementById('nomeInput').addEventListener('input', atualizarPreview);

  desenharRoda();
  atualizarSwatches();
  atualizarPreview();
}

function aplicarCor(hex, doInput) {
  cores[slotAtivo] = hex;
  if (!doInput) document.getElementById('hexInput').value = hex;
  atualizarSwatches();
  atualizarPreview();
}

function atualizarSwatches() {
  document.getElementById('dotCor1').style.background = cores.c1;
  document.getElementById('dotCor2').style.background = cores.c2;
  if (slotAtivo === 'c1') document.documentElement.style.setProperty('--user-color', cores.c1);
}

function trocarSlot(slot) {
  slotAtivo = slot;
  document.getElementById('tabCor1').classList.toggle('ativa', slot === 'c1');
  document.getElementById('tabCor2').classList.toggle('ativa', slot === 'c2');
  document.getElementById('hexInput').value = cores[slot];
  document.documentElement.style.setProperty('--user-color', cores[slot]);
}

function atualizarPreview() {
  const nomeInput = document.getElementById('nomeInput');
  const previewHeader = document.getElementById('previewHeader');
  const previewNome = document.getElementById('previewNome');
  if (!nomeInput || !previewHeader || !previewNome) return;

  previewHeader.textContent = (nomeInput.value.trim() || 'Cargo VIP').toUpperCase();
  previewNome.textContent = nomeDiscordReal;

  const corCss = gradienteAtivo
    ? `linear-gradient(90deg, ${cores.c1}, ${cores.c2})`
    : `linear-gradient(90deg, ${cores.c1}, ${cores.c1})`;

  previewHeader.style.backgroundImage = corCss;
  previewNome.style.backgroundImage = corCss;

  const avatar = document.getElementById('previewAvatar');
  if (avatar) avatar.style.borderColor = gradienteAtivo ? cores.c2 : cores.c1;
}

// ============================================================
// Sistema de abas
// ============================================================
function configurarAbas(cargoAtual) {
  const btnLeaderboard = document.getElementById('abaLeaderboardBtn');
  const btnVip = document.getElementById('abaVipBtn');
  const abaLeaderboard = document.getElementById('abaLeaderboard');
  const abaVip = document.getElementById('abaVip');
  const vipBloqueado = document.getElementById('vipBloqueado');
  const painelVipConteudo = document.getElementById('painelVipConteudo');

  temVip = !!cargoAtual;

  // Configura estado visual da aba VIP
  if (temVip) {
    btnVip.classList.remove('aba-bloqueada');
    vipBloqueado.classList.add('oculto');
    painelVipConteudo.classList.remove('oculto');
  } else {
    btnVip.classList.add('aba-bloqueada');
    vipBloqueado.classList.remove('oculto');
    painelVipConteudo.classList.add('oculto');
  }

  function ativarAba(aba) {
    // Esconde todas
    abaLeaderboard.classList.add('oculto');
    abaVip.classList.add('oculto');
    btnLeaderboard.classList.remove('ativa');
    btnVip.classList.remove('ativa');

    if (aba === 'leaderboard') {
      abaLeaderboard.classList.remove('oculto');
      btnLeaderboard.classList.add('ativa');
      btnLeaderboard.setAttribute('aria-selected', 'true');
      btnVip.setAttribute('aria-selected', 'false');
      carregarLeaderboard();
    } else if (aba === 'vip') {
      abaVip.classList.remove('oculto');
      btnVip.classList.add('ativa');
      btnLeaderboard.setAttribute('aria-selected', 'false');
      btnVip.setAttribute('aria-selected', 'true');
    }
  }

  btnLeaderboard.addEventListener('click', () => ativarAba('leaderboard'));
  btnVip.addEventListener('click', () => {
    // Se não tem VIP, mostra a aba mas com o bloqueio — não bloqueia o clique
    ativarAba('vip');
  });

  // Começa na aba leaderboard
  ativarAba('leaderboard');
}

// ============================================================
// Leaderboard
// ============================================================
async function carregarLeaderboard() {
  const lista = document.getElementById('rankingLista');
  lista.innerHTML = '<div class="ranking-loading">Carregando ranking...</div>';

  try {
    const res = await fetch('/api/leaderboard');
    if (!res.ok) throw new Error('Falha na requisição');
    const data = await res.json();

    // Atualiza card de XP do usuário
    atualizarMeuXp(data.eu);

    // Renderiza top 20
    if (!data.ranking.length) {
      lista.innerHTML = '<div class="ranking-vazio">Ainda ninguém no ranking. Manda mensagem no servidor!</div>';
      return;
    }

    lista.innerHTML = data.ranking.map((entry) => {
      const souEu = entry.userId === meuUserId;
      const medalha = entry.posicao === 1 ? '🥇' : entry.posicao === 2 ? '🥈' : entry.posicao === 3 ? '🥉' : `#${entry.posicao}`;
      const pct = Math.min(100, Math.round((entry.xp / XP_PARA_VIP) * 100));

      return `
        <div class="ranking-item ${souEu ? 'ranking-item-eu' : ''}">
          <span class="ranking-pos">${medalha}</span>
          <img class="ranking-avatar" src="${entry.avatarUrl}" alt="" />
          <div class="ranking-info">
            <span class="ranking-nome">${entry.displayName}${souEu ? ' <span class="ranking-eu-tag">você</span>' : ''}</span>
            <div class="ranking-xp-barra-mini">
              <div class="ranking-xp-fill-mini" style="width:${pct}%"></div>
            </div>
          </div>
          <div class="ranking-stats">
            <span class="ranking-xp-valor">${entry.xp} XP</span>
            <span class="ranking-level">Nv. ${entry.level}</span>
          </div>
        </div>
      `;
    }).join('');

  } catch {
    lista.innerHTML = '<div class="ranking-loading">Falha ao carregar ranking. Tenta de novo.</div>';
  }
}

function atualizarMeuXp(eu) {
  if (!eu) return;

  document.getElementById('meuXpValor').textContent = eu.xp;
  document.getElementById('meuLevelValor').textContent = eu.level;
  document.getElementById('minhaPosicao').textContent = eu.posicao ? `#${eu.posicao}` : '—';

  // Barra de progresso
  const pct = Math.min(100, Math.round((eu.xp / XP_PARA_VIP) * 100));
  document.getElementById('xpProgressoFill').style.width = `${pct}%`;
  document.getElementById('xpProgressoTexto').textContent =
    eu.xp >= XP_PARA_VIP
      ? '✅ VIP desbloqueado!'
      : `${eu.xp} / ${XP_PARA_VIP} XP para o VIP`;
  document.getElementById('xpProgressoPct').textContent = `${pct}%`;

  // Atualiza mensagem de bloqueio com o nível atual
  const desc = document.getElementById('vipBloqueadoDesc');
  if (desc) {
    const faltam = Math.max(0, XP_PARA_VIP - eu.xp);
    desc.textContent = `Você está no nível ${eu.level} com ${eu.xp} XP. Faltam ${faltam} XP para desbloquear o VIP.`;
  }
}

// ============================================================
// Inicialização
// ============================================================
async function iniciar() {
  // Verifica erros de query string
  const params = new URLSearchParams(window.location.search);
  const erro = params.get('erro');

  if (erro) {
    const msgs = {
      nao_eh_membro: '❌ Você não é membro deste servidor.',
      state_invalido: '❌ Erro de segurança no login. Tenta novamente.',
      token_falhou: '❌ Falha ao comunicar com Discord. Tenta de novo.',
    };
    // Mostra erro na tela de login
    const loginDiv = document.getElementById('estado-login');
    const p = document.createElement('p');
    p.className = 'mensagem erro';
    p.style.display = 'block';
    p.textContent = msgs[erro] || '❌ Erro desconhecido.';
    loginDiv.prepend(p);
    return;
  }

  const res = await fetch('/api/me');
  const data = await res.json();
  if (!data.logado) return;

  csrfToken = data.csrfToken;
  meuUserId = data.user.id;
  nomeDiscordReal = data.user.displayName || data.user.username;

  document.getElementById('estado-login').classList.add('oculto');
  document.getElementById('estado-painel').classList.remove('oculto');

  // Avatar no painel VIP
  const previewAvatar = document.getElementById('previewAvatar');
  if (previewAvatar) previewAvatar.src = data.avatarUrl;

  // Configura abas com base em se tem cargo VIP de acesso
  configurarAbas(data.temCargoVip);

  // Inicializa a roda de cores antecipadamente para evitar layout shift ao trocar de aba
  inicializarRoda();

  // Preenche lista de membros compartilhados (painel VIP)
  (data.membros || []).forEach((m) => adicionarNaLista(m));
  if (data.callAtual) {
    const callBtn = document.getElementById('callBtn');
    if (callBtn) callBtn.textContent = 'Atualizar minha Call';
  }
}

// ============================================================
// Salvar cargo VIP
// ============================================================
document.getElementById('salvarBtn').addEventListener('click', async () => {
  const nomeInput = document.getElementById('nomeInput');
  const nome = nomeInput.value.trim();
  const msg = document.getElementById('mensagem');
  msg.className = 'mensagem';
  msg.textContent = '';

  if (nome.length < 3) {
    msg.textContent = 'O nome precisa ter pelo menos 3 caracteres.';
    msg.classList.add('erro');
    return;
  }

  const btn = document.getElementById('salvarBtn');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  try {
    const res = await fetch('/api/vip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, cor: cores.c1, cor2: cores.c2, gradiente: gradienteAtivo, csrfToken }),
    });
    const data = await res.json();

    if (!res.ok) {
      msg.textContent = data.erro || 'Algo deu errado.';
      msg.classList.add('erro');
    } else {
      msg.textContent = `Cargo "${data.nome}" salvo com sucesso!`;
      msg.classList.add('sucesso');
    }
  } catch {
    msg.textContent = 'Falha de conexão. Tenta de novo.';
    msg.classList.add('erro');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar cargo VIP';
  }
});

// ============================================================
// Compartilhar cargo
// ============================================================
const buscaInput = document.getElementById('buscaInput');
const resultadosBusca = document.getElementById('resultadosBusca');
const listaMembros = document.getElementById('listaMembros');
let buscaTimeout;

buscaInput.addEventListener('input', () => {
  clearTimeout(buscaTimeout);
  const termo = buscaInput.value.trim();
  if (termo.length < 2) {
    resultadosBusca.classList.add('oculto');
    resultadosBusca.innerHTML = '';
    return;
  }
  buscaTimeout = setTimeout(() => buscarMembros(termo), 350);
});

async function buscarMembros(termo) {
  try {
    const res = await fetch(`/api/buscar-membros?q=${encodeURIComponent(termo)}`);
    const data = await res.json();
    if (!res.ok) {
      resultadosBusca.innerHTML = `<div class="resultado-item desabilitado">${data.erro}</div>`;
      resultadosBusca.classList.remove('oculto');
      return;
    }
    renderResultados(data.resultados);
  } catch {
    // falha silenciosa
  }
}

function renderResultados(resultados) {
  if (!resultados.length) {
    resultadosBusca.innerHTML = `<div class="resultado-item desabilitado">Ninguém encontrado.</div>`;
    resultadosBusca.classList.remove('oculto');
    return;
  }
  resultadosBusca.innerHTML = resultados.map((m) => `
    <div class="resultado-item ${m.jaTem ? 'desabilitado' : ''}" data-id="${m.id}">
      <img class="resultado-avatar" src="${m.avatarUrl}" alt="" />
      <span class="resultado-nome">${m.displayName}</span>
      ${m.jaTem ? '<span class="resultado-tag">já tem</span>' : ''}
    </div>`
  ).join('');
  resultadosBusca.classList.remove('oculto');

  resultadosBusca.querySelectorAll('.resultado-item:not(.desabilitado)').forEach((el) => {
    el.addEventListener('click', () => compartilharCom(el.dataset.id));
  });
}

async function compartilharCom(targetId) {
  const msg = document.getElementById('mensagem');
  try {
    const res = await fetch('/api/vip/compartilhar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId, csrfToken }),
    });
    const data = await res.json();
    if (!res.ok) {
      msg.textContent = data.erro;
      msg.className = 'mensagem erro';
      return;
    }
    adicionarNaLista(data.membro);
    buscaInput.value = '';
    resultadosBusca.classList.add('oculto');
    msg.textContent = `Cargo compartilhado com ${data.membro.displayName}!`;
    msg.className = 'mensagem sucesso';
  } catch {
    msg.textContent = 'Falha de conexão. Tenta de novo.';
    msg.className = 'mensagem erro';
  }
}

function adicionarNaLista(membro) {
  const div = document.createElement('div');
  div.className = 'membro-item';
  div.dataset.id = membro.id;
  div.innerHTML = `
    <img class="membro-avatar" src="${membro.avatarUrl}" alt="" />
    <span class="membro-nome">${membro.displayName}</span>
    <button class="membro-remover" data-id="${membro.id}">remover</button>
  `;
  div.querySelector('.membro-remover').addEventListener('click', () => revogarDe(membro.id, div));
  listaMembros.appendChild(div);
}

async function revogarDe(targetId, elemento) {
  try {
    const res = await fetch('/api/vip/revogar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId, csrfToken }),
    });
    if (res.ok) elemento.remove();
  } catch {
    // falha silenciosa
  }
}

// ============================================================
// Call de voz privada
// ============================================================
const callBtn = document.getElementById('callBtn');
const callNomeInput = document.getElementById('callNomeInput');
callBtn.addEventListener('click', async () => {
  const msg = document.getElementById('mensagemCall');
  msg.className = 'mensagem';
  msg.textContent = '';
  callBtn.disabled = true;
  callBtn.textContent = 'Configurando...';

  try {
    const res = await fetch('/api/vip/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: callNomeInput.value.trim() || 'Call Privada', csrfToken }),
    });
    const data = await res.json();
    if (!res.ok) {
      msg.textContent = data.erro;
      msg.classList.add('erro');
    } else {
      msg.textContent = 'Sala de voz criada com sucesso! Você já pode entrar.';
      msg.classList.add('sucesso');
      callBtn.textContent = 'Atualizar minha Call';
      callNomeInput.placeholder = data.nome || 'Call Privada';
    }
  } catch {
    msg.textContent = 'Falha de conexão. Tenta de novo.';
    msg.classList.add('erro');
  } finally {
    callBtn.disabled = false;
    if (callBtn.textContent === 'Configurando...') callBtn.textContent = 'Criar minha Call Privada';
  }
});

// ============================================================
// Inicia tudo
// ============================================================
iniciar();
