# 🚀 Guia de Deployment no Railway

## 📋 Pré-requisitos

1. **Conta Railway** - Acessa [railway.app](https://railway.app) e faz login com GitHub
2. **Repositório Git** - Push seu código para GitHub
3. **Variáveis de Ambiente** - Já tem no `.env` local

---

## ✅ Passo 1: Preparar o Código

### 1.1 Inicializa Git (se não tiver)
```bash
git init
git add .
git commit -m "Inicial: Bot Discord com painel VIP"
```

### 1.2 Cria repositório no GitHub
- Vai em [github.com/new](https://github.com/new)
- Cria repo `botdiscord`
- Copia os comandos de push

### 1.3 Push para GitHub
```bash
git remote add origin https://github.com/seu-usuario/botdiscord.git
git branch -M main
git push -u origin main
```

---

## 🚂 Passo 2: Deploy no Railway

### 2.1 Acessa [railway.app](https://railway.app)

### 2.2 Novo Projeto
- Clica em **"New Project"**
- Seleciona **"Deploy from GitHub repo"**
- Autoriza Railway a acessar seu GitHub
- Seleciona o repo `botdiscord`

### 2.3 Configurar Variáveis
Railway vai detectar `Procfile` automaticamente!

1. **Clica na aba "Variables"**
2. **Adiciona todas as variáveis do seu `.env`:**
   ```
   DISCORD_TOKEN=seu_token_do_bot
   CLIENT_ID=1538760744001212436
   CLIENT_SECRET=seu_client_secret
   GUILD_ID=1538714894738923591
   SESSION_SECRET=gera-uma-string-forte-aqui
   NODE_ENV=production
   ```

3. **SITE_URL especial:** Railway vai gerar URL automático
   - Você vai ver algo tipo: `https://botdiscord-production.up.railway.app`
   - Usa esse valor em `SITE_URL`

### 2.4 Aguarda Deploy
- Railway faz build automaticamente
- Toma uns 2-3 minutos

---

## 🔐 Passo 3: Atualizar Discord OAuth Redirect URI

Agora que tem URL do Railway:

1. **Acessa [Discord Developer Portal](https://discord.com/developers/applications)**
2. **Seu app `botdiscord`**
3. **OAuth2 → Redirects**
4. **Remove** `http://localhost:3000/auth/callback`
5. **Adiciona** `https://seu-app.railway.app/auth/callback`
6. **Salva**

---

## ✅ Passo 4: Testar

1. **Acessa URL do Railway**
   - Exemplo: `https://botdiscord-production.up.railway.app`
   
2. **Clica "Login com Discord"**
   - Deve dar redirect para Discord
   - Volta para seu site autenticado

3. **Checa console/logs**
   - Na Railway, clica em "Deployment"
   - Vê os logs em tempo real

---

## 🤖 Passo 5: Bot Sempre Ativo

Railway mantém DOIS **dynos** rodando 24/7 (conforme `Procfile`):

- **`web: node server.js`** → Painel web na porta 3000
- **`worker: node index.js`** → Bot Discord sempre conectado

**Importante:** Railway **não dorme** como Heroku (que dormia). Seu bot fica ativo 24/7!

---

## 🔄 Como Atualizar o Código

Toda vez que faz push para `main`:

```bash
git add .
git commit -m "Descrição da mudança"
git push origin main
```

Railway **redeploy automaticamente** em ~2 min!

---

## 💰 Plano Railway

✅ **5GB/mês grátis** (suficiente para bot pequeno)  
✅ **$5 de crédito inicial**  
✅ Sem cartão de crédito pra começar  
⚠️ Depois disso, paga $0.50/GB ou paga uso

Se ficar muito caro, pode usar **alternativas gratuitas**:
- **Replit** - Rodinha 24/7 com webhook
- **Oracle Cloud Free Tier** - 4GB RAM, sempre grátis
- **Fly.io** - Similar ao Railway

---

## 🐛 Troubleshooting

### Bot não conecta
- Verifica se `DISCORD_TOKEN` está correto
- Checa logs em "Deployment"

### Painel web dá erro 502
- Provavelmente variável não setada
- Vai em "Variables" e verifica cada uma

### Bot conecta mas comandos não funcionam
- Verifica permissões do bot no servidor Discord

---

## 📞 Precisa de Ajuda?

1. Verifica logs: Dashboard Railway → Deployment → Logs
2. Testa localmente: `npm start` e `npm run site` em abas diferentes
3. Me avisa qual erro está vendo!

---

**Boa sorte! 🚀 Seu bot vai ficar 24/7 ativo agora!**
