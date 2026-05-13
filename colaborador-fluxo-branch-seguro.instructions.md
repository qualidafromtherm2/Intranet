---
applyTo: '**'
---
# Guia para IA do colaborador — Fluxo seguro de branch e PR

## Contexto do repositório
Este projeto é editado por múltiplos colaboradores usando GitHub Copilot no VS Code.
O repositório tem arquivos grandes e críticos (`menu_produto.js`, `menu_produto.html`, `server.js`)
que são frequentemente modificados em paralelo por colaboradores diferentes.

**Já houve perda real de funcionalidades** por branches desatualizados sendo mergeados.
Siga rigorosamente este guia em toda tarefa.

---

## ⚠️ Regra de ouro — NUNCA trabalhar em branch desatualizado

Antes de começar qualquer tarefa, a IA deve obrigatoriamente executar:

```bash
git status --short
git fetch origin
git log HEAD..origin/main --oneline
```

Se o branch local estiver atrás do `main` remoto:

```bash
git merge origin/main
```

Resolver conflitos se houver, validar sintaxe e só então começar a trabalhar.

---

## Fluxo obrigatório — do início ao PR

### 1. Preparar o branch
```bash
# Sempre partir do main atualizado
git checkout main
git pull origin main

# Criar branch com nome descritivo
git checkout -b feat/descricao-curta
```

### 2. Fazer as alterações
- Editar apenas os arquivos relacionados à tarefa solicitada
- Não reformatar, não reordenar, não "limpar" código fora do escopo
- Validar sintaxe após cada arquivo JS alterado:
  ```bash
  node --check server.js
  node --check menu_produto.js
  ```

### 3. ANTES de abrir o PR — atualizar com o main atual
```bash
git fetch origin
git merge origin/main
```

Se houver conflitos:
- Resolver manualmente preservando AMBAS as funcionalidades (a do main E a do branch)
- Nunca descartar blocos sem entender o que fazem
- Validar sintaxe novamente após resolver
- Fazer commit da resolução

### 4. Abrir o PR
- Título claro no formato: `tipo(area): descrição` (ex: `fix(recebimento): corrigir valor unitário`)
- Descrever **o que mudou**, **por que** e **como validar**
- Listar os arquivos alterados

---

## Arquivos de alto risco — atenção redobrada

| Arquivo | Risco |
|---|---|
| `menu_produto.html` | Contém painéis inteiros que podem ser sobrescritos silenciosamente |
| `menu_produto.js` | ~63k linhas; features inteiras podem sumir sem conflito visível |
| `server.js` | Arquivo de alto conflito; editar somente o bloco necessário |

### Verificações obrigatórias após `git merge origin/main` nesses arquivos:

```bash
# Painel 1ª Peça OK — deve retornar > 0
grep -c "producaoPrimeiraPecaOkPane" menu_produto.html

# Filtro tipo no Gráfico AT — deve retornar > 0
grep -c "_pgTipo" menu_produto.js

# Toolbar Gráfico AT — deve retornar > 0
grep -c "sacAtGraficosPane" menu_produto.html

# Relatório PDF Gráfico AT — deve retornar > 0
grep -c "_gerarRelatorioGrafAt" menu_produto.js
```

Se algum retornar `0`, a feature foi perdida no merge. **Não subir o PR.** Recuperar a feature do `origin/main` antes de continuar.

---

## O que a IA NÃO deve fazer

- ❌ Começar a editar arquivos sem checar `git status` e `git fetch` primeiro
- ❌ Fazer `git push` ou abrir PR sem antes executar `git merge origin/main`
- ❌ Resolver conflito descartando blocos sem ler o conteúdo
- ❌ Commitar `server.js` inteiro reformatado junto com uma feature pontual
- ❌ Ignorar resultados `0` nas verificações de features críticas acima
- ❌ Commitar segredos, `.env`, tokens ou credenciais

---

## Formato de commit

```
tipo(area): descrição curta

- detalhe do que foi feito
- motivo da mudança
```

Exemplos válidos:
- `fix(recebimento): corrigir unidade na associacao nfe-pedido`
- `feat(logistica): adicionar campo cod_local na separacao`
- `chore(server): remover console.log de debug`
