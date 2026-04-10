/**
 * routes/ai_assistant.js
 * Integração com OpenAI ChatGPT — Assistente SGF
 */
const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { Pool } = require('pg');

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const REPORT_MAX_ROWS = 200;
const REPORT_TIMEOUT_MS = 12000;
const SCHEMA_CACHE_TTL_MS = 10 * 60 * 1000;
const AUTO_REPORT_PREVIEW_ROWS = 25;
const OPENAI_RETRY_DELAYS_MS = [700, 1800];

const UFS_BRASIL = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS',
  'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC',
  'SP', 'SE', 'TO'
]);

const dbConnectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
const dbPool = dbConnectionString
  ? new Pool({
      connectionString: dbConnectionString,
      ssl: { rejectUnauthorized: false }
    })
  : null;

let schemaCache = { expiresAt: 0, text: '' };

// ─── Prompt do sistema ────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Você é o Assistente SGF, um assistente inteligente da intranet SGF (Sistema de Gestão Fromtherm).
Você ajuda os colaboradores a navegar pelo sistema, tirar dúvidas sobre funcionalidades, abrir Ordens de Serviço (OS), iniciar solicitações de compra, consultar dados operacionais e apoiar o fluxo de reuniões/calendário.

## MÓDULOS DO SISTEMA:
- **Início**: Página principal com visão geral e atalhos.
- **Produto**: Cadastro e consulta de produtos — dados, estrutura, lista de peças, fotos, anexos, definições, últimas compras.
- **Engenharia**: Gestão de engenharia e projetos (Check-Proj).
- **Registros**: Histórico de alterações de produtos e dados do sistema.
- **Logística**: Controle de OPs (Ordens de Produção), Armazéns, Solicitação de transferência, Recebimento de materiais, Envio de mercadoria.
- **Qualidade (PIR)**: PIR de produtos — registro de inspeções e resultados de qualidade.
- **SAC → AT (Assistência Técnica)**: Abertura de OS (Ordem de Serviço) de assistência técnica ao cliente.
  Para abrir uma OS de AT, os dados necessários são:
  1. Tipo de atendimento: Qualidade | Comercial | Extensão de garantia | Atendimento rápido
  2. Nome do cliente / revenda (obrigatório)
  3. Número de série do produto (quando disponível)
  4. Descrição da reclamação / motivo do atendimento (obrigatório)
  5. Telefone de contato (opcional)
- **SAC → Solicitação de envio**: Solicitações de envio de peças ou produtos ao cliente.
- **SAC → Gráfico AT**: Gráficos de acompanhamento dos atendimentos técnicos.
- **Compras**: Produtos recebidos, configurações, Check-Compras.
  Fluxos de compras importantes:
  - Produto cadastrado na Omie: pode ir para carrinho/solicitação normalmente.
  - Produto não cadastrado: a solicitação pode ser aberta sem código, usando descrição/palavras-chave e demais campos do formulário.
  - Se o usuário não souber o código, isso NÃO bloqueia o processo. Primeiro descubra se o item é cadastrado, não cadastrado ou se precisa ser localizado pela descrição.
  - Sempre que fizer sentido, ofereça duas opções ao usuário: abrir a tela certa ou seguir diretamente pelo chat.
- **Agenda / Calendário de Reservas**: Reservas de auditório, sala de reunião, reunião online, visita, evento, lembretes, atas e notas de reunião.
  Dados importantes do calendário:
  - Reuniões e reservas usam o calendário mensal da intranet.
  - Lembretes usam destinatários vinculados ao usuário.
  - Atas e notas de reunião ficam vinculadas à reserva.
  - Para perguntas sobre reuniões, lembretes, atas, notas, participantes, calendário e reservas, prefira consultar dados do sistema em vez de responder no chute.
- **Recursos Humanos**: Cadastro de colaboradores, Aniversariantes, Configuração de cargos, Colaboradores RH.
- **Financeiro**: Módulo financeiro da empresa.
- **Sincronização**: Sincronização de produtos com o ERP Omie.

## AÇÕES SUPORTADAS (JSON):
Quando for necessário acionar algo na tela, responda EXCLUSIVAMENTE em JSON (sem texto adicional):

1) Navegar para módulo:
{"action":"navigate","data":{"target":"TARGET","note":"MENSAGEM_CURTA"}}

TARGET aceitos:
- inicio
- produto
- engenharia
- registros
- agenda
- estoque
- recebimento
- envio_mercadoria
- os
- sac_envio
- compras
- compras_config
- produto_recebido
- sincronizacao
- colaboradores
- grafico_at

2) Abrir OS no SAC/AT:
{"action":"open_os","data":{"tipo":"TIPO","cliente":"CLIENTE","serie":"SERIE","descricao":"DESCRICAO","telefone":"TELEFONE"}}

