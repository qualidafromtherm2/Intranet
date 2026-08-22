/**
 * Execução de tasks do orquestrador (ops + free).
 */
'use strict';

const { chatCompletion, buildProviderStatusBoard, listConfiguredProviders } = require('./iaCloudProviders');
const { isReadOnlySelectSql } = require('./iaOrchestrator');

const SQL_MAX_ROWS = Math.min(Number(process.env.DEV_AGENT_SQL_MAX_ROWS || 500), 2000);
const SQL_TIMEOUT_MS = Math.min(Number(process.env.DEV_AGENT_SQL_TIMEOUT_MS || 60000), 120000);

const FREE_SYSTEM = `Você é um assistente leve da intranet Fromtherm.
Responda em português simples e curto.
Não invente dados de banco — use só o que vier no contexto.
Não diga que vai editar o repositório: você só orienta ou rascunha.
Se precisar de mudança crítica no sistema, diga que o Cursor (agente pesado) deve aplicar.`;

const DRAFT_SYSTEM = `Você rascunha mudanças HTML/CSS para a intranet Fromtherm.
Devolva o trecho sugerido (HTML e/ou CSS) e explique onde aplicar na tela.
NÃO afirme que já aplicou no código — isto é só rascunho.
No final, diga em uma linha: Para aplicar no site, responda "aplicar".`;

