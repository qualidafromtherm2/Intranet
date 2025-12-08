// utils/auditoria.js
// Helper para registrar modificações de produto no histórico (auditoria_produto.historico_modificacoes)
const { dbQuery, isDbEnabled } = require('../src/db');

/**
 * Registra uma modificação/menção de produto no histórico
 * @param {Object} params
 * @param {string} params.codigo_omie - Compatibilidade antiga (geralmente o código textual). Mantido para não quebrar listagens existentes.
 * @param {string} [params.codigo_texto] - Código textual do produto (ex.: 02.MP.N.02630)
 * @param {number|string} [params.codigo_produto] - Código numérico do OMIE (11 dígitos)
 * @param {string} params.tipo_acao - Ex.: 'ALTERACAO_CADASTRO', 'ABERTURA_OP', 'MUDANCA_ESTRUTURA', 'MENCAO'
 * @param {string} params.usuario - Usuário responsável (login/nome)
 * @param {string} [params.detalhes] - Texto livre com detalhes
 * @param {string} [params.origem] - Ex.: 'OMIE', 'SQL', 'API'
 */
async function registrarModificacao({ codigo_omie, codigo_texto, codigo_produto, tipo_acao, usuario, detalhes = '', origem = '' }) {
  if (!isDbEnabled) {
    console.warn('[auditoria] DB não habilitado; ignorando registro');
    return;
  }
  if (!codigo_omie && !codigo_texto && !codigo_produto) {
    console.warn('[auditoria] Falta algum identificador do produto (codigo_omie/codigo_texto/codigo_produto).');
  }
  if (!tipo_acao || !usuario) {
    console.warn('[auditoria] Parâmetros obrigatórios ausentes');
    return;
  }
  try {
    // Garante colunas estendidas (idempotente)
    await dbQuery(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'auditoria_produto' AND table_name = 'historico_modificacoes' AND column_name = 'codigo_texto'
        ) THEN
          ALTER TABLE auditoria_produto.historico_modificacoes ADD COLUMN codigo_texto text;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'auditoria_produto' AND table_name = 'historico_modificacoes' AND column_name = 'codigo_produto'
        ) THEN
          ALTER TABLE auditoria_produto.historico_modificacoes ADD COLUMN codigo_produto bigint;
        END IF;
      END $$;
    `);

    // Compatibilidade: se não veio codigo_omie, usa o melhor disponível para preencher a coluna antiga
    const compatCodigoOmie = (codigo_omie != null && String(codigo_omie).trim() !== '')
      ? String(codigo_omie).trim()
      : (codigo_texto != null && String(codigo_texto).trim() !== '')
        ? String(codigo_texto).trim()
        : (codigo_produto != null ? String(codigo_produto) : null);

    await dbQuery(
      `INSERT INTO auditoria_produto.historico_modificacoes
       (codigo_omie, codigo_texto, codigo_produto, tipo_acao, usuario, detalhes, origem)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        compatCodigoOmie,
        (codigo_texto != null ? String(codigo_texto) : null),
        (codigo_produto != null ? Number(codigo_produto) : null),
        String(tipo_acao),
        String(usuario),
        String(detalhes || ''),
        String(origem || '')
      ]
    );
  } catch (err) {
    console.error('[auditoria] Falha ao registrar histórico:', err?.message || err);
  }
}

module.exports = { registrarModificacao };