3) Iniciar solicitação de compra:
{"action":"open_purchase","data":{"modo":"omie|nao_cadastrada|nao_sei","codigo":"CODIGO","descricao":"DESCRICAO","quantidade":"QUANTIDADE","observacao":"OBSERVACAO","prazo_solicitado":"25/04/2026","departamento":"DEPARTAMENTO","categoria":"CATEGORIA","abrir_tela":true}}

4) Solicitar relatório SQL:
{"action":"sql_report","data":{"question":"PERGUNTA_CLARA_DO_RELATORIO"}}

5) Iniciar fluxo de reserva/reunião no calendário:
{"action":"open_meeting","data":{"data":"2026-04-08","tipo":"auditorio|sala_reuniao|reuniao_online|visita|evento","tema":"TEMA","inicio":"09:00","duracao_horas":"1","repetir":"sim|nao","cafe":"sim|nao","participantes":["usuario1","usuario2"]}}

## COMO ABRIR UMA OS (AT):
Quando o usuário quiser abrir uma Ordem de Serviço (OS), colete os seguintes dados em conversa natural:
1. **Tipo de atendimento** (Qualidade, Comercial, Extensão de garantia ou Atendimento rápido)
2. **Nome do cliente** ou revenda
3. **Número de série** do produto (se houver)
4. **Descrição/reclamação** do problema

Após coletar todos os dados obrigatórios (tipo, cliente, descrição), responda com a ação "open_os".

Campos opcionais podem ser string vazia ("") quando não informados.

## REGRAS DE COMPORTAMENTO:
- Responda sempre em português brasileiro (informal mas profissional).
- Seja objetivo e amigável.
- Se não souber algo específico do sistema, diga que não tem essa informação e sugira contatar o suporte de TI.
- Não invente funcionalidades que não existem no sistema.
- Para dúvidas não relacionadas ao SGF, diga educadamente que só pode ajudar com o sistema.
- Para relatórios de dados do sistema, use "sql_report" em vez de inventar números.
- Para perguntas sobre reuniões, calendário, reservas, atas, lembretes e notas, use "sql_report" quando o usuário estiver consultando dados.
- Para compras, nunca diga que o processo é impossível só porque o usuário não sabe o código do produto.
- Para compras, se faltarem dados, faça perguntas curtas e guiadas em vez de devolver uma lista rígida de campos.
- Para compras, faça uma pergunta por vez e, quando ajudar, ofereça opções numeradas como 1, 2 e 3.
- Para datas de compras, aceite formato brasileiro como 25/04/2026; não exija que o usuário já envie em AAAA-MM-DD.
- Para marcar/agendar/reservar reunião, auditório, sala ou reunião online, use "open_meeting" quando fizer sentido abrir o fluxo operacional.
`;

const SQL_REPORT_PROMPT = `Você converte perguntas de negócio em SQL PostgreSQL SOMENTE LEITURA.
Retorne SEMPRE um JSON estrito com este formato:
{"title":"TITULO_CURTO","sql":"SELECT ...","explanation":"explicação curta","assumptions":["item 1","item 2"]}

