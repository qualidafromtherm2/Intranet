# Ambiente local — Intranet no Windows (igual ao Leandro)

Guia para outro desenvolvedor no **Windows** (e para a IA dele) subir o projeto no **localhost:5001**, com **Postgres**, **Omie**, **R2** e demais integrações do `.env`.

> O Leandro usa **Linux**; os comandos de PM2 e Node são os mesmos. Só mudam a instalação inicial e alguns comandos de diagnóstico.

---

## O que você vai conseguir fazer

- Abrir no navegador: **http://localhost:5001/menu_produto.html#inicio**
- Testar mudanças de tela (HTML/CSS/JS) com **F5**
- Testar API, SQL, Omie e integrações usando o **mesmo `.env`** do time
- Reiniciar o servidor com **PM2** após alterar backend

---

## Antes de começar — peça ao Leandro (ou responsável)

O arquivo `.env` **não vai no GitHub** (segurança). Para ter o mesmo acesso que o Leandro, você precisa receber dele (WhatsApp seguro, 1Password, etc.):

1. Uma cópia do `.env` dele **ou** os valores preenchidos a partir do `.env.example`
2. Confirmação de que pode usar o **mesmo banco Postgres** (Render/Supabase) — normalmente sim, com `DATABASE_URL` compartilhada

**Nunca** commitar o `.env` nem colar credenciais no chat da IA.

---

## 1) Instalar ferramentas no Windows (uma vez)

| Ferramenta | Versão | Para quê |
|------------|--------|----------|
| **Git for Windows** | recente | clonar o repositório |
| **Node.js** | **v20.19.5** (ver `.nvmrc`) | rodar o servidor |
| **npm** | vem com o Node | instalar dependências |
| **PM2** | global | manter `intranet_api` na porta 5001 |

Use o terminal **PowerShell** ou **Git Bash** (vem com o Git for Windows). Os exemplos abaixo funcionam nos dois.

### Opção A — Node direto (mais simples)

1. Baixe e instale: https://nodejs.org/ — escolha a versão **20 LTS** (idealmente **20.19.5**)
2. Abra **PowerShell** e rode:

```powershell
node -v
npm -v
npm install -g pm2
pm2 -v
```

### Opção B — nvm-windows (se precisar trocar versão do Node)

1. Baixe: https://github.com/coreybutler/nvm-windows/releases (instalador `nvm-setup.exe`)
2. Feche e abra o PowerShell:

```powershell
nvm install 20.19.5
nvm use 20.19.5
node -v
npm install -g pm2
```

### Git for Windows

Baixe: https://git-scm.com/download/win — instale com as opções padrão.

---

## 2) Clonar o projeto (uma vez)

No PowerShell ou Git Bash:

```powershell
cd C:\Users\SEU_USUARIO\Projetos
git clone https://github.com/qualidafromtherm2/Intranet.git
cd Intranet
npm install
```

Se tiver chave SSH configurada no GitHub:

```powershell
git clone git@github.com:qualidafromtherm2/Intranet.git
```

> `npm install` pode demorar alguns minutos na primeira vez.

---

## 3) Configurar o `.env`

