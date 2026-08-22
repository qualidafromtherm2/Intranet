/**
 * Orquestrador: avalia o pedido, monta plano (ops | free | cursor)
 * e executa tarefas leves sem gastar Cursor.
 */
'use strict';

const { chatCompletion, hasAnyFreeProvider } = require('./iaCloudProviders');

const ASSIGNEES = new Set(['ops', 'free', 'cursor']);
const ACTIONS = new Set([
  'list_conversations',
  'delete_conversation',
  'cancel_run',
  'sql_select',
  'reply',
  'draft_html_css',
  'cursor_implement',
]);

const PLANNER_SYSTEM = `Você é o orquestrador do Chatbot da intranet Fromtherm.
Classifique o pedido do usuário e devolva APENAS JSON válido (sem markdown) neste formato:
{
  "summary": "frase curta do plano",
  "risk": "low" | "medium" | "high",
  "tasks": [
    {
      "id": "t1",
      "assignee": "ops" | "free" | "cursor",
      "action": "list_conversations" | "delete_conversation" | "cancel_run" | "sql_select" | "reply" | "draft_html_css" | "cursor_implement",
      "prompt": "instrução para o worker (se preciso)",
      "sql": "SELECT ... (só se action=sql_select)"
    }
  ]
}

Regras:
- ops: listar/apagar conversas, cancelar run — sem LLM.
- free: dúvidas, chamado (só consulta), SQL SELECT, explicar, rascunhar HTML/CSS (NÃO aplicar no repo).
- cursor: alterar código de verdade, schema/banco, multi-arquivo, deploy, PR, merge, lógica crítica.
- Se misturar consulta + mudança crítica: tasks free + cursor.
- SQL free: somente SELECT/WITH...SELECT. Nunca INSERT/UPDATE/DELETE/DDL.
- Português simples. Máximo 4 tasks.
- Se o pedido for só conversa leve → uma task free/reply.
- Se for implementação pesada → uma task cursor/cursor_implement.`;

function normalizePlan(raw, { fallbackPrompt = '', preferAssignee = null } = {}) {
  const plan = raw && typeof raw === 'object' ? raw : {};
  const risk = ['low', 'medium', 'high'].includes(plan.risk) ? plan.risk : 'medium';
  const rawTasks = Array.isArray(plan.tasks) ? plan.tasks : [];
  let hadInvalidAssignee = false;
  let tasks = rawTasks
    .map((t, i) => {
      let assignee = ASSIGNEES.has(t?.assignee) ? t.assignee : null;
      if (!assignee) {
        hadInvalidAssignee = true;
        assignee = ASSIGNEES.has(preferAssignee) ? preferAssignee : 'cursor';
      }
      let action = ACTIONS.has(t?.action) ? t.action : null;
      if (!action) {
        if (assignee === 'ops') action = 'list_conversations';
        else if (assignee === 'free') action = 'reply';
        else action = 'cursor_implement';
      }
      return {
        id: String(t?.id || `t${i + 1}`),
        assignee,
        action,
        prompt: String(t?.prompt || fallbackPrompt || '').trim(),
        sql: t?.sql ? String(t.sql).trim() : undefined,
      };
    })
    .filter(Boolean);

  let usedDefaultCursorFallback = false;
  if (!tasks.length) {
    usedDefaultCursorFallback = true;
    tasks = [
      {
        id: 't1',
        assignee: 'cursor',
        action: 'cursor_implement',
        prompt: fallbackPrompt,
      },
    ];
  }

  return {
    summary: String(plan.summary || 'Plano do orquestrador').trim().slice(0, 240),
    risk,
    tasks,
    usedDefaultCursorFallback,
    hadInvalidAssignee,
  };
}

function extractJsonObject(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch (_) {}
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch (_) {}
  }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch (_) {}
  }
  return null;
}