Regras obrigatórias:
- Um único comando SQL.
- Apenas SELECT ou WITH ... SELECT.
- Nunca use INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, CREATE, GRANT, REVOKE, COPY, DO, EXECUTE.
- Nunca inclua ponto e vírgula no fim.
- Sempre inclua LIMIT <= 200.
- Use somente tabelas e colunas presentes no schema informado.
- Quando houver ambiguidade, escolha o caminho mais conservador e descreva em assumptions.
`;

function normalizarTextoBusca(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateText(value, max = 80) {
  const txt = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (!txt) return '∅';
  return txt.length > max ? `${txt.slice(0, max - 3)}...` : txt;
}

function extrairPerguntaUsuario(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      return String(messages[i]?.content || '').trim();
    }
  }
  return '';
}

function perguntaPedeConsultaDados(pergunta) {
  const t = normalizarTextoBusca(pergunta);
  if (!t) return false;

  if (
    t.length <= 40 &&
    /^(1|2|3|sim|nao|não|nao sei|não sei|cadastrado|produto cadastrado|nao cadastrado|não cadastrado|nao possui cadastro|não possui cadastro|nao tem cadastro|não tem cadastro|sem cadastro|possui cadastro|tem cadastro)$/.test(t)
  ) {
    return false;
  }

  // Fluxos operacionais (abrir/preencher/criar) devem continuar no fluxo normal do chat.
  if (
    /\b(abrir|criar|iniciar|preencher|enviar|registrar|lancar|lancar)\b/.test(t) &&
    /\b(os|ordem de servico|compra|solicitacao)\b/.test(t)
  ) {
    return false;
  }

  if (
    /\b(quero|preciso|vou|desejo|fazer|realizar|comprar)\b/.test(t) &&
    /\b(compra|compras|comprar|solicitacao|solicitacao de compra)\b/.test(t)
  ) {
    return false;
  }

  if (
    /\b(agendar|marcar|reservar|criar|abrir|iniciar)\b/.test(t) &&
    /\b(reuniao|reunioes|agenda|calendario|reserva|reservas|audit[oó]rio|auditorio|sala|lembrete|evento|visita)\b/.test(t)
  ) {
    return false;
  }

  if (/^como\b/.test(t)) return false;

  const sinaisConsulta = [
    'qual',
    'quais',
    'quem',
    'quant',
    'total',
    'ultima',
    'ultimas',
    'listar',
    'lista',
    'buscar',
    'busca',
    'localizar',
    'encontrar',
    'mostra',
    'mostrar',
    'traga',
    'status',
    'em aberto',
    'fechad',
    'tecnico',
    'tecnicos',
    'codigo',
    'código',
    'produto',
    'produtos',
    'compra',
    'compras',
    'pedido',
    'pedidos',
    'cotacao',
    'cotação',
    'requisicao',
    'requisição',
    'requisicoes',
    'fornecedor',
    'os',
    'ordem de servico',
    'relatorio',
    'indicador',
    'reuniao',
    'reunioes',
    'agenda',
    'calendario',
    'reserva',
    'reservas',
    'lembrete',
    'lembretes',
    'ata',
    'atas',
    'nota',
    'notas',
    'participante',
    'participantes'
  ];
  return sinaisConsulta.some((s) => t.includes(s));
}

function extrairUfPergunta(pergunta) {
  const upper = String(pergunta || '').toUpperCase();
  const matches = upper.match(/\b[A-Z]{2}\b/g) || [];
  for (const m of matches) {
    if (UFS_BRASIL.has(m)) return m;
  }
  return null;
}

function formatarDataPtBr(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString('pt-BR');
}

function resolverUsuarioAssistente(req) {
  const user = req?.session?.user || {};
  const candidato = user.username || user.login || user.fullName || user.id || null;
  return String(candidato || '').trim() || null;
}

function resolverIdentificadoresAssistente(req) {
  const user = req?.session?.user || {};
  const candidatos = [user.username, user.login, user.fullName, user.id]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .map((item) => item.toLowerCase());
  return Array.from(new Set(candidatos));
}

function formatarDataIsoLocal(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const ano = date.getFullYear();
  const mes = String(date.getMonth() + 1).padStart(2, '0');
  const dia = String(date.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function obterDataAtualSaoPaulo() {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const ano = Number(partes.find((p) => p.type === 'year')?.value || 0);
  const mes = Number(partes.find((p) => p.type === 'month')?.value || 0);
  const dia = Number(partes.find((p) => p.type === 'day')?.value || 0);
  const dt = new Date(ano, mes - 1, dia);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function extrairDataAgenda(pergunta) {
  const txt = String(pergunta || '').trim();
  const normalizado = normalizarTextoBusca(txt);
  const hoje = obterDataAtualSaoPaulo();

  if (normalizado.includes('amanha') || normalizado.includes('amanhã')) {
    const amanha = new Date(hoje);
    amanha.setDate(amanha.getDate() + 1);
    return formatarDataIsoLocal(amanha);
  }
  if (normalizado.includes('hoje')) {
    return formatarDataIsoLocal(hoje);
  }

  let match = txt.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (match) {
    const ano = Number(match[1]);
    const mes = Number(match[2]);
    const dia = Number(match[3]);
    const dt = new Date(ano, mes - 1, dia);
    if (dt.getFullYear() === ano && dt.getMonth() === mes - 1 && dt.getDate() === dia) {
      return formatarDataIsoLocal(dt);
    }
  }

  match = txt.match(/\b(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?\b/);
  if (match) {
    let ano = match[3] ? Number(match[3]) : hoje.getFullYear();
    if (ano < 100) ano += 2000;
    const mes = Number(match[2]);
    const dia = Number(match[1]);
    const dt = new Date(ano, mes - 1, dia);
    if (dt.getFullYear() === ano && dt.getMonth() === mes - 1 && dt.getDate() === dia) {
      return formatarDataIsoLocal(dt);
    }
  }

  return '';
}

function perguntaPedeAgendaPessoal(pergunta) {
  const t = normalizarTextoBusca(pergunta);
  if (!t) return false;

  const temAutorreferencia =
    /\b(tenho|minha|minhas|meu|meus|pra mim|para mim|eu tenho|eu)\b/.test(t);
  const temTermoAgenda =
    /\b(reuniao|reunioes|agenda|calendario|reserva|reservas|lembrete|lembretes)\b/.test(t);

  return temAutorreferencia && temTermoAgenda;
}

function formatarRelatorioTexto({ title, explanation, assumptions, columns, rows, rowCount }) {
  const linhas = [];
  linhas.push(`📊 ${title || 'Relatório SQL'}`);
  if (explanation) linhas.push(explanation);
  if (Array.isArray(assumptions) && assumptions.length) {
    linhas.push(`Premissas: ${assumptions.join(' | ')}`);
  }
  linhas.push(`Linhas retornadas: ${Number(rowCount || 0)}`);

  if (!Array.isArray(columns) || !columns.length || !Array.isArray(rows) || !rows.length) {
    linhas.push('Nenhum dado encontrado para os filtros informados.');
    return linhas.join('\n');
  }

  const preview = rows.slice(0, AUTO_REPORT_PREVIEW_ROWS);
  linhas.push('');
  linhas.push(columns.join(' | '));
  linhas.push(columns.map(() => '---').join(' | '));

  for (const row of preview) {
    const values = columns.map((c) => truncateText(row?.[c], 80));
    linhas.push(values.join(' | '));
  }

  if (rows.length > preview.length) {
    linhas.push(`... +${rows.length - preview.length} linha(s)`);
  }

  return linhas.join('\n');
}

function logAiChatInfo(etapa, detalhes = {}) {
  console.log(`[AI/Chat] ${etapa}`, detalhes);
}

function logAiReportInfo(etapa, detalhes = {}) {
  console.log(`[AI/Report] ${etapa}`, detalhes);
}

function normalizarErroOpenAI(err) {
  const status = err?.response?.status;
  const code = err?.response?.data?.error?.code;

  if (status === 401) {
    return { httpStatus: 502, mensagem: 'Chave de API inválida. Contate o administrador.' };
  }
  if (status === 429 && code === 'insufficient_quota') {
    return { httpStatus: 429, mensagem: 'Créditos da API OpenAI esgotados. Atualize o faturamento para continuar.' };
  }
  if (status === 429) {
    return { httpStatus: 429, mensagem: 'Limite de requisições atingido. Aguarde um momento e tente novamente.' };
  }
  return { httpStatus: 502, mensagem: 'Erro ao comunicar com o serviço de IA. Tente novamente.' };
}

function responderErroOpenAI(res, err, contexto = 'AI') {
  const norm = normalizarErroOpenAI(err);
  if (norm.httpStatus >= 500) {
    console.error(`[${contexto}] Erro ao chamar OpenAI:`, err?.response?.data || err?.message || err);
  }
  return res.status(norm.httpStatus).json({ error: norm.mensagem });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function erroOpenAiEhTransitorio(err) {
  const status = Number(err?.response?.status || 0);
  const type = String(err?.response?.data?.error?.type || '').trim().toLowerCase();
  const code = String(err?.code || '').trim().toUpperCase();

  if (status >= 500) return true;
  if (type === 'server_error') return true;
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ECONNRESET') return true;
  return false;
}

async function chamarOpenAiComRetry(apiKey, payload, { timeout = 30000, contexto = 'AI/OpenAI' } = {}) {
  let ultimaFalha = null;

  for (let tentativa = 0; tentativa <= OPENAI_RETRY_DELAYS_MS.length; tentativa += 1) {
    try {
      return await axios.post(
        OPENAI_URL,
        payload,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout
        }
      );
    } catch (err) {
      ultimaFalha = err;
      const podeTentarNovamente = tentativa < OPENAI_RETRY_DELAYS_MS.length && erroOpenAiEhTransitorio(err);
      if (!podeTentarNovamente) break;

      const delayMs = OPENAI_RETRY_DELAYS_MS[tentativa];
      console.warn(`[${contexto}] Falha transitória na OpenAI; retry ${tentativa + 1}/${OPENAI_RETRY_DELAYS_MS.length} em ${delayMs}ms`, {
        status: err?.response?.status || null,
        type: err?.response?.data?.error?.type || null,
        code: err?.code || null,
        message: err?.response?.data?.error?.message || err?.message || null
      });
      await sleep(delayMs);
    }
  }

  throw ultimaFalha;
}

function extrairJsonObjeto(texto) {
  const raw = String(texto || '').trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (_) {
    const ini = raw.indexOf('{');
    const fim = raw.lastIndexOf('}');
    if (ini < 0 || fim <= ini) return null;
    try {
      return JSON.parse(raw.slice(ini, fim + 1));
    } catch {
      return null;
    }
  }
}

function normalizarSql(sql) {
  return String(sql || '').trim().replace(/;+$/g, '').trim();
}

function aplicarLimiteSql(sql, maxRows = REPORT_MAX_ROWS) {
  const matchLimit = sql.match(/\blimit\s+(\d+)\b/i);
  if (!matchLimit) {
    return `${sql}\nLIMIT ${maxRows}`;
  }
  const atual = Number(matchLimit[1] || 0);
  if (!Number.isFinite(atual) || atual <= 0 || atual > maxRows) {
    return sql.replace(/\blimit\s+\d+\b/i, `LIMIT ${maxRows}`);
  }
  return sql;
}

function validarSqlSomenteLeitura(sql) {
  if (!sql) return 'SQL vazio.';
  if (sql.includes(';')) return 'A consulta deve conter apenas um comando.';
  if (!/^\s*(select|with)\b/i.test(sql)) return 'A consulta deve iniciar com SELECT ou WITH.';
  if (/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|comment|copy|call|do|execute|prepare|deallocate|vacuum|analyze|refresh|reindex|cluster|listen|notify|unlisten)\b/i.test(sql)) {
    return 'A consulta contém comandos não permitidos.';
  }
  if (/\bpg_sleep\s*\(/i.test(sql)) return 'A consulta contém função não permitida.';
  return null;
}

async function obterSchemaTexto() {
  if (!dbPool) {
    throw new Error('Conexão com banco não configurada para relatórios SQL.');
  }

  const agora = Date.now();
  if (schemaCache.text && schemaCache.expiresAt > agora) {
    return schemaCache.text;
  }

  const { rows } = await dbPool.query(`
    SELECT c.table_schema, c.table_name, c.column_name, c.data_type
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema
       AND t.table_name   = c.table_name
     WHERE c.table_schema NOT IN ('information_schema', 'pg_catalog')
       AND t.table_type IN ('BASE TABLE', 'VIEW')
     ORDER BY c.table_schema, c.table_name, c.ordinal_position
  `);

  const porTabela = new Map();
  for (const r of rows) {
    const chave = `${r.table_schema}.${r.table_name}`;
    if (!porTabela.has(chave)) porTabela.set(chave, []);
    porTabela.get(chave).push(`${r.column_name}:${r.data_type}`);
  }

  const tabelasPrioritarias = new Set([
    'rh.reservas_ambientes',
    'rh.reservas_participantes',
    'rh.atas_reuniao',
    'rh.lembretes_calendario',
    'rh.lembretes_destinatarios',
    'rh.notas_reuniao',
    'public.auth_user'
  ]);

  const entradas = Array.from(porTabela.entries()).sort(([tabelaA], [tabelaB]) => {
    const aPrioritaria = tabelasPrioritarias.has(tabelaA);
    const bPrioritaria = tabelasPrioritarias.has(tabelaB);
    if (aPrioritaria && !bPrioritaria) return -1;
    if (!aPrioritaria && bPrioritaria) return 1;
    return tabelaA.localeCompare(tabelaB, 'pt-BR');
  });
  const limiteTabelas = 260;
  const linhas = entradas.slice(0, limiteTabelas).map(([tabela, colunas]) => {
    const cols = colunas.slice(0, 60).join(', ');
    const sufixoCols = colunas.length > 60 ? ', ...' : '';
    return `- ${tabela} (${cols}${sufixoCols})`;
  });

  if (entradas.length > limiteTabelas) {
    linhas.push(`- ... ${entradas.length - limiteTabelas} tabela(s) omitida(s) para caber no contexto`);
  }

  const texto = linhas.join('\n');
  schemaCache = {
    text: texto,
    expiresAt: agora + SCHEMA_CACHE_TTL_MS
  };
  return texto;
}

async function gerarPlanoSql(apiKey, pergunta) {
  const schemaTexto = await obterSchemaTexto();
  const response = await chamarOpenAiComRetry(
    apiKey,
    {
      model: 'gpt-4o-mini',
      temperature: 0.1,
      max_tokens: 900,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SQL_REPORT_PROMPT },
        {
          role: 'user',
          content:
`Pergunta do usuário:
${pergunta}

