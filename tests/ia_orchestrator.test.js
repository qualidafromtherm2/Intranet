const test = require('node:test');
const assert = require('node:assert/strict');
const {
  planWithHeuristics,
  normalizePlan,
  extractJsonObject,
  isReadOnlySelectSql,
  planNeedsCursor,
  planNeedsFree,
  planNeedsOps,
  summarizePlanForUi,
  buildCursorPromptFromPlan,
} = require('../utils/iaOrchestrator');

test('ops: listar conversas', () => {
  const plan = planWithHeuristics('liste minhas conversas', { hasFree: true });
  assert.equal(plan.tasks[0].assignee, 'ops');
  assert.equal(plan.tasks[0].action, 'list_conversations');
  assert.equal(planNeedsOps(plan), true);
  assert.equal(planNeedsCursor(plan), false);
});

test('ops: excluir conversa', () => {
  const plan = planWithHeuristics('apaga essa conversa', { hasFree: true });
  assert.equal(plan.tasks[0].action, 'delete_conversation');
});

test('ops: cancelar run', () => {
  const plan = planWithHeuristics('cancela o run do agent', { hasFree: true });
  assert.equal(plan.tasks[0].action, 'cancel_run');
});

test('free: SELECT explícito', () => {
  const plan = planWithHeuristics(
    'SELECT id, descricao FROM suporte."Chamado" LIMIT 5',
    { hasFree: true }
  );
  assert.equal(plan.tasks[0].assignee, 'free');
  assert.equal(plan.tasks[0].action, 'sql_select');
  assert.match(plan.tasks[0].sql, /^SELECT/i);
});

test('free: rascunho HTML/CSS', () => {
  const plan = planWithHeuristics('muda a cor do botão no CSS', { hasFree: true });
  assert.equal(plan.tasks[0].assignee, 'free');
  assert.equal(plan.tasks[0].action, 'draft_html_css');
});

test('free: dúvida / chamado', () => {
  const plan = planWithHeuristics('explica como funciona o chamado urgente', { hasFree: true });
  assert.equal(plan.tasks[0].assignee, 'free');
  assert.equal(plan.tasks[0].action, 'reply');
});

test('cursor: tarefa crítica multi-camada', () => {
  const plan = planWithHeuristics(
    'cria coluna no banco, rota na API e tela no front',
    { hasFree: true }
  );
  assert.equal(plan.tasks[0].assignee, 'cursor');
  assert.equal(plan.risk, 'high');
});

test('cursor: deploy / PR', () => {
  const plan = planWithHeuristics('publicar no site e fazer merge do PR', { hasFree: true });
  assert.equal(planNeedsCursor(plan), true);
});

test('sem provedor free → cursor (exceto ops)', () => {
  const plan = planWithHeuristics('explica o modal de férias', { hasFree: false });
  assert.equal(plan.tasks[0].assignee, 'cursor');
  const ops = planWithHeuristics('liste as conversas', { hasFree: false });
  assert.equal(ops.tasks[0].assignee, 'ops');
});

test('isReadOnlySelectSql', () => {
  assert.equal(isReadOnlySelectSql('SELECT 1'), true);
  assert.equal(isReadOnlySelectSql('WITH x AS (SELECT 1) SELECT * FROM x'), true);
  assert.equal(isReadOnlySelectSql('DELETE FROM t'), false);
  assert.equal(isReadOnlySelectSql('SELECT 1; DROP TABLE t'), false);
});

test('extractJsonObject e normalizePlan', () => {
  const raw = extractJsonObject('```json\n{"summary":"ok","risk":"low","tasks":[{"assignee":"free","action":"reply"}]}\n```');
  const plan = normalizePlan(raw, { fallbackPrompt: 'oi' });
  assert.equal(plan.risk, 'low');
  assert.equal(plan.tasks[0].assignee, 'free');
  assert.equal(planNeedsFree(plan), true);
});

test('summarizePlanForUi e buildCursorPromptFromPlan', () => {
  const plan = planWithHeuristics('cria schema e tela', { hasFree: true });
  assert.match(summarizePlanForUi(plan), /Orquestrador/);
  const prompt = buildCursorPromptFromPlan('faça X', plan, [
    { taskId: 't1', content: 'SQL ok' },
  ]);
  assert.match(prompt, /Resultados já obtidos/);
  assert.match(prompt, /faça X/);
});

test('fase 3: aplicar rascunho → Cursor', () => {
  const plan = planWithHeuristics('aplicar', { hasFree: true });
  assert.equal(plan.tasks[0].assignee, 'cursor');
  assert.match(plan.summary, /Aplicar rascunho/i);
  const applyPrompt = buildCursorPromptFromPlan('aplicar', plan, [
    { taskId: 'draft', content: '```css\n.btn{color:red}\n```' },
  ]);
  assert.match(applyPrompt, /APLICAR o rascunho/i);
});

test('fase 2: reply após sql precisa de contexto', () => {
  const { freeTaskNeedsPriorContext } = require('../utils/iaOrchestratorExec');
  const tasks = [
    { id: 't1', action: 'sql_select' },
    { id: 't2', action: 'reply' },
  ];
  assert.equal(freeTaskNeedsPriorContext(tasks[0], tasks), false);
  assert.equal(freeTaskNeedsPriorContext(tasks[1], tasks), true);
});
