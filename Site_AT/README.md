# Site AT — Busca de OP

Aplicação mínima para consultar uma ordem de produção por `numero_op` na tabela `"OrdemProducao".tab_op` do Postgres e mostrar o `codigo_produto` e a etiqueta ZPL com preview.

## Como rodar

1) Instale as dependências:

```bash
npm install
```

2) Copie `.env.example` para `.env` (já está preenchido com as credenciais fornecidas). Ajuste `PORT` se quiser outro:

```bash
cp .env.example .env
```

3) Inicie o servidor:

```bash
npm start
```

4) Abra http://localhost:3000 e pesquise o `numero_op` (Enter ou botão).

## Endpoint

- `GET /api/op?numero_op=...` — retorna `{ codigo_produto, conteudo_zpl, label_preview }`. `label_preview` é uma imagem PNG em base64 gerada via API pública da Labelary; se a renderização falhar, ainda retorna o ZPL bruto.

## Notas

- O banco é acessado via SSL (sem validação de certificado) usando `pg`.
- A Labelary é um serviço público; se o preview não aparecer, o texto ZPL ainda fica disponível.
- O front fica em `public/index.html` e é servido estaticamente pelo Express.
