const { dbQuery } = require('../src/db');

let schemaPronto = false;

async function garantirSchemaPermissoesMovimentacao() {
  if (schemaPronto) return;
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS logistica.movimentacao_permissoes (
      username TEXT PRIMARY KEY,
      origem_local_codigo TEXT,
      destino_transferencia_codigo TEXT,
      origem_local_codigos TEXT[],
      destino_transferencia_codigos TEXT[],
      restringir_ajustes BOOLEAN NOT NULL DEFAULT FALSE,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbQuery(`
    ALTER TABLE logistica.movimentacao_permissoes
      ADD COLUMN IF NOT EXISTS origem_local_codigos TEXT[],
      ADD COLUMN IF NOT EXISTS destino_transferencia_codigos TEXT[]
  `);
  schemaPronto = true;
}

async function obterPermissaoMovimentacao(username) {
  await garantirSchemaPermissoesMovimentacao();
  const { rows } = await dbQuery(`
    SELECT username, origem_local_codigo, destino_transferencia_codigo,
           origem_local_codigos, destino_transferencia_codigos,
           restringir_ajustes
    FROM logistica.movimentacao_permissoes
    WHERE LOWER(username) = LOWER($1)
    LIMIT 1
  `, [String(username || '').trim()]);
  return rows[0] || null;
}

function normalizarLocaisPermitidos(valor) {
  const valores = Array.isArray(valor) ? valor : String(valor || '').split(',');
  return valores
    .map(codigo => codigo.trim())
    .filter(Boolean);
}

async function validarPermissaoMovimentacao({ username, tipo, origem, destino }) {
  const regra = await obterPermissaoMovimentacao(username);
  if (!regra) return { ok: true, regra: null };

  const tipoNormalizado = String(tipo || '').trim().toUpperCase();
  const origensPermitidas = normalizarLocaisPermitidos(
    regra.origem_local_codigos?.length ? regra.origem_local_codigos : regra.origem_local_codigo
  );
  const destinosPermitidos = normalizarLocaisPermitidos(
    regra.destino_transferencia_codigos?.length
      ? regra.destino_transferencia_codigos
      : regra.destino_transferencia_codigo
  );
  const origemAtual = String(origem || '').trim();
  const destinoAtual = String(destino || '').trim();

  if (regra.restringir_ajustes && ['ENT', 'SAI'].includes(tipoNormalizado) && origensPermitidas.length) {
    const localAjuste = tipoNormalizado === 'ENT' ? destinoAtual : origemAtual;
    if (!origensPermitidas.includes(localAjuste)) {
      return { ok: false, error: 'Seu usuário não pode movimentar ajustes neste estoque.' };
    }
  }

  if (tipoNormalizado === 'TRF') {
    if (origensPermitidas.length && !origensPermitidas.includes(origemAtual)) {
      return { ok: false, error: 'Este estoque de origem não está permitido para seu usuário.' };
    }
    if (destinosPermitidos.length && !destinosPermitidos.includes(destinoAtual)) {
      return { ok: false, error: 'Este estoque de destino não está permitido para seu usuário.' };
    }
  }

  return { ok: true, regra };
}

module.exports = {
  garantirSchemaPermissoesMovimentacao,
  obterPermissaoMovimentacao,
  validarPermissaoMovimentacao,
  normalizarLocaisPermitidos
};
