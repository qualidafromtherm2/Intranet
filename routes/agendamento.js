/**
 * Rotas para Agendamento Automático de Sincronização
 */

const express = require('express');

module.exports = (pool) => {
  const router = express.Router();

  /**
   * GET /api/sincronizacao/agendamento/config
   * Retorna a configuração atual de agendamento
   */
  router.get('/config', async (req, res) => {
    const client = await pool.connect();
    
    try {
      const result = await client.query(`
        SELECT id, ativo, dias_semana, horario::text as horario, ultima_execucao, proxima_execucao, updated_at
        FROM public.agendamento_sincronizacao
        ORDER BY id DESC
        LIMIT 1
      `);

      if (result.rows.length === 0) {
        // Criar configuração padrão se não existir
        const insertResult = await client.query(`
          INSERT INTO public.agendamento_sincronizacao (ativo, dias_semana, horario)
          VALUES (false, ARRAY[1, 5], '09:00:00')
          RETURNING id, ativo, dias_semana, horario::text as horario, ultima_execucao, proxima_execucao, updated_at
        `);
        return res.json(insertResult.rows[0]);
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error('[Agendamento] Erro ao buscar configuração:', error);
      res.status(500).json({ error: error.message });
    } finally {
      client.release();
    }
  });

  /**
   * POST /api/sincronizacao/agendamento/config
   * Salva a configuração de agendamento
   */
  router.post('/config', async (req, res) => {
    const client = await pool.connect();
    const { ativo, dias_semana, horario } = req.body;

    try {
      // Validações
      if (typeof ativo !== 'boolean') {
        return res.status(400).json({ error: 'Campo "ativo" deve ser boolean' });
      }

      if (!Array.isArray(dias_semana)) {
        return res.status(400).json({ error: 'Campo "dias_semana" deve ser um array' });
      }

      if (!horario || !/^\d{2}:\d{2}$/.test(horario)) {
        return res.status(400).json({ error: 'Campo "horario" deve estar no formato HH:MM' });
      }

      // Calcular próxima execução
      const proximaExecucao = calcularProximaExecucao(dias_semana, horario, ativo);

      // Atualizar ou inserir configuração
      const result = await client.query(`
        INSERT INTO public.agendamento_sincronizacao (id, ativo, dias_semana, horario, proxima_execucao)
        VALUES (1, $1, $2, $3, $4)
        ON CONFLICT (id) DO UPDATE SET
          ativo = $1,
          dias_semana = $2,
          horario = $3,
          proxima_execucao = $4,
          updated_at = CURRENT_TIMESTAMP
        RETURNING id, ativo, dias_semana, horario::text as horario, proxima_execucao, updated_at
      `, [ativo, dias_semana, horario, proximaExecucao]);

      console.log('[Agendamento] Configuração salva:', result.rows[0]);
      
      res.json({
        success: true,
        message: 'Configuração salva com sucesso',
        ...result.rows[0]
      });
    } catch (error) {
      console.error('[Agendamento] Erro ao salvar configuração:', error);
      res.status(500).json({ error: error.message });
    } finally {
      client.release();
    }
  });

  /**
   * POST /api/sincronizacao/agendamento/executar
   * Executa a sincronização automaticamente (chamado pelo worker)
   */
  router.post('/executar', async (req, res) => {
    const client = await pool.connect();

    try {
      // Buscar configuração
      const configResult = await client.query(`
        SELECT ativo, dias_semana, horario
        FROM public.agendamento_sincronizacao
        ORDER BY id DESC
        LIMIT 1
      `);

      if (configResult.rows.length === 0 || !configResult.rows[0].ativo) {
        return res.status(400).json({ error: 'Agendamento não está ativo' });
      }

      const config = configResult.rows[0];
      const agora = new Date();
      const diaAtual = agora.getDay();

      // Verificar se deve executar hoje
      if (!config.dias_semana.includes(diaAtual)) {
        return res.status(400).json({ error: 'Hoje não está configurado para sincronização' });
      }

      // Registrar execução
      const proximaExecucao = calcularProximaExecucao(config.dias_semana, config.horario, config.ativo);
      
      await client.query(`
        UPDATE public.agendamento_sincronizacao
        SET ultima_execucao = CURRENT_TIMESTAMP,
            proxima_execucao = $1
        WHERE id = 1
      `, [proximaExecucao]);

      console.log('[Agendamento] ⏰ Sincronização automática iniciada');

      res.json({
        success: true,
        message: 'Sincronização automática iniciada com sucesso',
        executada_em: agora,
        proxima_execucao: proximaExecucao
      });
    } catch (error) {
      console.error('[Agendamento] Erro ao executar sincronização:', error);
      res.status(500).json({ error: error.message });
    } finally {
      client.release();
    }
  });

  /**
   * Calcula a próxima data/hora de execução
   */
  function calcularProximaExecucao(diasSemana, horario, ativo) {
    if (!ativo || !diasSemana || diasSemana.length === 0) {
      return null;
    }

    const agora = new Date();
    const [hora, minuto] = horario.split(':').map(Number);
    
    // Começar verificando hoje
    let dataProxima = new Date(agora);
    dataProxima.setHours(hora, minuto, 0, 0);
    
    // Se já passou o horário hoje, começar de amanhã
    if (dataProxima <= agora) {
      dataProxima.setDate(dataProxima.getDate() + 1);
    }
    
    // Procurar o próximo dia configurado (até 7 dias à frente)
    for (let i = 0; i < 7; i++) {
      const diaSemana = dataProxima.getDay();
      if (diasSemana.includes(diaSemana)) {
        return dataProxima;
      }
      dataProxima.setDate(dataProxima.getDate() + 1);
    }
    
    return null;
  }

  return router;
};
