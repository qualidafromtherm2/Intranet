/**
 * gerar-skills-botoes.js
 *
 * Lê a tabela nav_node do banco e gera/atualiza um SKILL.md em
 * .agents/skills/btn-<chave>/ para cada botão folha do menu.
 *
 * Uso:
 *   node scripts/gerar-skills-botoes.js
 *   node scripts/gerar-skills-botoes.js --dry-run   (mostra o que faria, sem escrever)
 *   node scripts/gerar-skills-botoes.js --force      (sobrescreve skills existentes)
 *
 * Requisito: DATABASE_URL no .env (usa dotenv automaticamente).
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs   = require('fs');
const path = require('path');

const SKILLS_DIR  = path.resolve(__dirname, '../.agents/skills');
const DRY_RUN     = process.argv.includes('--dry-run');
const FORCE       = process.argv.includes('--force');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

// ---------- helpers ----------

function kebab(str) {
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function skillDirName(key) {
  // ex: "side:logistica:armazens" → "btn-logistica-armazens"
  const parts = key.split(':').filter(p => p !== 'side' && p !== 'top');
  return 'btn-' + parts.map(kebab).join('-');
}

function buildSkill(node, parentLabel) {
  const selectorLine = node.selector
    ? `\`${node.selector}\``
    : '_(sem selector registrado)_';

  const grepSelector = node.selector
    ? `rg '${node.selector.replace(/^[.#]/, '')}' menu_produto.js menu_produto.html -n | head -20`
    : `rg '${kebab(node.label)}' menu_produto.js -n | head -20`;

  const categoria = parentLabel || node.position;

  return `---
name: btn-${kebab(node.label)}
description: >-
  Especialista no botão "${node.label}" do Intranet (${categoria}).
  Use quando a tarefa envolve "${node.label}", "${categoria}" ou qualquer
  alteração nesta seção do menu.
---

# Botão: ${node.label}

## Identificação

| Campo | Valor |
|-------|-------|
| **Categoria** | ${categoria} |
| **Nav key** | \`${node.key}\` |
| **Selector** | ${selectorLine} |

## Como encontrar o código (receita rápida)

\`\`\`bash
# 1 — Achar o handler do botão
${grepSelector}

# 2 — Ler ~60 linhas ao redor da linha encontrada para ver o painel que abre
# 3 — Achar chamadas API dentro do painel
rg "fetch\\('/api/" menu_produto.js -n | head -30
\`\`\`

## Fluxo padrão

1. **Selector** → clique no menu lateral abre um painel (ID \`#*Pane\` ou \`#*Content\`)
2. **Painel** → faz \`fetch('/api/...')\` → endpoint em \`routes/\` ou inline em \`server.js\`
3. **Modais** → funções \`abrir*Modal()\` invocadas dentro do painel

## Validação após alterar

- Front only → F5 no browser (porta 3001)
- API alterada → \`node --check server.js\` → \`pm2 restart intranet_api\`
`;
}

// ---------- main ----------

async function main() {
  const { rows } = await pool.query(`
    SELECT
      n.id,
      n.key,
      n.label,
      n.selector,
      n.position,
      n.parent_id,
      p.label AS parent_label
    FROM public.nav_node n
    LEFT JOIN public.nav_node p ON p.id = n.parent_id
    WHERE n.active = TRUE
    ORDER BY n.parent_id NULLS FIRST, n.sort, n.id
  `);

  // Identifica nós folha (sem filhos)
  const withChildren = new Set(rows.filter(r => r.parent_id).map(r => r.parent_id));
  const leaves = rows.filter(r => !withChildren.has(r.id));

  console.log(`\n📋 nav_node: ${rows.length} nós — ${leaves.length} folhas (botões)\n`);

  let criados = 0, pulados = 0, atualizados = 0;

  for (const node of leaves) {
    const dirName  = skillDirName(node.key);
    const dirPath  = path.join(SKILLS_DIR, dirName);
    const filePath = path.join(dirPath, 'SKILL.md');
    const jaExiste = fs.existsSync(filePath);

    if (jaExiste && !FORCE) {
      pulados++;
      continue;
    }

    const conteudo = buildSkill(node, node.parent_label);

    if (DRY_RUN) {
      console.log(`${jaExiste ? '↺' : '+'} ${dirName}  ← "${node.label}" (${node.key})`);
      if (!jaExiste) console.log(`  selector: ${node.selector || '—'}\n`);
      criados++;
      continue;
    }

    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(filePath, conteudo, 'utf8');

    if (jaExiste) { atualizados++; console.log(`↺  Atualizado: ${dirName}`); }
    else          { criados++;    console.log(`+  Criado:     ${dirName}   ("${node.label}")`); }
  }

  if (!DRY_RUN) {
    console.log(`\n✅ Concluído: ${criados} criados | ${atualizados} atualizados | ${pulados} já existentes (use --force para sobrescrever)\n`);
  } else {
    console.log(`\n🔍 Dry-run: ${criados} seriam criados/atualizados | ${pulados} já existentes\n`);
  }

  await pool.end();
}

main().catch(err => {
  console.error('Erro:', err.message);
  process.exit(1);
});
