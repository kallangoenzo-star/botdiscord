# Bot VIP + Painel Web (cargo pessoal cosmético)

## Como funciona agora
1. Usuário digita `/vip` no Discord.
2. O bot responde com um botão **"Abrir Painel VIP"**.
3. O botão leva pra um site próprio, onde a pessoa faz login com o Discord,
   escolhe o nome e a cor (numa roda de cores de verdade) e salva.
4. O site chama a API do Discord por trás dos panos e cria/edita o cargo,
   igual antes — só que com uma interface bonita em vez do formulário nativo.

## Passo a passo

### 1. Configurar a aplicação no Discord Developer Portal
Em https://discord.com/developers/applications, na sua aplicação:

- **Bot** → copie o token → `DISCORD_TOKEN`
- **General Information** → copie o Application ID → `CLIENT_ID`
- **OAuth2 → General** → copie o Client Secret → `CLIENT_SECRET`
  (se não existir, clique em "Reset Secret")
- **OAuth2 → General → Redirects** → adicione:
  `http://localhost:3000/auth/callback` (pra testar local)
  Depois, quando hospedar de verdade, adicione também a URL final
  (ex: `https://seusite.com/auth/callback`)

### 2. Preencher o .env
Copie `.env.example` para `.env` e preencha tudo, incluindo:
- `GUILD_ID`: ID do seu servidor (modo desenvolvedor → clique direito no server → Copiar ID)
- `SITE_URL`: `http://localhost:3000` pra testar local
- `SESSION_SECRET`: qualquer frase aleatória longa (é só pra criptografar a sessão)

### 3. Instalar dependências
```
npm install
```

### 4. Rodar as DUAS partes (bot e site são processos separados)
Em um terminal:
```
npm start
```
Em outro terminal, ao mesmo tempo:
```
npm run site
```

Teste digitando `/vip` no Discord — deve aparecer o botão. Clique nele,
faça login, escolha a cor e salve.

## Hospedar de verdade (24/7)
Quando for pra produção, os dois processos (`index.js` e `server.js`)
precisam ficar rodando ao mesmo tempo em algum serviço tipo Railway ou Render
(cada um pode ser um "serviço" separado dentro do mesmo projeto).
Depois de hospedar, atualize:
- `SITE_URL` no `.env` pra URL pública do site
- O Redirect no Developer Portal pra `https://sua-url-publica.com/auth/callback`

## Permissões (sem mudança)
O cargo do bot ainda precisa estar **acima**, na hierarquia de cargos do
servidor, de onde os cargos VIP vão ficar — e o bot precisa da permissão
**Manage Roles**.