async function runSqlReadOnly(pool, sql) {
  const q = String(sql || '').trim().replace(/;+\s*$/, '');
  if (!q) return { ok: false, error: 'SQL vazio' };
  if (!isReadOnlySelectSql(q)) {
    return { ok: false, error: 'Somente SELECT é permitido na IA grátis.' };
  }
  if (!pool) return { ok: false, error: 'DATABASE_URL não configurada.' };

  const client = await pool.connect();
  try {
    await client.query(`SET statement_timeout = ${Number(SQL_TIMEOUT_MS)}`);
    await client.query('BEGIN');
    await client.query('SET TRANSACTION READ ONLY');
    const result = await client.query(q);
    await client.query('COMMIT');
    const rows = Array.isArray(result.rows) ? result.rows.slice(0, SQL_MAX_ROWS) : [];
    return {
      ok: true,
      rowCount: result.rowCount ?? rows.length,
      fields: (result.fields || []).map((f) => f.name),
      rows,
      truncated: Array.isArray(result.rows) && result.rows.length > rows.length,
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    return { ok: false, error: err.message };
  } finally {
    client.release();
  }
}

function formatSqlResult(result) {
  if (!result?.ok) return `Erro SQL: ${result?.error || 'falha'}`;
  const preview = (result.rows || []).slice(0, 30);
  return [
    `SQL OK — ${result.rowCount} linha(s)${result.truncated ? ' (truncado)' : ''}.`,
    result.fields?.length ? `Colunas: ${result.fields.join(', ')}` : '',
    preview.length ? '```json\n' + JSON.stringify(preview, null, 2).slice(0, 6000) + '\n```' : '(sem linhas)',
  ]
    .filter(Boolean)
    .join('\n');
}

async function freeChat({ action, prompt, context = '', preferredProvider = null }) {
  const system = action === 'draft_html_css' ? DRAFT_SYSTEM : FREE_SYSTEM;
  const userContent = [context ? `Contexto:\n${context}\n` : '', `Pedido:\n${prompt || ''}`]
    .filter(Boolean)
    .join('\n');
  const isDraft = action === 'draft_html_css';
  const preferred =
    preferredProvider ||
    process.env.IA_FREE_WORKER_PROVIDER ||
    process.env.IA_ORCHESTRATOR_PROVIDER ||
    (process.env.GROQ_API_KEY ? 'groq' : 'openrouter');
  const result = await chatCompletion({
    preferred,
    temperature: isDraft ? 0.3 : 0.2,
    maxTokens: isDraft ? 2048 : 600,
    light: !isDraft,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
  });
  return {
    content: result.content,
    provider: result.provider,
    model: result.model,
    usage: result.usage || null,
    attempts: result.attempts || [],
  };
}

/** Reply/draft depois de sql_select no mesmo plano precisam do resultado SQL. */
function freeTaskNeedsPriorContext(task, freeTasks) {
  const idx = freeTasks.findIndex((t) => t === task || (t.id && t.id === task.id));
  if (idx <= 0) return false;
  if (task.action !== 'reply' && task.action !== 'draft_html_css') return false;
  return freeTasks.slice(0, idx).some((t) => t.action === 'sql_select');
}

/**
 * Executa tasks ops + free.
 * Fase 2: free independentes em Promise.all; dependentes (reply após SQL) na 2ª onda.
 */
async function executeLightTasks({
  plan,
  conv,
  req,
  userText,
  iaDb,
  pool,
  cancelAgentRun,
  conversationHistory = '',
  preferredProvider = null,
}) {
  const tasks = (plan?.tasks || []).filter((t) => t.assignee === 'ops' || t.assignee === 'free');
  const results = [];
  const allAttempts = [];
  let opsUsed = false;

  const mergeAttempts = (attempts) => {
    for (const a of attempts || []) {
      const prev = allAttempts.find((x) => x.id === a.id);
      if (!prev) {
        allAttempts.push({ ...a });
      } else if (a.ok && !prev.ok) {
        Object.assign(prev, a);
      } else if (a.ok && prev.ok && a.usage?.total_tokens) {
        prev.usage = {
          prompt_tokens: (prev.usage?.prompt_tokens || 0) + (a.usage.prompt_tokens || 0),
          completion_tokens: (prev.usage?.completion_tokens || 0) + (a.usage.completion_tokens || 0),
          total_tokens: (prev.usage?.total_tokens || 0) + (a.usage.total_tokens || 0),
        };
        if (a.model) prev.model = a.model;
      }
    }
  };

  const runOne = async (task, priorResults = []) => {
    if (task.assignee === 'ops') {
      opsUsed = true;
      if (task.action === 'list_conversations') {
        const userId = req.devAgentMobile ? null : req.session?.user?.id;
        const items = await iaDb.listConversations({ userId, limit: 30 });
        const lines = items.length
          ? items.map(
              (c) =>
                `- #${c.id} ${c.title || '(sem título)'} — ${c.status || ''} ${c.cursor_agent_id ? `(agent ${c.cursor_agent_id})` : ''}`
            )
          : ['(nenhuma conversa)'];
        return {
          taskId: task.id,
          action: task.action,
          assignee: 'ops',
          content: `Conversas recentes:\n${lines.join('\n')}`,
        };
      }
      if (task.action === 'delete_conversation') {
        const id = Number(conv?.id);
        if (!id) {
          return {
            taskId: task.id,
            action: task.action,
            assignee: 'ops',
            content: 'Não há conversa ativa para excluir. Abra uma conversa e peça de novo.',
          };
        }
        await iaDb.deleteConversation(id);
        return {
          taskId: task.id,
          action: task.action,
          assignee: 'ops',
          content: `Conversa #${id} excluída.`,
          deletedConversationId: id,
        };
      }
      if (task.action === 'cancel_run') {
        const agentId = conv?.cursor_agent_id;
        if (!agentId || typeof cancelAgentRun !== 'function') {
          return {
            taskId: task.id,
            action: task.action,
            assignee: 'ops',
            content: 'Não há agent/run ativo para cancelar nesta conversa.',
          };
        }
        try {
          await cancelAgentRun(agentId);
          return {
            taskId: task.id,
            action: task.action,
            assignee: 'ops',
            content: `Run do agent ${agentId} cancelado (se estava ativo).`,
          };
        } catch (e) {
          return {
            taskId: task.id,
            action: task.action,
            assignee: 'ops',
            content: `Não foi possível cancelar: ${e.message}`,
          };
        }
      }
      return {
        taskId: task.id,
        action: task.action,
        assignee: 'ops',
        content: `Ação ops desconhecida: ${task.action}`,
      };
    }

    if (task.action === 'sql_select') {
      let sql = task.sql;
      if (!sql) {
        try {
          const drafted = await chatCompletion({
            preferred:
              preferredProvider ||
              process.env.IA_FREE_WORKER_PROVIDER ||
              (process.env.GROQ_API_KEY ? 'groq' : 'openrouter'),
            temperature: 0,
            maxTokens: 400,
            light: true,
            messages: [
              {
                role: 'system',
                content:
                  'Gere UM único SQL PostgreSQL somente SELECT (sem ponto-e-vírgula final) para a intranet Fromtherm. Responda só o SQL.',
              },
              { role: 'user', content: task.prompt || userText },
            ],
          });
          mergeAttempts(drafted.attempts);
          sql = String(drafted.content || '')
            .replace(/```sql/gi, '')
            .replace(/```/g, '')
            .trim()
            .replace(/;+\s*$/, '');
        } catch (e) {
          mergeAttempts(e.attempts);
          return {
            taskId: task.id,
            action: task.action,
            assignee: 'free',
            content: `Não consegui montar o SQL: ${e.message}`,
          };
        }
      }
      const result = await runSqlReadOnly(pool, sql);
      return {
        taskId: task.id,
        action: task.action,
        assignee: 'free',
        content: formatSqlResult(result) + (sql ? `\n\nSQL usado:\n\`${sql.slice(0, 500)}\`` : ''),
        sqlResult: result,
      };
    }

    const contextBits = [
      conversationHistory,
      ...[...results, ...priorResults]
        .filter((r) => r.assignee === 'free' || r.assignee === 'ops')
        .map((r) => r.content),
    ]
      .filter(Boolean)
      .join('\n\n');
    try {
      const chat = await freeChat({
        action: task.action,
        prompt: task.prompt || userText,
        context: contextBits,
        preferredProvider,
      });
      mergeAttempts(chat.attempts);
      const isDraft = task.action === 'draft_html_css';
      let content = chat.content;
      if (isDraft && !/responda ["']?aplicar/i.test(content)) {
        content += '\n\n---\nPara aplicar no site com o Cursor, responda **aplicar**.';
      }
      return {
        taskId: task.id,
        action: task.action,
        assignee: 'free',
        content,
        provider: chat.provider,
        model: chat.model,
        isDraft,
      };
    } catch (e) {
      mergeAttempts(e.attempts);
      return {
        taskId: task.id,
        action: task.action,
        assignee: 'free',
        content: `IA grátis indisponível: ${e.message}`,
        error: e.message,
      };
    }
  };

  const opsTasks = tasks.filter((t) => t.assignee === 'ops');
  const freeTasks = tasks.filter((t) => t.assignee === 'free');

  if (opsTasks.length) {
    const opsResults = await Promise.all(opsTasks.map((t) => runOne(t)));
    results.push(...opsResults);
  }

  const freeParallel = freeTasks.filter((t) => !freeTaskNeedsPriorContext(t, freeTasks));
  const freeSequential = freeTasks.filter((t) => freeTaskNeedsPriorContext(t, freeTasks));

  if (freeParallel.length) {
    const wave = await Promise.all(freeParallel.map((t) => runOne(t)));
    results.push(...wave);
  }
  for (const t of freeSequential) {
    const r = await runOne(t, results);
    results.push(r);
  }

  const assistantMessage = results
    .map((r) => r.content)
    .filter(Boolean)
    .join('\n\n---\n\n');

  const routing = buildProviderStatusBoard({
    configured: listConfiguredProviders(),
    attempts: allAttempts,
    engine: null,
    cursorStatus: 'idle',
    opsUsed,
  });

  return {
    results,
    assistantMessage,
    hasDraft: results.some((r) => r.isDraft || r.action === 'draft_html_css'),
    attempts: allAttempts,
    opsUsed,
    routing,
  };
}

module.exports = {
  runSqlReadOnly,
  formatSqlResult,
  freeChat,
  freeTaskNeedsPriorContext,
  executeLightTasks,
};
