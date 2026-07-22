const { dbQuery } = require('../src/db');

let schemaPronto = false;

async function garantirSchemaPermissoesMovimentacao() {
  if (schemaPronto) return;
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS logistica.movimentacao_permissoes (
      username TEXT PRIMARY KEY,
      origem_local_codigo TEXT,
      destino_transferencia_codigo TEXT,
      restringir_ajustes BOOLEAN NOT NULL DEFAULT FALSE,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  schemaPronto = true;
}

async function obterPermissaoMovimentacao(username) {
  await garantirSchemaPermissoesMovimentacao();
  const { rows } = await dbQuery(`
    SELECT username, origem_local_codigo, destino_transferencia_codigo, restringir_ajustes
    FROM logistica.movimentacao_permissoes
    WHERE LOWER(username) = LOWER($1)
    LIMIT 1
  `, [String(username || '').trim()]);
  return rows[0] || null;
}

async function validarPermissaoMovimentacao({ username, tipo, origem, destino }) {
  const regra = await obterPermissaoMovimentacao(username);
  if (!regra) return { ok: true, regra: null };

  const tipoNormalizado = String(tipo || '').trim().toUpperCase();
  const origemRegra = String(regra.origem_local_codigo || '').trim();
  const destinoRegra = String(regra.destino_transferencia_codigo || '').trim();
  const origemAtual = String(origem || '').trim();
  const destinoAtual = String(destino || '').trim();

  if (regra.restringir_ajustes && ['ENT', 'SAI'].includes(tipoNormalizado) && origemRegra) {
    const localAjuste = tipoNormalizado === 'ENT' ? destinoAtual : origemAtual;
    if (localAjuste !== origemRegra) {
      return { ok: false, error: 'Seu usuário só pode movimentar ajustes no Estoque Almox.' };
    }
  }

  if (tipoNormalizado === 'TRF') {
    if (origemRegra && origemAtual !== origemRegra) {
      return { ok: false, error: 'Sua transferência deve sair do Estoque Almox.' };
    }
    if (destinoRegra && destinoAtual !== destinoRegra) {
      return { ok: false, error: 'Sua transferência deve ter como destino o Estoque Produção.' };
    }
  }

  return { ok: true, regra };
}

module.exports = { garantirSchemaPermissoesMovimentacao, obterPermissaoMovimentacao, validarPermissaoMovimentacao };
