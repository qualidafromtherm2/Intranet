const { dbQuery } = require('../src/db');

let schemaPronto = false;

async function garantirSchemaPermissoesSeparacao(client = null) {
  if (schemaPronto) return;
  const query = client ? client.query.bind(client) : dbQuery;
  await query(`
    CREATE TABLE IF NOT EXISTS logistica.separacao_permissoes (
      user_id BIGINT PRIMARY KEY REFERENCES public.auth_user(id) ON DELETE CASCADE,
      restringir_destinos BOOLEAN NOT NULL DEFAULT FALSE,
      destinos_codigos TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      destinos_chaves TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`ALTER TABLE logistica.separacao_permissoes ADD COLUMN IF NOT EXISTS destinos_chaves TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`);
  schemaPronto = true;
}

function normalizarCodigos(codigos) {
  return [...new Set((Array.isArray(codigos) ? codigos : [])
    .map(codigo => String(codigo || '').trim())
    .filter(Boolean))];
}

async function obterPermissaoSeparacao(userId, client = null) {
  await garantirSchemaPermissoesSeparacao(client);
  const query = client ? client.query.bind(client) : dbQuery;
  const { rows } = await query(`
    SELECT user_id::text, restringir_destinos, destinos_codigos, destinos_chaves
      FROM logistica.separacao_permissoes
     WHERE user_id = $1
     LIMIT 1
  `, [userId]);
  const regra = rows[0] || null;
  if (regra) regra.destinos_codigos = normalizarCodigos(regra.destinos_codigos);
  if (regra) regra.destinos_chaves = normalizarCodigos(regra.destinos_chaves);
  return regra;
}

async function salvarPermissaoSeparacao(client, userId, configuracao = {}) {
  await garantirSchemaPermissoesSeparacao(client);
  const restringir = configuracao.restringir_destinos === true;
  const codigos = normalizarCodigos(configuracao.destinos_codigos);
  const chaves = normalizarCodigos(configuracao.destinos_chaves);
  if (restringir && !chaves.length) {
    const err = new Error('Selecione ao menos um destino para restringir a separação.');
    err.code = 'DESTINO_SEPARACAO_OBRIGATORIO';
    throw err;
  }
  await client.query(`
    INSERT INTO logistica.separacao_permissoes
      (user_id, restringir_destinos, destinos_codigos, destinos_chaves, atualizado_em)
    VALUES ($1, $2, $3::text[], $4::text[], NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      restringir_destinos = EXCLUDED.restringir_destinos,
      destinos_codigos = EXCLUDED.destinos_codigos,
      destinos_chaves = EXCLUDED.destinos_chaves,
      atualizado_em = NOW()
  `, [userId, restringir, codigos, chaves]);
}

async function assertAcessoSeparacao(client, solicIds, req) {
  const ids = (solicIds || []).map(id => parseInt(id, 10)).filter(Number.isFinite);
  if (!ids.length) return { ok: true };
  const userId = req.session?.user?.id;
  if (!userId) return { ok: false, status: 401, error: 'Não autenticado.' };
  const regra = await obterPermissaoSeparacao(userId, client);
  if (!regra?.restringir_destinos) return { ok: true, regra };
  const { rows } = await client.query(`
    SELECT DISTINCT COALESCE(NULLIF(TRIM(nome_local), ''), 'Sem destino') AS destino
      FROM solicitacao_produto.itens_solicitados
     WHERE id = ANY($1::bigint[])
       AND CONCAT(TRIM(COALESCE(cod_local, '')), '|', TRIM(COALESCE(nome_local, ''))) <> ALL($2::text[])
  `, [ids, regra.destinos_chaves]);
  if (rows.length) {
    return {
      ok: false,
      status: 403,
      error: `Seu usuário não possui acesso à separação com destino ${rows[0].destino}.`
    };
  }
  return { ok: true, regra };
}

module.exports = {
  garantirSchemaPermissoesSeparacao,
  obterPermissaoSeparacao,
  salvarPermissaoSeparacao,
  assertAcessoSeparacao,
  normalizarCodigos
};