Schema disponível:
${schemaTexto}`
        }
      ]
    },
    { timeout: 40000, contexto: 'AI/Report/OpenAI' }
  );

  const content = response.data?.choices?.[0]?.message?.content || '{}';
  const json = extrairJsonObjeto(content) || {};
  return {
    title: String(json.title || 'Relatório SQL').trim(),
    sql: String(json.sql || '').trim(),
    explanation: String(json.explanation || '').trim(),
    assumptions: Array.isArray(json.assumptions)
      ? json.assumptions.map(v => String(v || '').trim()).filter(Boolean).slice(0, 5)
      : []
  };
}

async function executarSqlSeguro(sql, params = []) {
  if (!dbPool) {
    throw new Error('Conexão com banco não configurada para relatórios SQL.');
  }
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = '${REPORT_TIMEOUT_MS}ms'`);
    await client.query('SET LOCAL default_transaction_read_only = on');
    const resultado = await client.query(sql, params);
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function tentarConsultaDiretaConhecida(pergunta, req) {
  const t = normalizarTextoBusca(pergunta);
  if (!t || !dbPool) return null;

  if (perguntaPedeAgendaPessoal(pergunta)) {
    const identificadores = resolverIdentificadoresAssistente(req);
    const dataAgenda = extrairDataAgenda(pergunta) || formatarDataIsoLocal(new Date());

    if (identificadores.length) {
      const termosLembrete = /\b(lembrete|lembretes)\b/.test(t);
      const termosReuniao = /\b(reuniao|reunioes|agenda|calendario|reserva|reservas)\b/.test(t);

      if (termosReuniao) {
        const resultado = await executarSqlSeguro(
          `
          WITH alvo AS (
            SELECT
              $1::date AS dia,
              (ARRAY['dom','seg','ter','qua','qui','sex','sab'])[EXTRACT(DOW FROM $1::date)::int + 1] AS sigla
          )
          SELECT
            r.id,
            r.tipo_espaco,
            r.tema_reuniao,
            TO_CHAR(a.dia, 'YYYY-MM-DD') AS data_ocorrencia,
            TO_CHAR(r.hora_inicio, 'HH24:MI') AS inicio,
            TO_CHAR(r.hora_fim, 'HH24:MI') AS fim,
            r.criado_por,
            COALESCE(array_agg(DISTINCT p.username ORDER BY p.username)
              FILTER (WHERE p.username IS NOT NULL), ARRAY[]::text[]) AS participantes
          FROM rh.reservas_ambientes r
          CROSS JOIN alvo a
          LEFT JOIN rh.reservas_participantes p ON p.reserva_id = r.id
          WHERE (
            (
              r.repetir = false
              AND r.data_reserva = a.dia
            )
            OR (
              r.repetir = true
              AND (r.repetir_todos_meses = true OR EXTRACT(MONTH FROM r.data_reserva) = EXTRACT(MONTH FROM a.dia))
              AND a.sigla = ANY(COALESCE(r.dias_semana, ARRAY[]::text[]))
              AND NOT (a.dia = ANY(COALESCE(r.datas_excecao, ARRAY[]::date[])))
            )
          )
          AND (
            lower(COALESCE(r.criado_por, '')) = ANY($2::text[])
            OR EXISTS (
              SELECT 1
                FROM rh.reservas_participantes px
               WHERE px.reserva_id = r.id
                 AND lower(px.username) = ANY($2::text[])
            )
          )
          GROUP BY r.id, r.tipo_espaco, r.tema_reuniao, a.dia, r.hora_inicio, r.hora_fim, r.criado_por
          ORDER BY r.hora_inicio ASC, r.id ASC
          LIMIT 50
          `,
          [dataAgenda, identificadores]
        );

        const rows = Array.isArray(resultado.rows) ? resultado.rows : [];
        if (rows.length) {
          const cabecalho = [
            `📅 Suas reuniões em ${formatarDataPtBr(dataAgenda)}: ${rows.length} encontrada(s).`
          ];
          const detalhes = rows.map((r) => {
            const participantes = Array.isArray(r.participantes) ? r.participantes.join(', ') : '';
            return [
              `- ${truncateText(r.tema_reuniao, 120)}`,
              `  Tipo: ${truncateText(r.tipo_espaco, 40)}`,
              `  Horário: ${truncateText(r.inicio, 10)} às ${truncateText(r.fim, 10)}`,
              `  Criado por: ${truncateText(r.criado_por, 60)}`,
              participantes ? `  Participantes: ${truncateText(participantes, 160)}` : null
            ].filter(Boolean).join('\n');
          });
          return [...cabecalho, ...detalhes].join('\n');
        }

        return `Você não tem reuniões registradas para ${formatarDataPtBr(dataAgenda)}.`;
      }

      if (termosLembrete) {
        const resultado = await executarSqlSeguro(
          `
          SELECT
            l.id,
            TO_CHAR(l.data_lembrete, 'YYYY-MM-DD') AS data_lembrete,
            l.texto,
            l.criado_por,
            COALESCE(array_agg(DISTINCT d.username ORDER BY d.username)
              FILTER (WHERE d.username IS NOT NULL), ARRAY[]::text[]) AS destinatarios
          FROM rh.lembretes_calendario l
          LEFT JOIN rh.lembretes_destinatarios d ON d.lembrete_id = l.id
          WHERE l.data_lembrete = $1::date
            AND EXISTS (
              SELECT 1
                FROM rh.lembretes_destinatarios dx
               WHERE dx.lembrete_id = l.id
                 AND lower(dx.username) = ANY($2::text[])
            )
          GROUP BY l.id, l.data_lembrete, l.texto, l.criado_por
          ORDER BY l.id ASC
          LIMIT 50
          `,
          [dataAgenda, identificadores]
        );

        const rows = Array.isArray(resultado.rows) ? resultado.rows : [];
        if (rows.length) {
          const linhas = [
            `📝 Seus lembretes em ${formatarDataPtBr(dataAgenda)}: ${rows.length} encontrado(s).`
          ];
          rows.forEach((r) => {
            linhas.push(`- ${truncateText(r.texto, 180)}`);
          });
          return linhas.join('\n');
        }

        return `Você não tem lembretes para ${formatarDataPtBr(dataAgenda)}.`;
      }
    }
  }

  // Ex.: "qual a ultima os aberta?"
  if (t.includes('ultima os') || t.includes('ultima ordem de servico') || t.includes('ultima ordem de serviço')) {
    const resultado = await executarSqlSeguro(`
      SELECT id, data, status, tipo, nome_revenda_cliente, cidade, estado, agendar_atendimento_com
        FROM sac.at
       ORDER BY id DESC
       LIMIT 1
    `);
    const os = resultado.rows?.[0];
    if (!os) {
      return 'Não encontrei OS cadastrada na tabela sac.at.';
    }
    return [
      '📌 Última OS cadastrada:',
      `Nº OS: ${os.id}`,
      `Data: ${formatarDataPtBr(os.data) || '∅'}`,
      `Status: ${truncateText(os.status, 120)}`,
      `Tipo: ${truncateText(os.tipo, 120)}`,
      `Cliente/Revenda: ${truncateText(os.nome_revenda_cliente, 120)}`,
      `Cidade/UF: ${truncateText(os.cidade, 80)} / ${truncateText(os.estado, 20)}`,
      `Técnico/Agendamento: ${truncateText(os.agendar_atendimento_com, 120)}`
    ].join('\n');
  }

  // Ex.: "qual tecnico de campo tem em SC?"
  if (t.includes('tecnico')) {
    const uf = extrairUfPergunta(pergunta);
    const params = [];
    let where = '';
    if (uf) {
      params.push(uf);
      where = `WHERE upper(coalesce(uf, '')) = $1`;
    }

    const resultado = await executarSqlSeguro(`
      SELECT id, nome, municipio, uf, celular, tipo, qtd_atend_ult_1_ano, tempo_medio
        FROM sac.controle_tecnicos
        ${where}
       ORDER BY nome ASC
       LIMIT 100
    `, params);

    const rows = resultado.rows || [];
    if (!rows.length) {
      return uf
        ? `Não encontrei técnicos cadastrados em ${uf} na tabela sac.controle_tecnicos.`
        : 'Não encontrei técnicos cadastrados na tabela sac.controle_tecnicos.';
    }

    const linhas = [
      `👷 Técnicos${uf ? ` em ${uf}` : ''}: ${rows.length} encontrado(s).`
    ];
    for (const r of rows.slice(0, 25)) {
      linhas.push(
        `- ${truncateText(r.nome, 80)} | ${truncateText(r.municipio, 60)}/${truncateText(r.uf, 8)} | Cel: ${truncateText(r.celular, 24)} | Tipo: ${truncateText(r.tipo, 40)}`
      );
    }
    if (rows.length > 25) linhas.push(`... +${rows.length - 25} técnico(s)`);
    return linhas.join('\n');
  }

  return null;
}