Na pasta do projeto (`Intranet\`):

**PowerShell:**

```powershell
Copy-Item .env.example .env
```

**Git Bash / CMD:**

```bash
copy .env.example .env
```

Depois **substitua** o conteúdo pelo `.env` que o Leandro enviou (ou preencha os campos com os valores dele). O arquivo fica na **raiz** da pasta `Intranet`, ao lado de `server.js`.

### Variáveis essenciais (mesmo pacote do Leandro)

| Variável | Uso |
|----------|-----|
| `DATABASE_URL` | Postgres — login, kanbans, produção, etc. |
| `OMIE_APP_KEY` / `OMIE_APP_SECRET` | API Omie |
| `OMIE_WEBHOOK_TOKEN` | webhooks Omie (se testar webhook) |
| `R2_*` | fotos/arquivos no Cloudflare R2 |
| `GITHUB_TOKEN` | imagens no repositório GitHub |
| `OPENAI_API_KEY` | chatbot/assistente (se usar) |
| `SESSION_SECRET` | sessão de login (peça um valor ao Leandro ou gere um texto longo aleatório) |
| `SERVICE_PROFILE` | deixe `full` (padrão) — intranet completa |
| `FORCE_DB` | use **`1`** para o localhost usar o Postgres igual produção (recomendado para testar SQL no navegador local) |

Referência completa: arquivo `.env.example` na raiz do projeto.

---

## 4) Subir o servidor com PM2 (primeira vez)

Abra PowerShell ou Git Bash **na pasta do projeto** (`Intranet\`):

```powershell
pm2 start ecosystem.config.js --only intranet_api
pm2 status
```

Deve aparecer `intranet_api` com status **online**.

Teste no navegador (Chrome, Edge, etc.):

**http://localhost:5001/menu_produto.html#inicio**

### Manter rodando após reiniciar o PC (opcional)

```powershell
pm2 save
pm2 startup
```

O `pm2 startup` vai mostrar um comando — **copie e execute** no PowerShell **como Administrador**.

---

## 5) Rotina diária — igual ao Leandro

### Depois de mudar **tela** (HTML, CSS, JS)

1. Salve o arquivo no editor (VS Code, Cursor, etc.)
2. **F5** no navegador em `http://localhost:5001/menu_produto.html#...`
3. Não precisa reiniciar PM2

### Depois de mudar **backend** (`server.js`, `routes/*.js`, `utils/*.js`)

```powershell
node --check server.js
# se editou outro arquivo:
node --check routes/nome-do-arquivo.js

pm2 flush
pm2 restart intranet_api
pm2 logs intranet_api
```

- `pm2 flush` — limpa logs antigos
- `pm2 restart intranet_api` — recarrega o código na porta 5001
- `pm2 logs intranet_api` — ver erros (**Ctrl+C** para sair)

### Atualizar código do GitHub antes de trabalhar

```powershell
git checkout main
git pull origin main
npm install
pm2 restart intranet_api
```

---

## 6) Comandos úteis de diagnóstico (Windows)

```powershell
# está rodando?
pm2 status

# porta 5001 ocupada?
netstat -ano | findstr :5001

# ver qual programa usa o PID (troque 12345 pelo número da última coluna)
tasklist /FI "PID eq 12345"

# matar processo na porta (só se necessário — troque o PID)
taskkill /PID 12345 /F

# últimas linhas de log sem ficar preso
pm2 logs intranet_api --lines 30 --nostream

# parar
pm2 stop intranet_api

# subir de novo
pm2 start ecosystem.config.js --only intranet_api
```

### Erros comuns no Windows

| Sintoma | Provável causa | O que fazer |
|---------|----------------|-------------|
| Página não abre | PM2 parado ou porta errada | `pm2 status` → restart |
| `EADDRINUSE :5001` | outro processo na 5001 | `netstat -ano \| findstr :5001` → `taskkill` ou `pm2 stop intranet_api` |
| `pm2` não reconhecido | PM2 não instalado global | `npm install -g pm2` e feche/abra o terminal |
| `node` não reconhecido | Node não no PATH | reinstale Node ou use `nvm use 20.19.5` |
| `DATABASE_URL não configurada` | `.env` ausente ou vazio | conferir `.env` na raiz do projeto |
| Login não persiste | `SESSION_SECRET` ou `DATABASE_URL` | pedir valores corretos ao Leandro |
| Omie falha | chaves erradas no `.env` | conferir `OMIE_APP_KEY` / `OMIE_APP_SECRET` |
| Mudança no JS não aparece | cache do navegador | **Ctrl+Shift+R** (hard refresh) |
| Firewall bloqueia | Windows Defender | permitir Node.js em redes privadas |

---

## 7) Alternativa sem PM2 (só para teste rápido)

**PowerShell:**

```powershell
$env:PORT=5001; node server.js
```

**CMD:**

```cmd
set PORT=5001 && node server.js
```

O Leandro usa **PM2** no dia a dia — prefira PM2 para ficar igual.

---

## 8) Texto para colar no início do chat com a IA

Copie e cole isto quando for pedir ajuda à IA (Cursor ou Continue):

```
Projeto: Intranet Fromtherm (Node/Express + Postgres + Omie).

Sistema: Windows 10/11
Ambiente local:
- Pasta: C:\Users\...\Intranet  (ajuste o caminho)
- URL de teste: http://localhost:5001/menu_produto.html#inicio
- Servidor: PM2, processo intranet_api, porta 5001
- Terminal: PowerShell ou Git Bash
- .env já configurado com DATABASE_URL, Omie e R2 (não commitar)

Após alterar backend:
  node --check <arquivo>.js
  pm2 flush
  pm2 restart intranet_api
  pm2 logs intranet_api --lines 20 --nostream

Após alterar front (menu_produto.html/js/css): só F5 no navegador.

Regras:
- Não ler menu_produto.js inteiro — só o trecho do modal/botão pedido
- Diff mínimo; não commitar sem eu pedir
- Não expor credenciais do .env
- Comandos de diagnóstico Windows: netstat -ano | findstr :5001
```

---

## 9) Checklist — “estou igual ao Leandro?”

- [ ] `node -v` → v20.19.5 (ou 20.x próximo)
- [ ] `npm install` rodou sem erro
- [ ] `.env` na raiz com `DATABASE_URL`, Omie e R2 preenchidos
- [ ] `FORCE_DB=1` (se quiser SQL no localhost como ele)
- [ ] `pm2 status` → `intranet_api` **online**
- [ ] Navegador abre **http://localhost:5001/menu_produto.html#inicio**
- [ ] Login funciona
- [ ] Após editar `routes/*.js`, `pm2 restart intranet_api` e logs sem erro

---

## 10) Deploy (produção)

Mudanças locais **não** vão para o site público sozinhas. Fluxo: branch → PR → merge em `main` → Render faz deploy automático. Ver `README.md` na raiz.

---

## Anexo — Linux (referência do Leandro)

Se no futuro usar Linux, a instalação é parecida. Diferenças principais:

```bash
# copiar .env
cp .env.example .env

# ver porta ocupada
ss -tlnp | grep 5001

# subir sem PM2
PORT=5001 node server.js
```

O restante (`pm2 start`, `pm2 restart intranet_api`, URL de teste) é **igual**.
