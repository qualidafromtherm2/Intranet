# Webhook de Produtos da Omie - Instruções de Configuração

## Objetivo
Este webhook mantém as imagens dos produtos atualizadas automaticamente quando há alterações na Omie, eliminando a necessidade de executar scripts de sincronização manualmente.

## URL do Webhook

```
https://intranet-30av.onrender.com/webhooks/omie/produtos?token=SEU_TOKEN_AQUI
```

**Substitua `SEU_TOKEN_AQUI`** pelo token configurado na variável de ambiente `OMIE_WEBHOOK_TOKEN` do servidor.

## Como Configurar na Omie

1. Acesse o painel administrativo da Omie
2. Vá em **Configurações** → **Webhooks** → **Cadastro de Produtos**
3. Clique em **Novo Webhook**
4. Preencha os campos:
   - **URL**: Cole a URL completa com o token (ver acima)
   - **Eventos**: Selecione:
     - ✅ Produto.Incluido
     - ✅ Produto.Alterado
     - ✅ Produto.Excluido
   - **Método**: POST
   - **Formato**: JSON

5. Clique em **Salvar**

## O que o Webhook Faz

### Quando recebe notificação da Omie:

1. **Produto Incluído/Alterado**:
   - Consulta o produto na API da Omie (`ConsultarProduto`)
   - Remove imagens antigas da tabela `produtos_omie_imagens`
   - Insere novas imagens com URLs atualizadas
   - Retorna: `{ ok: true, codigo_produto: "123", acao: "atualizado (3 imagens)" }`

2. **Produto Excluído/Inativo/Bloqueado**:
   - Remove todas as imagens do produto
   - Retorna: `{ ok: true, codigo_produto: "123", acao: "removido" }`

## Vantagens

✅ **Automático**: Não precisa mais rodar scripts manualmente  
✅ **Tempo Real**: Imagens atualizadas assim que mudam na Omie  
✅ **URLs Frescos**: Resolve o problema de URLs expiradas do CDN da Omie  
✅ **Eficiente**: Só atualiza os produtos que realmente mudaram

## Logs

O webhook registra todos os eventos no console do servidor:

```
[webhooks/omie/produtos] Webhook recebido: { topic: "Produto.Alterado", codigo_produto: 123, ... }
[webhooks/omie/produtos] Processando evento "Produto.Alterado" para produto 123
[webhooks/omie/produtos] Produto 123 atualizado (2 imagens)
```

## Testando

Após configurar:

1. Edite um produto na Omie (altere uma imagem ou descrição)
2. Aguarde alguns segundos
3. Consulte os logs do servidor para confirmar recebimento
4. Abra o catálogo de produtos na intranet
5. Verifique se a imagem está atualizada

## Troubleshooting

**Webhook não está sendo chamado?**
- Verifique se salvou corretamente na Omie
- Confirme que a URL está completa com o token
- Teste a URL manualmente com curl/Postman

**Erro 401 (não autorizado)?**
- O token está incorreto
- Verifique a variável `OMIE_WEBHOOK_TOKEN` no servidor

**Erro 500?**
- Veja os logs do servidor para detalhes
- Pode ser problema de conexão com a API da Omie
- Verifique as credenciais `OMIE_APP_KEY` e `OMIE_APP_SECRET`

## Webhooks Relacionados

Este sistema já possui os seguintes webhooks configurados:

- ✅ **Ordens de Produção**: `/webhooks/omie/op`
- ✅ **Pedidos de Venda**: `/webhooks/omie/pedidos`
- ✅ **Clientes/Fornecedores**: `/webhooks/omie/clientes`
- ✅ **Produtos** (novo): `/webhooks/omie/produtos`

## Script de Sincronização Manual

Caso precise sincronizar todos os produtos de uma vez (primeira configuração ou falha no webhook):

```bash
node sync_omie_imagens_estoque.js
```

Este script:
- Processa TODOS os produtos ativos (não apenas os alterados)
- Leva ~15-20 minutos para 2300+ produtos
- Deve ser usado apenas quando necessário
- O webhook substitui este script para uso contínuo
