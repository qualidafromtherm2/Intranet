/**
 * ============================================================
 * CRON — Snapshot diário de estoque (20:00 horário Brasília)
 * ============================================================
 * Copia o estado atual de logistica.estoque_atual para
 * public.omie_estoque_posicao com data_posicao = hoje.
 *
 * Não faz nenhuma chamada à API Omie — usa apenas dados
 * locais já mantidos pelo webhook.
 *
 * Isso garante que a aba "Posição de Estoque por Data" tenha
 * um registro diário fiel do fechamento de cada dia.
 */

const { dbQuery } = require('../src/db');

const TAG = '[SnapshotEstoque]';

// Horário de Brasília = UTC-3 → 20:00 BRT = 23:00 UTC
// Usamos getHours() que já respeita o fuso do servidor (Linux configurado como America/Sao_Paulo)
const HORA_ALVO  = 20; // 20:00
const MINUTO_MAX = 4;  // janela de 5 minutos (20:00 – 20:04)

let _lastRunDate = null;

/**
 * Insere/atualiza snapshot de hoje em omie_estoque_posicao
 * copiando tudo de logistica.estoque_atual.
 */
async function executarSnapshotEstoque() {
  const hoje = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  console.log(TAG, `Iniciando snapshot de estoque para data ${hoje}...`);

  try {
    const result = await dbQuery(`
      INSERT INTO public.omie_estoque_posicao (
        data_posicao,
        ingested_at,
        local_codigo,
        omie_prod_id,
        cod_int,
        codigo,
        descricao,
        preco_unitario,
        saldo,
        cmc,
        pendente,
        estoque_minimo,
        reservado,
        fisico
      )
      SELECT
        $1::date           AS data_posicao,
        now()              AS ingested_at,
        local_codigo,
        omie_prod_id,
        cod_int,
        codigo,
        descricao,
        preco_unitario,
        saldo,
        cmc,
        pendente,
        estoque_minimo,
        reservado,
        fisico
      FROM logistica.estoque_atual
      WHERE codigo IS NOT NULL AND codigo <> ''
      ON CONFLICT ON CONSTRAINT uq_posicao_uni
      DO UPDATE SET
        descricao      = EXCLUDED.descricao,
        preco_unitario = EXCLUDED.preco_unitario,
        saldo          = EXCLUDED.saldo,
        cmc            = EXCLUDED.cmc,
        pendente       = EXCLUDED.pendente,
        estoque_minimo = EXCLUDED.estoque_minimo,
        reservado      = EXCLUDED.reservado,
        fisico         = EXCLUDED.fisico,
        ingested_at    = now()
    `, [hoje]);

    const count = result?.rowCount ?? '?';
    console.log(TAG, `Snapshot concluído: ${count} registros gravados para ${hoje}.`);
  } catch (err) {
    console.error(TAG, 'Erro ao gravar snapshot:', err?.message || err);
  }
}

function verificarHorarioSnapshot() {
  const now    = new Date();
  const hoje   = now.toISOString().slice(0, 10);
  const hora   = now.getHours();
  const minuto = now.getMinutes();

  if (hora === HORA_ALVO && minuto <= MINUTO_MAX && _lastRunDate !== hoje) {
    _lastRunDate = hoje; // evita duplo disparo dentro da janela
    executarSnapshotEstoque().catch(err =>
      console.error(TAG, 'Erro não tratado:', err?.message || err)
    );
  }
}

function iniciarCronSnapshotEstoque() {
  console.log(TAG, `Timer iniciado — snapshot diário às ${HORA_ALVO}:00 (Brasília).`);
  setInterval(verificarHorarioSnapshot, 60 * 1000); // verifica a cada minuto
  verificarHorarioSnapshot(); // checa imediatamente (útil se servidor reiniciou nessa janela)
}

module.exports = {
  iniciarCronSnapshotEstoque,
  executarSnapshotEstoque, // exportado para permitir disparo manual via endpoint se necessário
};