function isReadOnlySelectSql(sql) {
  const stripped = String(sql || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim();
  if (!stripped) return false;
  if (/;\s*\S/.test(stripped)) return false;
  return /^(with\b[\s\S]+)?select\b/i.test(stripped);
}

/** Fase 3: usuário confirma aplicar rascunho HTML/CSS. */
function isApplyDraftRequest(userText) {
  const t = String(userText || '').trim().toLowerCase();
  if (!t) return false;
  return (
    /^(aplicar|aplica|pode aplicar|aplica isso|aplica o rascunho|aplica o patch)[!?.]*$/i.test(t) ||
    /\b(aplicar|aplica)\b.*\b(rascunho|patch|html|css|cursor)\b/i.test(t)
  );
}

function findLastDraftContent(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (!m || m.role !== 'assistant') continue;
    const c = String(m.content || '');
    if (/responda \*\*?aplicar\*\*?/i.test(c) || /rascunh|```(html|css)/i.test(c)) {
      return c.replace(/^\[IA grátis\]\s*/i, '').trim();
    }
  }
  return '';
}

/**
 * Classificador por regras (testável, sem API).
 * Usado quando não há provedor OU como base antes do LLM.
 */
function planWithHeuristics(userText, { hasFree = hasAnyFreeProvider() } = {}) {
  const text = String(userText || '').trim();
  const lower = text.toLowerCase();

  if (!text) {
    return {
      ...normalizePlan({
        summary: 'Pedido vazio — Cursor',
        risk: 'high',
        tasks: [{ id: 't1', assignee: 'cursor', action: 'cursor_implement', prompt: text }],
      }),
      confident: true,
    };
  }

  // Fase 3: aplicar rascunho anterior → Cursor
  if (isApplyDraftRequest(text)) {
    return {
      ...normalizePlan({
        summary: 'Aplicar rascunho HTML/CSS → Cursor',
        risk: 'medium',
        tasks: [{ id: 't1', assignee: 'cursor', action: 'cursor_implement', prompt: text }],
      }),
      confident: true,
    };
  }

  // Ops — histórico / excluir / cancelar
  if (
    /\b(list(a|e|ar)?|mostrar|exibir)\b.*\b(conversas?|histórico|historico)\b/i.test(lower) ||
    /\b(conversas?|histórico|historico)\b.*\b(list(a|e|ar)?|mostrar)\b/i.test(lower)
  ) {
    return {
      ...normalizePlan({
        summary: 'Listar conversas (ops)',
        risk: 'low',
        tasks: [{ id: 't1', assignee: 'ops', action: 'list_conversations', prompt: text }],
      }),
      confident: true,
    };
  }
  if (/\b(apaga(r)?|exclui(r)?|deleta(r)?)\b.*\bconversa/i.test(lower)) {
    return {
      ...normalizePlan({
        summary: 'Excluir conversa (ops)',
        risk: 'low',
        tasks: [{ id: 't1', assignee: 'ops', action: 'delete_conversation', prompt: text }],
      }),
      confident: true,
    };
  }
  if (/\b(cancela(r)?|parar|stop)\b.*\b(run|agent|agente|trabalho)\b/i.test(lower)) {
    return {
      ...normalizePlan({
        summary: 'Cancelar run (ops)',
        risk: 'low',
        tasks: [{ id: 't1', assignee: 'ops', action: 'cancel_run', prompt: text }],
      }),
      confident: true,
    };
  }

  // Crítico → Cursor
  const critical =
    /\b(deploy|publicar|merge|pull request|\bpr\b|schema|migration|coluna nova|cria(r)? rota|endpoint|postgres|omie|multi[- ]?arquivo|refactor|refator)/i.test(
      lower
    ) ||
    /\b(banco|api)\b.*\b(tela|front|html)\b/i.test(lower) ||
    /\b(tela|front|html)\b.*\b(banco|api)\b/i.test(lower);

  if (critical || !hasFree) {
    return {
      ...normalizePlan({
        summary: hasFree ? 'Tarefa crítica → Cursor' : 'Sem IA grátis — Cursor',
        risk: critical ? 'high' : 'medium',
        tasks: [{ id: 't1', assignee: 'cursor', action: 'cursor_implement', prompt: text }],
      }),
      confident: true,
    };
  }

  // SQL SELECT explícito
  const sqlMatch = text.match(/\b(select\b[\s\S]+)/i);
  if (sqlMatch && isReadOnlySelectSql(sqlMatch[1])) {
    return {
      ...normalizePlan({
        summary: 'Consulta SQL (free)',
        risk: 'low',
        tasks: [
          {
            id: 't1',
            assignee: 'free',
            action: 'sql_select',
            prompt: text,
            sql: sqlMatch[1].replace(/;+\s*$/, '').trim(),
          },
        ],
      }),
      confident: true,
    };
  }
  if (/\b(consulta|buscar|localizar|quantos?|liste)\b.*\b(sql|banco|tabela|chamado)/i.test(lower)) {
    return {
      ...normalizePlan({
        summary: 'Localizar no SQL (free)',
        risk: 'low',
        tasks: [
          {
            id: 't1',
            assignee: 'free',
            action: 'sql_select',
            prompt: text,
          },
          {
            id: 't2',
            assignee: 'free',
            action: 'reply',
            prompt: `Com base no resultado SQL (se houver), responda em português simples: ${text}`,
          },
        ],
      }),
      confident: true,
    };
  }

  // HTML/CSS rascunho
  if (/\b(html|css|label|botão|botao|cor|estilo|texto do botão)\b/i.test(lower) &&
      /\b(muda(r)?|altera(r)?|troca(r)?|ajusta(r)?|rascunh)/i.test(lower) &&
      !/\b(rota|schema|banco|deploy)\b/i.test(lower)) {
    return {
      ...normalizePlan({
        summary: 'Rascunho HTML/CSS (free)',
        risk: 'low',
        tasks: [{ id: 't1', assignee: 'free', action: 'draft_html_css', prompt: text }],
      }),
      confident: true,
    };
  }

  // Chamado / dúvida leve
  if (/\b(chamado|dúvida|duvida|explica|o que é|como faço|como funciona)\b/i.test(lower)) {
    return {
      ...normalizePlan({
        summary: 'Resposta leve (free)',
        risk: 'low',
        tasks: [{ id: 't1', assignee: 'free', action: 'reply', prompt: text }],
      }),
      confident: true,
    };
  }

  // Default ambíguo: free reply, mas LLM pode refinar (confident: false)
  return {
    ...normalizePlan({
      summary: 'Resposta leve (free)',
      risk: 'low',
      tasks: [{ id: 't1', assignee: 'free', action: 'reply', prompt: text }],
    }),
    confident: false,
  };
}

async function planWithLlm(userText, { context = '' } = {}) {
  const preferred =
    process.env.IA_ORCHESTRATOR_PROVIDER ||
    (process.env.GROQ_API_KEY ? 'groq' : process.env.GEMINI_API_KEY ? 'gemini' : 'openrouter');
  const result = await chatCompletion({
    preferred,
    temperature: 0.1,
    maxTokens: 500,
    light: true,
    messages: [
      { role: 'system', content: PLANNER_SYSTEM },
      {
        role: 'user',
        content: [
          context ? `Contexto:\n${context}\n` : '',
          `Pedido do usuário:\n${userText}`,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
  });
  const parsed = extractJsonObject(result.content);
  if (!parsed) {
    throw new Error('Planner não retornou JSON válido');
  }
  const plan = normalizePlan(parsed, { fallbackPrompt: userText });
  plan.plannerProvider = result.provider;
  plan.plannerModel = result.model;
  plan.plannerUsage = result.usage || null;
  return plan;
}

/**
 * Monta o plano. Heurística sempre; LLM refina só em pedidos ambíguos.
 */
async function buildPlan(userText, opts = {}) {
  const hasFree = hasAnyFreeProvider();
  const heuristic = planWithHeuristics(userText, { hasFree });

  const useLlm =
    hasFree &&
    String(process.env.IA_ORCHESTRATOR_LLM || '1').trim() !== '0' &&
    opts.useLlm !== false;

  const onlyOps = heuristic.tasks.every((t) => t.assignee === 'ops');
  const onlyCursor = heuristic.tasks.every((t) => t.assignee === 'cursor');
  // Padrões inequívocos: não gasta LLM no plano
  if (onlyOps || onlyCursor || heuristic.confident || !useLlm) {
    return { ...heuristic, source: 'heuristic' };
  }

  try {
    const llmPlan = await planWithLlm(userText, { context: opts.context || '' });
    if (!hasFree) {
      return {
        ...normalizePlan({
          summary: 'Sem IA grátis — Cursor',
          risk: 'medium',
          tasks: [{ assignee: 'cursor', action: 'cursor_implement', prompt: userText }],
        }),
        source: 'fallback-cursor',
      };
    }
    // LLM vazio / assignee inválido → mantém heurística (evita Cursor caro à toa)
    if (llmPlan.usedDefaultCursorFallback || llmPlan.hadInvalidAssignee) {
      return {
        ...heuristic,
        source: 'heuristic-fallback',
        plannerError: llmPlan.usedDefaultCursorFallback
          ? 'Planner sem tasks válidas'
          : 'Planner com assignee inválido',
        plannerProvider: llmPlan.plannerProvider,
        plannerModel: llmPlan.plannerModel,
      };
    }
    const adjusted = {
      ...llmPlan,
      tasks: llmPlan.tasks.map((t) => {
        if (t.assignee === 'free' && !hasFree) {
          return { ...t, assignee: 'cursor', action: 'cursor_implement' };
        }
        return t;
      }),
      source: 'llm',
    };
    return adjusted;
  } catch (e) {
    return { ...heuristic, source: 'heuristic-fallback', plannerError: e.message };
  }
}

function planNeedsCursor(plan) {
  return (plan?.tasks || []).some((t) => t.assignee === 'cursor');
}

function planNeedsFree(plan) {
  return (plan?.tasks || []).some((t) => t.assignee === 'free');
}

function planNeedsOps(plan) {
  return (plan?.tasks || []).some((t) => t.assignee === 'ops');
}

function summarizePlanForUi(plan) {
  if (!plan) return '';
  const parts = (plan.tasks || []).map((t) => {
    if (t.assignee === 'ops') return 'Ops';
    if (t.assignee === 'free') return 'Free';
    return 'Cursor';
  });
  const uniq = [...new Set(parts)];
  return `Orquestrador → ${uniq.join(' + ')}: ${plan.summary || ''}`.trim();
}

function buildCursorPromptFromPlan(userText, plan, freeResults = []) {
  const applying = isApplyDraftRequest(userText);
  const lines = applying
    ? [
        '[Orquestrador] O usuário confirmou APLICAR o rascunho HTML/CSS da IA grátis.',
        'Aplique SOMENTE o patch abaixo no repositório (diff mínimo). Não redesenhe a tela.',
        `Plano: ${plan?.summary || ''}`,
      ]
    : [
        '[Orquestrador] Parte crítica atribuída ao Cursor.',
        `Plano: ${plan?.summary || ''}`,
        `Risco: ${plan?.risk || 'high'}`,
      ];
  if (freeResults.length) {
    lines.push('', applying ? 'Rascunho a aplicar:' : 'Resultados já obtidos pelas IAs grátis (use, não refaça):');
    for (const r of freeResults) {
      lines.push(`- [${r.taskId || r.action}] ${String(r.content || '').slice(0, 6000)}`);
    }
  }
  lines.push('', 'Pedido do usuário:', userText || '');
  return lines.join('\n');
}

module.exports = {
  PLANNER_SYSTEM,
  normalizePlan,
  extractJsonObject,
  isReadOnlySelectSql,
  isApplyDraftRequest,
  findLastDraftContent,
  planWithHeuristics,
  planWithLlm,
  buildPlan,
  planNeedsCursor,
  planNeedsFree,
  planNeedsOps,
  summarizePlanForUi,
  buildCursorPromptFromPlan,
};
