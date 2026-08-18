const canvas = document.getElementById('colorWheel');
const ctx = canvas.getContext('2d');
const radius = canvas.width / 2;
let lightness = 50;
let csrfToken = ''; // Token de segurança CSRF

// Duas cores possíveis (c1 sempre existe, c2 só é usada com gradiente ativo)
const cores = { c1: '#8b5cf6', c2: '#4fd1c5' };
let slotAtivo = 'c1';
let gradienteAtivo = false;

// ---------- Desenha a roda de cores (matiz + saturação) ----------
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
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
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
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function rgbParaHex(r, g, b) {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

// ---------- Clique/arrasto na roda escolhe a cor do slot ativo ----------
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

// ---------- Slider de brilho ----------
const lightSlider = document.getElementById('lightSlider');
lightSlider.addEventListener('input', () => {
  lightness = Number(lightSlider.value);
  desenharRoda();
});

// ---------- Campo HEX manual ----------
const hexInput = document.getElementById('hexInput');
hexInput.addEventListener('change', () => {
  let v = hexInput.value.trim();
  if (!v.startsWith('#')) v = '#' + v;
  if (/^#[0-9A-Fa-f]{6}$/.test(v)) aplicarCor(v, true);
});

function aplicarCor(hex, doInput) {
  cores[slotAtivo] = hex;
  if (!doInput) hexInput.value = hex;
  atualizarSwatches();
  atualizarPreview();
}

function atualizarSwatches() {
  document.getElementById('dotCor1').style.background = cores.c1;
  document.getElementById('dotCor2').style.background = cores.c2;
  if (slotAtivo === 'c1') document.documentElement.style.setProperty('--user-color', cores.c1);
}

// ---------- Alternar entre editar Cor 1 e Cor 2 ----------
document.getElementById('tabCor1').addEventListener('click', () => trocarSlot('c1'));
document.getElementById('tabCor2').addEventListener('click', () => trocarSlot('c2'));

function trocarSlot(slot) {
  slotAtivo = slot;
  document.getElementById('tabCor1').classList.toggle('ativa', slot === 'c1');
  document.getElementById('tabCor2').classList.toggle('ativa', slot === 'c2');
  hexInput.value = cores[slot];
  document.documentElement.style.setProperty('--user-color', cores[slot]);
}

// ---------- Toggle do gradiente ----------
const gradienteToggle = document.getElementById('gradienteToggle');
gradienteToggle.addEventListener('change', () => {
  gradienteAtivo = gradienteToggle.checked;
  document.getElementById('tabCor2').classList.toggle('oculta', !gradienteAtivo);
  if (!gradienteAtivo) trocarSlot('c1');
  atualizarPreview();
});

// ---------- Preview: nome de usuário real do Discord + nome do cargo (cabeçalho) ----------
const nomeInput = document.getElementById('nomeInput');
const previewNome = document.getElementById('previewNome');
const previewHeader = document.getElementById('previewHeader');
let nomeDiscordReal = 'você'; // atualizado depois do login, em iniciar()

nomeInput.addEventListener('input', atualizarPreview);

function atualizarPreview() {
  // O nome do cargo vira o "cabeçalho" (igual a categoria destacada no Discord)
  previewHeader.textContent = (nomeInput.value.trim() || 'Cargo VIP').toUpperCase();
  // O texto colorido de verdade no Discord é o SEU nome de usuário/apelido
  previewNome.textContent = nomeDiscordReal;

  const corCss = gradienteAtivo
    ? `linear-gradient(90deg, ${cores.c1}, ${cores.c2})`
    : `linear-gradient(90deg, ${cores.c1}, ${cores.c1})`;

  // Usa backgroundImage (não o shorthand "background") pra não resetar
  // o background-clip:text definido no CSS.
  previewHeader.style.backgroundImage = corCss;
  previewNome.style.backgroundImage = corCss;

  const avatar = document.getElementById('previewAvatar');
  avatar.style.borderColor = gradienteAtivo ? cores.c2 : cores.c1;
}

// ---------- Checa login e carrega estado ----------
async function iniciar() {
  desenharRoda();
  atualizarSwatches();
  atualizarPreview();

  // Verifica erros de query string
  const params = new URLSearchParams(window.location.search);
  const erro = params.get('erro');
  const msgDiv = document.getElementById('mensagem');
  
  if (erro === 'nao_eh_membro') {
    msgDiv.textContent = '❌ Você não é membro deste servidor. Precisa estar no servidor do Discord para usar este bot.';
    msgDiv.className = 'mensagem erro';
    msgDiv.style.display = 'block';
    return;
  }
  
  if (erro === 'state_invalido') {
    msgDiv.textContent = '❌ Erro de segurança no login. Tenta novamente.';
    msgDiv.className = 'mensagem erro';
    msgDiv.style.display = 'block';
    return;
  }
  
  if (erro === 'token_falhou') {
    msgDiv.textContent = '❌ Falha ao comunicar com Discord. Tenta de novo.';
    msgDiv.className = 'mensagem erro';
    msgDiv.style.display = 'block';
    return;
  }

  const res = await fetch('/api/me');
  const data = await res.json();
  if (!data.logado) return;

  // Armazena CSRF token
  csrfToken = data.csrfToken;

  document.getElementById('estado-login').classList.add('oculto');
  document.getElementById('estado-painel').classList.remove('oculto');
  document.getElementById('previewAvatar').src = data.avatarUrl;

  nomeDiscordReal = data.user.displayName || data.user.username;
  atualizarPreview();

  (data.membros || []).forEach((m) => adicionarNaLista(m));
  if (data.callAtual) {
    document.getElementById('callBtn').textContent = 'Atualizar minha Call';
  }
}

// ---------- Salvar ----------
document.getElementById('salvarBtn').addEventListener('click', async () => {
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
      body: JSON.stringify({
        nome,
        cor: cores.c1,
        cor2: cores.c2,
        gradiente: gradienteAtivo,
        csrfToken, // Envia CSRF token
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      msg.textContent = data.erro || 'Algo deu errado.';
      msg.classList.add('erro');
    } else {
      msg.textContent = `Cargo "${data.nome}" salvo com sucesso!`;
      msg.classList.add('sucesso');
    }
  } catch (err) {
    msg.textContent = 'Falha de conexão. Tenta de novo.';
    msg.classList.add('erro');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar cargo VIP';
  }
});

iniciar();

// ---------- Compartilhar cargo com outros membros ----------
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
  // espera a pessoa parar de digitar antes de buscar (evita chamada a cada letra)
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
    // falha silenciosa, usuário pode tentar de novo
  }
}