async function tentarResponderComSqlAuto({ apiKey, pergunta, req }) {
  if (!dbPool || !perguntaPedeConsultaDados(pergunta)) return null;

  // 1) Atalhos determinísticos para perguntas recorrentes
  const direta = await tentarConsultaDiretaConhecida(pergunta, req);
  if (direta) return direta;

  // 2) Geração SQL assistida por IA para perguntas gerais de dados
  const plano = await gerarPlanoSql(apiKey, pergunta);
  let sql = normalizarSql(plano.sql);
  sql = aplicarLimiteSql(sql, REPORT_MAX_ROWS);

  const erroValidacao = validarSqlSomenteLeitura(sql);
  if (erroValidacao) return null;

  const resultado = await executarSqlSeguro(sql);
  const columns = (resultado.fields || []).map((f) => f.name);
  const rows = Array.isArray(resultado.rows) ? resultado.rows : [];

  return formatarRelatorioTexto({
    title: plano.title || 'Relatório SQL',
    explanation: plano.explanation || '',
    assumptions: plano.assumptions || [],
    columns,
    rows,
    rowCount: Number(resultado.rowCount || rows.length || 0)
  });
}

// ─── POST /api/ai/chat ────────────────────────────────────────────────────────
router.post('/chat', express.json({ limit: '50kb' }), async (req, res) => {
  const { messages } = req.body || {};
  const startedAt = Date.now();

  if (!Array.isArray(messages) || messages.length === 0) {
    logAiChatInfo('payload-invalido', { motivo: 'messages_ausente_ou_vazio' });
    return res.status(400).json({ error: 'Campo messages é obrigatório.' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logAiChatInfo('nao-configurado', { motivo: 'OPENAI_API_KEY_ausente' });
    return res.status(503).json({ error: 'Serviço de IA não configurado. Contate o administrador do sistema.' });
  }

  // Sanitiza: mantém apenas as últimas 25 mensagens, limita tamanho do conteúdo
  const sanitizedMessages = messages.slice(-25).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 2000)
  }));

  const perguntaAtual = extrairPerguntaUsuario(sanitizedMessages);
  logAiChatInfo('inicio', {
    totalMessages: sanitizedMessages.length,
    lastUserChars: perguntaAtual.length
  });

  if (perguntaAtual && dbPool) {
    try {
      const respostaSql = await tentarResponderComSqlAuto({ apiKey, pergunta: perguntaAtual, req });
      if (respostaSql) {
        logAiChatInfo('sucesso-auto-sql', {
          duracaoMs: Date.now() - startedAt,
          respostaChars: respostaSql.length
        });
        return res.json({ content: respostaSql });
      }
    } catch (errSqlAuto) {
      console.warn('[AI/Chat] Fallback para modo conversa (auto-SQL falhou):', errSqlAuto?.message || errSqlAuto);
    }
  }

  try {
    const response = await chamarOpenAiComRetry(
      apiKey,
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...sanitizedMessages
        ],
        max_tokens: 600,
        temperature: 0.4
      },
      { timeout: 30000, contexto: 'AI/Chat/OpenAI' }
    );

    const content = response.data.choices[0]?.message?.content || '';
    logAiChatInfo('sucesso-openai', {
      duracaoMs: Date.now() - startedAt,
      respostaChars: content.length
    });
    return res.json({ content });

  } catch (err) {
    return responderErroOpenAI(res, err, 'AI/Chat');
  }
});

