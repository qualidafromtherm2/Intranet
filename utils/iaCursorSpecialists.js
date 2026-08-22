/**
 * Catálogo de especialistas do Chatbot (espelha AGENTS.md + skills do repo).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SKILLS_ROOT = path.join(__dirname, '..', '.agents', 'skills');

/** Especialistas de módulo / transversais (curados). */
const CURATED = [
  {
    id: 'pagina-inicio',
    name: 'Início',
    group: 'Módulos',
    blurb: 'Calendário, reservas, visão semanal',
    skill: 'pagina-inicio',
  },
  {
    id: 'logistica-lista-produtos',
    name: 'Lista de produtos',
    group: 'Módulos',
    blurb: 'Grid, filtros, sync Omie',
    skill: 'logistica-lista-produtos',
  },
  {
    id: 'logistica-tela-separacao',
    name: 'Tela de separação',
    group: 'Módulos',
    blurb: 'Kanban separação, modal separar',
    skill: 'logistica-tela-separacao',
  },
  {
    id: 'logistica-kanban-solicitacoes',
    name: 'Kanban solicitações',
    group: 'Módulos',
    blurb: 'Criar/editar solicitação de produto',
    skill: 'logistica-kanban-solicitacoes',
  },
  {
    id: 'modulo-produto',
    name: 'Produto',
    group: 'Módulos',
    blurb: 'Dados, fotos, estrutura, RI, PIR',
    skill: 'modulo-produto',
  },
  {
    id: 'modulo-rh',
    name: 'RH',
    group: 'Módulos',
    blurb: 'Colaboradores, cargos, férias',
    skill: 'modulo-rh',
  },
  {
    id: 'modulo-compras',
    name: 'Compras',
    group: 'Módulos',
    blurb: 'Kanban, cotação, NF-e',
    skill: 'modulo-compras',
  },
  {
    id: 'modulo-sac-at',
    name: 'SAC / AT',
    group: 'Módulos',
    blurb: 'OS, VIPP, envios',
    skill: 'modulo-sac-at',
  },
  {
    id: 'modulo-armazens',
    name: 'Armazéns',
    group: 'Módulos',
    blurb: 'Estoque, transferência, ajuste',
    skill: 'modulo-armazens',
  },
  {
    id: 'modulo-producao',
    name: 'Produção',
    group: 'Módulos',
    blurb: "OP's, 1ª peça, kanban PCP",
    skill: 'modulo-producao',
  },
  {
    id: 'modulo-engenharia',
    name: 'Engenharia',
    group: 'Módulos',
    blurb: 'Lista, códigos de erro',
    skill: 'modulo-engenharia',
  },
  {
    id: 'sql-schema-intranet',
    name: 'Banco / SQL',
    group: 'Transversal',
    blurb: 'Acesso total via API SQL (criar schema/tabela, consultar)',
    skill: 'sql-schema-intranet',
  },
  {
    id: 'api-rotas-intranet',
    name: 'API / rotas',
    group: 'Transversal',
    blurb: 'Express, auth, middleware',
    skill: 'api-rotas-intranet',
  },
  {
    id: 'deploy-github',
    name: 'Deploy / GitHub',
    group: 'Transversal',
    blurb: 'Commit, push, Render',
    skill: 'deploy-github',
  },
  {
    id: 'cursor-token-economia',
    name: 'Economia de tokens',
    group: 'Transversal',
    blurb: 'Grep antes de ler, contexto mínimo',
    skill: 'cursor-token-economia',
  },
];

function parseFrontmatter(raw) {
  const m = String(raw || '').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: String(raw || '') };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (val === '>-' || val === '|') val = '';
    meta[key] = val.replace(/^["']|["']$/g, '');
  }
  // description multiline with >-
  if (!meta.description && /description:\s*>-/.test(m[1])) {
    const dm = m[1].match(/description:\s*>-\n((?:  .+\n?)+)/);
    if (dm) meta.description = dm[1].replace(/^  /gm, '').trim();
  }
  return { meta, body: m[2] || '' };
}