function renderResultados(resultados) {
  if (!resultados.length) {
    resultadosBusca.innerHTML = `<div class="resultado-item desabilitado">Ninguém encontrado.</div>`;
    resultadosBusca.classList.remove('oculto');
    return;
  }
  resultadosBusca.innerHTML = resultados
    .map(
      (m) => `
      <div class="resultado-item ${m.jaTem ? 'desabilitado' : ''}" data-id="${m.id}" data-nome="${m.displayName}" data-avatar="${m.avatarUrl}">
        <img class="resultado-avatar" src="${m.avatarUrl}" alt="" />
        <span class="resultado-nome">${m.displayName}</span>
        ${m.jaTem ? '<span class="resultado-tag">já tem</span>' : ''}
      </div>`
    )
    .join('');
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
      body: JSON.stringify({ targetId }),
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
      body: JSON.stringify({ targetId }),
    });
    if (res.ok) elemento.remove();
  } catch {
    // se falhar, o item simplesmente continua na lista
  }
}

// ---------- Criar / atualizar a call de voz privada ----------
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
      body: JSON.stringify({ nome: callNomeInput.value.trim() || 'Call Privada' }),
    });
    const data = await res.json();
    if (!res.ok) {
      msg.textContent = data.erro;
      msg.classList.add('erro');
    } else {
      msg.textContent = `Sala de voz criada com sucesso! Você já pode entrar.`;
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