// ─── POST /api/ai/report ──────────────────────────────────────────────────────
router.post('/report', express.json({ limit: '30kb' }), async (req, res) => {
  const question = String(req.body?.question || '').trim().slice(0, 1200);
  const startedAt = Date.now();
  if (!question) {
    logAiReportInfo('payload-invalido', { motivo: 'question_vazia' });
    return res.status(400).json({ ok: false, error: 'Pergunta do relatório é obrigatória.' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logAiReportInfo('nao-configurado', { motivo: 'OPENAI_API_KEY_ausente' });
    return res.status(503).json({ ok: false, error: 'Serviço de IA não configurado. Contate o administrador do sistema.' });
  }
  if (!dbPool) {
    logAiReportInfo('sem-banco', { motivo: 'DATABASE_URL_ausente' });
    return res.status(503).json({ ok: false, error: 'Banco de dados não configurado para relatórios SQL.' });
  }

  logAiReportInfo('inicio', { questionChars: question.length });

  try {
    const plano = await gerarPlanoSql(apiKey, question);
    let sql = normalizarSql(plano.sql);
    sql = aplicarLimiteSql(sql, REPORT_MAX_ROWS);

    const erroValidacao = validarSqlSomenteLeitura(sql);
    if (erroValidacao) {
      logAiReportInfo('sql-inseguro', { motivo: erroValidacao });
      return res.status(400).json({ ok: false, error: `Não foi possível gerar SQL seguro: ${erroValidacao}` });
    }

    const resultado = await executarSqlSeguro(sql);
    const columns = (resultado.fields || []).map(f => f.name);
    const rows = Array.isArray(resultado.rows) ? resultado.rows : [];

    logAiReportInfo('sucesso', {
      duracaoMs: Date.now() - startedAt,
      rowCount: Number(resultado.rowCount || rows.length || 0),
      columnCount: columns.length
    });

    return res.json({
      ok: true,
      title: plano.title || 'Relatório SQL',
      explanation: plano.explanation || '',
      assumptions: plano.assumptions || [],
      sql,
      rowCount: Number(resultado.rowCount || rows.length || 0),
      columns,
      rows
    });
  } catch (err) {
    if (err?.response?.status) {
      return responderErroOpenAI(res, err, 'AI/Report');
    }

    const msg = String(err?.message || 'Erro ao executar relatório SQL.');
    const detalhe = msg.slice(0, 300);
    console.error('[AI/Report] Erro:', detalhe);
    return res.status(400).json({
      ok: false,
      error: `Não foi possível gerar/executar o relatório SQL. Detalhe: ${detalhe}`
    });
  }
});

module.exports = router;