function readSkillMarkdown(skillId) {
  const file = path.join(SKILLS_ROOT, skillId, 'SKILL.md');
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function titleFromBtnId(id) {
  return String(id || '')
    .replace(/^btn-/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function listButtonSpecialists() {
  let dirs = [];
  try {
    dirs = fs.readdirSync(SKILLS_ROOT).filter((d) => d.startsWith('btn-'));
  } catch {
    return [];
  }
  const out = [];
  for (const id of dirs.sort()) {
    const raw = readSkillMarkdown(id);
    if (!raw) continue;
    const { meta } = parseFrontmatter(raw);
    const name =
      (meta.name && String(meta.name).replace(/^btn-/i, '').replace(/-/g, ' ')) ||
      titleFromBtnId(id);
    // Prefer human label from skill H1
    const h1 = raw.match(/^#\s+(.+)$/m);
    const label = h1 ? h1[1].replace(/^Botão:\s*/i, '').trim() : name;
    out.push({
      id,
      name: label.length > 48 ? `${label.slice(0, 45)}…` : label,
      group: 'Botões',
      blurb: (meta.description || 'Especialista deste botão do menu').slice(0, 120),
      skill: id,
    });
  }
  return out;
}

function listSpecialists() {
  const curated = CURATED.map((c) => ({ ...c }));
  const buttons = listButtonSpecialists();
  return [...curated, ...buttons];
}

function getSpecialist(id) {
  if (!id) return null;
  return listSpecialists().find((s) => s.id === id) || null;
}

function truncate(text, max) {
  const s = String(text || '');
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n\n…(skill truncada)`;
}

/**
 * Prompt completo enviado ao Cloud Agent (não aparece na UI).
 */
function buildActivationPrompt(specialist) {
  const raw = readSkillMarkdown(specialist.skill || specialist.id) || '';
  const skillBody = truncate(raw, 14000);
  return [
    `Você é o especialista "${specialist.name}" na intranet Fromtherm (Cloud Agent).`,
    '',
    'REGRAS OBRIGATÓRIAS:',
    '1. Siga a skill abaixo (e o arquivo .agents/skills/' + (specialist.skill || specialist.id) + '/SKILL.md no repo).',
    '2. Economia de tokens: grep/busca antes de ler; máx. 5 arquivos na 1ª rodada; NÃO leia menu_produto.js inteiro.',
    '3. Conflitos com colegas: altere só o necessário; não reescreva áreas não pedidas; se a main mudou, atualize/rebase mentalmente e evite sobrescrever trabalho alheio.',
    '4. Não faça commit/push sem pedido explícito do usuário.',
    '5. Português simples; diga onde ver na tela (menu, botão, modal).',
    '6. Fluxo: ENTENDER → EXPLORAR → IMPLEMENTAR → VALIDAR.',
    '7. SQL: use a API /api/dev-agent/sql com $INTRANET_PUBLIC_URL e $DEV_AGENT_MOBILE_TOKEN (não invente DATABASE_URL).',
    '',
    'O usuário acabou de te colocar nesta conversa. Confirme em UMA frase curta que está no papel "' +
      specialist.name +
      '" e aguarde a tarefa (não implemente nada ainda, a menos que a mensagem já traga a tarefa).',
    '',
    '=== SKILL ===',
    skillBody,
    '=== FIM SKILL ===',
  ].join('\n');
}

/**
 * Envolve o texto do usuário com o papel do especialista ativo.
 */
function buildUserPromptWithSpecialist(userText, specialist) {
  if (!specialist) return userText;
  const tip = [
    `[Especialista ativo: ${specialist.name} (id=${specialist.id})]`,
    `Continue estritamente neste papel. Skill: .agents/skills/${specialist.skill || specialist.id}/SKILL.md`,
    'Economize tokens; não mexa em módulos fora do escopo; evite conflitos de merge desnecessários.',
    '',
    'Pedido do usuário:',
    userText || '(sem texto — veja imagens se houver)',
  ].join('\n');
  return tip;
}

module.exports = {
  listSpecialists,
  getSpecialist,
  buildActivationPrompt,
  buildUserPromptWithSpecialist,
  CURATED,
};
