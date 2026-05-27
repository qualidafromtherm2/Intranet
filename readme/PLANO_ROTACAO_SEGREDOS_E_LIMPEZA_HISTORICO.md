# Plano de Rotacao de Segredos e Limpeza de Historico

Data: 2026-05-27

## Objetivo

Este plano cobre a etapa seguinte ao hardening aplicado no runtime:

- rotacionar segredos que ja podem ter sido expostos em commits antigos, backups ou dumps
- invalidar credenciais antigas sem derrubar fluxos criticos de uma vez
- limpar o historico Git com procedimento controlado, nunca com force push improvisado

## Segredos e acessos para rotacionar

Prioridade alta:

- SESSION_SECRET
- AGENTE_TOKEN
- INTERNAL_TOKEN
- OMIE_WEBHOOK_TOKEN
- WHATSAPP_WEBHOOK_VERIFY_TOKEN
- VIPP_TOKEN
- AT_SESSION_SECRET
- OMIE_APP_KEY
- OMIE_APP_SECRET
- WHATSAPP_CLOUD_ACCESS_TOKEN ou META_WHATSAPP_ACCESS_TOKEN

Prioridade media:

- credenciais de banco fora de DATABASE_URL, se existirem em scripts locais
- qualquer token legado em arquivos fora de .env

## Ordem segura de execucao

1. Levantar todos os valores atuais em um cofre seguro fora do repositorio.
2. Gerar novos segredos para os itens internos:
   - SESSION_SECRET
   - AGENTE_TOKEN
   - INTERNAL_TOKEN
   - AT_SESSION_SECRET
3. Rotacionar tokens de terceiros:
   - Omie
   - WhatsApp Cloud
   - VIPP
4. Atualizar variaveis no ambiente de producao e no ambiente local.
5. Reiniciar a aplicacao e validar os endpoints protegidos.
6. Invalidar sessoes antigas se houver troca de SESSION_SECRET em producao.
7. So depois disso iniciar a limpeza de historico Git.

## Janela de deploy sugerida

1. Aplicar novos valores no provedor de hospedagem.
2. Executar:

```bash
pm2 flush
pm2 restart intranet_api
pm2 logs intranet_api --lines 100 --nostream
```

3. Validar manualmente:

```bash
curl -I http://localhost:5001/
curl -I http://localhost:5001/menu_produto.html
curl -i http://localhost:5001/etiquetas/
curl -i http://localhost:5001/uploads/
curl -i http://localhost:5001/routes/produtos.js
```

Resultado esperado:

- raiz e assets publicos: 200
- diretorios operacionais sem sessao: 401
- codigo-fonte interno e backups: 404

## Efeito esperado por segredo

- SESSION_SECRET: invalida cookies de sessao existentes; avisar usuarios se a troca for em horario comercial.
- AGENTE_TOKEN: exige atualizar o agente de impressao antes do uso.
- INTERNAL_TOKEN: exige alinhar disparos internos de re-sync.
- OMIE_WEBHOOK_TOKEN: exige atualizar a configuracao do webhook no Omie.
- WHATSAPP_WEBHOOK_VERIFY_TOKEN: exige atualizar a verificacao do webhook da Meta.
- VIPP_TOKEN: exige validar emissao de etiqueta apos a troca.
- AT_SESSION_SECRET: invalida sessao do portal tecnico AT.

## Limpeza de historico Git

Nao executar reescrita de historico diretamente na main sem alinhamento com todos os colaboradores.

Fluxo recomendado:

1. Congelar merges e pushes para a main.
2. Criar um clone de trabalho so para saneamento de historico.
3. Usar git-filter-repo para remover artefatos e caminhos sensiveis historicos.
4. Revisar o resultado localmente.
5. Abrir janela coordenada para push com force-with-lease.
6. Pedir novo clone ou hard reset controlado para todos os colaboradores.

Exemplo de comandos no clone de saneamento:

```bash
git clone --mirror <repo>
cd Intranet.git
git filter-repo \
  --path intranet_backup_20251118_102011_completude_campos_obrigatorios_familia.tar.gz \
  --path menu_produto.js.backup_errors \
  --path t-temp.txt \
  --path 'tart intranet_api' \
  --path tica.recebimentos_nfe_omie \
  --path 'uario TEXT' \
  --path 'uario, NEW.produto_descricao, NEW.status, NEW.departamento' \
  --path 'uario, OLD.produto_descricao, OLD.status, OLD.departamento' \
  --path 'OrdemProducaoJsonClient (5).js' \
  --path 'ProdutosEstruturaJsonClient (5).js' \
  --path 'API Omie/ProdutosEstruturaJsonClient (5).js' \
  --invert-paths
```

Se houver segredos literais no historico, complementar com replace-text:

```bash
git filter-repo --replace-text replacements.txt
```

Conteudo de replacements.txt:

```text
old-literal-secret==>REMOVED_SECRET
another-old-token==>REMOVED_SECRET
```

## Checklist de verificacao antes de reescrever historico

- todos os segredos ja foram rotacionados
- o deploy atual ja esta usando apenas env vars validas
- os artefatos a remover foram confirmados como descarte
- a equipe foi avisada sobre a troca de base do repositorio
- existe backup do espelho antes do push final

## Checklist de verificacao depois da limpeza

- git log --stat nao mostra mais os artefatos removidos
- git grep nao encontra mais literais de segredo conhecidos
- a aplicacao sobe com PM2 sem erro
- endpoints protegidos continuam com 401/404 conforme esperado

## Observacao final

Limpeza de historico reduz exposicao futura, mas nao substitui a rotacao de segredo. Se um token apareceu em commit, dump, backup ou print de log, ele deve ser tratado como comprometido mesmo depois de apagado do Git.