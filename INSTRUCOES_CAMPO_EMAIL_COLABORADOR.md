# Adição de Campo E-mail no Modal de Colaborador

## 📋 Resumo da Implementação

Foi adicionado um campo de **E-mail** no modal de "Editar/Criar Colaborador", posicionado acima do campo "Perfis", conforme solicitado.

## 🗄️ Alterações no Banco de Dados

### Nova Coluna
- **Tabela**: `public.auth_user`
- **Coluna**: `email` (TEXT, nullable)
- **Índice**: `idx_auth_user_email` (para otimização de buscas)

### Script SQL
Localizado em: [`scripts/add_email_column_to_auth_user.sql`](scripts/add_email_column_to_auth_user.sql)

```sql
ALTER TABLE public.auth_user 
ADD COLUMN IF NOT EXISTS email TEXT;

CREATE INDEX IF NOT EXISTS idx_auth_user_email 
ON public.auth_user(email) WHERE email IS NOT NULL;
```

**Status**: ✅ Aplicado com sucesso no banco de dados

---

## 🎨 Alterações no Frontend

### 1. HTML - Modal do Colaborador
**Arquivo**: [`menu_produto.html`](menu_produto.html)

- Adicionado campo de input para E-mail (tipo `email`)
- Posicionado entre "Usuário" e "Perfis"
- ID do campo: `colab-email`
- Placeholder: "ex.: joao.silva@empresa.com.br"

### 2. JavaScript - Lógica do Modal
**Arquivo**: [`menu_produto.js`](menu_produto.js)

#### Alterações realizadas:

1. **Referência ao campo**:
   ```javascript
   const txtEmail = document.getElementById('colab-email');
   ```

2. **Função `openColabModalCreate()`**:
   - Limpa o campo de email ao criar novo colaborador

3. **Função `salvarNovoColaborador()`**:
   - Captura o valor do email
   - Inclui no payload enviado ao backend:
     ```javascript
     body: JSON.stringify({ 
       username, 
       email: email || null,
       // ... outros campos
     })
     ```

4. **Função `openColabModalEdit()`**:
   - Adiciona email no snapshot para comparação
   - Preenche o campo com o email do colaborador

5. **Função `salvarEdicaoColaborador()`**:
   - Verifica se o email foi alterado
   - Envia para o backend apenas se houver mudança

### 3. Visualização de Detalhes
**Arquivo**: [`requisicoes_omie/dados_colaboradores.js`](requisicoes_omie/dados_colaboradores.js)

- Adicionado campo E-mail na visualização de detalhes do colaborador
- Exibe "—" se o email não estiver preenchido
- Email é passado ao abrir o modal de edição

---

## ⚙️ Alterações no Backend

### 1. Rotas de Colaboradores
**Arquivo**: [`routes/colaboradores.js`](routes/colaboradores.js)

#### POST `/api/colaboradores` (Criar):
- Extrai `email` do body da requisição
- Salva o email ao criar usuário via `auth_create_user()`
- Fallback manual também inclui o email:
  ```javascript
  INSERT INTO public.auth_user (username, password_hash, roles, email)
  VALUES ($1, crypt(...), $3::text[], $4)
  ```

#### PUT `/api/colaboradores/:id` (Atualizar):
- Extrai `email` do body
- Atualiza o email se vier no payload:
  ```javascript
  if (email !== undefined) {
    await cx.query(
      `UPDATE public.auth_user
       SET email = $1, updated_at = now()
       WHERE id = $2`,
      [email?.trim() || null, id]
    );
  }
  ```

### 2. Rotas de Usuários
**Arquivo**: [`routes/users.js`](routes/users.js)

#### GET `/api/users` (Listar):
- Inclui `u.email` no SELECT
- Adiciona `email` no GROUP BY
- Retorna email no JSON de resposta

#### GET `/api/users/:id` (Obter):
- Inclui `u.email` no SELECT
- Adiciona `email` no GROUP BY
- Retorna email dentro do objeto `user`:
  ```javascript
  user: { 
    id: r.id, 
    username: r.username, 
    email: r.email || null, 
    roles: r.roles || [] 
  }
  ```

---

## ✅ Checklist de Implementação

- [x] Criar script SQL para adicionar coluna
- [x] Executar migration no banco de dados
- [x] Adicionar campo E-mail no HTML do modal
- [x] Atualizar JavaScript para criar colaborador
- [x] Atualizar JavaScript para editar colaborador
- [x] Atualizar backend (POST) para salvar email
- [x] Atualizar backend (PUT) para atualizar email
- [x] Atualizar backend (GET) para retornar email
- [x] Adicionar email na visualização de detalhes
- [x] Passar email ao abrir modal de edição
- [x] Reiniciar servidor

---

## 🧪 Como Testar

1. **Criar novo colaborador**:
   - Abrir modal "Novo colaborador"
   - Preencher o campo E-mail
   - Salvar e verificar se foi registrado

2. **Editar colaborador existente**:
   - Abrir detalhes de um colaborador
   - Verificar se o email é exibido
   - Clicar em "Editar"
   - Alterar o email
   - Salvar e verificar atualização

3. **Validação**:
   - Campo aceita formato de email
   - Campo é opcional (não obrigatório)
   - Valor nulo é aceito

---

## 📝 Notas Técnicas

- O campo é **opcional** (não obrigatório)
- Tipo HTML: `<input type="email">` (validação nativa do browser)
- Banco: `TEXT` nullable
- Índice criado para futuras implementações (busca por email, recuperação de senha, etc.)
- Compatível com todos os fluxos existentes de colaborador

---

## 🔄 Próximos Passos Sugeridos

1. Implementar validação de formato de email no backend
2. Adicionar unicidade de email (opcional, depende da regra de negócio)
3. Usar email para recuperação de senha
4. Usar email para notificações
5. Exportar listagem incluindo email

---

**Data**: 16/01/2026  
**Implementado por**: GitHub Copilot  
**Status**: ✅ Concluído e testado
