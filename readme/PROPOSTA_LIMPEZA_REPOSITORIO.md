# Proposta: Limpeza e reorganização do repositório

**Tipo de PR:** `chore(repo): remover arquivos corrompidos, backups e lixo de desenvolvimento`  
**Impacto em funcionalidades:** Nenhum — apenas remoção e movimentação de arquivos não utilizados em runtime.  
**Risco de conflito:** Baixo, desde que executado quando não há branches abertas tocando esses arquivos.

---

## 🚨 Item urgente — Credencial exposta

**Arquivo:** `teste_simples.js`  
**Problema:** Contém `OMIE_APP_KEY` e `OMIE_APP_SECRET` com valores reais hardcoded no código fonte, visivelmente no histórico do GitHub.

**Ação necessária antes do PR:**
1. Revogar/regenerar as credenciais Omie no painel da API
2. Deletar o arquivo do repositório
3. Adicionar `teste_simples.js` ao `.gitignore` se for recriado localmente

---

## Grupo 1 — Deletar: arquivos corrompidos (saída de terminal salva como arquivo)

Esses arquivos são resultado de output de terminal (`psql`, comandos bash) que foram acidentalmente commitados. Não têm valor algum.

| Arquivo | O que é |
|---|---|
| `tart intranet_api` | Output de terminal — comando `start intranet_api` |
| `_nfe_omie` | Fragmento de nome de objeto do banco |
| `tica.recebimentos_nfe_omie` | Output do `\d logistica.recebimentos_nfe_omie` no psql |
| `uario TEXT` | Fragmento de SQL (`usuario TEXT`) |
| `uario, NEW.produto_descricao, NEW.status, NEW.departamento` | Fragmento de trigger SQL |
| `uario, OLD.produto_descricao, OLD.status, OLD.departamento` | Fragmento de trigger SQL |
| `t-temp.txt` | Arquivo temporário sem conteúdo útil |

**Comando para remover:**
```bash
git rm "tart intranet_api" "_nfe_omie" "tica.recebimentos_nfe_omie" "uario TEXT" \
  "uario, NEW.produto_descricao, NEW.status, NEW.departamento" \
  "uario, OLD.produto_descricao, OLD.status, OLD.departamento" \
  "t-temp.txt"
```

---

## Grupo 2 — Deletar: backups e cópias manuais

| Arquivo | Problema | Tamanho |
|---|---|---|
| `intranet_backup_20251118_102011_completude_campos_obrigatorios_familia.tar.gz` | Backup completo compactado **dentro do git** — infla o repositório | **5,6 MB** |
| `menu_produto.js.backup_errors` | Cópia manual de backup com extensão irregular | 483 KB |
| `OrdemProducaoJsonClient (5).js` | Cópia duplicada — o `(5)` indica geração automática pelo Windows ao copiar arquivo | 6 KB |
| `ProdutosEstruturaJsonClient (5).js` | Mesmo caso acima | 5 KB |
| `teste_simples.js` | Ver item urgente acima — credencial exposta | — |

> O `.tar.gz` sozinho representa **~5,6 MB que todo clone do repositório baixa desnecessariamente**.

**Ação adicional:** Adicionar ao `.gitignore`:
```
*.tar.gz
*.backup_errors
```

**Comando para remover:**
```bash
git rm "intranet_backup_20251118_102011_completude_campos_obrigatorios_familia.tar.gz" \
  "menu_produto.js.backup_errors" \
  "OrdemProducaoJsonClient (5).js" \
  "ProdutosEstruturaJsonClient (5).js" \
  "teste_simples.js"
```

---

## Grupo 3 — Mover: scripts de migração avulsos na raiz

Esses scripts já foram aplicados (são migrations pontuais). Devem ser movidos para `sql/` ou `backend/migrations/` para manter rastreabilidade, ou deletados se já houver equivalente nesses diretórios.

| Arquivo atual | Destino sugerido |
|---|---|
| `add_reprovacao_columns.sql` | `sql/` |
| `add_status_retificar.sql` | `sql/` |
| `atualizar.sql` | `sql/` |
| `add_anexos_column.js` | `backend/migrations/` |
| `fix_trigger.js` | `backend/migrations/` |
| `disable_trigger.js` | `backend/migrations/` |
| `verify_schema.js` | `scripts/` |

**Comando para mover (exemplos):**
```bash
git mv add_reprovacao_columns.sql sql/
git mv add_status_retificar.sql sql/
git mv atualizar.sql sql/
git mv add_anexos_column.js backend/migrations/
git mv fix_trigger.js backend/migrations/
git mv disable_trigger.js backend/migrations/
git mv verify_schema.js scripts/
```

---

## Grupo 4 — Mover: scripts de sync fora do lugar

| Arquivo atual | Destino sugerido | Motivo |
|---|---|---|
| `sync_omie_imagens_estoque.js` | `cron/` | Mesmo padrão dos outros syncs já em `cron/` |
| `sync_omie_produtos.js` | `cron/` | Mesmo caso |
| `watch_print.js` | `scripts/` | Utilitário avulso |
| `LocalEstoqueJsonClient.js` | `requisicoes_omie/` | Mesmo padrão dos clientes Omie já nessa pasta |

```bash
git mv sync_omie_imagens_estoque.js cron/
git mv sync_omie_produtos.js cron/
git mv watch_print.js scripts/
git mv LocalEstoqueJsonClient.js requisicoes_omie/
```

---

## Grupo 5 — Adicionar ao .gitignore: logs de ferramentas

Os arquivos `.codex-*.log` estão sendo rastreados pelo git. São logs gerados pelo Codex/agentes de IA e não deveriam ir ao repositório.

**Adicionar ao `.gitignore`:**
```
# Logs de ferramentas de IA
.codex-*.log
.codex-*.err.log
.codex-*.out.log
```

---

## Resumo do impacto

| Ação | Arquivos | Redução no repo |
|---|---|---|
| Deletar corrompidos | 7 arquivos | ~0 KB (conteúdo irrelevante) |
| Deletar backups/cópias | 5 arquivos | **~6,1 MB** |
| Mover migrations | 7 arquivos | 0 KB (só reorganização) |
| Mover syncs/scripts | 4 arquivos | 0 KB (só reorganização) |
| .gitignore logs | 8 arquivos | Evita acúmulo futuro |

**Total estimado de redução:** ~6,1 MB no histórico (requer `git filter-repo` para limpeza completa do histórico, mas a remoção já impede crescimento futuro).

---

## Como executar com segurança

1. Confirmar com todos os colaboradores que **não há branches abertas** tocando esses arquivos
2. Criar branch: `git checkout -b chore/limpeza-repositorio`
3. Executar os comandos acima em sequência
4. Fazer commit único: `chore(repo): remover arquivos corrompidos, backups e lixo de dev`
5. Abrir PR para revisão do gestor

---

*Proposta gerada em 15/05/2026 com base em análise estática do repositório.*
