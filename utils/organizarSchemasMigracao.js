/**
 * Reorganização de schemas (idempotente).
 *
 * 1) Move tabelas entre schemas + VIEW no caminho antigo (DML compat).
 * 2) Renomeia schemas com aspas (Vendas→vendas, etc.).
 * 3) Funde schemas de produção em producao.
 *
 * ALTER/CREATE TABLE no código devem usar o schema novo.
 */

'use strict';

function qi(ident) {
  return `"${String(ident).replace(/"/g, '""')}"`;
}

async function schemaExists(client, schema) {
  const r = await client.query(`SELECT 1 FROM pg_namespace WHERE nspname = $1 LIMIT 1`, [schema]);
  return r.rowCount > 0;
}

async function listBaseTables(client, schema) {
  const r = await client.query(
    `SELECT c.relname AS name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind = 'r'
      ORDER BY 1`,
    [schema]
  );
  return r.rows.map((x) => x.name);
}

async function relationKind(client, schema, name) {
  const r = await client.query(
    `SELECT c.relkind
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2
      LIMIT 1`,
    [schema, name]
  );
  return r.rows[0]?.relkind || null;
}

async function ensureSchema(client, schema) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${qi(schema)}`);
}

async function ensureCompatView(client, fromSchema, fromName, toSchema, toName) {
  const destKind = await relationKind(client, toSchema, toName);
  if (destKind !== 'r') return false;

  const srcKind = await relationKind(client, fromSchema, fromName);
  if (srcKind === 'r') return false;
  // VIEW já existe: não dar CREATE OR REPLACE (AccessExclusiveLock trava o site)
  if (srcKind === 'v') return true;

  await ensureSchema(client, fromSchema);
  await client.query(
    `CREATE OR REPLACE VIEW ${qi(fromSchema)}.${qi(fromName)} AS
     SELECT * FROM ${qi(toSchema)}.${qi(toName)}`
  );
  return true;
}

async function countRows(client, schema, name) {
  const r = await client.query(
    `SELECT COUNT(*)::bigint AS n FROM ${qi(schema)}.${qi(name)}`
  );
  return BigInt(r.rows[0].n);
}

async function moveTableWithCompatView(client, fromSchema, tableName, toSchema, newName = tableName) {
  await ensureSchema(client, toSchema);

  let destKind = await relationKind(client, toSchema, newName);
  let srcKind = await relationKind(client, fromSchema, tableName);

  if (destKind === 'r' && srcKind === 'r') {
    const destN = await countRows(client, toSchema, newName);
    const srcN = await countRows(client, fromSchema, tableName);
    if (destN === 0n) {
      console.warn(
        `[schemas] destino vazio ${toSchema}.${newName}; movendo dados de ${fromSchema}.${tableName}`
      );
      await client.query(`DROP TABLE ${qi(toSchema)}.${qi(newName)} CASCADE`);
      destKind = null;
    } else if (srcN === 0n || srcN === destN || destN >= srcN) {
      // Destino (schema novo do código) prevalece. Contagens iguais = cópia
      // residual do merge; não pode throw (quebrava SAC/rotas no ensure).
      console.warn(
        `[schemas] conflito resolvido: mantém ${toSchema}.${newName} (${destN}), ` +
          `remove ${fromSchema}.${tableName} (${srcN}) e cria VIEW de compat`
      );
      await client.query(`DROP TABLE ${qi(fromSchema)}.${qi(tableName)} CASCADE`);
      await ensureCompatView(client, fromSchema, tableName, toSchema, newName);
      return 'dest-kept';
    } else {
      // Origem tem mais linhas — descarta destino vazio/parcial e move a origem
      console.warn(
        `[schemas] conflito: origem maior ${fromSchema}.${tableName} (${srcN}) > ` +
          `${toSchema}.${newName} (${destN}); movendo origem`
      );
      await client.query(`DROP TABLE ${qi(toSchema)}.${qi(newName)} CASCADE`);
      destKind = null;
    }
  }

  if (destKind === 'r') {
    await ensureCompatView(client, fromSchema, tableName, toSchema, newName);
    return 'already';
  }

  if (newName !== tableName) {
    const destOldName = await relationKind(client, toSchema, tableName);
    if (destOldName === 'r') {
      await client.query(
        `ALTER TABLE ${qi(toSchema)}.${qi(tableName)} RENAME TO ${qi(newName)}`
      );
      await ensureCompatView(client, fromSchema, tableName, toSchema, newName);
      return 'renamed';
    }
  }

  srcKind = await relationKind(client, fromSchema, tableName);
  if (srcKind !== 'r') {
    await ensureCompatView(client, fromSchema, tableName, toSchema, newName);
    return srcKind === 'v' ? 'view-only' : 'missing';
  }

  await client.query(
    `ALTER TABLE ${qi(fromSchema)}.${qi(tableName)} SET SCHEMA ${qi(toSchema)}`
  );

  if (newName !== tableName) {
    await client.query(
      `ALTER TABLE ${qi(toSchema)}.${qi(tableName)} RENAME TO ${qi(newName)}`
    );
  }

  await ensureCompatView(client, fromSchema, tableName, toSchema, newName);
  return 'moved';
}

async function moveFunctionsBetweenSchemas(client, fromSchema, toSchema) {
  if (!(await schemaExists(client, fromSchema))) return 0;
  await ensureSchema(client, toSchema);
  const r = await client.query(
    `SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = $1 AND p.prokind = 'f'`,
    [fromSchema]
  );
  let n = 0;
  for (const row of r.rows) {
    try {
      // Se já existe no destino com mesma assinatura, pula
      const exists = await client.query(
        `SELECT 1 FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = $1 AND p.proname = $2
            AND pg_get_function_identity_arguments(p.oid) = $3
          LIMIT 1`,
        [toSchema, row.proname, row.args]
      );
      if (exists.rowCount) continue;
      await client.query(
        `ALTER FUNCTION ${qi(fromSchema)}.${qi(row.proname)}(${row.args}) SET SCHEMA ${qi(toSchema)}`
      );
      n += 1;
    } catch (err) {
      console.warn(
        `[schemas] não moveu função ${fromSchema}.${row.proname}:`,
        err.message
      );
    }
  }
  return n;
}

/**
 * Se a tabela ficou no schema antigo (PascalCase) e o código usa o novo,
 * cria VIEW no schema novo apontando para o antigo (ponte temporária).
 */
async function ensureForwardBridgeView(client, fromSchema, tableName, toSchema) {
  const srcKind = await relationKind(client, fromSchema, tableName);
  if (srcKind !== 'r') return false;
  const destKind = await relationKind(client, toSchema, tableName);
  if (destKind === 'r') return false;
  await ensureSchema(client, toSchema);
  await client.query(
    `CREATE OR REPLACE VIEW ${qi(toSchema)}.${qi(tableName)} AS
     SELECT * FROM ${qi(fromSchema)}.${qi(tableName)}`
  );
  return true;
}

/**
 * Renomeia schema inteiro (tabelas + funções) e recria views no nome antigo.
 */
async function renameSchemaWithCompat(client, fromSchema, toSchema) {
  const fromOk = await schemaExists(client, fromSchema);
  const toOk = await schemaExists(client, toSchema);

  if (!fromOk && toOk) {
    await ensureSchema(client, fromSchema);
    const tables = await listBaseTables(client, toSchema);
    for (const t of tables) {
      await ensureCompatView(client, fromSchema, t, toSchema, t);
    }
    return { status: 'already', tables: tables.length };
  }

  if (!fromOk && !toOk) {
    await ensureSchema(client, toSchema);
    await ensureSchema(client, fromSchema);
    return { status: 'missing', tables: 0 };
  }

  if (fromOk && !toOk) {
    await client.query(`ALTER SCHEMA ${qi(fromSchema)} RENAME TO ${qi(toSchema)}`);
    await ensureSchema(client, fromSchema);
    const tables = await listBaseTables(client, toSchema);
    for (const t of tables) {
      await ensureCompatView(client, fromSchema, t, toSchema, t);
    }
    await moveFunctionsBetweenSchemas(client, fromSchema, toSchema);
    return { status: 'renamed', tables: tables.length };
  }

  // Ambos existem: mover tabelas restantes do from → to (uma a uma)
  const tables = await listBaseTables(client, fromSchema);
  let moved = 0;
  let bridged = 0;
  for (const t of tables) {
    try {
      const st = await moveTableWithCompatView(client, fromSchema, t, toSchema, t);
      if (st === 'moved' || st === 'renamed') moved += 1;
    } catch (err) {
      console.warn(`[schemas] merge ${fromSchema}.${t} → ${toSchema}:`, err.message);
      // Ponte para o código novo não quebrar enquanto houver conflito
      try {
        if (await ensureForwardBridgeView(client, fromSchema, t, toSchema)) bridged += 1;
      } catch (e2) {
        console.warn(`[schemas] bridge ${toSchema}.${t} falhou:`, e2.message);
      }
    }
  }
  await moveFunctionsBetweenSchemas(client, fromSchema, toSchema);

  // views de compat no schema antigo para o que já estava no destino
  const destTables = await listBaseTables(client, toSchema);
  for (const t of destTables) {
    await ensureCompatView(client, fromSchema, t, toSchema, t);
  }
  // se ainda sobrou tabela física no antigo, garanta bridge no novo
  for (const t of await listBaseTables(client, fromSchema)) {
    try {
      if (await ensureForwardBridgeView(client, fromSchema, t, toSchema)) bridged += 1;
    } catch (_) {
      /* ignore */
    }
  }
  return {
    status: moved || bridged ? 'merged' : 'already',
    tables: destTables.length,
    moved,
    bridged,
  };
}

/** Wrappers de funções Vendas → vendas (chamadas antigas continuam). */
async function ensureVendasFunctionWrappers(client) {
  if (!(await schemaExists(client, 'vendas'))) return;
  await ensureSchema(client, 'Vendas');

  // Só cria se a função real estiver em vendas
  const real = await client.query(
    `SELECT 1 FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'vendas' AND p.proname = 'pedidos_upsert_from_list'
      LIMIT 1`
  );
  if (!real.rowCount) return;

  await client.query(`
    CREATE OR REPLACE FUNCTION "Vendas".pedidos_upsert_from_list(payload jsonb)
    RETURNS bigint
    LANGUAGE sql
    AS $$ SELECT vendas.pedidos_upsert_from_list(payload) $$
  `);
  await client.query(`
    CREATE OR REPLACE FUNCTION "Vendas".pedido_upsert_from_payload(payload jsonb)
    RETURNS void
    LANGUAGE sql
    AS $$ SELECT vendas.pedido_upsert_from_payload(payload) $$
  `);
}

// --- Fase 1: moves pontuais (já aplicados localmente; idempotente) ---
const MOVES = [
  { from: 'funcionarios', table: 'epi', to: 'rh' },
  { from: 'funcionarios', table: 'epi_entrega', to: 'rh' },
  { from: 'funcionarios', table: 'conversas', to: 'rh' },
  { from: 'funcionarios', table: 'ferias', to: 'rh' },
  { from: 'funcionarios', table: 'ferias_anexos', to: 'rh' },
  { from: 'funcionarios', table: 'ferias_registros', to: 'rh' },

  { from: 'mensagens', table: 'ajustes_estoque', to: 'logistica' },
  { from: 'mensagens', table: 'transferencias', to: 'logistica' },

  { from: 'solicitacao_produto', table: 'itens_solicitados', to: 'logistica' },
  { from: 'solicitacao_produto', table: 'solicitacoes_separacao', to: 'logistica' },
  { from: 'solicitacao_produto', table: 'movimentacoes_kanban_itens', to: 'logistica' },
  { from: 'solicitacao_produto', table: 'registro_troca', to: 'logistica' },

  { from: 'envios', table: 'solicitacoes', to: 'sac', newName: 'envios_solicitacoes' },
  { from: 'envios', table: 'custo_pecas', to: 'sac', newName: 'envios_custo_pecas' },

  // Produção — fusão no schema producao (após rename de Producao)
  { from: 'Tempo_Producao', table: 'Registro_tempo', to: 'producao' },
  { from: 'Tempo_Producao', table: 'Turno_dia', to: 'producao' },
  { from: 'Tempo_Producao', table: 'Turno_padrao', to: 'producao' },
  { from: 'OrdemProducao', table: 'tab_op', to: 'producao' },
  { from: 'OrdemProducao', table: 'tab_op_anexos', to: 'producao' },
  { from: 'OrdemProducao', table: 'tab_op_imagens', to: 'producao' },
  { from: 'IAPP_API', table: 'op_iapp', to: 'producao' },
  { from: 'IAPP_API', table: 'op_iapp_os', to: 'producao' },
  { from: 'IAPP_API', table: 'op_iapp_os_parada', to: 'producao' },
  { from: 'IAPP_API', table: 'op_iapp_produto', to: 'producao' },
  { from: 'Tabelas', table: 'op_rastreabilidade', to: 'producao' },

  // Órfãos
  { from: 'auditoria_produto', table: 'historico_modificacoes', to: 'auditoria' },

  // --- public → módulos (auth/session/nav ficam no public) ---
  // produto (pai antes dos filhos com FK)
  { from: 'public', table: 'produtos', to: 'produto' },
  { from: 'public', table: 'produtos_omie', to: 'produto' },
  { from: 'public', table: 'produtos_omie_anexos', to: 'produto' },
  { from: 'public', table: 'produtos_omie_imagens', to: 'produto' },
  { from: 'public', table: 'produto_codigo_reserva', to: 'produto' },
  { from: 'public', table: 'produto_permissao', to: 'produto' },

  // omie
  { from: 'public', table: 'omie_locais_estoque', to: 'omie' },
  { from: 'public', table: 'omie_operacao', to: 'omie' },
  { from: 'public', table: 'omie_malha_cab', to: 'omie' },
  { from: 'public', table: 'omie_malha_item', to: 'omie' },
  { from: 'public', table: 'omie_estoque_posicao', to: 'omie' },
  { from: 'public', table: 'omie_webhook_events', to: 'omie' },

  // producao — OP legado / PCP / históricos
  { from: 'public', table: 'op_status', to: 'producao' },
  { from: 'public', table: 'op_raw', to: 'producao' },
  { from: 'public', table: 'op_ordens', to: 'producao' },
  { from: 'public', table: 'op_info', to: 'producao' },
  { from: 'public', table: 'op_event', to: 'producao' },
  { from: 'public', table: 'op_movimentos', to: 'producao' },
  { from: 'public', table: 'op_codigos_log', to: 'producao' },
  { from: 'public', table: 'op_etapa_kanban_map', to: 'producao' },
  { from: 'public', table: 'op_status_overlay', to: 'producao' },
  { from: 'public', table: 'pcp_personalizacao', to: 'producao' },
  { from: 'public', table: 'pcp_personalizacao_item', to: 'producao' },
  { from: 'public', table: 'historico_op_glide', to: 'producao' },
  { from: 'public', table: 'historico_op_glide_f_escopo', to: 'producao' },
  { from: 'public', table: 'historico_op_iapp', to: 'producao' },
  { from: 'public', table: 'historico_estrutura_iapp', to: 'producao' },

  // sac — controles AT legados
  { from: 'public', table: 'controle_assistencia_tecnica', to: 'sac' },
  { from: 'public', table: 'controle_at_fechamento', to: 'sac' },
  { from: 'public', table: 'controle_atendimento_rapido', to: 'sac' },

  // usuario / chatbot / vendas / configuracoes
  { from: 'public', table: 'usuario_preferencias', to: 'usuario' },
  { from: 'public', table: 'chat_messages', to: 'chatbot' },
  { from: 'public', table: 'user_message', to: 'chatbot' },
  { from: 'public', table: 'historico_pedido_originalis', to: 'vendas' },
  { from: 'public', table: 'historico_pre2024', to: 'vendas' },
  { from: 'public', table: 'agendamento_sincronizacao', to: 'configuracoes' },
];

/** Schemas inteiros: só renomear (sem fusão). Ordem: Producao primeiro (base do merge). */
const SCHEMA_RENAMES = [
  { from: 'Producao', to: 'producao' },
  { from: 'Vendas', to: 'vendas' },
  { from: 'Chatbot', to: 'chatbot' },
  { from: 'User', to: 'usuario' },
  { from: 'Suporte_tecnico', to: 'suporte' },
];

let _migracaoPromise = null;
let _migracaoDone = false;
let _migracaoResult = null;

/** Schemas que o código referencia — criar cedo para ensures de boot não falharem. */
const TARGET_SCHEMAS = [
  'produto',
  'producao',
  'vendas',
  'chatbot',
  'usuario',
  'suporte',
  'logistica',
  'sac',
  'rh',
  'omie',
  'compras',
  'engenharia',
  'qualidade',
  'configuracoes',
  'auditoria',
  'etiqueta',
  'frete',
  'masp',
  'iapp',
  'estrutura',
  'testes',
];

async function organizarSchemasMigracao(db) {
  if (!db) return { ok: false, reason: 'no-db' };
  // Uma vez por processo: rotas (SAC, vendas, transferências…) chamavam de novo
  // a cada request e travavam o Postgres com CREATE VIEW + pool esgotado.
  if (_migracaoDone) return _migracaoResult || { ok: true, skipped: true };
  if (_migracaoPromise) return _migracaoPromise;

  _migracaoPromise = (async () => {
    const ownsClient = typeof db.connect === 'function';
    const client = ownsClient ? await db.connect() : db;

    const results = [];
    const schemaResults = [];
    let droppedApkAt = false;
    let gotLock = false;
    // Sem transação global: uma falha (ex.: Chatbot com conflito) não pode
    // impedir a fusão de Vendas/Producao — isso quebrou o relatório em produção.
    try {
      // Só um serviço (Intranet / intranet-api) migra por vez
      try {
        const lock = await client.query(
          `SELECT pg_try_advisory_lock(87236401) AS ok`
        );
        gotLock = !!lock.rows[0]?.ok;
        if (!gotLock) {
          console.log('[schemas] outro processo já migra — só garante schemas vazios');
          for (const s of TARGET_SCHEMAS) {
            try { await ensureSchema(client, s); } catch (_) { /* ignore */ }
          }
          await new Promise((r) => setTimeout(r, 2000));
          _migracaoDone = true;
          _migracaoResult = { ok: true, skipped: true, reason: 'lock-held' };
          return _migracaoResult;
        }
      } catch (_) {
        /* sem advisory lock segue mesmo assim */
      }

      // 1º: schemas vazios — rotas que rodam ensure no require() não quebram
      // com "schema X does not exist" enquanto as tabelas ainda estão em public.
      for (const s of TARGET_SCHEMAS) {
        try {
          await ensureSchema(client, s);
        } catch (_) {
          /* ignore */
        }
      }

      for (const s of SCHEMA_RENAMES) {
        try {
          const r = await renameSchemaWithCompat(client, s.from, s.to);
          schemaResults.push({ from: s.from, to: s.to, ...r });
        } catch (err) {
          console.error(`[schemas] falha ao renomear/fundir ${s.from}→${s.to}:`, err.message);
          schemaResults.push({ from: s.from, to: s.to, status: 'error', error: err.message });
        }
      }

      for (const m of MOVES) {
        try {
          const status = await moveTableWithCompatView(
            client,
            m.from,
            m.table,
            m.to,
            m.newName || m.table
          );
          results.push({
            from: `${m.from}.${m.table}`,
            to: `${m.to}.${m.newName || m.table}`,
            status,
          });
        } catch (err) {
          console.error(
            `[schemas] falha ao mover ${m.from}.${m.table}:`,
            err.message
          );
          results.push({
            from: `${m.from}.${m.table}`,
            to: `${m.to}.${m.newName || m.table}`,
            status: 'error',
            error: err.message,
          });
        }
      }

      try {
        await ensureVendasFunctionWrappers(client);
      } catch (err) {
        console.warn('[schemas] wrappers Vendas:', err.message);
      }

      // Projeto antigo de jogos AT — não usado pela intranet
      try {
        if (await schemaExists(client, 'apk_at')) {
          await client.query(`DROP SCHEMA IF EXISTS apk_at CASCADE`);
          droppedApkAt = true;
          console.log('[schemas] removido schema apk_at (projeto antigo / não usado)');
        }
      } catch (err) {
        console.warn('[schemas] drop apk_at:', err.message);
      }

      // Comentários nos schemas (orientação no DBeaver / psql)
      const schemaComments = {
        rh: 'RH — colaboradores, cargos, férias, EPI, reservas, calendário',
        logistica: 'Logística — estoque, NF-e, separação, ajustes, transferências, kanban SEP',
        sac: 'SAC/AT — OS, WhatsApp, material, envios VIPP',
        compras: 'Compras — kanban, cotações, pedidos Omie',
        vendas: 'Vendas — pedidos, NF-e, relatório gerencial',
        producao: 'Produção — OP, kanban PCP, paradas, tempo, IAPP runtime',
        engenharia: 'Engenharia — códigos de erro, fichas, estrutura BOM',
        qualidade: 'Qualidade — RI, PIR, 1ª peça, lista mestra',
        chatbot: 'Chatbot — manuais, FAQ, conversas, memória',
        frete: 'Frete — tabelas, cotações, cobertura',
        etiqueta: 'Etiquetas — fila impressão, agentes, VIPP cache',
        configuracoes: 'Configurações — famílias, CFOP, versão sistema',
        omie: 'Omie — fornecedores, estoque, malha, webhooks, sync',
        produto: 'Produto — cadastro Omie, fotos, anexos, permissões',
        auditoria: 'Auditoria — histórico de modificações de produto',
        suporte: 'Suporte técnico — chamados internos da intranet',
        usuario: 'Usuário — preferências e atalhos',
        monitoramento: 'Monitoramento — sessões e eventos',
        masp: 'MASP — análise e ações',
        iapp: 'IAPP — fichas/histórico (docs); runtime OP em producao',
        estrutura: 'Estrutura IAPP auxiliar (ficha/sync)',
        envios: 'Compat — views para sac.envios_*',
        funcionarios: 'Compat — views para rh.*',
        mensagens: 'Compat — views para logistica.ajustes/transferencias',
        solicitacao_produto: 'Compat — views para logistica kanban SEP',
        testes: 'Testes de produção — leituras e relatórios',
        supervisorio_fromtherm: 'Supervisório Fromtherm — modelos/grupos',
        public: 'Núcleo — auth, sessão, menu (nav), cron; demais módulos saíram',
      };
      for (const [schema, comment] of Object.entries(schemaComments)) {
        try {
          if (await schemaExists(client, schema)) {
            const lit = `'${String(comment).replace(/'/g, "''")}'`;
            await client.query(`COMMENT ON SCHEMA ${qi(schema)} IS ${lit}`);
          }
        } catch (_) {
          /* ignore */
        }
      }
    } finally {
      if (gotLock) {
        try {
          await client.query(`SELECT pg_advisory_unlock(87236401)`);
        } catch (_) {
          /* ignore */
        }
      }
      if (ownsClient && client.release) client.release();
    }

    const moved = results.filter((r) => r.status === 'moved' || r.status === 'renamed').length;
    const renamedSchemas = schemaResults.filter((r) => r.status === 'renamed' || r.status === 'merged').length;
    if (moved > 0 || renamedSchemas > 0) {
      console.log(
        `[schemas] migração: ${moved} tabela(s), ${renamedSchemas} schema(s) renomeado(s)/fundido(s)`
      );
    }
    _migracaoDone = true;
    _migracaoResult = { ok: true, results, schemaResults, droppedApkAt };
    return _migracaoResult;
  })()
    .catch((err) => {
      // Falha: permite nova tentativa no próximo boot/request
      _migracaoDone = false;
      _migracaoResult = null;
      throw err;
    })
    .finally(() => {
      _migracaoPromise = null;
    });

  return _migracaoPromise;
}

async function ensureSchemasCompatViews(db) {
  if (!db) return;
  const ownsClient = typeof db.connect === 'function';
  const client = ownsClient ? await db.connect() : db;
  try {
    for (const s of SCHEMA_RENAMES) {
      if (!(await schemaExists(client, s.to))) continue;
      await ensureSchema(client, s.from);
      const tables = await listBaseTables(client, s.to);
      for (const t of tables) {
        await ensureCompatView(client, s.from, t, s.to, t);
      }
    }
    for (const m of MOVES) {
      await ensureCompatView(client, m.from, m.table, m.to, m.newName || m.table);
    }
    await ensureVendasFunctionWrappers(client);
  } finally {
    if (ownsClient && client.release) client.release();
  }
}

module.exports = {
  organizarSchemasMigracao,
  ensureSchemasCompatViews,
  MOVES,
  SCHEMA_RENAMES,
};
