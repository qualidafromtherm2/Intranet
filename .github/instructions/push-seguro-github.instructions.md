---
applyTo: '**'
---
# Push seguro para o GitHub — protocolo obrigatório

Toda vez que o usuário pedir para **"atualizar o github"**, **"subir"**, **"push"**, **"commitar e enviar"** ou similar,
a IA DEVE seguir este protocolo passo a passo, SEM PULAR ETAPAS.

O objetivo é **nunca perder progresso local** quando o remoto avançar entre o início da edição e o push.

---

## Fase 0 — Pré-checagem (SEMPRE primeiro)

```bash
git status --short
git rev-parse --abbrev-ref HEAD
git fetch origin --quiet
git log HEAD..origin/main --oneline | head -20   # commits remotos novos
git log origin/main..HEAD --oneline | head -20   # commits locais ainda não enviados
```

Interpretar:
- Se `git log HEAD..origin/main` vazio → remoto não avançou. Seguir para Fase 2.
- Se houver commits novos no remoto → seguir Fase 1 (rebase/merge seguro).

---

## Fase 1 — Sincronizar com remoto quando houver divergência

### 1.1 — Salvar mudanças locais ANTES de qualquer pull/merge

```bash
git stash push -u -m "wip-push-$(date +%Y%m%d-%H%M%S)"
```

> Stash inclui `-u` (untracked) para não perder arquivos novos.

### 1.2 — Trazer remoto

```bash
git pull --rebase origin main
```

> Use `--rebase` (não merge) para histórico linear. Se conflito vier, resolver, `git rebase --continue`.

### 1.3 — Restaurar mudanças locais

```bash
git stash pop
```

Se houver conflito no pop:
- NÃO descartar nenhum bloco. Resolver manualmente preservando AMBAS as funcionalidades.
- `node --check` em cada arquivo JS conflitado.
- `git add <arquivos>` e seguir.

### 1.4 — Verificar features críticas (anti-regressão)

```bash
grep -c "producaoPrimeiraPecaOkPane" menu_produto.html  # > 0
grep -c "_pgTipo"                    menu_produto.js    # > 0
grep -c "sacAtGraficosPane"          menu_produto.html  # > 0
grep -c "_gerarRelatorioGrafAt"      menu_produto.js    # > 0
grep -c "sacVippBtn"                 menu_produto.html  # > 0
grep -c "criarEntradaSacVipp"        menu_produto.js    # > 0
grep -c "osVippModal"                menu_produto.html  # > 0
grep -c "/solicitacoes/vipp"         routes/sacEnvios.js # > 0
```

Se QUALQUER um retornar `0`, **parar tudo** e investigar (provavelmente foi sobrescrito).

---

## Fase 2 — Validação de sintaxe

Para cada arquivo `.js` modificado, validar:

```bash
node --check <arquivo>
```

Se falhar, corrigir antes de qualquer commit.

---

## Fase 3 — Backup de segurança (somente arquivos críticos modificados)

Antes do primeiro commit da rodada, criar tag de backup local:

```bash
git tag -f local-backup-$(date +%Y%m%d-%H%M%S)
```

> Permite recuperar via `git reset --hard <tag>` se algo der errado.

---

## Fase 4 — Commits temáticos

Listar arquivos modificados e **agrupar por tema** (não jogar tudo em um commit único):

```bash
git status --short
```

Para cada tema, fazer commit separado:

```bash
git add <arquivos-do-tema>
git commit -m "tipo(area): descrição curta

- detalhe 1
- detalhe 2"
```

Tipos válidos: `feat`, `fix`, `chore`, `docs`, `refactor`, `perf`.

**Nunca** misturar:
- Refatoração ampla + correção pontual
- Feature nova + limpeza geral
- Mudanças de áreas distintas (compras + produção)

---

## Fase 5 — Refetch e re-rebase antes do push

```bash
git fetch origin --quiet
git log HEAD..origin/main --oneline | head -5
```

Se durante o tempo da Fase 4 alguém empurrou novo commit remoto:

```bash
git pull --rebase origin main
```

Resolver conflitos se houver, re-rodar Fase 1.4 (verificar features críticas).

---

## Fase 6 — Push

```bash
git push origin main
```

Se rejeitado (non-fast-forward), repetir Fase 5 e tentar novamente. **NUNCA** usar `--force` sem confirmação explícita do usuário.

---

## Fase 7 — Verificação pós-push

```bash
git status
git log --oneline -5
```

Confirmar:
- `working tree clean` ou apenas arquivos que o usuário pediu para manter localmente
- Último commit local == último commit em `origin/main`

Reportar ao usuário:
- Lista de commits feitos (hash curto + mensagem)
- Arquivos tocados
- Próximos passos se houver pendência

---

## Regras absolutas

- ❌ NUNCA fazer `git push --force` sem confirmação explícita
- ❌ NUNCA fazer `git reset --hard` quando há mudanças não commitadas
- ❌ NUNCA descartar arquivos não rastreados sem checar com o usuário
- ❌ NUNCA pular Fase 0 (pré-checagem)
- ❌ NUNCA pular Fase 1.4 (verificar features críticas) quando houve sync com remoto
- ✅ SEMPRE preferir `--rebase` a `merge` para sincronizar
- ✅ SEMPRE usar `git stash -u` antes de pull/merge
- ✅ SEMPRE validar sintaxe JS antes de commit
- ✅ SEMPRE commitar por tema, nunca tudo de uma vez
- ✅ SEMPRE reportar ao final o que foi feito
