# IAPP - Consulta de Equipamentos

Este módulo permite consultar ordens de produção (OPs) na plataforma IAPP diretamente através do intranet.

## Funcionalidades

### 1. Consultar Equipamento por ID
Permite buscar uma ordem de produção específica usando seu ID numérico.

**Como usar:**
1. Acesse o menu "Qualidade" > "Consultar equipamento"
2. Digite o ID numérico da OP (ex.: 1593715)
3. Clique em "Buscar"

**Como encontrar o ID:**
- Acesse a OP no sistema IAPP
- Observe a URL da página: `.../editar?id=1593715`
- O número após `id=` é o ID que você precisa

### 2. Listar Todas as Ordens
Permite listar todas as ordens de produção disponíveis na IAPP.

**Como usar:**
1. Acesse o menu "Qualidade" > "Consultar equipamento"
2. Clique em "Listar Todos"
3. Aguarde o carregamento da lista completa

## Página Standalone

Além da integração no menu principal, existe uma página standalone disponível em:
```
/iapp/consultar_equipamento.html
```

Esta página oferece a mesma funcionalidade de consulta em uma interface simplificada.

## Endpoints da API

### Consultar por ID
```
GET /api/iapp/ordens-producao/busca/:id
```

**Exemplo:**
```bash
curl http://localhost:5001/api/iapp/ordens-producao/busca/1593715
```

### Listar Todas
```
GET /api/iapp/ordens-producao/lista?offset=0
```

**Exemplo:**
```bash
curl http://localhost:5001/api/iapp/ordens-producao/lista?offset=0
```

### Consultar por Identificação
```
GET /api/iapp/ordens-producao/busca-por-identificacao/:identificacao
```

**Exemplo:**
```bash
curl http://localhost:5001/api/iapp/ordens-producao/busca-por-identificacao/OP-12345
```

## Configuração

As credenciais da IAPP são configuradas no arquivo `config.server.js`:

```javascript
IAPP_TOKEN: process.env.IAPP_TOKEN || 'seu_token_aqui',
IAPP_SECRET: process.env.IAPP_SECRET || 'seu_secret_aqui',
IAPP_DOMAIN: process.env.IAPP_DOMAIN || '',
IAPP_INSECURE: (process.env.IAPP_INSECURE || 'true') === 'true'
```

**Recomendação:** Em produção, defina as credenciais como variáveis de ambiente:
```bash
export IAPP_TOKEN="seu_token_aqui"
export IAPP_SECRET="seu_secret_aqui"
export IAPP_INSECURE="false"
```

## Tratamento de Erros

O sistema fornece feedback visual sobre o status da operação:

- ✓ **Sucesso:** Mensagem verde com confirmação
- ⚠ **Aviso:** Mensagem amarela com detalhes do problema
- ✗ **Erro:** Mensagem vermelha com descrição do erro

### Erros Comuns

**"OFFSET não encontrado ou inválido"**
- Este erro vem da API IAPP quando o parâmetro offset está faltando ou inválido
- O código já passa `offset=0` corretamente
- Pode ser um problema temporário da API IAPP

**"Credenciais IAPP ausentes"**
- Verifique se as variáveis `IAPP_TOKEN` e `IAPP_SECRET` estão configuradas
- Confirme que o arquivo `config.server.js` está presente

**"Timeout"**
- A API IAPP pode estar lenta ou indisponível
- Tente novamente após alguns segundos

## Notas Técnicas

- A comunicação com a IAPP usa HTTPS na porta 443
- Timeout padrão: 15 segundos
- Os resultados são exibidos em formato JSON formatado
- A cor do texto é preta (#000) sobre fundo cinza claro (#f5f5f5) para melhor legibilidade
