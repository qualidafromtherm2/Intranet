# Sistema de Filtro de Kanbans - Minhas Solicitações

## Visão Geral

Implementação de um sistema de filtro de kanbans na página "Minhas Solicitações" que permite aos usuários ocultar/exibir colunas do kanban de acordo com suas preferências. As configurações são salvas no banco de dados por usuário.

## Funcionalidades

### 1. Botão de Filtro
- Localização: Canto superior direito da página "Minhas Solicitações"
- Ícone: `fa-filter` (FontAwesome)
- Texto: "Filtrar Kanbans"
- Estilo: Botão azul com gradiente

### 2. Modal de Filtro
- **Componentes:**
  - Lista de checkboxes para cada kanban
  - Botão "Selecionar Todos" - Marca/desmarca todos os kanbans
  - Botão "Aplicar Filtro" - Salva preferências e aplica filtro
  - Botão de fechar (X)

- **Comportamento:**
  - Ao abrir, carrega preferências salvas do usuário
  - Checkboxes refletem estado atual (marcado = visível)
  - Clique fora do modal fecha-o
  - ESC fecha o modal

### 3. Persistência
- Banco de dados: PostgreSQL
- Tabela: `compras.filtro_kanbans_usuario`
- Campos:
  - `username` (PK): Nome do usuário
  - `kanbans_visiveis` (JSONB): Array com nomes dos kanbans visíveis
  - `created_at`: Data de criação
  - `updated_at`: Data de atualização

### 4. Aplicação do Filtro
- Oculta colunas desmarcadas usando `display: none`
- Mantém colunas marcadas visíveis
- Aplica automaticamente ao carregar a página
- Feedback visual ao salvar (botão fica verde por 800ms)

## Kanbans Disponíveis

1. **Aguardando aprovação da requisição** (Badge: Operação Aprovador)
2. **Cotação com compras** (Badge: Operação Comprador)
3. **Cotado aguardando escolha** (Badge: Ação Requisitante)
4. **Solicitado revisão** (Badge: Ação Requisitante)
5. **Pedido de compra** (Badge: Operação Comprador)
6. **Compra realizada** (Badge: Ação Recebimento)
7. **Faturada pelo fornecedor** (Badge: Ação Recebimento)
8. **Recebido** (Badge: Setores de Liberação)
9. **Concluído** (sem badge)

## API Endpoints

### GET `/api/compras/filtro-kanbans`
Retorna as preferências de kanbans visíveis do usuário logado.

**Response:**
```json
{
  "kanbans_visiveis": [
    "aguardando aprovação da requisição",
    "aguardando cotação",
    "..."
  ]
}
```

**Comportamento padrão:** Se não houver preferências salvas, retorna todos os kanbans como visíveis.

### POST `/api/compras/filtro-kanbans`
Salva as preferências de kanbans visíveis do usuário logado.

**Request Body:**
```json
{
  "kanbans_visiveis": [
    "aguardando aprovação da requisição",
    "cotado aguardando escolha"
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Preferências salvas com sucesso"
}
```

## Arquivos Modificados

### 1. `menu_produto.html`
- Adicionado botão de filtro (linha ~432)
- Adicionado modal completo (linhas ~448-491)

### 2. `menu_produto.js`
- Variáveis globais: `kanbansVisiveis`, `todosKanbans` (linha ~20305)
- Funções implementadas:
  - `abrirModalFiltroKanbans()` - Abre modal e popula checkboxes
  - `fecharModalFiltroKanbans()` - Fecha o modal
  - `carregarPreferenciasKanbans()` - Carrega do servidor
  - `salvarPreferenciasKanbans()` - Salva no servidor
  - `aplicarFiltroKanbans()` - Aplica visibilidade nas colunas
  - `toggleSelecionarTodosKanbans()` - Marca/desmarca todos
- Event listeners adicionados (linha ~13370)
- Modificada `loadMinhasSolicitacoes()` para carregar preferências e aplicar filtro

### 3. `server.js`
- Endpoint GET (linhas 11443-11476)
- Endpoint POST (linhas 11478-11503)

### 4. `sql/create_filtro_kanbans_usuario.sql`
- Script SQL para criação da tabela
- Inclui comentários e índices

## Fluxo de Funcionamento

1. **Ao carregar a página:**
   - `loadMinhasSolicitacoes()` é chamada
   - `carregarPreferenciasKanbans()` busca preferências do servidor
   - Kanbans são renderizados
   - `aplicarFiltroKanbans()` oculta kanbans desmarcados

2. **Ao clicar no botão de filtro:**
   - Modal é aberto
   - Checkboxes são populados com estado atual
   - Usuário marca/desmarca kanbans desejados
   - Pode usar "Selecionar Todos" para marcar/desmarcar todos

3. **Ao aplicar filtro:**
   - Dados são salvos no servidor via POST
   - Variável global `kanbansVisiveis` é atualizada
   - `aplicarFiltroKanbans()` oculta/exibe colunas
   - Modal é fechado
   - Feedback visual no botão (verde por 800ms)

## Validações

- ✅ Usuário deve estar logado
- ✅ Array `kanbans_visiveis` é validado no servidor
- ✅ Nomes dos kanbans são validados contra lista permitida
- ✅ Valores padrão se não houver preferências salvas
- ✅ Tratamento de erros com try-catch
- ✅ Feedback visual ao usuário

## Testes Realizados

- [x] Criação da tabela no banco de dados
- [x] Reinicialização do servidor PM2
- [x] Verificação de erros de sintaxe JavaScript
- [ ] Teste funcional no navegador (pendente)

## Próximos Passos (Opcional)

- [ ] Adicionar atalho de teclado (ex: Ctrl+F) para abrir filtro
- [ ] Implementar presets de filtro (ex: "Ver apenas minhas ações")
- [ ] Adicionar contador de kanbans visíveis/ocultos
- [ ] Exportar/importar configurações de filtro
- [ ] Adicionar animação de transição ao ocultar/exibir

## Notas Técnicas

- **Títulos Personalizados:** Alguns kanbans têm títulos diferentes no frontend:
  - "aguardando cotação" → exibido como "Cotação com compras"
  - "aguardando compra" → exibido como "Pedido de compra"
  
- **Mapeamento Reverso:** A função `aplicarFiltroKanbans()` usa mapeamento reverso para converter títulos exibidos de volta aos nomes normalizados.

- **JSONB:** Uso de tipo JSONB no PostgreSQL permite queries eficientes e flexibilidade para futuras expansões.

- **Upsert:** Endpoint POST usa `INSERT...ON CONFLICT` para criar ou atualizar registro.

## Suporte

Para problemas ou dúvidas:
1. Verificar console do navegador para erros JavaScript
2. Verificar logs do servidor: `pm2 logs intranet_api`
3. Verificar tabela do banco: `SELECT * FROM compras.filtro_kanbans_usuario;`
