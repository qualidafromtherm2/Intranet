/**
 * routes/ai_assistant.js
 * Integração com OpenAI ChatGPT — Assistente SGF
 */
const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { Pool } = require('pg');
const JSZip = require('jszip');
const supabase = require('../utils/supabase');

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const REPORT_MAX_ROWS = 200;
const REPORT_TIMEOUT_MS = 12000;
const SCHEMA_CACHE_TTL_MS = 10 * 60 * 1000;
const AUTO_REPORT_PREVIEW_ROWS = 25;
const OPENAI_RETRY_DELAYS_MS = [700, 1800];
const MANUAL_MAX_CHUNKS = 6;
const MANUAL_PREVIEW_LIMIT = 2;
const CHATBOT_MEMORY_MAX_ITEMS = 8;
const CHATBOT_MEMORY_TTL_DAYS = 21;
const MANUAL_PREVIEW_BUCKET = process.env.SUPABASE_BUCKET || 'produtos';
const MANUAL_PREVIEW_SUPABASE_PREFIX = 'chatbot/manual_previews';
const MANUAL_CACHE_TMP_DIR = path.resolve(os.tmpdir(), 'fromtherm_chatbot_manual_cache');
const MANUAL_PREVIEW_TMP_DIR = path.join(MANUAL_CACHE_TMP_DIR, 'manual_previews');
const MANUAL_PDF_CACHE_DIR = path.join(MANUAL_CACHE_TMP_DIR, 'manual_pdfs');
const QUALIDADE_MANUAIS_BUCKET = process.env.QUALIDADE_MANUAIS_BUCKET || 'Manuais';
const QUALIDADE_MANUAIS_PREFIX = process.env.QUALIDADE_MANUAIS_PREFIX || 'Manuais principais';
const QUALIDADE_MANUAIS_CACHE_TTL_MS = 10 * 60 * 1000;
const QUALIDADE_MANUAIS_MAX_CHUNKS = 6;
const QUALIDADE_MANUAIS_MAX_CHARS = 1800;
const QUALIDADE_MANUAIS_TMP_DIR = path.join(MANUAL_CACHE_TMP_DIR, 'qualidade_manuais');
const QUALIDADE_MANUAIS_DOWNLOAD_DIR = path.join(QUALIDADE_MANUAIS_TMP_DIR, 'downloads');
const QUALIDADE_MANUAIS_TEXT_DIR = path.join(QUALIDADE_MANUAIS_TMP_DIR, 'textos');
const execFileAsync = promisify(execFile);

const QUALIDADE_MANUAIS_PRINCIPAIS_META = [
  {
    order: 1,
    code: 'FT-M01-MSGQ',
    title: 'Manual do Sistema de Gestão da Qualidade',
    aliases: ['msgq', 'manual do sistema de gestao da qualidade', 'sgq', 'manual da qualidade', 'gestao da qualidade', 'sistema de gestao']
  },
  {
    order: 2,
    code: 'FT-M02-MGPMBC',
    title: 'Manual de Garantia do Processo de Montagem das Bombas de Calor',
    aliases: ['mgpmbc', 'manual de garantia do processo de montagem das bombas de calor', 'montagem das bombas de calor', 'garantia do processo de montagem', 'bombas de calor']
  },
  {
    order: 3,
    code: 'FT-M03-MFP',
    title: 'Manual de Fornecedores de Produtos',
    aliases: ['mfp', 'manual de fornecedores de produtos', 'fornecedores de produtos', 'manual de fornecedores', 'fornecedores', 'fornecedor']
  },
  {
    order: 4,
    code: 'FT-M04-MSASC',
    title: 'Manual de Serviço de Atendimento e Satisfação do Consumidor',
    aliases: ['msasc', 'manual de servico de atendimento e satisfacao do consumidor', 'atendimento e satisfacao do consumidor', 'satisfacao do consumidor', 'consumidor', 'atendimento']
  },
  {
    order: 5,
    code: 'FT-M05-MAE',
    title: 'Manual de Auditoria Escalonada',
    aliases: ['mae', 'manual de auditoria escalonada', 'auditoria escalonada', 'auditoria', 'ft-m01-mae']
  },
  {
    order: 6,
    code: 'FT-M06-MER',
    title: 'Manual de Expedição e Recebimento',
    aliases: ['mer', 'manual de expedicao e recebimento', 'expedicao e recebimento', 'expedicao', 'recebimento']
  },
  {
    order: 7,
    code: 'FT-M07-MPTNC',
    title: 'Manual do Processo de Tratativa de Não-Conformidades',
    aliases: ['mptnc', 'manual do processo de tratativa de nao conformidades', 'tratativa de nao conformidades', 'tratativa', 'nao conformidades', 'nao conformidade']
  },
  {
    order: 99,
    code: 'FT-M04-ITSAT',
    title: 'FT-M04-ITSAT',
    aliases: ['itsat', 'ft-m04-itsat']
  }
];

let qualidadeManuaisCatalogCache = { expiresAt: 0, items: [] };
let qualidadeManuaisIndexCache = { expiresAt: 0, items: [] };
let qualidadeManuaisIndexPromise = null;

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
let chatbotLogTableReadyPromise = null;
let chatbotManualTableReadyPromise = null;
let chatbotKnowledgeTableReadyPromise = null;
let chatbotConversationTableReadyPromise = null;

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

const MANUAL_CHAT_PROMPT = `Você responde perguntas técnicas sobre bombas de calor e controladores Fromtherm SOMENTE com base nos trechos de manuais fornecidos.

Regras obrigatórias:
- Use apenas as informações presentes nos trechos.
- Não invente, não complete com conhecimento externo e não chute.
- MODELO OBRIGATÓRIO: Se o usuário fizer uma pergunta técnica sem mencionar o modelo do equipamento (ex: FTI-185, FTI-240, FTI-75 Br, etc.) e não houver modelo no contexto da conversa anterior, sua PRIMEIRA resposta deve ser pedir o modelo. Exemplo: "Para que eu possa te ajudar com precisão, qual é o modelo do seu equipamento Fromtherm? (ex: FTI-185, FTI-240, etc.)". Não tente responder sem saber o modelo.
- PERSISTÊNCIA DO MODELO: Quando o usuário já mencionou um modelo anteriormente na conversa (incluindo modelos informados no contexto), continue usando esse mesmo modelo para todas as perguntas seguintes até que ele mencione outro modelo explicitamente.
- Quando o usuário citar um modelo específico, priorize estritamente esse modelo. Se os trechos não confirmarem o modelo exato, diga isso.
- Quando o manual do modelo exato não aparecer, mas houver trecho claramente aplicável da mesma família do equipamento, você pode responder com base nessa família, deixando isso explícito.
- Se o usuário informar apenas número de OS, atendimento ou outro identificador operacional que não seja modelo/número de série, explique que isso não basta para consultar manual e peça o modelo ou número de série.
- Se houver informação parcial útil nos trechos, entregue primeiro o que foi possível confirmar e depois diga o que ainda ficou pendente. Não responda apenas "não encontrei" quando existir orientação útil.
- Para procedimentos, responda em passos curtos e práticos.
- Não ofereça foto, imagem ou link por conta própria. Isso será tratado separadamente pelo sistema.
- Se a informação não estiver clara nos trechos, diga explicitamente que não encontrou essa resposta nos manuais indexados.
- Responda em português brasileiro.
- Seja objetivo e útil.
- Ao final, inclua uma linha começando com "Fonte:" citando manual e página(s) usadas.
`;

const QUALIDADE_MANUAL_CHAT_PROMPT = `Você responde perguntas sobre os manuais principais da Qualidade da Fromtherm SOMENTE com base nos trechos fornecidos.

Regras obrigatórias:
- Use apenas as informações presentes nos trechos.
- Não invente, não complete com conhecimento externo e não chute.
- Quando o usuário citar um manual específico, priorize estritamente esse manual.
- Se houver informação parcial útil, entregue primeiro o que foi possível confirmar.
- Para procedimentos, responda em passos curtos e objetivos.
- Se a informação não estiver clara nos trechos, diga explicitamente isso.
- Responda em português brasileiro.
- Seja objetivo e útil.
- Ao final, inclua uma linha começando com "Fonte:" citando os manuais usados.
`;

const CHATBOT_FAQ_SEED = [
  {
    pergunta: 'como realizar uma compra para produto cadastrado na omie',
    resposta: 'Para produto cadastrado na Omie, o fluxo correto é informar código ou descrição do item, depois quantidade, prazo e objetivo da compra. O assistente pode localizar o produto, abrir a tela correta ou seguir diretamente pelo chat quando o fluxo permitir.',
    area: 'compras',
    tags: ['compras', 'omie', 'produto cadastrado', 'solicitacao de compra'],
    prioridade: 90,
    fonte: 'Base oficial SGF'
  },
  {
    pergunta: 'como realizar uma compra sem cadastro na omie',
    resposta: 'Para item sem cadastro, o fluxo correto é: modelo de compra, departamento, categoria, objetivo da compra/observações, palavra-chave do produto e quantidade. O assistente também pode perguntar se o usuário quer incluir mais itens, abrir a tela certa ou concluir pelo chat.',
    area: 'compras',
    tags: ['compras', 'sem cadastro', 'nao cadastrado', 'omie'],
    prioridade: 95,
    fonte: 'Base oficial SGF'
  },
  {
    pergunta: 'como abrir uma os de assistencia tecnica',
    resposta: 'Para abrir uma OS de assistência técnica, os dados principais são: tipo de atendimento, nome do cliente ou revenda, número de série quando houver e descrição da reclamação. Depois disso o assistente pode abrir o formulário de OS com os dados coletados.',
    area: 'os',
    tags: ['os', 'assistencia tecnica', 'sac', 'atendimento'],
    prioridade: 90,
    fonte: 'Base oficial SGF'
  },
  {
    pergunta: 'como reservar uma reuniao no calendario',
    resposta: 'Para reservar reunião ou ambiente, o assistente pode abrir o fluxo de agenda e coletar data, tipo de reserva, tema, horário, duração, repetição, café e participantes. Depois disso ele segue para a criação da reserva no calendário.',
    area: 'agenda',
    tags: ['agenda', 'calendario', 'reserva', 'reuniao'],
    prioridade: 80,
    fonte: 'Base oficial SGF'
  },
  {
    pergunta: 'como finalizar atendimento do assistente',
    resposta: 'O usuário pode finalizar o atendimento pelo botão de encerrar ou digitando comandos como "finalizar atendimento", "encerrar conversa" ou "nova conversa". Isso limpa o contexto anterior e reinicia o chatbot.',
    area: 'chatbot',
    tags: ['chatbot', 'finalizar', 'encerrar conversa', 'nova conversa'],
    prioridade: 70,
    fonte: 'Base oficial SGF'
  }
];

function normalizarTextoBusca(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizarTextoManualBusca(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactarTextoManual(texto) {
  return normalizarTextoManualBusca(texto).replace(/[^a-z0-9]+/g, '');
}

function normalizarCodigoManualQualidade(texto) {
  return compactarTextoManual(texto).replace(/^(ftm)/, 'ftm');
}

function obterTermosManualQualidade(meta = {}) {
  return Array.from(
    new Set([
      meta.code,
      meta.title,
      ...(Array.isArray(meta.aliases) ? meta.aliases : [])
    ]
      .map((item) => normalizarTextoBusca(item))
      .filter(Boolean))
  );
}

function resolverMetaManualQualidadePorNome(fileName = '') {
  const baseName = String(fileName || '').replace(/\.[^.]+$/, '').trim();
  const baseNorm = normalizarCodigoManualQualidade(baseName);
  return QUALIDADE_MANUAIS_PRINCIPAIS_META.find((meta) => {
    const codigoNorm = normalizarCodigoManualQualidade(meta.code);
    if (codigoNorm && (baseNorm === codigoNorm || baseNorm.includes(codigoNorm))) return true;
    return obterTermosManualQualidade(meta).some((termo) => {
      const termoNorm = normalizarCodigoManualQualidade(termo);
      return termoNorm && (baseNorm === termoNorm || baseNorm.includes(termoNorm));
    });
  }) || null;
}

function formatarTituloManualQualidade(item = {}) {
  const code = String(item.code || '').trim();
  const title = String(item.title || '').trim();
  if (code && title && title !== code) return `${code} - ${title}`;
  return code || title || String(item.fileName || 'Manual').trim() || 'Manual';
}

async function garantirPastasCacheManuaisQualidade() {
  await Promise.all([
    fsp.mkdir(QUALIDADE_MANUAIS_DOWNLOAD_DIR, { recursive: true }),
    fsp.mkdir(QUALIDADE_MANUAIS_TEXT_DIR, { recursive: true })
  ]);
}

async function listarCatalogoManuaisQualidade({ force = false } = {}) {
  if (!force && qualidadeManuaisCatalogCache.expiresAt > Date.now() && Array.isArray(qualidadeManuaisCatalogCache.items)) {
    return qualidadeManuaisCatalogCache.items;
  }

  const { data, error } = await supabase.storage.from(QUALIDADE_MANUAIS_BUCKET).list(QUALIDADE_MANUAIS_PREFIX, {
    limit: 100,
    sortBy: { column: 'name', order: 'asc' }
  });
  if (error) throw error;

  const items = (Array.isArray(data) ? data : [])
    .filter((item) => item && item.name && !String(item.name).endsWith('/'))
    .map((item) => {
      const meta = resolverMetaManualQualidadePorNome(item.name);
      const pathKey = `${QUALIDADE_MANUAIS_PREFIX}/${item.name}`;
      const { data: publicData } = supabase.storage.from(QUALIDADE_MANUAIS_BUCKET).getPublicUrl(pathKey);
      const publicUrl = String(publicData?.publicUrl || '').trim();
      return {
        fileName: String(item.name || '').trim(),
        pathKey,
        mimeType: String(item?.metadata?.mimetype || item?.metadata?.contentType || '').trim(),
        publicUrl,
        sourceUrl: publicUrl,
        openUrl: publicUrl,
        code: meta?.code || String(item.name || '').replace(/\.[^.]+$/, '').trim(),
        title: meta?.title || String(item.name || '').replace(/\.[^.]+$/, '').trim(),
        aliases: Array.isArray(meta?.aliases) ? meta.aliases : [],
        order: Number(meta?.order || 9999),
        assetType: 'document',
        pageLabel: 'Arquivo',
        openLabel: 'Abrir arquivo',
        note: 'Atalho direto para o arquivo do manual.'
      };
    })
    .sort((a, b) => {
      if (Number(a.order || 9999) !== Number(b.order || 9999)) {
        return Number(a.order || 9999) - Number(b.order || 9999);
      }
      return String(a.fileName || '').localeCompare(String(b.fileName || ''), 'pt-BR');
    });

  qualidadeManuaisCatalogCache = {
    expiresAt: Date.now() + QUALIDADE_MANUAIS_CACHE_TTL_MS,
    items
  };
  return items;
}

function perguntaPedeManualQualidade(pergunta) {
  const raw = String(pergunta || '').trim();
  const t = normalizarTextoBusca(raw);
  if (!t) return false;

  if (/\b(?:ft|fti|fh)\s*[- ]?\s*\d+/i.test(raw)) return false;

  const temCodigoManual = /\bft\s*-\s*m\d{2}\s*-\s*[a-z0-9]+\b/i.test(raw);
  const temContextoManual = /\bmanual\b|\bmanuais\b/.test(t);
  const termosQualidade = Array.from(
    new Set(
      QUALIDADE_MANUAIS_PRINCIPAIS_META.flatMap((meta) => [
        meta.code,
        meta.title,
        ...(Array.isArray(meta.aliases) ? meta.aliases : [])
      ])
        .map((item) => normalizarTextoBusca(item))
        .filter((item) => item && item.length >= 3)
    )
  );
  const temTemaQualidade = termosQualidade.some((item) => t.includes(item));
  const pedidoGenericoQualidade = temContextoManual && (
    t.includes('principal') ||
    t.includes('principais') ||
    t.includes('manual da qualidade') ||
    t.includes('manuais da qualidade')
  );

  return temCodigoManual || temTemaQualidade || pedidoGenericoQualidade || (temContextoManual && t.includes('qualidade')) || (temContextoManual && temTemaQualidade);
}

function perguntaPedeListaManuaisQualidade(pergunta) {
  const t = normalizarTextoBusca(pergunta);
  if (!t) return false;
  return perguntaPedeManualQualidade(pergunta) && (
    /\bquais\b/.test(t) ||
    /\blista\b/.test(t) ||
    t.includes('manuais principais') ||
    t.includes('todos os manuais') ||
    t.includes('manuais da qualidade')
  );
}

function extrairCodigosMemoriaManuaisQualidade(memoria = {}) {
  return Array.isArray(memoria?.ultimos_manuais_qualidade?.codigos)
    ? memoria.ultimos_manuais_qualidade.codigos.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function selecionarManuaisQualidadeRelacionados(pergunta, catalogo = [], memoria = {}) {
  const raw = String(pergunta || '').trim();
  const t = normalizarTextoBusca(raw);
  const tCompact = compactarTextoManual(raw);
  let encontrados = (Array.isArray(catalogo) ? catalogo : []).filter((manual) => {
    const termos = [
      manual.code,
      manual.title,
      manual.fileName,
      ...(Array.isArray(manual.aliases) ? manual.aliases : [])
    ];
    return termos.some((termo) => {
      const termoNorm = normalizarTextoBusca(termo);
      const termoCompact = compactarTextoManual(termo);
      return (termoNorm && t.includes(termoNorm)) || (termoCompact && tCompact.includes(termoCompact));
    });
  });

  if (!encontrados.length && perguntaDependeDeContextoCurto(pergunta)) {
    const memoriaCodigos = extrairCodigosMemoriaManuaisQualidade(memoria);
    if (memoriaCodigos.length) {
      const memoriaCompact = new Set(memoriaCodigos.map((item) => compactarTextoManual(item)));
      encontrados = (Array.isArray(catalogo) ? catalogo : []).filter((manual) => memoriaCompact.has(compactarTextoManual(manual.code)));
    }
  }

  return encontrados;
}

function montarManualPreviewsQualidade(manuais = [], limit = 3) {
  return (Array.isArray(manuais) ? manuais : [])
    .filter((item) => item && item.openUrl)
    .slice(0, Math.max(1, Number(limit || 3)))
    .map((item) => ({
      manual: formatarTituloManualQualidade(item),
      page: '',
      pageLabel: 'Arquivo',
      assetType: 'document',
      sourceUrl: item.sourceUrl,
      openUrl: item.openUrl,
      openLabel: 'Abrir arquivo',
      note: 'Atalho direto para o arquivo do manual.'
    }));
}

function normalizarTextoManualQualidadeExtraido(texto) {
  return String(texto || '')
    .replace(/\uFEFF/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function quebrarTextoManualQualidadeEmChunks(texto) {
  const blocos = normalizarTextoManualQualidadeExtraido(texto)
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);

  const chunks = [];
  let buffer = '';
  for (const bloco of blocos) {
    const candidato = buffer ? `${buffer}\n\n${bloco}` : bloco;
    if (candidato.length > QUALIDADE_MANUAIS_MAX_CHARS && buffer) {
      chunks.push(buffer.trim());
      buffer = bloco;
    } else {
      buffer = candidato;
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks.slice(0, 80);
}

async function baixarManualQualidadeCacheado(manual = {}) {
  await garantirPastasCacheManuaisQualidade();
  const ext = path.extname(String(manual.fileName || '').trim()).toLowerCase() || '.docx';
  const fileHash = hashCurtoManual(`${manual.pathKey}|${manual.publicUrl}`);
  const localPath = path.join(QUALIDADE_MANUAIS_DOWNLOAD_DIR, `${fileHash}${ext}`);
  if (fs.existsSync(localPath)) return localPath;

  const response = await axios.get(String(manual.publicUrl || '').trim(), {
    responseType: 'arraybuffer',
    timeout: 60000
  });
  await fsp.writeFile(localPath, Buffer.from(response.data));
  return localPath;
}

async function converterDocxQualidadeParaTxt(localPath = '') {
  await garantirPastasCacheManuaisQualidade();
  const baseName = path.basename(String(localPath || ''), path.extname(String(localPath || '')));
  const txtPath = path.join(QUALIDADE_MANUAIS_TEXT_DIR, `${baseName}.txt`);
  if (fs.existsSync(txtPath)) return txtPath;

  await execFileAsync('soffice', [
    '--headless',
    '--convert-to',
    'txt:Text',
    '--outdir',
    QUALIDADE_MANUAIS_TEXT_DIR,
    localPath
  ], {
    timeout: 120000,
    maxBuffer: 10 * 1024 * 1024
  });

  if (!fs.existsSync(txtPath)) {
    throw new Error(`Falha ao converter ${path.basename(localPath)} para texto.`);
  }
  return txtPath;
}

async function carregarTextoManualQualidade(manual = {}) {
  const localPath = await baixarManualQualidadeCacheado(manual);
  const ext = path.extname(localPath).toLowerCase();

  if (ext === '.docx' || ext === '.doc' || ext === '.pdf') {
    const txtPath = await converterDocxQualidadeParaTxt(localPath);
    return normalizarTextoManualQualidadeExtraido(await fsp.readFile(txtPath, 'utf8'));
  }

  if (ext === '.txt') {
    return normalizarTextoManualQualidadeExtraido(await fsp.readFile(localPath, 'utf8'));
  }

  const buffer = await fsp.readFile(localPath);
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  return normalizarTextoManualQualidadeExtraido(String(documentXml || '').replace(/<[^>]+>/g, ' '));
}

async function carregarIndiceManuaisQualidade({ force = false } = {}) {
  if (!force && qualidadeManuaisIndexCache.expiresAt > Date.now() && Array.isArray(qualidadeManuaisIndexCache.items)) {
    return qualidadeManuaisIndexCache.items;
  }
  if (qualidadeManuaisIndexPromise) return qualidadeManuaisIndexPromise;

  qualidadeManuaisIndexPromise = (async () => {
    const catalogo = await listarCatalogoManuaisQualidade({ force });
    const itens = [];

    for (const manual of catalogo) {
      try {
        const texto = await carregarTextoManualQualidade(manual);
        const chunks = quebrarTextoManualQualidadeEmChunks(texto).map((chunk, index) => ({
          chunk_ordem: index + 1,
          texto: chunk,
          texto_normalizado: normalizarTextoManualBusca(chunk)
        }));
        itens.push({
          ...manual,
          chunks
        });
      } catch (err) {
        console.warn('[AI/Qualidade/Manuais] Falha ao preparar manual:', manual.fileName, err?.message || err);
      }
    }

    qualidadeManuaisIndexCache = {
      expiresAt: Date.now() + QUALIDADE_MANUAIS_CACHE_TTL_MS,
      items: itens
    };
    return itens;
  })();

  try {
    return await qualidadeManuaisIndexPromise;
  } finally {
    qualidadeManuaisIndexPromise = null;
  }
}

function extrairTokensBuscaManualQualidade(pergunta) {
  const stopwords = new Set([
    'a', 'ao', 'aos', 'as', 'com', 'como', 'da', 'das', 'de', 'do', 'dos', 'e',
    'em', 'manual', 'manuais', 'na', 'nas', 'no', 'nos', 'o', 'os', 'ou', 'para',
    'por', 'qual', 'quais', 'que', 'sobre', 'uma', 'um'
  ]);

  return Array.from(
    new Set(
      normalizarTextoManualBusca(pergunta)
        .split(/\s+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 3 && !stopwords.has(item))
    )
  ).slice(0, 10);
}

function scoreChunkManualQualidade(pergunta, manual = {}, chunk = {}, manuaisRelacionados = []) {
  const perguntaNorm = normalizarTextoBusca(pergunta);
  const tituloNorm = normalizarTextoBusca(`${manual.code || ''} ${manual.title || ''} ${manual.fileName || ''}`);
  const chunkNorm = String(chunk?.texto_normalizado || '');
  const relacionados = new Set((Array.isArray(manuaisRelacionados) ? manuaisRelacionados : []).map((item) => String(item.code || '')));
  const tokens = extrairTokensBuscaManualQualidade(pergunta);
  let score = 0;

  if (relacionados.has(String(manual.code || ''))) score += 220;

  for (const token of tokens) {
    if (tituloNorm.includes(token)) score += 30;
    if (chunkNorm.includes(token)) score += token.length >= 6 ? 18 : 10;
  }

  const codigoCompact = compactarTextoManual(manual.code);
  if (codigoCompact && compactarTextoManual(perguntaNorm).includes(codigoCompact)) score += 160;

  return score;
}

async function buscarTrechosManuaisQualidade(pergunta, memoria = {}) {
  const indice = await carregarIndiceManuaisQualidade();
  const catalogo = Array.isArray(indice) ? indice : [];
  const manuaisRelacionados = selecionarManuaisQualidadeRelacionados(pergunta, catalogo, memoria);
  const universo = manuaisRelacionados.length ? manuaisRelacionados : catalogo;
  const trechos = [];

  for (const manual of universo) {
    for (const chunk of Array.isArray(manual.chunks) ? manual.chunks : []) {
      const score = scoreChunkManualQualidade(pergunta, manual, chunk, manuaisRelacionados);
      if (score <= 0) continue;
      trechos.push({
        manual,
        texto: chunk.texto,
        score,
        chunk_ordem: chunk.chunk_ordem
      });
    }
  }

  return trechos
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || String(a.manual?.code || '').localeCompare(String(b.manual?.code || '')))
    .slice(0, QUALIDADE_MANUAIS_MAX_CHUNKS);
}

function formatarFonteTrechosManuaisQualidade(trechos = []) {
  return Array.from(
    new Set(
      (Array.isArray(trechos) ? trechos : [])
        .map((item) => formatarTituloManualQualidade(item.manual))
        .filter(Boolean)
    )
  ).join(' | ');
}

function montarMemoriaManuaisQualidade(manuais = []) {
  const codigos = Array.from(
    new Set(
      (Array.isArray(manuais) ? manuais : [])
        .map((item) => String(item?.code || '').trim())
        .filter(Boolean)
    )
  ).slice(0, 4);

  if (!codigos.length) return [];
  return [
    {
      chave: 'ultimos_manuais_qualidade',
      valor: { codigos },
      relevancia: 8,
      ttlDias: 21
    }
  ];
}

async function tentarResponderComManuaisQualidade({
  apiKey,
  pergunta,
  memoria = {},
  manualMediaMode = 'none'
}) {
  if (!perguntaPedeManualQualidade(pergunta) && !(perguntaDependeDeContextoCurto(pergunta) && String(memoria?.ultimo_assunto?.assunto || '') === 'manuais_qualidade')) {
    return null;
  }

  const catalogo = await listarCatalogoManuaisQualidadePrincipaisSafe(memoria);
  if (!catalogo.length) {
    return {
      content: 'Não encontrei os arquivos de manuais principais da Qualidade no Supabase configurado para o chatbot.',
      manualPreviews: [],
      manuaisQualidade: []
    };
  }

  const manuaisRelacionados = selecionarManuaisQualidadeRelacionados(pergunta, catalogo, memoria);
  const listaSolicitada = perguntaPedeListaManuaisQualidade(pergunta);
  const midiaSolicitada = manualMediaMode !== 'none';

  if (listaSolicitada) {
    const alvo = manuaisRelacionados.length ? manuaisRelacionados : catalogo;
    let content = `Hoje a pasta "${QUALIDADE_MANUAIS_PREFIX}" do bucket "${QUALIDADE_MANUAIS_BUCKET}" possui ${catalogo.length} arquivo(s):\n\n`;
    content += alvo.map((manual, index) => `${index + 1}. ${formatarTituloManualQualidade(manual)}`).join('\n');
    content += `\n\nFonte: Supabase / ${QUALIDADE_MANUAIS_BUCKET} / ${QUALIDADE_MANUAIS_PREFIX}`;
    if (midiaSolicitada) {
      content += '\n\nAnexei abaixo os atalhos para abrir os arquivos.';
    }
    return {
      content,
      manualPreviews: midiaSolicitada ? montarManualPreviewsQualidade(alvo, alvo.length) : [],
      manuaisQualidade: alvo
    };
  }

  if (manuaisRelacionados.length && !/\b(como|qual|quais|quando|onde|requisito|procedimento|fala|diz|explica|explicar|detalha|detalhar|conteudo|conteúdo|sobre)\b/.test(normalizarTextoBusca(pergunta))) {
    const alvo = manuaisRelacionados.slice(0, 3);
    let content = alvo.length === 1
      ? `Encontrei o manual ${formatarTituloManualQualidade(alvo[0])}.`
      : `Encontrei estes manuais relacionados ao seu pedido:\n\n${alvo.map((manual, index) => `${index + 1}. ${formatarTituloManualQualidade(manual)}`).join('\n')}`;
    content += midiaSolicitada
      ? '\n\nAnexei abaixo o atalho para abrir o arquivo.'
      : '\n\nSe quiser, posso te mandar o link direto do arquivo.';
    content += `\n\nFonte: Supabase / ${QUALIDADE_MANUAIS_BUCKET} / ${QUALIDADE_MANUAIS_PREFIX}`;
    return {
      content,
      manualPreviews: midiaSolicitada ? montarManualPreviewsQualidade(alvo, alvo.length) : [],
      manuaisQualidade: alvo
    };
  }

  const trechos = await buscarTrechosManuaisQualidade(pergunta, memoria);
  if (!trechos.length) {
    const alvo = manuaisRelacionados.length ? manuaisRelacionados : [];
    let content = alvo.length
      ? `Identifiquei o manual ${formatarTituloManualQualidade(alvo[0])}, mas não achei um trecho confiável no conteúdo extraído para responder isso com segurança.`
      : 'Não encontrei um trecho confiável nesses manuais principais da Qualidade para responder isso com segurança.';
    content += midiaSolicitada && alvo.length
      ? '\n\nAnexei abaixo o atalho para abrir o arquivo.'
      : '\n\nSe quiser, eu posso listar os manuais principais ou abrir um arquivo específico.';
    content += `\n\nFonte: Supabase / ${QUALIDADE_MANUAIS_BUCKET} / ${QUALIDADE_MANUAIS_PREFIX}`;
    return {
      content,
      manualPreviews: midiaSolicitada && alvo.length ? montarManualPreviewsQualidade(alvo, alvo.length) : [],
      manuaisQualidade: alvo
    };
  }

  const contexto = trechos.map((item, idx) => (
    `[Trecho ${idx + 1}]\nManual: ${formatarTituloManualQualidade(item.manual)}\nConteúdo:\n${String(item.texto || '').trim().slice(0, 1800)}`
  )).join('\n\n');

  const response = await chamarOpenAiComRetry(
    apiKey,
    {
      model: 'gpt-4o-mini',
      temperature: 0.1,
      max_tokens: 650,
      messages: [
        { role: 'system', content: QUALIDADE_MANUAL_CHAT_PROMPT },
        {
          role: 'user',
          content:
`Pergunta do usuário:
${pergunta}

Trechos relevantes dos manuais principais da Qualidade:
${contexto}`
        }
      ]
    },
    { timeout: 30000, contexto: 'AI/Chat/Qualidade/Manuais' }
  );

  let content = String(response.data?.choices?.[0]?.message?.content || '').trim();
  if (!content) {
    content = 'Não consegui montar uma resposta confiável a partir dos manuais principais da Qualidade.';
  }

  if (!/\bfonte:/i.test(content)) {
    content += `\n\nFonte: ${formatarFonteTrechosManuaisQualidade(trechos)}`;
  }

  const manuaisUsados = Array.from(new Map(trechos.map((item) => [String(item.manual?.code || item.manual?.fileName || ''), item.manual])).values());
  const manualPreviews = midiaSolicitada ? montarManualPreviewsQualidade(manuaisUsados, Math.min(3, manuaisUsados.length)) : [];
  if (manualPreviews.length && !/anexei abaixo/i.test(content)) {
    content += '\n\nAnexei abaixo o atalho para abrir o arquivo correspondente.';
  }

  return {
    content,
    manualPreviews,
    manuaisQualidade: manuaisUsados
  };
}

async function listarCatalogoManuaisQualidadePrincipaisSafe(memoria = {}) {
  try {
    return await listarCatalogoManuaisQualidade();
  } catch (err) {
    console.warn('[AI/Qualidade/Manuais] Falha ao listar catálogo:', err?.message || err, {
      assunto: memoria?.ultimo_assunto?.assunto || ''
    });
    return [];
  }
}

function extrairModelosPergunta(pergunta) {
  const raw = String(pergunta || '');
  const regex = /\b(fti|ft|fh)\s*[- ]?\s*(\d{1,3})(?:\s*[- ]?\s*([a-z]{1,4}\d{0,3}))?\b/gi;
  const vistos = new Set();
  const modelos = [];

  for (const match of raw.matchAll(regex)) {
    const prefixo = String(match[1] || '').toUpperCase();
    const numero = String(Number(match[2] || 0) || '').trim();
    if (!prefixo || !numero) continue;

    const complemento = String(match[3] || '').trim().toUpperCase();
    const canonico = `${prefixo}-${numero}${complemento ? complemento : ''}`;
    const chave = canonico.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    const aliasBase = [
      `${prefixo}-${numero}`,
      `${prefixo} ${numero}`,
      `${prefixo}${numero}`
    ];
    const aliasComplemento = complemento
      ? [
          `${prefixo}-${numero}${complemento}`,
          `${prefixo} ${numero}${complemento}`,
          `${prefixo}${numero}${complemento}`
        ]
      : [];

    const aliases = Array.from(
      new Set([...aliasBase, ...aliasComplemento].map((item) => normalizarTextoManualBusca(item)).filter(Boolean))
    );
    const aliasesCompact = Array.from(
      new Set([...aliasBase, ...aliasComplemento].map((item) => compactarTextoManual(item)).filter(Boolean))
    );

    modelos.push({
      prefixo,
      numero,
      complemento,
      canonico,
      aliases,
      aliasesCompact
    });
  }

  return modelos;
}

function calcularScoreModeloNoTexto(texto, modelos, { exact = 0, compact = 0, familiaNumero = 0 } = {}) {
  if (!Array.isArray(modelos) || !modelos.length) return 0;

  const textoNorm = normalizarTextoManualBusca(texto);
  const textoCompacto = compactarTextoManual(texto);
  if (!textoNorm && !textoCompacto) return 0;

  let total = 0;
  for (const modelo of modelos) {
    let melhor = 0;

    for (const alias of modelo.aliases || []) {
      if (alias && textoNorm.includes(alias)) {
        melhor = Math.max(melhor, exact);
      }
    }

    for (const aliasCompacto of modelo.aliasesCompact || []) {
      if (aliasCompacto && textoCompacto.includes(aliasCompacto)) {
        melhor = Math.max(melhor, compact);
      }
    }

    if (
      familiaNumero > 0 &&
      textoNorm.includes(String(modelo.prefixo || '').toLowerCase()) &&
      textoNorm.includes(String(modelo.numero || ''))
    ) {
      melhor = Math.max(melhor, familiaNumero);
    }

    total += melhor;
  }

  return total;
}

function perguntaPedeManualBombaCalor(pergunta) {
  const raw = String(pergunta || '').trim();
  const t = normalizarTextoBusca(raw);
  if (!t) return false;

  const temModelo = /\b(?:ft|fti|fh)\s*[- ]?\s*\d+/i.test(raw);
  const termosNucleo = [
    'bomba de calor',
    'manual',
    'aquecedor',
    'controlador',
    'wifi',
    'wi fi',
    'fromtherm'
  ];
  const temNucleo = termosNucleo.some((termo) => t.includes(termo));

  const termosTecnicos = [
    'instal',
    'operac',
    'configur',
    'erro',
    'alarme',
    'degelo',
    'temperatura',
    'pressao',
    'sensor',
    'setpoint',
    'modo',
    'manutenc',
    'ligacao',
    'tensao',
    'garantia',
    'potencia'
  ];
  const temTecnico = termosTecnicos.some((termo) => t.includes(termo));

  return temModelo || temNucleo || (/\b(?:ft|fti|fh)\b/.test(t) && temTecnico);
}

function perguntaPedeTensaoOuVoltagem(pergunta) {
  const t = normalizarTextoBusca(pergunta);
  if (!t) return false;

  return [
    'voltagem',
    'tensao',
    'alimentacao',
    '220',
    '380',
    'monofas',
    'bifas',
    'trifas'
  ].some((item) => t.includes(item));
}

function perguntaPareceUsarNumeroOsSemModelo(pergunta) {
  const raw = String(pergunta || '').trim();
  const t = normalizarTextoBusca(raw);
  if (!raw || !t || extrairModelosPergunta(raw).length) return false;
  if (!/\b\d{2}-\d{4,}\b/.test(raw)) return false;

  return [
    'os',
    'ordem de servico',
    'modelo',
    'manual',
    'voltagem',
    'tensao',
    'quadro',
    'externo',
    'wifi',
    'alarme'
  ].some((item) => t.includes(item));
}

function montarRespostaSolicitandoModeloManual() {
  return 'Esse número parece ser da OS, não do modelo do equipamento. Pelos manuais eu preciso do modelo ou do número de série para confirmar voltagem, quadro externo, Wi-Fi e demais dados técnicos.';
}

function perguntaPedeImagemManual(pergunta) {
  const t = normalizarTextoBusca(pergunta);
  if (!t) return false;

  const verboEnvio = /(manda|mande|envia|envie|mostrar|mostra)/.test(t);
  const pedidoDireto =
    t.includes('foto') ||
    t.includes('imagem') ||
    t.includes('print') ||
    t.includes('screenshot') ||
    (verboEnvio &&
      (t.includes('foto') || t.includes('imagem') || t.includes('print')));

  return pedidoDireto;
}

function perguntaPedeLinkManual(pergunta) {
  const t = normalizarTextoBusca(pergunta);
  if (!t) return false;

  if (perguntaPedeImagemManual(pergunta)) return false;

  const verboEnvio = /(manda|mande|envia|envie|mostrar|mostra|abrir|abre|ver)/.test(t);

  const pediuPagina =
    t.includes('pagina') ||
    t.includes('pag ') ||
    t.includes('pdf') ||
    /^qual pagina\b/.test(t) ||
    /^onde .*manual\b/.test(t);

  const pediuLinkManual =
    (t.includes('link') && (t.includes('manual') || t.includes('pagina') || t.includes('pdf'))) ||
    (verboEnvio &&
      (t.includes('manual') || t.includes('pagina') || t.includes('pdf')));

  return pediuPagina || pediuLinkManual;
}

function perguntaPedeManualCompleto(pergunta) {
  const t = normalizarTextoBusca(pergunta);
  if (!t) return false;

  const verboEnvio = /(manda|mande|envia|envie|mostrar|mostra|abrir|abre)/.test(t);

  return (
    /\bqual (e|é)?\s*o?\s*manual\b/.test(t) ||
    /\bqual manual\b/.test(t) ||
    /\bmanual do modelo\b/.test(t) ||
    /\bmanual da\b/.test(t) ||
    /\bmanual completo\b/.test(t) ||
    /\bmanual inteiro\b/.test(t) ||
    /\bpdf do manual\b/.test(t) ||
    ((t.includes('manual') || t.includes('pdf')) && verboEnvio)
  );
}

function perguntaPedeTrechoManual(pergunta) {
  const t = normalizarTextoBusca(pergunta);
  if (!t) return false;

  const verboEnvio = /(manda|mande|envia|envie|mostra|mostrar)/.test(t);

  return (
    /\btrecho\b/.test(t) ||
    /\bparte\b/.test(t) ||
    /\bonde fala\b/.test(t) ||
    /\bqual parte\b/.test(t) ||
    /\bfala isso\b/.test(t) ||
    /\bfala disso\b/.test(t) ||
    /\btexto do manual\b/.test(t) ||
    ((verboEnvio && (t.includes('parte') || t.includes('trecho'))) ||
      (t.includes('manual') && (t.includes('parte') || t.includes('trecho'))))
  );
}

function resolverModoMidiaManual(pergunta) {
  if (perguntaPedeImagemManual(pergunta)) return 'image';
  if (perguntaPedeLinkManual(pergunta)) return 'link';
  return 'none';
}

function extrairFonteDaRespostaAssistente(texto) {
  return String(texto || '')
    .split(/\n+/)
    .map((linha) => String(linha || '').trim())
    .find((linha) => /^fonte:/i.test(linha)) || '';
}

function resumirRespostaAssistenteSemFonte(texto, max = 280) {
  const linhas = String(texto || '')
    .split(/\n+/)
    .map((linha) => String(linha || '').trim())
    .filter((linha) => linha && !/^fonte:/i.test(linha) && !/^anexei abaixo/i.test(linha));
  const resumo = linhas.join(' ').replace(/\s+/g, ' ').trim();
  if (!resumo) return '';
  return resumo.length > max ? `${resumo.slice(0, max - 3)}...` : resumo;
}

function extrairInteracaoAnteriorManual(messages = []) {
  const lista = Array.isArray(messages) ? messages : [];
  let ultimaAssistente = null;
  let ultimaPerguntaAnterior = null;

  for (let i = lista.length - 2; i >= 0; i -= 1) {
    const item = lista[i];
    if (!ultimaAssistente && item?.role === 'assistant' && String(item?.content || '').trim()) {
      ultimaAssistente = String(item.content || '').trim();
      continue;
    }
    if (ultimaAssistente && item?.role === 'user' && String(item?.content || '').trim()) {
      ultimaPerguntaAnterior = String(item.content || '').trim();
      break;
    }
  }

  return {
    perguntaAnterior: ultimaPerguntaAnterior || '',
    respostaAnterior: ultimaAssistente || '',
    fonteAnterior: extrairFonteDaRespostaAssistente(ultimaAssistente || ''),
    resumoAnterior: resumirRespostaAssistenteSemFonte(ultimaAssistente || '')
  };
}

function enriquecerPerguntaManualComHistorico(pergunta, messages = []) {
  const perguntaAtual = String(pergunta || '').trim();
  if (!perguntaAtual) return '';

  const dependeContexto =
    perguntaDependeDeContextoCurto(perguntaAtual) ||
    perguntaPedeTrechoManual(perguntaAtual) ||
    perguntaPedeManualCompleto(perguntaAtual) ||
    perguntaPedeLinkManual(perguntaAtual) ||
    perguntaPedeImagemManual(perguntaAtual);

  if (!dependeContexto) return perguntaAtual;

  const contexto = extrairInteracaoAnteriorManual(messages);
  const itens = [];
  if (contexto.perguntaAnterior) itens.push(`Pergunta anterior do usuário: ${contexto.perguntaAnterior}`);
  if (contexto.resumoAnterior) itens.push(`Resumo da resposta anterior: ${contexto.resumoAnterior}`);
  if (contexto.fonteAnterior) itens.push(`Fonte anterior citada: ${contexto.fonteAnterior}`);
  if (!itens.length) return perguntaAtual;

  return `${perguntaAtual}\n\n[Contexto imediato da conversa]\n- ${itens.join('\n- ')}`;
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

  if (perguntaPedeAgendaPessoal(pergunta)) {
    return true;
  }

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

function listarRolesUsuarioSessao(req) {
  const rawRoles = req?.session?.user?.roles ?? [];
  if (Array.isArray(rawRoles)) {
    return rawRoles
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }
  return String(rawRoles || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function usuarioEhAdminChatbot(req) {
  return listarRolesUsuarioSessao(req)
    .some((role) => normalizarTextoBusca(role) === 'admin');
}

function resolverIdentificadoresAssistente(req) {
  const user = req?.session?.user || {};
  const candidatos = [user.username, user.login, user.fullName, user.id]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .map((item) => item.toLowerCase());
  return Array.from(new Set(candidatos));
}

function resolverUsuarioMemoriaChatbot(req) {
  const ids = resolverIdentificadoresAssistente(req);
  if (ids[0]) return ids[0];

  const bodyUser = String(req?.body?.chatbotUser || '').trim().toLowerCase();
  const bodyToken = String(req?.body?.chatbotToken || '').trim();
  if (bodyUser || bodyToken) {
    const tokenSuffix = bodyToken ? hashCurtoManual(bodyToken) : 'sem-token';
    return `portal:${bodyUser || 'tecnico'}:${tokenSuffix}`;
  }

  const ip = String(req?.ip || req?.socket?.remoteAddress || req?.headers?.['x-forwarded-for'] || '').trim();
  const userAgent = String(req?.headers?.['user-agent'] || '').trim();
  if (ip || userAgent) {
    return `anon:${hashCurtoManual(`${ip}|${userAgent}`)}`;
  }

  const sessionId = String(req?.sessionID || '').trim();
  if (sessionId) return `sess:${sessionId}`;

  return null;
}

function inferirAreaPerguntaChatbot(pergunta) {
  const t = normalizarTextoBusca(pergunta);
  if (!t) return '';
  if (perguntaPedeManualQualidade(pergunta)) return 'manuais_qualidade';
  if (perguntaPedeManualBombaCalor(pergunta)) return 'manuais_produto';
  if (/\b(compra|compras|omie|cotacao|cotação|pedido|pedidos|fornecedor)\b/.test(t)) return 'compras';
  if (/\b(os|ordem de servico|ordem de serviço|assistencia tecnica|assistência técnica|sac)\b/.test(t)) return 'os';
  if (/\b(reuniao|reunioes|agenda|calendario|calendário|reserva|reservas|lembrete|ata|nota de reuniao)\b/.test(t)) return 'agenda';
  if (/\b(produto|produtos|estrutura|peca|peça|manual)\b/.test(t)) return 'produto';
  if (/\b(estoque|logistica|logística|recebimento|envio)\b/.test(t)) return 'logistica';
  if (/\b(colaborador|rh|recursos humanos)\b/.test(t)) return 'rh';
  if (/\b(financeiro|pagamento|fatura)\b/.test(t)) return 'financeiro';
  return 'geral';
}

function perguntaDependeDeContextoCurto(pergunta) {
  const t = normalizarTextoBusca(pergunta);
  if (!t) return false;
  if (extrairModelosPergunta(pergunta).length) return false;
  if (t.length > 140) return false;

  const temAssuntoProprio = [
    'wifi',
    'wi fi',
    'manual',
    'bomba de calor',
    'controlador',
    'painel',
    'display',
    'voltagem',
    'tensao',
    'temperatura',
    'quadro',
    'sensor',
    'alarme',
    'erro',
    'configur',
    'instal',
    'ligacao',
    'modo',
    'degelo',
    'refriger',
    'aquec',
    'placa',
    'app',
    'aplicativo'
  ].some((item) => t.includes(item));

  if (/\b(ele|ela|esse|essa|esses|essas|dele|dela|disso|nisso|desse modelo|dessa bomba|desse produto|dessa maquina|dessa máquina)\b/.test(t)) {
    return true;
  }

  if (temAssuntoProprio) return false;

  return /^(e\b|qual\b|como\b|onde\b|quando\b|isso\b|entao\b|então\b)/.test(t) && t.length <= 70;
}

function formatarValorMemoriaPrompt(memoria) {
  const itens = [];
  const assunto = String(memoria?.ultimo_assunto?.assunto || '').trim();
  if (assunto) itens.push(`Último assunto do usuário: ${assunto}`);

  const modelos = Array.isArray(memoria?.ultimos_modelos?.modelos)
    ? memoria.ultimos_modelos.modelos.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (modelos.length) itens.push(`Últimos modelos citados: ${modelos.join(', ')}`);

  const manuaisQualidade = extrairCodigosMemoriaManuaisQualidade(memoria);
  if (manuaisQualidade.length) itens.push(`Últimos manuais de qualidade citados: ${manuaisQualidade.join(', ')}`);

  const ultimaPergunta = String(memoria?.ultima_pergunta?.pergunta || '').trim();
  if (ultimaPergunta) itens.push(`Última pergunta recente: ${ultimaPergunta.slice(0, 220)}`);

  return itens.join('\n');
}

function montarPerguntaComMemoria(pergunta, memoria) {
  const perguntaAtual = String(pergunta || '').trim();
  if (!perguntaAtual) return '';

  const assunto = String(memoria?.ultimo_assunto?.assunto || '').trim();
  const areaPergunta = inferirAreaPerguntaChatbot(perguntaAtual);
  const perguntaCurtaContextual = perguntaDependeDeContextoCurto(perguntaAtual);
  const assuntoCompativel =
    !areaPergunta ||
    areaPergunta === 'geral' ||
    !assunto ||
    areaPergunta === assunto ||
    (areaPergunta === 'produto' && assunto === 'manuais_produto') ||
    (areaPergunta === 'manuais_produto' && assunto === 'produto');

  const itens = [];
  const modelos = Array.isArray(memoria?.ultimos_modelos?.modelos)
    ? memoria.ultimos_modelos.modelos.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (modelos.length && perguntaCurtaContextual && assuntoCompativel) {
    itens.push(`Últimos modelos citados na conversa: ${modelos.join(', ')}`);
  }

  const manuaisQualidade = extrairCodigosMemoriaManuaisQualidade(memoria);
  if (manuaisQualidade.length && perguntaCurtaContextual && assuntoCompativel) {
    itens.push(`Últimos manuais de qualidade citados na conversa: ${manuaisQualidade.join(', ')}`);
  }

  if (assunto && perguntaCurtaContextual && assuntoCompativel) {
    itens.push(`Assunto atual provável da conversa: ${assunto}`);
  }

  if (!itens.length) return perguntaAtual;
  return `${perguntaAtual}\n\n[Use o contexto abaixo somente se a pergunta atual depender claramente da conversa anterior]\n- ${itens.join('\n- ')}`;
}

function extrairMemoriaCurtaDaConversa({ pergunta, resposta = '' } = {}) {
  const perguntaFinal = String(pergunta || '').trim();
  if (!perguntaFinal) return [];

  const assunto = inferirAreaPerguntaChatbot(perguntaFinal);
  const modelos = extrairModelosPergunta(perguntaFinal).map((item) => item.canonico);
  const itens = [
    {
      chave: 'ultima_pergunta',
      valor: { pergunta: perguntaFinal.slice(0, 400) },
      relevancia: 2,
      ttlDias: 5
    },
    {
      chave: 'ultimo_assunto',
      valor: { assunto, pergunta: perguntaFinal.slice(0, 220) },
      relevancia: 6,
      ttlDias: 14
    }
  ];

  if (modelos.length) {
    itens.push({
      chave: 'ultimos_modelos',
      valor: { modelos: Array.from(new Set(modelos)).slice(0, 4) },
      relevancia: 10,
      ttlDias: 30
    });
  }

  const respostaNorm = normalizarTextoBusca(resposta);
  if (respostaNorm.includes('fonte:')) {
    itens.push({
      chave: 'ultima_fonte_utilizada',
      valor: { fonte: String(resposta || '').split(/\n+/).find((linha) => /^fonte:/i.test(String(linha || '').trim())) || '' },
      relevancia: 3,
      ttlDias: 10
    });
  }

  return itens;
}

function devePriorizarManuaisPorContexto(pergunta, memoria = {}) {
  if (!perguntaDependeDeContextoCurto(pergunta)) return false;
  const areaPergunta = inferirAreaPerguntaChatbot(pergunta);
  if (areaPergunta && !['geral', 'produto', 'manuais_produto', 'manuais_qualidade'].includes(areaPergunta)) {
    return false;
  }
  const assunto = String(memoria?.ultimo_assunto?.assunto || '').trim();
  const modelos = Array.isArray(memoria?.ultimos_modelos?.modelos)
    ? memoria.ultimos_modelos.modelos.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const manuaisQualidade = extrairCodigosMemoriaManuaisQualidade(memoria);
  return assunto === 'manuais_produto' || assunto === 'manuais_qualidade' || modelos.length > 0 || manuaisQualidade.length > 0;
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

function formatarPaginasManual(paginaInicial, paginaFinal) {
  const ini = Number(paginaInicial || 0);
  const fim = Number(paginaFinal || 0);
  if (!ini && !fim) return 's/p';
  if (ini && fim && ini !== fim) return `págs. ${ini}-${fim}`;
  return `pág. ${ini || fim}`;
}

function formatarFontesManuais(trechos) {
  const agrupado = new Map();
  for (const trecho of Array.isArray(trechos) ? trechos : []) {
    const manual = String(trecho?.nome_arquivo || 'Manual').trim() || 'Manual';
    const pagina = formatarPaginasManual(trecho?.pagina_inicial, trecho?.pagina_final);
    if (!agrupado.has(manual)) agrupado.set(manual, new Set());
    agrupado.get(manual).add(pagina);
  }

  return Array.from(agrupado.entries())
    .map(([manual, paginas]) => `${manual} (${Array.from(paginas).join(', ')})`)
    .join(' | ');
}

function resumirReferenciasManuais(trechos, limit = 2) {
  const refs = [];
  const vistos = new Set();

  for (const trecho of Array.isArray(trechos) ? trechos : []) {
    const manual = String(trecho?.nome_arquivo || 'Manual').trim() || 'Manual';
    const pagina = formatarPaginasManual(trecho?.pagina_inicial, trecho?.pagina_final);
    const ref = `${manual} (${pagina})`;
    if (!manual || vistos.has(ref)) continue;
    vistos.add(ref);
    refs.push(ref);
    if (refs.length >= Math.max(1, Number(limit || 2))) break;
  }

  return refs;
}

function selecionarTrechosUnicosParaResposta(trechos, limit = 2) {
  const lista = [];
  const vistos = new Set();

  for (const trecho of Array.isArray(trechos) ? trechos : []) {
    const chave = `${Number(trecho?.manual_id || 0)}:${Number(trecho?.pagina_inicial || 0)}:${Number(trecho?.chunk_ordem || 0)}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    lista.push(trecho);
    if (lista.length >= Math.max(1, Number(limit || 2))) break;
  }

  return lista;
}

function extrairNumerosRelevantesTexto(texto) {
  return Array.from(
    new Set(
      (String(texto || '').match(/\b\d[\d\.\,]{2,}\b/g) || [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )
  ).slice(0, 8);
}

function extrairSegmentosRelevantesTrecho(texto, pergunta, limit = 2) {
  const bruto = String(texto || '').trim();
  if (!bruto) return [];

  const tokens = tokenizarPerguntaParaPreview(pergunta);
  const numeros = extrairNumerosRelevantesTexto(pergunta);
  const linhas = bruto
    .split(/\n+/)
    .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const ranqueados = linhas
    .map((linha, index) => {
      const norm = normalizarTextoManualBusca(linha);
      let score = 0;
      for (const token of tokens) {
        if (norm.includes(token)) score += token.length >= 6 ? 3 : 1;
      }
      for (const numero of numeros) {
        if (linha.includes(numero)) score += 12;
      }
      if (/\b(btu|btus|kw|cop|eer|potencia|capacidade|alimentacao|voltagem)\b/i.test(linha)) score += 2;
      if (/manual fromtherm|^modelo$|^fti$|temperatura ambiente/i.test(linha)) score -= 12;
      return { linha, index, score };
    })
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || a.index - b.index);

  const melhor = ranqueados.find((item) => Number(item.score || 0) > 0);
  if (melhor) {
    const janela = [];
    let anterior = melhor.index > 0 ? linhas[melhor.index - 1] : '';
    const atual = linhas[melhor.index] || '';
    const proxima = melhor.index + 1 < linhas.length ? linhas[melhor.index + 1] : '';
    const regexRotulo = /\b(btu|btus|kw|cop|eer|potencia|capacidade|alimentacao|voltagem|corrente)\b/i;

    if (!regexRotulo.test(anterior) && /\d/.test(atual)) {
      for (let i = melhor.index - 2; i >= Math.max(0, melhor.index - 4); i -= 1) {
        if (regexRotulo.test(linhas[i] || '')) {
          anterior = linhas[i];
          break;
        }
      }
    }

    if (anterior && !/manual fromtherm/i.test(anterior)) janela.push(anterior);
    if (atual) janela.push(atual);
    if (proxima && !janela.includes(proxima) && (/\d/.test(proxima) || /\b(btu|kw|cop|eer|potencia|capacidade)\b/i.test(proxima))) {
      janela.push(proxima);
    }

    return [janela.join(' ').replace(/\s+/g, ' ').trim()];
  }

  return linhas
    .filter((item) => item.length >= 18)
    .slice(0, Math.max(1, Number(limit || 2)));
}

function montarLinksManuaisCompletos(trechos, limit = 2) {
  const manuais = [];
  const vistos = new Set();

  for (const trecho of Array.isArray(trechos) ? trechos : []) {
    const manualId = Number(trecho?.manual_id || 0);
    if (!manualId || vistos.has(manualId)) continue;
    vistos.add(manualId);
    manuais.push({
      manual: String(trecho?.nome_arquivo || 'Manual').trim() || 'Manual',
      page: Math.max(1, Number(trecho?.pagina_inicial || trecho?.pagina_final || 1)),
      assetType: 'manual',
      sourceUrl: String(trecho?.caminho_manual || '').trim(),
      openUrl: String(trecho?.caminho_manual || '').trim()
    });
    if (manuais.length >= Math.max(1, Number(limit || 2))) break;
  }

  return manuais.filter((item) => item.sourceUrl);
}

async function montarRespostaManualCompletoDireta(trechos, pergunta, manualMediaMode) {
  if (!perguntaPedeManualCompleto(pergunta) || manualMediaMode === 'none') return null;

  const baseTrechos = selecionarTrechosUnicosParaResposta(trechos, 2);
  const manualPreviews = montarLinksManuaisCompletos(baseTrechos, 2);
  if (!manualPreviews.length) return null;

  const lista = manualPreviews.map((item) => `${item.manual}`).join(' | ');
  const content = `Segue o manual usado nesta conversa para você consultar direto.\n\nManual: ${lista}\n\nFonte: ${formatarFontesManuais(baseTrechos)}`;

  return {
    content,
    trechos: baseTrechos,
    manualPreviews
  };
}

async function montarRespostaTrechoManualDireta(trechos, pergunta, manualMediaMode, messages = []) {
  if (!perguntaPedeTrechoManual(pergunta)) return null;

  const contextoAnterior = extrairInteracaoAnteriorManual(messages);
  const textoFoco = [contextoAnterior.resumoAnterior, pergunta]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join('\n');

  const ordenados = [...(Array.isArray(trechos) ? trechos : [])]
    .map((trecho) => ({ trecho, scoreResposta: scoreTrechoParaPreview(textoFoco || pergunta, trecho) }))
    .sort((a, b) => Number(b.scoreResposta || 0) - Number(a.scoreResposta || 0))
    .map((item) => item.trecho);

  const baseTrechos = selecionarTrechosUnicosParaResposta(ordenados, 1);
  if (!baseTrechos.length) return null;

  const blocos = baseTrechos.map((trecho) => {
    const segmentos = extrairSegmentosRelevantesTrecho(trecho?.texto, textoFoco || pergunta, 2);
    const cabecalho = `${String(trecho?.nome_arquivo || 'Manual').trim() || 'Manual'} (${formatarPaginasManual(trecho?.pagina_inicial, trecho?.pagina_final)})`;
    return `${cabecalho}:\n- ${segmentos.join('\n- ')}`;
  });

  let manualPreviews = [];
  if (manualMediaMode !== 'none') {
    manualPreviews = await montarPreviewsManuais(baseTrechos, MANUAL_PREVIEW_LIMIT, pergunta, manualMediaMode);
  }

  let content = `Encontrei a parte do manual relacionada ao que acabamos de falar:\n\n${blocos.join('\n\n')}\n\nFonte: ${formatarFontesManuais(baseTrechos)}`;
  if (manualPreviews.length && !/anexei abaixo/i.test(content)) {
    content += manualMediaMode === 'image'
      ? '\n\nAnexei abaixo um atalho para abrir a imagem dessa parte do manual.'
      : '\n\nAnexei abaixo um atalho para abrir a página correspondente do manual.';
  }

  return {
    content,
    trechos: baseTrechos,
    manualPreviews
  };
}

async function inferirRespostaConfiguracaoWifi(pergunta, trechos, { allowGenericWifi = false } = {}) {
  const t = normalizarTextoBusca(pergunta);
  if (!t || !t.includes('wifi')) return null;
  if (!allowGenericWifi && !['configur', 'conectar', 'parear', 'ajustar'].some((item) => t.includes(item))) return null;

  let candidatos = Array.isArray(trechos) ? [...trechos] : [];
  if (dbPool) {
    const [resetDb, appDb] = await Promise.all([
      dbPool.query(
        `
        SELECT
          c.manual_id,
          m.nome_arquivo,
          m.caminho_manual,
          m.conteudo_hash,
          c.chunk_ordem,
          c.pagina_inicial,
          c.pagina_final,
          c.texto
        FROM "Chatbot".manuais_instrucao_chunks c
        JOIN "Chatbot".manuais_instrucao m
          ON m.id = c.manual_id
        WHERE COALESCE(m.status_indexacao, 'pendente') = 'indexado'
          AND COALESCE(c.texto_normalizado, lower(COALESCE(c.texto, ''))) LIKE '%wifi%'
          AND (
            COALESCE(c.texto_normalizado, lower(COALESCE(c.texto, ''))) LIKE '%5 segundos%'
            OR COALESCE(c.texto_normalizado, lower(COALESCE(c.texto, ''))) LIKE '%redefinir%'
            OR COALESCE(c.texto_normalizado, lower(COALESCE(c.texto, ''))) LIKE '%redefinicao%'
          )
        ORDER BY
          CASE WHEN COALESCE(c.texto_normalizado, lower(COALESCE(c.texto, ''))) LIKE '%5 segundos%' THEN 10 ELSE 0 END DESC,
          c.pagina_inicial ASC NULLS LAST,
          c.chunk_ordem ASC
        LIMIT 1
        `
      ),
      dbPool.query(
      `
      SELECT
        c.manual_id,
        m.nome_arquivo,
        m.caminho_manual,
        m.conteudo_hash,
        c.chunk_ordem,
        c.pagina_inicial,
        c.pagina_final,
        c.texto
      FROM "Chatbot".manuais_instrucao_chunks c
      JOIN "Chatbot".manuais_instrucao m
        ON m.id = c.manual_id
      WHERE COALESCE(m.status_indexacao, 'pendente') = 'indexado'
        AND (
          COALESCE(c.texto_normalizado, lower(COALESCE(c.texto, ''))) LIKE '%fromtherm smart%'
          OR COALESCE(c.texto_normalizado, lower(COALESCE(c.texto, ''))) LIKE '%adicionar dispositivo%'
          OR COALESCE(c.texto_normalizado, lower(COALESCE(c.texto, ''))) LIKE '%tempo limite de conexao%'
          OR COALESCE(c.texto_normalizado, lower(COALESCE(c.texto, ''))) LIKE '%redefinir o wifi%'
          OR COALESCE(c.texto_normalizado, lower(COALESCE(c.texto, ''))) LIKE '%redefinicao do wi fi%'
          OR COALESCE(c.texto_normalizado, lower(COALESCE(c.texto, ''))) LIKE '%configuracao wifi%'
        )
      ORDER BY
        (
          CASE WHEN COALESCE(c.texto_normalizado, lower(COALESCE(c.texto, ''))) LIKE '%fromtherm smart%' THEN 4 ELSE 0 END +
          CASE WHEN COALESCE(c.texto_normalizado, lower(COALESCE(c.texto, ''))) LIKE '%adicionar dispositivo%' THEN 4 ELSE 0 END +
          CASE WHEN COALESCE(c.texto_normalizado, lower(COALESCE(c.texto, ''))) LIKE '%tempo limite de conexao%' THEN 3 ELSE 0 END +
          CASE WHEN COALESCE(c.texto_normalizado, lower(COALESCE(c.texto, ''))) LIKE '%configuracao wifi%' THEN 2 ELSE 0 END
        ) DESC,
        c.pagina_inicial ASC NULLS LAST,
        c.chunk_ordem ASC
      LIMIT 4
      `
      )
    ]);
    candidatos = deduplicarTrechosManuais([
      ...candidatos,
      ...(Array.isArray(resetDb?.rows) ? resetDb.rows : []),
      ...(Array.isArray(appDb?.rows) ? appDb.rows : [])
    ]);
  }

  const trechoReset = candidatos.find((trecho) => {
    const texto = normalizarTextoManualBusca(trecho?.texto);
    return texto.includes('5 segundos') && (texto.includes('redefinir o wifi') || texto.includes('redefinicao do wi fi') || texto.includes('configuracao wifi'));
  });
  const trechoApp = candidatos.find((trecho) => {
    const texto = normalizarTextoManualBusca(trecho?.texto);
    return texto.includes('fromtherm smart') || texto.includes('adicionar dispositivo') || texto.includes('tempo limite de conexao');
  });

  if (!trechoReset && !trechoApp) return null;

  const passos = [];
  if (trechoReset) {
    passos.push('No painel do controlador, entre na interface de configuração Wi-Fi e mantenha o botão correspondente pressionado por 5 segundos para redefinir o Wi-Fi.');
  }
  if (trechoApp) {
    passos.push('No celular, abra o aplicativo Fromtherm Smart e inicie a inclusão do equipamento em "Adicionar dispositivo".');
    passos.push('Se o equipamento não aparecer automaticamente, use a opção de detecção automática pelo botão "+".');
    passos.push('Selecione a rede Wi-Fi, informe a senha e avance para concluir a vinculação.');
    passos.push('Se aparecer "Tempo limite de conexão", repita a opção "Adicionar dispositivo" até a conexão concluir.');
  }

  let content = 'Para configurar o Wi-Fi da bomba de calor, siga este procedimento:\n\n';
  content += passos.map((passo, idx) => `${idx + 1}. ${passo}`).join('\n');

  if (!extrairModelosPergunta(pergunta).length) {
    content += '\n\nComo você não informou o modelo, trate isso como procedimento geral para os modelos com controlador/aplicativo Wi-Fi.';
  }

  content += `\n\nFonte: ${formatarFontesManuais([trechoReset, trechoApp].filter(Boolean))}`;

  return {
    content,
    trechos: deduplicarTrechosManuais([trechoReset, trechoApp].filter(Boolean)),
    manualPreviews: []
  };
}

async function inferirRespostaTensaoModeloFti(pergunta, trechos) {
  if (!perguntaPedeTensaoOuVoltagem(pergunta)) return null;

  const raw = String(pergunta || '');
  const match = raw.match(/\bfti\s*[- ]?\s*(25|35|45|55|75|105|125)\s*[- ]?\s*([dl])\s*[- ]?\s*(\d{2})\s*[- ]?\s*([a-z]{0,4})\b/i);
  if (!match) return null;

  let trechoBase = (Array.isArray(trechos) ? trechos : []).find((trecho) => {
    const manual = normalizarTextoManualBusca(trecho?.nome_arquivo);
    const texto = normalizarTextoManualBusca(trecho?.texto);
    return manual.includes('fti 25') && manual.includes('fti 125') && texto.includes('220 v monofasico') && texto.includes('380 v trifasico');
  });
  if (!trechoBase && dbPool) {
    const { rows } = await dbPool.query(
      `
      SELECT
        c.manual_id,
        m.nome_arquivo,
        m.caminho_manual,
        m.conteudo_hash,
        c.chunk_ordem,
        c.pagina_inicial,
        c.pagina_final,
        c.texto
      FROM "Chatbot".manuais_instrucao_chunks c
      JOIN "Chatbot".manuais_instrucao m
        ON m.id = c.manual_id
      WHERE COALESCE(m.status_indexacao, 'pendente') = 'indexado'
        AND lower(COALESCE(m.nome_arquivo, '')) LIKE '%fti - 25%'
        AND lower(COALESCE(m.nome_arquivo, '')) LIKE '%fti - 125%'
        AND lower(COALESCE(c.texto, '')) LIKE '%220 v monof%'
        AND lower(COALESCE(c.texto, '')) LIKE '%380 v trif%'
      ORDER BY c.pagina_inicial ASC NULLS LAST, c.chunk_ordem ASC
      LIMIT 1
      `
    );
    trechoBase = Array.isArray(rows) && rows.length ? rows[0] : null;
  }
  if (!trechoBase) return null;

  const serie = match[1];
  const composicao = String(match[2] || '').toUpperCase();
  const aplicacao = match[3];
  const cor = String(match[4] || '').toUpperCase();
  const modeloInformado = `FTI-${serie}${composicao}${aplicacao}${cor}`.replace(/-$/, '');
  const tensao = composicao === 'D' ? '220 V monofásico' : '380 V trifásico';
  const corTexto = cor === 'PT' ? 'preto' : cor === 'CZ' ? 'cinza' : '';

  let content = `Pela codificação do modelo ${modeloInformado}, a letra ${composicao} indica alimentação ${tensao} com degelo.`;
  if (aplicacao) {
    content += ` O campo ${aplicacao} indica aplicação para aquecimento até ${Number(aplicacao)}°C.`;
  }
  if (corTexto) {
    content += ` O sufixo ${cor} indica cor ${corTexto}.`;
  }

  content += `\n\nFonte: ${String(trechoBase?.nome_arquivo || 'Manual')} (${formatarPaginasManual(trechoBase?.pagina_inicial, trechoBase?.pagina_final)})`;

  return {
    content,
    trechos: [trechoBase],
    manualPreviews: []
  };
}

function hashCurtoManual(valor) {
  return crypto.createHash('sha1').update(String(valor || '')).digest('hex').slice(0, 16);
}

async function garantirPastasCacheManuais() {
  await Promise.all([
    fsp.mkdir(MANUAL_PREVIEW_TMP_DIR, { recursive: true }),
    fsp.mkdir(MANUAL_PDF_CACHE_DIR, { recursive: true })
  ]);
}

async function baixarPdfManualCacheado({ caminhoManual, conteudoHash }) {
  await garantirPastasCacheManuais();
  const extensao = path.extname(new URL(String(caminhoManual || '').trim()).pathname || '').toLowerCase() || '.pdf';
  const baseNome = `${hashCurtoManual(conteudoHash || caminhoManual)}${extensao === '.pdf' ? '' : '.pdf'}`;
  const arquivoPdf = path.join(MANUAL_PDF_CACHE_DIR, baseNome);

  if (fs.existsSync(arquivoPdf)) return arquivoPdf;

  const response = await axios.get(String(caminhoManual || '').trim(), {
    responseType: 'arraybuffer',
    timeout: 60000
  });
  await fsp.writeFile(arquivoPdf, Buffer.from(response.data));
  return arquivoPdf;
}

function obterHashReferenciaPreview(trecho) {
  const raw = String(trecho?.conteudo_hash || '').trim();
  return raw || hashCurtoManual(`${trecho?.manual_id || 0}|${trecho?.caminho_manual || ''}`);
}

function montarUrlPaginaManual(caminhoManual, pagina) {
  const url = String(caminhoManual || '').trim();
  const paginaNum = Math.max(1, Number(pagina || 1));
  if (!url) return '';
  return `${url}#page=${paginaNum}`;
}

async function buscarPreviewManualCacheado({ manualId, pagina, conteudoHashRef }) {
  if (!dbPool || !manualId || !pagina || !conteudoHashRef) return null;

  const { rows } = await dbPool.query(
    `
      SELECT manual_id, pagina, conteudo_hash_ref, source_url, bucket, path_key, public_url
      FROM "Chatbot".manual_preview_cache
      WHERE manual_id = $1
        AND pagina = $2
        AND conteudo_hash_ref = $3
      LIMIT 1
    `,
    [manualId, pagina, conteudoHashRef]
  );

  return rows?.[0] || null;
}

async function salvarPreviewManualCacheado({
  manualId,
  pagina,
  conteudoHashRef,
  sourceUrl,
  bucket,
  pathKey,
  publicUrl
}) {
  if (!dbPool || !manualId || !pagina || !conteudoHashRef || !bucket || !pathKey || !publicUrl) return null;

  const { rows } = await dbPool.query(
    `
      INSERT INTO "Chatbot".manual_preview_cache (
        manual_id,
        pagina,
        conteudo_hash_ref,
        source_url,
        bucket,
        path_key,
        public_url,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      ON CONFLICT (manual_id, pagina, conteudo_hash_ref)
      DO UPDATE SET
        source_url = EXCLUDED.source_url,
        bucket = EXCLUDED.bucket,
        path_key = EXCLUDED.path_key,
        public_url = EXCLUDED.public_url,
        updated_at = NOW()
      RETURNING manual_id, pagina, conteudo_hash_ref, source_url, bucket, path_key, public_url
    `,
    [manualId, pagina, conteudoHashRef, sourceUrl || null, bucket, pathKey, publicUrl]
  );

  return rows?.[0] || null;
}

function montarAnexoManualBase(trecho, pagina, assetType = 'link') {
  const caminhoManual = String(trecho?.caminho_manual || '').trim();
  return {
    manual: String(trecho?.nome_arquivo || 'Manual').trim() || 'Manual',
    page: pagina,
    assetType,
    sourceUrl: caminhoManual,
    openUrl: montarUrlPaginaManual(caminhoManual, pagina)
  };
}

async function gerarPreviewPaginaManual(trecho, { mediaMode = 'link' } = {}) {
  const pagina = Math.max(1, Number(trecho?.pagina_inicial || trecho?.pagina_final || 1));
  const manualId = Number(trecho?.manual_id || 0);
  const caminhoManual = String(trecho?.caminho_manual || '').trim();
  if (!manualId || !caminhoManual) return null;

  const base = montarAnexoManualBase(trecho, pagina, mediaMode === 'image' ? 'image' : 'link');
  if (mediaMode !== 'image') return base;

  const conteudoHashRef = obterHashReferenciaPreview(trecho);
  const cacheExistente = await buscarPreviewManualCacheado({ manualId, pagina, conteudoHashRef }).catch((err) => {
    console.warn('[AI/Manuais] Falha ao consultar cache de preview:', err?.message || err);
    return null;
  });
  if (cacheExistente?.public_url) {
    return {
      ...base,
      imageUrl: String(cacheExistente.public_url || '').trim()
    };
  }

  const pdfPath = await baixarPdfManualCacheado({
    caminhoManual,
    conteudoHash: conteudoHashRef
  });

  const nomeHash = hashCurtoManual(`${conteudoHashRef}|${caminhoManual}|${pagina}`);
  const nomeBase = `manual-${manualId}-p${pagina}-${nomeHash}`;
  const outputBase = path.join(MANUAL_PREVIEW_TMP_DIR, nomeBase);
  const outputFile = `${outputBase}.jpg`;

  if (!fs.existsSync(outputFile)) {
    await execFileAsync('pdftoppm', [
      '-jpeg',
      '-scale-to', '1200',
      '-f', String(pagina),
      '-l', String(pagina),
      '-singlefile',
      pdfPath,
      outputBase
    ], { timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
  }

  if (!fs.existsSync(outputFile)) return null;

  const buffer = await fsp.readFile(outputFile);
  const pathKey = `${MANUAL_PREVIEW_SUPABASE_PREFIX}/manual-${manualId}/pagina-${pagina}-${nomeHash}.jpg`;
  const { error: uploadErr } = await supabase
    .storage
    .from(MANUAL_PREVIEW_BUCKET)
    .upload(pathKey, buffer, {
      contentType: 'image/jpeg',
      upsert: true
    });

  if (uploadErr) {
    console.warn('[AI/Manuais] Falha ao enviar preview para Supabase:', uploadErr?.message || uploadErr);
    return base;
  }

  const { data: publicData } = supabase.storage.from(MANUAL_PREVIEW_BUCKET).getPublicUrl(pathKey);
  const publicUrl = String(publicData?.publicUrl || '').trim();
  if (!publicUrl) return base;

  await salvarPreviewManualCacheado({
    manualId,
    pagina,
    conteudoHashRef,
    sourceUrl: caminhoManual,
    bucket: MANUAL_PREVIEW_BUCKET,
    pathKey,
    publicUrl
  }).catch((err) => {
    console.warn('[AI/Manuais] Falha ao salvar cache SQL do preview:', err?.message || err);
  });

  return {
    ...base,
    imageUrl: publicUrl
  };
}

function tokenizarPerguntaParaPreview(pergunta) {
  const stopwords = new Set([
    'como', 'para', 'com', 'sem', 'uma', 'uns', 'umas', 'que', 'qual', 'quais',
    'onde', 'quando', 'sobre', 'manual', 'bomba', 'calor', 'fromtherm', 'pagina',
    'paginas', 'imagem', 'foto', 'fotos', 'mostra', 'mostrar', 'manda', 'enviar',
    'quero', 'preciso', 'aqui', 'isso', 'essa', 'esse'
  ]);

  return Array.from(
    new Set(
      normalizarTextoManualBusca(pergunta)
        .split(/\s+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 3 && !stopwords.has(item))
    )
  ).slice(0, 10);
}

function scoreTrechoParaPreview(pergunta, trecho) {
  const tokens = tokenizarPerguntaParaPreview(pergunta);
  const numeros = extrairNumerosRelevantesTexto(pergunta);
  const modelos = extrairModelosPergunta(pergunta);
  const nome = normalizarTextoManualBusca(trecho?.nome_arquivo);
  const texto = normalizarTextoManualBusca(trecho?.texto);
  const textoBruto = String(trecho?.texto || '');
  let score = Number(trecho?.score || 0);

  for (const token of tokens) {
    if (nome.includes(token)) score += 40;
    if (texto.includes(token)) score += 14;
  }

  for (const numero of numeros) {
    if (textoBruto.includes(numero)) score += 120;
    if (texto.includes(normalizarTextoManualBusca(numero))) score += 80;
  }

  score += calcularScoreModeloNoTexto(`${nome} ${texto}`, modelos, {
    exact: 120,
    compact: 150,
    familiaNumero: 40
  });

  return score;
}

async function montarPreviewsManuais(trechos, limit = MANUAL_PREVIEW_LIMIT, pergunta = '', mediaMode = 'link') {
  if (mediaMode === 'none') return [];

  const candidatos = [];
  const vistos = new Set();
  const listaBase = Array.isArray(trechos) ? [...trechos] : [];
  const ordenados = String(pergunta || '').trim()
    ? listaBase
        .map((trecho) => ({ trecho, previewScore: scoreTrechoParaPreview(pergunta, trecho) }))
        .sort((a, b) => Number(b.previewScore || 0) - Number(a.previewScore || 0))
        .map((item) => item.trecho)
    : listaBase;

  for (const trecho of ordenados) {
    const pagina = Math.max(1, Number(trecho?.pagina_inicial || trecho?.pagina_final || 1));
    const chave = `${Number(trecho?.manual_id || 0)}:${pagina}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    candidatos.push(trecho);
    if (candidatos.length >= Math.max(1, Number(limit || MANUAL_PREVIEW_LIMIT))) break;
  }

  const previews = await Promise.all(candidatos.map(async (trecho) => {
    try {
      return await gerarPreviewPaginaManual(trecho, { mediaMode });
    } catch (err) {
      console.warn('[AI/Manuais] Falha ao gerar preview da página:', err?.message || err);
      return null;
    }
  }));

  return previews.filter(Boolean);
}

async function listarManuaisPrioritariosPorModelo(modelos) {
  if (!dbPool || !Array.isArray(modelos) || !modelos.length) return [];

  const resultado = await dbPool.query(
    `
    SELECT id, nome_arquivo, COALESCE(nome_arquivo_normalizado, nome_arquivo, '') AS nome_arquivo_normalizado
    FROM "Chatbot".manuais_instrucao
    WHERE COALESCE(status_indexacao, 'pendente') = 'indexado'
    `
  );

  return (Array.isArray(resultado.rows) ? resultado.rows : [])
    .map((manual) => ({
      ...manual,
      score_modelo: calcularScoreModeloNoTexto(manual?.nome_arquivo_normalizado, modelos, {
        exact: 800,
        compact: 950,
        familiaNumero: 250
      })
    }))
    .filter((manual) => Number(manual.score_modelo || 0) > 0)
    .sort((a, b) => {
      if (Number(b.score_modelo || 0) !== Number(a.score_modelo || 0)) {
        return Number(b.score_modelo || 0) - Number(a.score_modelo || 0);
      }
      return Number(a.id || 0) - Number(b.id || 0);
    });
}

async function buscarTrechosManuaisFts(perguntaNorm, limit, manualIds = []) {
  const params = [perguntaNorm];
  let filtroManual = '';

  if (Array.isArray(manualIds) && manualIds.length) {
    params.push(manualIds.map((item) => Number(item)).filter(Boolean));
    filtroManual = ` AND c.manual_id = ANY($${params.length}::bigint[])`;
  }

  params.push(Math.max(1, Number(limit || MANUAL_MAX_CHUNKS)));

  const resultado = await dbPool.query(
    `
    SELECT
      c.manual_id,
      m.nome_arquivo,
      m.caminho_manual,
      m.conteudo_hash,
      c.chunk_ordem,
      c.pagina_inicial,
      c.pagina_final,
      c.texto,
      ts_rank_cd(
        to_tsvector('simple', COALESCE(m.nome_arquivo_normalizado, '') || ' ' || COALESCE(c.texto_normalizado, '')),
        plainto_tsquery('simple', $1)
      ) AS score
    FROM "Chatbot".manuais_instrucao_chunks c
    JOIN "Chatbot".manuais_instrucao m
      ON m.id = c.manual_id
    WHERE COALESCE(m.status_indexacao, 'pendente') = 'indexado'
      ${filtroManual}
      AND to_tsvector('simple', COALESCE(m.nome_arquivo_normalizado, '') || ' ' || COALESCE(c.texto_normalizado, ''))
        @@ plainto_tsquery('simple', $1)
    ORDER BY score DESC, c.manual_id ASC, c.chunk_ordem ASC
    LIMIT $${params.length}
    `,
    params
  );

  return Array.isArray(resultado.rows) ? resultado.rows : [];
}

async function buscarTrechosManuaisLike(tokens, limit, manualIds = []) {
  if (!Array.isArray(tokens) || !tokens.length) return [];

  const tokenPairs = tokens
    .map((token) => {
      const normal = normalizarTextoManualBusca(token);
      const compacto = compactarTextoManual(token);
      if (!normal && !compacto) return null;
      return {
        normal: normal ? `%${normal}%` : null,
        compacto: compacto ? `%${compacto}%` : null
      };
    })
    .filter(Boolean);

  if (!tokenPairs.length) return [];

  const params = [];
  const condicoes = [];
  const scoreParts = [];

  tokenPairs.forEach((pair) => {
    const subConds = [];

    if (pair.normal) {
      params.push(pair.normal);
      const idx = params.length;
      subConds.push(`COALESCE(m.nome_arquivo_normalizado, '') LIKE $${idx}`);
      subConds.push(`COALESCE(c.texto_normalizado, '') LIKE $${idx}`);
      scoreParts.push(`CASE WHEN COALESCE(m.nome_arquivo_normalizado, '') LIKE $${idx} OR COALESCE(c.texto_normalizado, '') LIKE $${idx} THEN 1 ELSE 0 END`);
    }

    if (pair.compacto) {
      params.push(pair.compacto);
      const idx = params.length;
      subConds.push(`regexp_replace(COALESCE(m.nome_arquivo_normalizado, ''), '[^a-z0-9]+', '', 'gi') LIKE $${idx}`);
      subConds.push(`regexp_replace(COALESCE(c.texto_normalizado, ''), '[^a-z0-9]+', '', 'gi') LIKE $${idx}`);
      scoreParts.push(`CASE WHEN regexp_replace(COALESCE(m.nome_arquivo_normalizado, ''), '[^a-z0-9]+', '', 'gi') LIKE $${idx} OR regexp_replace(COALESCE(c.texto_normalizado, ''), '[^a-z0-9]+', '', 'gi') LIKE $${idx} THEN 1.25 ELSE 0 END`);
    }

    if (subConds.length) {
      condicoes.push(`(${subConds.join(' OR ')})`);
    }
  });

  let filtroManual = '';

  if (Array.isArray(manualIds) && manualIds.length) {
    params.push(manualIds.map((item) => Number(item)).filter(Boolean));
    filtroManual = ` AND c.manual_id = ANY($${params.length}::bigint[])`;
  }

  const scoreExpr = scoreParts.length ? scoreParts.join(' + ') : '0';

  params.push(Math.max(1, Number(limit || MANUAL_MAX_CHUNKS)));

  const resultado = await dbPool.query(
    `
    SELECT
      c.manual_id,
      m.nome_arquivo,
      m.caminho_manual,
      m.conteudo_hash,
      c.chunk_ordem,
      c.pagina_inicial,
      c.pagina_final,
      c.texto,
      (${scoreExpr})::float AS score
    FROM "Chatbot".manuais_instrucao_chunks c
    JOIN "Chatbot".manuais_instrucao m
      ON m.id = c.manual_id
    WHERE COALESCE(m.status_indexacao, 'pendente') = 'indexado'
      ${filtroManual}
      AND ${condicoes.length ? `(${condicoes.join(' OR ')})` : 'TRUE'}
    ORDER BY score DESC, c.manual_id ASC, c.chunk_ordem ASC
    LIMIT $${params.length}
    `,
    params
  );

  return Array.isArray(resultado.rows) ? resultado.rows : [];
}

function extrairPaginasDaFonteManual(textoFonte) {
  const texto = String(textoFonte || '');
  const paginas = new Set();
  const regex = /p[aá]g(?:s?\.?)?\s*(\d+)(?:\s*[-–]\s*(\d+))?/ig;
  let match;

  while ((match = regex.exec(texto))) {
    const ini = Number(match[1] || 0);
    const fim = Number(match[2] || 0);
    if (ini) paginas.add(ini);
    if (ini && fim && fim >= ini && fim - ini <= 8) {
      for (let p = ini + 1; p <= fim; p += 1) paginas.add(p);
    } else if (fim) {
      paginas.add(fim);
    }
  }

  return Array.from(paginas).sort((a, b) => a - b);
}

async function buscarTrechosManuaisPorPaginas(paginas, limit, manualIds = []) {
  if (!dbPool || !Array.isArray(paginas) || !paginas.length) return [];

  const params = [paginas.map((item) => Number(item)).filter(Boolean)];
  let filtroManual = '';
  let orderManual = '';

  if (Array.isArray(manualIds) && manualIds.length) {
    params.push(manualIds.map((item) => Number(item)).filter(Boolean));
    filtroManual = ` AND c.manual_id = ANY($${params.length}::bigint[])`;
    orderManual = `array_position($${params.length}::bigint[], c.manual_id) ASC NULLS LAST,`;
  }

  params.push(Math.max(1, Number(limit || MANUAL_MAX_CHUNKS)));

  const { rows } = await dbPool.query(
    `
    SELECT
      c.manual_id,
      m.nome_arquivo,
      m.caminho_manual,
      m.conteudo_hash,
      c.chunk_ordem,
      c.pagina_inicial,
      c.pagina_final,
      c.texto,
      1000::float AS score
    FROM "Chatbot".manuais_instrucao_chunks c
    JOIN "Chatbot".manuais_instrucao m
      ON m.id = c.manual_id
    WHERE COALESCE(m.status_indexacao, 'pendente') = 'indexado'
      ${filtroManual}
      AND EXISTS (
        SELECT 1
        FROM unnest($1::int[]) AS p(pagina)
        WHERE p.pagina BETWEEN c.pagina_inicial AND c.pagina_final
      )
    ORDER BY ${orderManual} c.manual_id ASC, c.pagina_inicial ASC, c.chunk_ordem ASC
    LIMIT $${params.length}
    `,
    params
  );

  return Array.isArray(rows) ? rows : [];
}

async function buscarTrechosReferenciaisPorFonteAnterior(pergunta, messages = []) {
  const contexto = extrairInteracaoAnteriorManual(messages);
  const paginas = extrairPaginasDaFonteManual(contexto.fonteAnterior);
  if (!paginas.length) return [];

  const modelos = extrairModelosPergunta(pergunta);
  const manuaisPrioritarios = await listarManuaisPrioritariosPorModelo(modelos);
  const manualIdsPrioritarios = manuaisPrioritarios
    .slice(0, 3)
    .map((manual) => Number(manual.id || 0))
    .filter(Boolean);

  let rows = await buscarTrechosManuaisPorPaginas(paginas, MANUAL_MAX_CHUNKS, manualIdsPrioritarios);
  if (!rows.length) {
    rows = await buscarTrechosManuaisPorPaginas(paginas, MANUAL_MAX_CHUNKS);
  }

  return rows;
}

function deduplicarTrechosManuais(trechos) {
  const mapa = new Map();
  for (const trecho of Array.isArray(trechos) ? trechos : []) {
    const chave = `${Number(trecho?.manual_id || 0)}:${Number(trecho?.chunk_ordem || 0)}`;
    const scoreAtual = Number(trecho?.score || 0);
    const existente = mapa.get(chave);
    if (!existente || scoreAtual > Number(existente?.score || 0)) {
      mapa.set(chave, {
        ...trecho,
        score: scoreAtual
      });
    }
  }
  return Array.from(mapa.values());
}

function reranquearTrechosManuais(trechos, modelos, manualScoreMap = new Map()) {
  return deduplicarTrechosManuais(trechos)
    .map((trecho) => {
      const manualId = Number(trecho?.manual_id || 0);
      const baseScore = Number(trecho?.score || 0);
      const bonusManual = Number(manualScoreMap.get(manualId) || 0);
      const bonusNome = calcularScoreModeloNoTexto(trecho?.nome_arquivo, modelos, {
        exact: 700,
        compact: 850,
        familiaNumero: 220
      });
      const bonusTexto = calcularScoreModeloNoTexto(trecho?.texto, modelos, {
        exact: 90,
        compact: 120,
        familiaNumero: 30
      });

      return {
        ...trecho,
        score: baseScore + bonusManual + bonusNome + bonusTexto
      };
    })
    .sort((a, b) => {
      if (Number(b.score || 0) !== Number(a.score || 0)) {
        return Number(b.score || 0) - Number(a.score || 0);
      }
      if (Number(a.manual_id || 0) !== Number(b.manual_id || 0)) {
        return Number(a.manual_id || 0) - Number(b.manual_id || 0);
      }
      return Number(a.chunk_ordem || 0) - Number(b.chunk_ordem || 0);
    });
}

async function buscarTrechosManuais(pergunta, { limit = MANUAL_MAX_CHUNKS } = {}) {
  if (!dbPool) return [];
  await garantirTabelasManuaisChatbot();

  const perguntaNorm = normalizarTextoManualBusca(pergunta).slice(0, 500);
  if (!perguntaNorm) return [];

  const modelos = extrairModelosPergunta(pergunta);
  const manuaisPrioritarios = await listarManuaisPrioritariosPorModelo(modelos);
  const manualScoreMap = new Map(
    manuaisPrioritarios.map((manual) => [Number(manual.id || 0), Number(manual.score_modelo || 0)])
  );
  const manualIdsPrioritarios = manuaisPrioritarios
    .slice(0, 3)
    .map((manual) => Number(manual.id || 0))
    .filter(Boolean);
  const buscaRestritaPorModelo = manualIdsPrioritarios.length > 0;
  const limiteBusca = Math.max(Math.max(1, Number(limit || MANUAL_MAX_CHUNKS)) * 4, 24);

  let rows = [];
  try {
    if (buscaRestritaPorModelo) {
      rows = await buscarTrechosManuaisFts(perguntaNorm, limiteBusca, manualIdsPrioritarios);
    }
    if (!buscaRestritaPorModelo && rows.length < limit) {
      const complemento = await buscarTrechosManuaisFts(perguntaNorm, limiteBusca);
      rows = deduplicarTrechosManuais([...rows, ...complemento]);
    }
  } catch (err) {
    console.warn('[AI/Manuais] Falha na busca FTS:', err?.message || err);
  }

  const stopwords = new Set(['como', 'para', 'com', 'sem', 'uma', 'uns', 'umas', 'que', 'qual', 'quais', 'onde', 'quando', 'sobre', 'manual', 'bomba', 'calor', 'fromtherm']);
  const tokens = Array.from(
    new Set(
      perguntaNorm
        .split(/\s+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 3 && !stopwords.has(item))
    )
  ).slice(0, 8);

  if (tokens.length) {
    try {
      if (buscaRestritaPorModelo) {
        const fallbackPrioritario = await buscarTrechosManuaisLike(tokens, limiteBusca, manualIdsPrioritarios);
        rows = deduplicarTrechosManuais([...rows, ...fallbackPrioritario]);
      }
      if (!buscaRestritaPorModelo) {
        const fallbackGeral = await buscarTrechosManuaisLike(tokens, limiteBusca);
        rows = deduplicarTrechosManuais([...rows, ...fallbackGeral]);
      }
    } catch (err) {
      console.warn('[AI/Manuais] Falha na busca por LIKE:', err?.message || err);
    }
  }

  return reranquearTrechosManuais(rows, modelos, manualScoreMap)
    .slice(0, Math.max(1, Number(limit || MANUAL_MAX_CHUNKS)));
}

async function tentarResponderComManuais({
  apiKey,
  pergunta,
  forceManual = false,
  messages = [],
  manualMediaMode = 'none'
}) {
  if (!dbPool || (!forceManual && !perguntaPedeManualBombaCalor(pergunta))) return null;

  if (perguntaPareceUsarNumeroOsSemModelo(pergunta)) {
    return {
      content: montarRespostaSolicitandoModeloManual(),
      trechos: [],
      manualPreviews: []
    };
  }

  const perguntaEfetiva = enriquecerPerguntaManualComHistorico(pergunta, messages);
  const pedidoReferencial =
    perguntaPedeTrechoManual(pergunta) ||
    perguntaPedeManualCompleto(pergunta) ||
    perguntaPedeImagemManual(pergunta) ||
    perguntaPedeLinkManual(pergunta);

  let trechos = [];
  if (pedidoReferencial) {
    trechos = await buscarTrechosReferenciaisPorFonteAnterior(perguntaEfetiva, messages);
  }
  if (!trechos.length) {
    trechos = await buscarTrechosManuais(perguntaEfetiva, { limit: MANUAL_MAX_CHUNKS });
  }
  if (!trechos.length) {
    return {
      content: forceManual
        ? 'Não encontrei essa resposta nos manuais técnicos indexados. Se puder, informe o modelo do equipamento ou descreva o procedimento com outras palavras.'
        : 'Não encontrei essa resposta nos manuais indexados de bomba de calor. Se quiser, posso tentar localizar por outro termo ou modelo específico.',
      trechos: [],
      manualPreviews: []
    };
  }

  const respostaManualCompleto = await montarRespostaManualCompletoDireta(trechos, perguntaEfetiva, manualMediaMode);
  if (respostaManualCompleto?.content) {
    return respostaManualCompleto;
  }

  const respostaTrechoManual = await montarRespostaTrechoManualDireta(trechos, perguntaEfetiva, manualMediaMode, messages);
  if (respostaTrechoManual?.content) {
    return respostaTrechoManual;
  }

  const respostaWifi = await inferirRespostaConfiguracaoWifi(perguntaEfetiva, trechos, {
    allowGenericWifi: manualMediaMode !== 'none'
  });
  if (respostaWifi?.content) {
    let contentWifi = String(respostaWifi.content || '').trim();
    let manualPreviewsWifi = [];

    if (manualMediaMode !== 'none') {
      manualPreviewsWifi = await montarPreviewsManuais(
        respostaWifi.trechos || [],
        MANUAL_PREVIEW_LIMIT,
        perguntaEfetiva,
        manualMediaMode
      );
      if (manualPreviewsWifi.length && !/anexei abaixo/i.test(contentWifi)) {
        contentWifi += manualMediaMode === 'image'
          ? '\n\nAnexei abaixo um atalho para abrir a imagem da página correspondente.'
          : '\n\nAnexei abaixo um atalho para abrir a página do manual correspondente.';
      }
    }

    return {
      ...respostaWifi,
      content: contentWifi,
      manualPreviews: manualPreviewsWifi
    };
  }

  const respostaDeterministica = await inferirRespostaTensaoModeloFti(perguntaEfetiva, trechos);
  if (respostaDeterministica?.content) {
    let contentDet = String(respostaDeterministica.content || '').trim();
    let manualPreviewsDet = [];

    if (manualMediaMode !== 'none') {
      manualPreviewsDet = await montarPreviewsManuais(
        respostaDeterministica.trechos || [],
        MANUAL_PREVIEW_LIMIT,
        perguntaEfetiva,
        manualMediaMode
      );
      if (manualPreviewsDet.length && !/anexei abaixo/i.test(contentDet)) {
        contentDet += manualMediaMode === 'image'
          ? '\n\nAnexei abaixo um atalho para abrir a imagem da página correspondente.'
          : '\n\nAnexei abaixo um atalho para abrir a página do manual correspondente.';
      }
    }

    return {
      ...respostaDeterministica,
      content: contentDet,
      manualPreviews: manualPreviewsDet
    };
  }

  const modelos = extrairModelosPergunta(perguntaEfetiva);
  const contextoModelos = modelos.length
    ? `Modelos citados pelo usuário: ${modelos.map((modelo) => modelo.canonico).join(', ')}. Priorize somente esses modelos ao responder.\n\n`
    : '';
  const contexto = trechos.map((trecho, idx) => {
    const manual = String(trecho?.nome_arquivo || 'Manual').trim() || 'Manual';
    const paginas = formatarPaginasManual(trecho?.pagina_inicial, trecho?.pagina_final);
    const texto = String(trecho?.texto || '').trim().slice(0, 1800);
    return `[Trecho ${idx + 1}]\nManual: ${manual}\nPágina(s): ${paginas}\n${texto}`;
  }).join('\n\n');

  const response = await chamarOpenAiComRetry(
    apiKey,
    {
      model: 'gpt-4o-mini',
      temperature: 0.1,
      max_tokens: 650,
      messages: [
        { role: 'system', content: MANUAL_CHAT_PROMPT },
        {
          role: 'user',
          content:
`Pergunta do usuário:
${perguntaEfetiva}

${contextoModelos}Trechos relevantes dos manuais indexados:
${contexto}`
        }
      ]
    },
    { timeout: 30000, contexto: 'AI/Chat/Manual' }
  );

  let content = String(response.data?.choices?.[0]?.message?.content || '').trim();
  if (!content) {
    content = 'Não consegui montar uma resposta confiável a partir dos manuais indexados.';
  }
  if (!/\bfonte:/i.test(content)) {
    content = `${content}\n\nFonte: ${formatarFontesManuais(trechos)}`;
  }

  let manualPreviews = [];
  if (manualMediaMode !== 'none') {
    manualPreviews = await montarPreviewsManuais(trechos, MANUAL_PREVIEW_LIMIT, perguntaEfetiva, manualMediaMode);
    if (manualPreviews.length && !/anexei abaixo/i.test(content)) {
      content += manualMediaMode === 'image'
        ? '\n\nAnexei abaixo um atalho para abrir a imagem da página correspondente.'
        : '\n\nAnexei abaixo um atalho para abrir a página do manual correspondente.';
    }
  }

  return { content, trechos, manualPreviews };
}

function logAiChatInfo(etapa, detalhes = {}) {
  console.log(`[AI/Chat] ${etapa}`, detalhes);
}

function logAiReportInfo(etapa, detalhes = {}) {
  console.log(`[AI/Report] ${etapa}`, detalhes);
}

async function garantirTabelaMensagensErro() {
  if (!dbPool) return false;
  if (!chatbotLogTableReadyPromise) {
    chatbotLogTableReadyPromise = (async () => {
      await dbPool.query(`
        CREATE SCHEMA IF NOT EXISTS "Chatbot";
        CREATE TABLE IF NOT EXISTS "Chatbot"."Mensagens_erro" (
          id BIGSERIAL PRIMARY KEY,
          criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          rota TEXT NOT NULL,
          motivo TEXT NOT NULL,
          usuario TEXT NULL,
          pergunta TEXT NOT NULL,
          resposta TEXT NULL,
          http_status INTEGER NULL,
          detalhes JSONB NULL
        )
      `);
      await dbPool.query(`
        CREATE INDEX IF NOT EXISTS idx_chatbot_mensagens_erro_criado_em
          ON "Chatbot"."Mensagens_erro" (criado_em DESC)
      `);
      schemaCache.expiresAt = 0;
    })().catch((err) => {
      chatbotLogTableReadyPromise = null;
      throw err;
    });
  }
  await chatbotLogTableReadyPromise;
  return true;
}

async function garantirTabelasManuaisChatbot() {
  if (!dbPool) return false;
  if (!chatbotManualTableReadyPromise) {
    chatbotManualTableReadyPromise = (async () => {
      await dbPool.query(`
        CREATE SCHEMA IF NOT EXISTS "Chatbot";

        CREATE TABLE IF NOT EXISTS "Chatbot".manuais_instrucao (
          id BIGSERIAL PRIMARY KEY,
          nome_arquivo TEXT NOT NULL,
          caminho_manual TEXT NOT NULL UNIQUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        ALTER TABLE "Chatbot".manuais_instrucao
          ADD COLUMN IF NOT EXISTS nome_arquivo_normalizado TEXT,
          ADD COLUMN IF NOT EXISTS paginas INTEGER,
          ADD COLUMN IF NOT EXISTS conteudo_hash TEXT,
          ADD COLUMN IF NOT EXISTS ultima_indexacao_em TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS status_indexacao TEXT NOT NULL DEFAULT 'pendente',
          ADD COLUMN IF NOT EXISTS erro_indexacao TEXT;

        CREATE TABLE IF NOT EXISTS "Chatbot".manuais_instrucao_chunks (
          id BIGSERIAL PRIMARY KEY,
          manual_id BIGINT NOT NULL REFERENCES "Chatbot".manuais_instrucao(id) ON DELETE CASCADE,
          chunk_ordem INTEGER NOT NULL,
          pagina_inicial INTEGER NOT NULL,
          pagina_final INTEGER NOT NULL,
          texto TEXT NOT NULL,
          texto_normalizado TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS "Chatbot".manual_preview_cache (
          id BIGSERIAL PRIMARY KEY,
          manual_id BIGINT NOT NULL REFERENCES "Chatbot".manuais_instrucao(id) ON DELETE CASCADE,
          pagina INTEGER NOT NULL,
          conteudo_hash_ref TEXT NOT NULL DEFAULT '',
          source_url TEXT NULL,
          bucket TEXT NOT NULL,
          path_key TEXT NOT NULL,
          public_url TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_chatbot_manuais_instrucao_caminho
          ON "Chatbot".manuais_instrucao (caminho_manual);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_chatbot_manuais_chunks_manual_ordem
          ON "Chatbot".manuais_instrucao_chunks (manual_id, chunk_ordem);
        CREATE INDEX IF NOT EXISTS idx_chatbot_manuais_chunks_manual
          ON "Chatbot".manuais_instrucao_chunks (manual_id);
        CREATE INDEX IF NOT EXISTS idx_chatbot_manuais_chunks_pagina
          ON "Chatbot".manuais_instrucao_chunks (manual_id, pagina_inicial, pagina_final);
        CREATE INDEX IF NOT EXISTS idx_chatbot_manuais_chunks_busca
          ON "Chatbot".manuais_instrucao_chunks
          USING GIN (to_tsvector('simple', COALESCE(texto_normalizado, '')));
        CREATE UNIQUE INDEX IF NOT EXISTS idx_chatbot_manual_preview_cache_manual_pagina_hash
          ON "Chatbot".manual_preview_cache (manual_id, pagina, conteudo_hash_ref);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_chatbot_manual_preview_cache_path_key
          ON "Chatbot".manual_preview_cache (path_key);
      `);
    })().catch((err) => {
      chatbotManualTableReadyPromise = null;
      throw err;
    });
  }
  await chatbotManualTableReadyPromise;
  return true;
}

async function garantirTabelasConhecimentoChatbot() {
  if (!dbPool) return false;
  if (!chatbotKnowledgeTableReadyPromise) {
    chatbotKnowledgeTableReadyPromise = (async () => {
      await dbPool.query(`
        CREATE SCHEMA IF NOT EXISTS "Chatbot";

        CREATE TABLE IF NOT EXISTS "Chatbot".faq_aprovadas (
          id BIGSERIAL PRIMARY KEY,
          pergunta TEXT NOT NULL,
          pergunta_normalizada TEXT NOT NULL,
          resposta TEXT NOT NULL,
          area TEXT NULL,
          produto_modelo TEXT NULL,
          tags TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
          prioridade INTEGER NOT NULL DEFAULT 50,
          status_aprovacao TEXT NOT NULL DEFAULT 'aprovado',
          fonte TEXT NULL,
          aprovado_por TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS "Chatbot".memoria_usuario (
          id BIGSERIAL PRIMARY KEY,
          usuario TEXT NOT NULL,
          chave TEXT NOT NULL,
          valor_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          relevancia INTEGER NOT NULL DEFAULT 1,
          expira_em TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS "Chatbot".lacunas_conhecimento (
          id BIGSERIAL PRIMARY KEY,
          usuario TEXT NULL,
          pergunta TEXT NOT NULL,
          pergunta_normalizada TEXT NOT NULL,
          motivo_falha TEXT NOT NULL,
          resposta_fornecida TEXT NULL,
          contexto JSONB NULL,
          status TEXT NOT NULL DEFAULT 'novo',
          sugestao_fonte TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_chatbot_faq_pergunta_normalizada
          ON "Chatbot".faq_aprovadas (pergunta_normalizada);
        CREATE INDEX IF NOT EXISTS idx_chatbot_faq_area_prioridade
          ON "Chatbot".faq_aprovadas (area, prioridade DESC);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_chatbot_memoria_usuario_chave
          ON "Chatbot".memoria_usuario (usuario, chave);
        CREATE INDEX IF NOT EXISTS idx_chatbot_memoria_usuario_expira
          ON "Chatbot".memoria_usuario (usuario, expira_em, atualizado_em DESC);

        CREATE INDEX IF NOT EXISTS idx_chatbot_lacunas_status_criado_em
          ON "Chatbot".lacunas_conhecimento (status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_chatbot_lacunas_pergunta_normalizada
          ON "Chatbot".lacunas_conhecimento (pergunta_normalizada);
      `);

      for (const faq of CHATBOT_FAQ_SEED) {
        const pergunta = String(faq?.pergunta || '').trim();
        const perguntaNormalizada = normalizarTextoManualBusca(pergunta);
        const resposta = String(faq?.resposta || '').trim();
        if (!pergunta || !perguntaNormalizada || !resposta) continue;

        await dbPool.query(
          `
          INSERT INTO "Chatbot".faq_aprovadas
            (pergunta, pergunta_normalizada, resposta, area, produto_modelo, tags, prioridade, status_aprovacao, fonte, aprovado_por)
          VALUES ($1, $2, $3, $4, $5, $6::text[], $7, 'aprovado', $8, $9)
          ON CONFLICT (pergunta_normalizada) DO NOTHING
          `,
          [
            pergunta,
            perguntaNormalizada,
            resposta,
            String(faq?.area || '').trim() || null,
            String(faq?.produto_modelo || '').trim() || null,
            Array.isArray(faq?.tags) ? faq.tags.map((item) => String(item || '').trim()).filter(Boolean) : [],
            Number(faq?.prioridade || 50),
            String(faq?.fonte || '').trim() || 'Base oficial SGF',
            'seed_chatbot'
          ]
        );
      }
    })().catch((err) => {
      chatbotKnowledgeTableReadyPromise = null;
      throw err;
    });
  }
  await chatbotKnowledgeTableReadyPromise;
  return true;
}

function normalizarConversationIdChatbot(rawValue) {
  const valor = String(rawValue || '').trim().slice(0, 120);
  if (!valor) return '';
  return /^[a-zA-Z0-9:_-]+$/.test(valor) ? valor : '';
}

function gerarConversationIdChatbot() {
  return `conv_${crypto.randomUUID()}`;
}

async function garantirTabelasHistoricoChatbot() {
  if (!dbPool) return false;
  if (!chatbotConversationTableReadyPromise) {
    chatbotConversationTableReadyPromise = (async () => {
      await dbPool.query(`
        CREATE SCHEMA IF NOT EXISTS "Chatbot";

        CREATE TABLE IF NOT EXISTS "Chatbot".conversas (
          conversation_id TEXT PRIMARY KEY,
          usuario TEXT NULL,
          origem TEXT NOT NULL DEFAULT 'manual_tecnico',
          criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          encerrado_em TIMESTAMPTZ NULL
        );

        CREATE TABLE IF NOT EXISTS "Chatbot".conversa_mensagens (
          id BIGSERIAL PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES "Chatbot".conversas(conversation_id) ON DELETE CASCADE,
          usuario TEXT NULL,
          papel TEXT NOT NULL,
          conteudo TEXT NOT NULL,
          origem TEXT NULL,
          metadados JSONB NULL,
          criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_chatbot_conversas_usuario_atualizado_em
          ON "Chatbot".conversas (usuario, atualizado_em DESC);
        CREATE INDEX IF NOT EXISTS idx_chatbot_conversa_mensagens_conversation_id_id
          ON "Chatbot".conversa_mensagens (conversation_id, id);
      `);
    })().catch((err) => {
      chatbotConversationTableReadyPromise = null;
      throw err;
    });
  }
  await chatbotConversationTableReadyPromise;
  return true;
}

async function registrarMensagemHistoricoChatbot({
  req,
  conversationId,
  papel,
  conteudo,
  origem = 'manual_tecnico',
  metadados = null
} = {}) {
  if (!dbPool) return null;

  const conversationIdFinal = normalizarConversationIdChatbot(conversationId) || gerarConversationIdChatbot();
  const papelFinal = String(papel || '').trim().toLowerCase();
  const conteudoFinal = String(conteudo || '').trim().slice(0, 20000);
  const origemFinal = String(origem || '').trim().slice(0, 80) || 'manual_tecnico';
  const usuario = resolverUsuarioMemoriaChatbot(req);

  if (!['user', 'assistant', 'system'].includes(papelFinal) || !conteudoFinal) {
    return conversationIdFinal;
  }

  await garantirTabelasHistoricoChatbot();

  await dbPool.query(
    `
    INSERT INTO "Chatbot".conversas
      (conversation_id, usuario, origem, atualizado_em)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (conversation_id)
    DO UPDATE
      SET usuario = COALESCE(EXCLUDED.usuario, "Chatbot".conversas.usuario),
          origem = COALESCE(NULLIF(EXCLUDED.origem, ''), "Chatbot".conversas.origem),
          atualizado_em = NOW()
    `,
    [conversationIdFinal, usuario, origemFinal]
  );

  await dbPool.query(
    `
    INSERT INTO "Chatbot".conversa_mensagens
      (conversation_id, usuario, papel, conteudo, origem, metadados)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      conversationIdFinal,
      usuario,
      papelFinal,
      conteudoFinal,
      origemFinal,
      metadados ? JSON.stringify(metadados).slice(0, 12000) : null
    ]
  );

  return conversationIdFinal;
}

async function encerrarHistoricoChatbot({
  req,
  conversationId,
  origem = 'manual_tecnico',
  motivo = 'encerrado pelo usuario'
} = {}) {
  if (!dbPool) return null;
  const conversationIdFinal = normalizarConversationIdChatbot(conversationId);
  if (!conversationIdFinal) return null;

  await garantirTabelasHistoricoChatbot();
  await registrarMensagemHistoricoChatbot({
    req,
    conversationId: conversationIdFinal,
    papel: 'system',
    conteudo: `Atendimento finalizado (${String(motivo || 'motivo não informado').trim().slice(0, 120)}).`,
    origem,
    metadados: { finalizado: true }
  });

  await dbPool.query(
    `
    UPDATE "Chatbot".conversas
       SET encerrado_em = COALESCE(encerrado_em, NOW()),
           atualizado_em = NOW()
     WHERE conversation_id = $1
    `,
    [conversationIdFinal]
  );

  return conversationIdFinal;
}

const CHATBOT_FAQ_FALLBACK_STOPWORDS = new Set([
  'a',
  'ao',
  'aos',
  'as',
  'como',
  'com',
  'da',
  'das',
  'de',
  'do',
  'dos',
  'e',
  'em',
  'na',
  'nas',
  'no',
  'nos',
  'o',
  'os',
  'ou',
  'para',
  'por',
  'qual',
  'quais',
  'quando',
  'que',
  'quero',
  'se',
  'sem',
  'ser',
  'sobre',
  'uma',
  'umas',
  'um',
  'uns'
]);

function extrairTokensBuscaFaq(perguntaNorm) {
  return Array.from(
    new Set(
      String(perguntaNorm || '')
        .split(/\s+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 3 && !CHATBOT_FAQ_FALLBACK_STOPWORDS.has(item))
    )
  ).slice(0, 8);
}

function normalizarAreaChatbot(area) {
  return String(area || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function areasFaqCompativeis(areaPergunta, areaFaq) {
  const origem = normalizarAreaChatbot(areaPergunta);
  const destino = normalizarAreaChatbot(areaFaq);

  if (!origem || origem === 'geral' || !destino) return true;
  if (origem === destino) return true;

  const combinacoesCompativeis = new Set([
    'manuais_produto:produto',
    'produto:manuais_produto'
  ]);

  return combinacoesCompativeis.has(`${origem}:${destino}`);
}

async function buscarFaqAprovadaChatbot(pergunta) {
  if (!dbPool) return null;
  await garantirTabelasConhecimentoChatbot();

  const perguntaNorm = normalizarTextoManualBusca(pergunta).slice(0, 500);
  if (!perguntaNorm) return null;

  const areaPergunta = inferirAreaPerguntaChatbot(pergunta);
  const modelos = extrairModelosPergunta(pergunta);
  const tokens = extrairTokensBuscaFaq(perguntaNorm);
  let rows = [];
  try {
    const resultado = await dbPool.query(
      `
      SELECT
        id,
        pergunta,
        resposta,
        area,
        produto_modelo,
        tags,
        prioridade,
        fonte,
        'fts'::text AS busca_tipo,
        CASE WHEN pergunta_normalizada = $1 THEN 1 ELSE 0 END AS exact_match,
        ts_rank_cd(
          to_tsvector(
            'simple',
            COALESCE(pergunta_normalizada, '') || ' ' ||
            COALESCE(produto_modelo, '') || ' ' ||
            array_to_string(COALESCE(tags, ARRAY[]::text[]), ' ')
          ),
          plainto_tsquery('simple', $1)
        ) AS score
      FROM "Chatbot".faq_aprovadas
      WHERE COALESCE(status_aprovacao, 'aprovado') = 'aprovado'
        AND (
          pergunta_normalizada = $1
          OR to_tsvector(
            'simple',
            COALESCE(pergunta_normalizada, '') || ' ' ||
            COALESCE(produto_modelo, '') || ' ' ||
            array_to_string(COALESCE(tags, ARRAY[]::text[]), ' ')
          ) @@ plainto_tsquery('simple', $1)
        )
      ORDER BY exact_match DESC, prioridade DESC, score DESC, id ASC
      LIMIT 10
      `,
      [perguntaNorm]
    );
    rows = Array.isArray(resultado.rows) ? resultado.rows : [];
  } catch (err) {
    console.warn('[AI/FAQ] Falha na busca FTS:', err?.message || err);
  }

  if (!rows.length) {
    if (!tokens.length) return null;

    const likes = tokens.map((token) => `%${token}%`);
    const condicoes = likes
      .map((_, idx) => `(pergunta_normalizada LIKE $${idx + 1} OR resposta LIKE $${idx + 1} OR COALESCE(produto_modelo, '') LIKE $${idx + 1})`)
      .join(' OR ');
    const scoreExpr = likes
      .map((_, idx) => `CASE WHEN pergunta_normalizada LIKE $${idx + 1} OR resposta LIKE $${idx + 1} OR COALESCE(produto_modelo, '') LIKE $${idx + 1} THEN 1 ELSE 0 END`)
      .join(' + ');

    const resultado = await dbPool.query(
      `
      SELECT
        id,
        pergunta,
        resposta,
        area,
        produto_modelo,
        tags,
        prioridade,
        fonte,
        'like'::text AS busca_tipo,
        0 AS exact_match,
        (${scoreExpr})::float AS score
      FROM "Chatbot".faq_aprovadas
      WHERE COALESCE(status_aprovacao, 'aprovado') = 'aprovado'
        AND (${condicoes})
      ORDER BY prioridade DESC, score DESC, id ASC
      LIMIT 10
      `,
      likes
    );
    rows = Array.isArray(resultado.rows) ? resultado.rows : [];
  }

  const melhor = rows
    .map((row) => {
      const bonusModelo = calcularScoreModeloNoTexto(row?.produto_modelo, modelos, {
        exact: 150,
        compact: 180,
        familiaNumero: 60
      });
      return {
        ...row,
        bonus_modelo: bonusModelo,
        area_normalizada: normalizarAreaChatbot(row?.area),
        score_total:
          Number(row?.exact_match || 0) * 1000 +
          Number(row?.prioridade || 0) * 10 +
          Number(row?.score || 0) * 100 +
          bonusModelo
      };
    })
    .sort((a, b) => Number(b.score_total || 0) - Number(a.score_total || 0))[0];

  if (!melhor) return null;

  const buscaTipo = String(melhor?.busca_tipo || 'fts').trim().toLowerCase();
  const scoreBruto = Number(melhor?.score || 0);
  const bonusModelo = Number(melhor?.bonus_modelo || 0);
  const areaFaq = String(melhor?.area_normalizada || '').trim();
  const areaCompativel = areasFaqCompativeis(areaPergunta, areaFaq);

  if (areaPergunta === 'manuais_produto' && !areaCompativel && bonusModelo <= 0) {
    return null;
  }

  if (buscaTipo === 'like') {
    const minHitsLike = modelos.length || areaPergunta === 'manuais_produto' ? 2 : 1;
    if (scoreBruto < minHitsLike) return null;
    if (!areaCompativel && bonusModelo <= 0) return null;
  }

  const fonte = String(melhor?.fonte || '').trim() || 'Base oficial SGF';
  const area = String(melhor?.area || '').trim();
  const resposta = String(melhor?.resposta || '').trim();
  const content = /\bfonte:/i.test(resposta)
    ? resposta
    : `${resposta}\n\nFonte: ${fonte}${area ? ` | Área: ${area}` : ''}`;

  return {
    id: Number(melhor.id || 0),
    pergunta: String(melhor.pergunta || '').trim(),
    content,
    area,
    fonte
  };
}

async function carregarMemoriaUsuarioChatbot(req) {
  if (!dbPool) return {};
  const usuario = resolverUsuarioMemoriaChatbot(req);
  if (!usuario) return {};

  await garantirTabelasConhecimentoChatbot();

  const resultado = await dbPool.query(
    `
    SELECT chave, valor_json, relevancia, expira_em, atualizado_em
    FROM "Chatbot".memoria_usuario
    WHERE usuario = $1
      AND (expira_em IS NULL OR expira_em > NOW())
    ORDER BY relevancia DESC, atualizado_em DESC
    LIMIT $2
    `,
    [usuario, CHATBOT_MEMORY_MAX_ITEMS]
  );

  const memoria = {};
  for (const row of Array.isArray(resultado.rows) ? resultado.rows : []) {
    memoria[String(row?.chave || '').trim()] = row?.valor_json || {};
  }
  return memoria;
}

async function salvarMemoriaUsuarioChatbot(req, itens = []) {
  if (!dbPool) return;
  const usuario = resolverUsuarioMemoriaChatbot(req);
  if (!usuario) return;
  const lista = Array.isArray(itens) ? itens : [];
  if (!lista.length) return;

  await garantirTabelasConhecimentoChatbot();

  for (const item of lista) {
    const chave = String(item?.chave || '').trim();
    if (!chave) continue;
    const ttlDias = Math.max(1, Number(item?.ttlDias || CHATBOT_MEMORY_TTL_DAYS));
    const expiraEm = new Date(Date.now() + ttlDias * 24 * 60 * 60 * 1000);

    await dbPool.query(
      `
      INSERT INTO "Chatbot".memoria_usuario
        (usuario, chave, valor_json, relevancia, expira_em, atualizado_em)
      VALUES ($1, $2, $3::jsonb, $4, $5, NOW())
      ON CONFLICT (usuario, chave)
      DO UPDATE
        SET valor_json = EXCLUDED.valor_json,
            relevancia = EXCLUDED.relevancia,
            expira_em = EXCLUDED.expira_em,
            atualizado_em = NOW()
      `,
      [
        usuario,
        chave,
        JSON.stringify(item?.valor || {}),
        Math.max(1, Number(item?.relevancia || 1)),
        expiraEm.toISOString()
      ]
    );
  }
}

function respostaIndicaLacunaConhecimento(content) {
  const t = normalizarTextoBusca(content);
  if (!t) return true;

  const sinais = [
    'nao encontrei essa resposta',
    'nao encontrei essa informacao',
    'nao consegui montar uma resposta confiavel',
    'nao tenho essa informacao',
    'nao tem essa informacao',
    'nao consegui ajudar',
    'nao consegui entender'
  ];

  return sinais.some((item) => t.includes(item));
}

async function registrarLacunaConhecimentoChatbot({
  req,
  pergunta,
  motivo,
  respostaFornecida = '',
  contexto = null,
  sugestaoFonte = null
} = {}) {
  if (!dbPool) return;

  const perguntaFinal = String(pergunta || obterPerguntaRequest(req) || '').trim().slice(0, 4000);
  if (!perguntaFinal) return;

  try {
    await garantirTabelasConhecimentoChatbot();

    const usuario = resolverUsuarioMemoriaChatbot(req);
    await dbPool.query(
      `
      INSERT INTO "Chatbot".lacunas_conhecimento
        (usuario, pergunta, pergunta_normalizada, motivo_falha, resposta_fornecida, contexto, sugestao_fonte)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
      `,
      [
        usuario,
        perguntaFinal,
        normalizarTextoManualBusca(perguntaFinal).slice(0, 500),
        String(motivo || 'lacuna_nao_classificada').trim().slice(0, 200),
        String(respostaFornecida || '').trim().slice(0, 8000) || null,
        contexto ? JSON.stringify(contexto).slice(0, 12000) : null,
        String(sugestaoFonte || '').trim().slice(0, 500) || null
      ]
    );
  } catch (err) {
    console.error('[Chatbot/Lacunas] Falha ao registrar lacuna:', err?.message || err);
  }
}

function obterPerguntaRequest(req) {
  const bodyQuestion = String(req?.body?.question || '').trim();
  if (bodyQuestion) return bodyQuestion;

  const mensagens = Array.isArray(req?.body?.messages) ? req.body.messages : [];
  for (let i = mensagens.length - 1; i >= 0; i -= 1) {
    if (mensagens[i]?.role === 'user') {
      const content = String(mensagens[i]?.content || '').trim();
      if (content) return content;
    }
  }
  return '';
}

function respostaPrecisaRevisao(content) {
  const t = normalizarTextoBusca(content);
  if (!t) return false;

  const sinais = [
    'nao tenho essa informacao',
    'nao tem essa informacao',
    'contatar o suporte de ti',
    'contate o administrador do sistema',
    'servico de ia nao configurado',
    'erro ao comunicar com o servico de ia',
    'nao consegui ajudar',
    'nao consegui entender',
    'so posso ajudar com o sistema',
    'só posso ajudar com o sistema'
  ];
  return sinais.some((item) => t.includes(normalizarTextoBusca(item)));
}

if (dbPool) {
  garantirTabelaMensagensErro().catch((err) => {
    console.error('[Chatbot/Mensagens_erro] Falha ao garantir schema/tabela:', err?.message || err);
  });
  garantirTabelasManuaisChatbot().catch((err) => {
    console.error('[Chatbot/Manuais] Falha ao garantir schema/tabelas:', err?.message || err);
  });
  garantirTabelasConhecimentoChatbot().catch((err) => {
    console.error('[Chatbot/Conhecimento] Falha ao garantir schema/tabelas:', err?.message || err);
  });
  garantirTabelasHistoricoChatbot().catch((err) => {
    console.error('[Chatbot/Historico] Falha ao garantir schema/tabelas:', err?.message || err);
  });
}

async function registrarMensagemErroChatbot({
  req,
  rota = 'chat',
  motivo,
  pergunta,
  resposta,
  httpStatus = null,
  detalhes = null
} = {}) {
  if (!dbPool) return;

  const perguntaFinal = String(pergunta || obterPerguntaRequest(req) || '').trim().slice(0, 4000);
  const respostaFinal = String(resposta || '').trim().slice(0, 8000) || null;
  const motivoFinal = String(motivo || '').trim().slice(0, 200) || 'erro_nao_classificado';
  const usuario = resolverUsuarioAssistente(req);

  if (!perguntaFinal) return;

  try {
    await garantirTabelaMensagensErro();
    await dbPool.query(
      `
      INSERT INTO "Chatbot"."Mensagens_erro"
        (rota, motivo, usuario, pergunta, resposta, http_status, detalhes)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      `,
      [
        String(rota || 'chat').trim().slice(0, 60),
        motivoFinal,
        usuario,
        perguntaFinal,
        respostaFinal,
        httpStatus == null ? null : Number(httpStatus || 0),
        detalhes ? JSON.stringify(detalhes).slice(0, 12000) : null
      ]
    );
  } catch (err) {
    console.error('[Chatbot/Mensagens_erro] Falha ao registrar ocorrência:', err?.message || err);
  }
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

async function responderErroOpenAI(res, err, contexto = 'AI', req = null) {
  const norm = normalizarErroOpenAI(err);
  if (norm.httpStatus >= 500) {
    console.error(`[${contexto}] Erro ao chamar OpenAI:`, err?.response?.data || err?.message || err);
  }
  await registrarMensagemErroChatbot({
    req,
    rota: String(contexto || 'AI').includes('Report') ? 'report' : 'chat',
    motivo: 'erro_openai',
    pergunta: obterPerguntaRequest(req),
    resposta: norm.mensagem,
    httpStatus: norm.httpStatus,
    detalhes: {
      contexto,
      status: err?.response?.status || null,
      code: err?.response?.data?.error?.code || err?.code || null,
      type: err?.response?.data?.error?.type || null,
      message: err?.response?.data?.error?.message || err?.message || null
    }
  });
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
  if (!dbPool) return null;

  // 1) Atalhos determinísticos para perguntas recorrentes
  const direta = await tentarConsultaDiretaConhecida(pergunta, req);
  if (direta) return direta;

  if (!perguntaPedeConsultaDados(pergunta)) return null;

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

function calcularNivelConhecimentoChatbot(metricas = {}) {
  const faqAprovadas = Math.max(0, Number(metricas.faqAprovadas || 0));
  const manuaisIndexados = Math.max(0, Number(metricas.manuaisIndexados || 0));
  const trechosIndexados = Math.max(0, Number(metricas.trechosIndexados || 0));
  const usuariosMemoriaAtiva = Math.max(0, Number(metricas.usuariosMemoriaAtiva || 0));
  const lacunasAbertas = Math.max(0, Number(metricas.lacunasAbertas || 0));
  const lacunas7d = Math.max(0, Number(metricas.lacunas7d || 0));
  const lacunasResolvidas30d = Math.max(0, Number(metricas.lacunasResolvidas30d || 0));
  const erros30d = Math.max(0, Number(metricas.erros30d || 0));
  const faqNovas30d = Math.max(0, Number(metricas.faqNovas30d || 0));

  const ativosConhecimento = Math.min(35, faqAprovadas * 2 + manuaisIndexados + Math.floor(trechosIndexados / 80));
  const memoriaContextual = Math.min(10, usuariosMemoriaAtiva * 2);
  const aprendizadoRecente = Math.min(15, faqNovas30d * 2 + lacunasResolvidas30d * 2);
  const penalidade = Math.min(30, lacunasAbertas * 3 + lacunas7d * 2 + Math.ceil(erros30d / 2));
  const estabilidade = Math.max(0, 20 - penalidade);
  const score = Math.max(0, Math.min(100, 20 + ativosConhecimento + memoriaContextual + aprendizadoRecente + estabilidade));

  let label = 'Inicial';
  if (score >= 80) label = 'Alto';
  else if (score >= 65) label = 'Bom';
  else if (score >= 45) label = 'Em evolução';

  let resumo = 'Base ainda pequena e com necessidade de curadoria.';
  if (score >= 80) {
    resumo = 'Boa cobertura de conhecimento, com base indexada e sinais de estabilidade operacional.';
  } else if (score >= 65) {
    resumo = 'Cobertura consistente, mas ainda vale reduzir lacunas abertas e ampliar a base oficial.';
  } else if (score >= 45) {
    resumo = 'Estrutura funcional, porém ainda depende de ampliar conhecimento aprovado e reduzir falhas recorrentes.';
  }

  return {
    score,
    label,
    resumo,
    fatores: [
      { nome: 'Conhecimento aprovado', valor: ativosConhecimento, detalhe: `${faqAprovadas} FAQs, ${manuaisIndexados} manuais indexados, ${trechosIndexados} trechos` },
      { nome: 'Memória ativa', valor: memoriaContextual, detalhe: `${usuariosMemoriaAtiva} usuário(s) com memória contextual ativa` },
      { nome: 'Aprendizado recente', valor: aprendizadoRecente, detalhe: `${faqNovas30d} FAQ(s) novas em 30 dias, ${lacunasResolvidas30d} lacuna(s) resolvida(s)` },
      { nome: 'Estabilidade', valor: estabilidade, detalhe: `${lacunasAbertas} lacuna(s) aberta(s), ${erros30d} erro(s) nos últimos 30 dias` }
    ]
  };
}

function parseChatbotMonitorInt(value, fallback, { min = 1, max = 200 } = {}) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseChatbotMonitorSortDir(value, fallback = 'desc') {
  const normalized = String(value || fallback).trim().toLowerCase();
  return normalized === 'asc' ? 'asc' : 'desc';
}

function buildChatbotMonitorPagination(totalRows, requestedPage, pageSize) {
  const safeTotal = Math.max(0, Number(totalRows || 0));
  const totalPages = Math.max(1, Math.ceil(safeTotal / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const offset = (page - 1) * pageSize;
  return {
    total: safeTotal,
    page,
    pageSize,
    totalPages,
    hasPrev: page > 1,
    hasNext: page < totalPages,
    offset
  };
}

async function carregarDetalheFaqMonitorChatbot({
  page = 1,
  pageSize = 20,
  search = '',
  area = '',
  status = '',
  sortBy = 'updated_at',
  sortDir = 'desc'
} = {}) {
  const sortMap = {
    updated_at: 'f.updated_at',
    created_at: 'f.created_at',
    prioridade: 'COALESCE(f.prioridade, 0)',
    area: "COALESCE(NULLIF(f.area, ''), 'geral')",
    pergunta: "COALESCE(f.pergunta, '')"
  };
  const safeSortBy = sortMap[sortBy] ? sortBy : 'updated_at';
  const safeSortDir = parseChatbotMonitorSortDir(sortDir);

  const filters = [];
  const values = [];
  if (search) {
    values.push(`%${search}%`);
    const token = `$${values.length}`;
    filters.push(`(
      COALESCE(f.pergunta, '') ILIKE ${token}
      OR COALESCE(f.resposta, '') ILIKE ${token}
      OR COALESCE(f.area, '') ILIKE ${token}
      OR COALESCE(f.produto_modelo, '') ILIKE ${token}
      OR COALESCE(f.fonte, '') ILIKE ${token}
      OR COALESCE(f.aprovado_por, '') ILIKE ${token}
      OR array_to_string(COALESCE(f.tags, ARRAY[]::text[]), ' ') ILIKE ${token}
    )`);
  }
  if (area) {
    values.push(area);
    filters.push(`COALESCE(NULLIF(f.area, ''), 'geral') = $${values.length}`);
  }
  if (status) {
    values.push(status);
    filters.push(`COALESCE(NULLIF(f.status_aprovacao, ''), 'aprovado') = $${values.length}`);
  }

  const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const totalResult = await dbPool.query(
    `SELECT COUNT(*)::int AS total FROM "Chatbot".faq_aprovadas f ${whereSql}`,
    values
  );
  const pagination = buildChatbotMonitorPagination(totalResult.rows?.[0]?.total || 0, page, pageSize);

  const dataResult = await dbPool.query(
    `
    SELECT
      f.id,
      f.pergunta,
      f.pergunta_normalizada,
      f.resposta,
      COALESCE(NULLIF(f.area, ''), 'geral') AS area,
      f.produto_modelo,
      f.tags,
      COALESCE(f.prioridade, 0) AS prioridade,
      COALESCE(NULLIF(f.status_aprovacao, ''), 'aprovado') AS status_aprovacao,
      f.fonte,
      f.aprovado_por,
      f.created_at,
      f.updated_at
    FROM "Chatbot".faq_aprovadas f
    ${whereSql}
    ORDER BY ${sortMap[safeSortBy]} ${safeSortDir.toUpperCase()}, f.id DESC
    LIMIT $${values.length + 1}
    OFFSET $${values.length + 2}
    `,
    [...values, pagination.pageSize, pagination.offset]
  );

  const summaryResult = await dbPool.query(
    `
    SELECT
      COUNT(*)::int AS total_rows,
      COUNT(DISTINCT COALESCE(NULLIF(f.area, ''), 'geral'))::int AS area_count,
      COALESCE(ROUND(AVG(COALESCE(f.prioridade, 0))::numeric, 1), 0) AS average_priority,
      COUNT(*) FILTER (WHERE COALESCE(array_length(f.tags, 1), 0) > 0)::int AS tagged_count
    FROM "Chatbot".faq_aprovadas f
    ${whereSql}
    `,
    values
  );

  const [areasResult, statusResult] = await Promise.all([
    dbPool.query(`
      SELECT
        COALESCE(NULLIF(area, ''), 'geral') AS value,
        COUNT(*)::int AS total
      FROM "Chatbot".faq_aprovadas
      GROUP BY 1
      ORDER BY total DESC, value ASC
      LIMIT 30
    `),
    dbPool.query(`
      SELECT
        COALESCE(NULLIF(status_aprovacao, ''), 'aprovado') AS value,
        COUNT(*)::int AS total
      FROM "Chatbot".faq_aprovadas
      GROUP BY 1
      ORDER BY total DESC, value ASC
      LIMIT 20
    `)
  ]);

  const summary = summaryResult.rows?.[0] || {};
  return {
    meta: {
      ...pagination,
      sortBy: safeSortBy,
      sortDir: safeSortDir,
      search
    },
    summary: {
      totalRows: Number(summary.total_rows || 0),
      areaCount: Number(summary.area_count || 0),
      averagePriority: Number(summary.average_priority || 0),
      taggedCount: Number(summary.tagged_count || 0)
    },
    options: {
      areas: (areasResult.rows || []).map((row) => ({
        value: String(row.value || 'geral'),
        label: String(row.value || 'geral'),
        total: Number(row.total || 0)
      })),
      statuses: (statusResult.rows || []).map((row) => ({
        value: String(row.value || 'aprovado'),
        label: String(row.value || 'aprovado'),
        total: Number(row.total || 0)
      }))
    },
    rows: (dataResult.rows || []).map((row) => ({
      id: Number(row.id || 0),
      question: String(row.pergunta || '').trim(),
      normalizedQuestion: String(row.pergunta_normalizada || '').trim(),
      answer: String(row.resposta || '').trim(),
      area: String(row.area || 'geral').trim() || 'geral',
      productModel: String(row.produto_modelo || '').trim() || null,
      tags: Array.isArray(row.tags) ? row.tags.map((item) => String(item || '').trim()).filter(Boolean) : [],
      priority: Number(row.prioridade || 0),
      approvalStatus: String(row.status_aprovacao || 'aprovado').trim() || 'aprovado',
      source: String(row.fonte || '').trim() || null,
      approvedBy: String(row.aprovado_por || '').trim() || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  };
}

async function carregarDetalheMensagensMonitorChatbot({
  page = 1,
  pageSize = 20,
  search = '',
  role = '',
  origin = '',
  conversationId = '',
  user = '',
  sortBy = 'criado_em',
  sortDir = 'desc'
} = {}) {
  const sortMap = {
    criado_em: 'm.criado_em',
    conversation_id: 'm.conversation_id',
    usuario: "COALESCE(NULLIF(m.usuario, ''), '')",
    papel: "COALESCE(NULLIF(m.papel, ''), 'sem_papel')",
    mensagens_na_conversa: 'COALESCE(cs.mensagens_na_conversa, 0)',
    ultima_mensagem_em: 'COALESCE(cs.ultima_mensagem_em, m.criado_em)'
  };
  const safeSortBy = sortMap[sortBy] ? sortBy : 'criado_em';
  const safeSortDir = parseChatbotMonitorSortDir(sortDir);

  const filters = [];
  const values = [];
  if (search) {
    values.push(`%${search}%`);
    const token = `$${values.length}`;
    filters.push(`(
      COALESCE(m.conteudo, '') ILIKE ${token}
      OR COALESCE(m.usuario, '') ILIKE ${token}
      OR COALESCE(m.conversation_id, '') ILIKE ${token}
      OR COALESCE(m.origem, '') ILIKE ${token}
      OR COALESCE(m.metadados::text, '') ILIKE ${token}
    )`);
  }
  if (role) {
    values.push(role);
    filters.push(`COALESCE(NULLIF(m.papel, ''), 'sem_papel') = $${values.length}`);
  }
  if (origin) {
    values.push(origin);
    filters.push(`COALESCE(NULLIF(m.origem, ''), 'sem_origem') = $${values.length}`);
  }
  if (conversationId) {
    values.push(`%${conversationId}%`);
    filters.push(`COALESCE(m.conversation_id, '') ILIKE $${values.length}`);
  }
  if (user) {
    values.push(`%${user}%`);
    filters.push(`COALESCE(m.usuario, '') ILIKE $${values.length}`);
  }

  const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const totalResult = await dbPool.query(
    `SELECT COUNT(*)::int AS total FROM "Chatbot".conversa_mensagens m ${whereSql}`,
    values
  );
  const pagination = buildChatbotMonitorPagination(totalResult.rows?.[0]?.total || 0, page, pageSize);

  const dataResult = await dbPool.query(
    `
    WITH conv_stats AS (
      SELECT
        conversation_id,
        COUNT(*)::int AS mensagens_na_conversa,
        MIN(criado_em) AS primeira_mensagem_em,
        MAX(criado_em) AS ultima_mensagem_em
      FROM "Chatbot".conversa_mensagens
      GROUP BY 1
    )
    SELECT
      m.id,
      m.conversation_id,
      m.usuario,
      COALESCE(NULLIF(m.papel, ''), 'sem_papel') AS papel,
      m.conteudo,
      COALESCE(NULLIF(m.origem, ''), 'sem_origem') AS origem,
      m.metadados,
      m.criado_em,
      COALESCE(cs.mensagens_na_conversa, 0) AS mensagens_na_conversa,
      cs.primeira_mensagem_em,
      cs.ultima_mensagem_em
    FROM "Chatbot".conversa_mensagens m
    LEFT JOIN conv_stats cs
      ON cs.conversation_id = m.conversation_id
    ${whereSql}
    ORDER BY ${sortMap[safeSortBy]} ${safeSortDir.toUpperCase()}, m.id DESC
    LIMIT $${values.length + 1}
    OFFSET $${values.length + 2}
    `,
    [...values, pagination.pageSize, pagination.offset]
  );

  const summaryResult = await dbPool.query(
    `
    SELECT
      COUNT(*)::int AS total_rows,
      COUNT(DISTINCT m.conversation_id)::int AS conversation_count,
      COUNT(DISTINCT COALESCE(NULLIF(m.usuario, ''), 'anon'))::int AS user_count,
      COUNT(*) FILTER (WHERE COALESCE(NULLIF(m.papel, ''), 'sem_papel') = 'assistant')::int AS assistant_count,
      COUNT(*) FILTER (WHERE COALESCE(NULLIF(m.papel, ''), 'sem_papel') = 'user')::int AS user_message_count,
      COUNT(*) FILTER (WHERE COALESCE(NULLIF(m.papel, ''), 'sem_papel') = 'system')::int AS system_count
    FROM "Chatbot".conversa_mensagens m
    ${whereSql}
    `,
    values
  );

  const [rolesResult, originsResult] = await Promise.all([
    dbPool.query(`
      SELECT
        COALESCE(NULLIF(papel, ''), 'sem_papel') AS value,
        COUNT(*)::int AS total
      FROM "Chatbot".conversa_mensagens
      GROUP BY 1
      ORDER BY total DESC, value ASC
      LIMIT 20
    `),
    dbPool.query(`
      SELECT
        COALESCE(NULLIF(origem, ''), 'sem_origem') AS value,
        COUNT(*)::int AS total
      FROM "Chatbot".conversa_mensagens
      GROUP BY 1
      ORDER BY total DESC, value ASC
      LIMIT 30
    `)
  ]);

  const summary = summaryResult.rows?.[0] || {};
  return {
    meta: {
      ...pagination,
      sortBy: safeSortBy,
      sortDir: safeSortDir,
      search
    },
    summary: {
      totalRows: Number(summary.total_rows || 0),
      conversationCount: Number(summary.conversation_count || 0),
      userCount: Number(summary.user_count || 0),
      assistantCount: Number(summary.assistant_count || 0),
      userMessageCount: Number(summary.user_message_count || 0),
      systemCount: Number(summary.system_count || 0)
    },
    options: {
      roles: (rolesResult.rows || []).map((row) => ({
        value: String(row.value || 'sem_papel'),
        label: String(row.value || 'sem_papel'),
        total: Number(row.total || 0)
      })),
      origins: (originsResult.rows || []).map((row) => ({
        value: String(row.value || 'sem_origem'),
        label: String(row.value || 'sem_origem'),
        total: Number(row.total || 0)
      }))
    },
    rows: (dataResult.rows || []).map((row) => ({
      id: Number(row.id || 0),
      conversationId: String(row.conversation_id || '').trim(),
      user: String(row.usuario || '').trim() || null,
      role: String(row.papel || 'sem_papel').trim() || 'sem_papel',
      content: String(row.conteudo || '').trim(),
      origin: String(row.origem || 'sem_origem').trim() || 'sem_origem',
      metadata: row.metadados && typeof row.metadados === 'object' ? row.metadados : null,
      createdAt: row.criado_em,
      conversationMessageCount: Number(row.mensagens_na_conversa || 0),
      conversationStartedAt: row.primeira_mensagem_em,
      conversationUpdatedAt: row.ultima_mensagem_em
    }))
  };
}

async function carregarDetalheMemoriaMonitorChatbot({
  page = 1,
  pageSize = 20,
  search = '',
  key = '',
  user = '',
  activeState = 'all',
  sortBy = 'atualizado_em',
  sortDir = 'desc'
} = {}) {
  const sortMap = {
    atualizado_em: 'mu.atualizado_em',
    created_at: 'mu.created_at',
    relevancia: 'COALESCE(mu.relevancia, 0)',
    expira_em: 'mu.expira_em',
    usuario: "COALESCE(NULLIF(mu.usuario, ''), '')",
    chave: "COALESCE(NULLIF(mu.chave, ''), 'sem_chave')"
  };
  const safeSortBy = sortMap[sortBy] ? sortBy : 'atualizado_em';
  const safeSortDir = parseChatbotMonitorSortDir(sortDir);
  const safeActiveState = ['all', 'active', 'expired'].includes(String(activeState || '').trim().toLowerCase())
    ? String(activeState || 'all').trim().toLowerCase()
    : 'all';

  const filters = [];
  const values = [];
  if (search) {
    values.push(`%${search}%`);
    const token = `$${values.length}`;
    filters.push(`(
      COALESCE(mu.usuario, '') ILIKE ${token}
      OR COALESCE(mu.chave, '') ILIKE ${token}
      OR COALESCE(mu.valor_json::text, '') ILIKE ${token}
    )`);
  }
  if (key) {
    values.push(key);
    filters.push(`COALESCE(NULLIF(mu.chave, ''), 'sem_chave') = $${values.length}`);
  }
  if (user) {
    values.push(`%${user}%`);
    filters.push(`COALESCE(mu.usuario, '') ILIKE $${values.length}`);
  }
  if (safeActiveState === 'active') {
    filters.push('(mu.expira_em IS NULL OR mu.expira_em > NOW())');
  } else if (safeActiveState === 'expired') {
    filters.push('(mu.expira_em IS NOT NULL AND mu.expira_em <= NOW())');
  }

  const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const totalResult = await dbPool.query(
    `SELECT COUNT(*)::int AS total FROM "Chatbot".memoria_usuario mu ${whereSql}`,
    values
  );
  const pagination = buildChatbotMonitorPagination(totalResult.rows?.[0]?.total || 0, page, pageSize);

  const dataResult = await dbPool.query(
    `
    SELECT
      mu.id,
      mu.usuario,
      COALESCE(NULLIF(mu.chave, ''), 'sem_chave') AS chave,
      mu.valor_json,
      COALESCE(mu.relevancia, 0) AS relevancia,
      mu.expira_em,
      mu.created_at,
      mu.atualizado_em,
      CASE
        WHEN mu.expira_em IS NULL OR mu.expira_em > NOW() THEN TRUE
        ELSE FALSE
      END AS ativa
    FROM "Chatbot".memoria_usuario mu
    ${whereSql}
    ORDER BY ${sortMap[safeSortBy]} ${safeSortDir.toUpperCase()} NULLS LAST, mu.id DESC
    LIMIT $${values.length + 1}
    OFFSET $${values.length + 2}
    `,
    [...values, pagination.pageSize, pagination.offset]
  );

  const summaryResult = await dbPool.query(
    `
    SELECT
      COUNT(*)::int AS total_rows,
      COUNT(*) FILTER (WHERE mu.expira_em IS NULL OR mu.expira_em > NOW())::int AS active_count,
      COUNT(*) FILTER (WHERE mu.expira_em IS NOT NULL AND mu.expira_em <= NOW())::int AS expired_count,
      COUNT(DISTINCT COALESCE(NULLIF(mu.usuario, ''), 'anon'))::int AS user_count,
      COUNT(DISTINCT COALESCE(NULLIF(mu.chave, ''), 'sem_chave'))::int AS key_count
    FROM "Chatbot".memoria_usuario mu
    ${whereSql}
    `,
    values
  );

  const keysResult = await dbPool.query(`
    SELECT
      COALESCE(NULLIF(chave, ''), 'sem_chave') AS value,
      COUNT(*)::int AS total
    FROM "Chatbot".memoria_usuario
    GROUP BY 1
    ORDER BY total DESC, value ASC
    LIMIT 40
  `);

  const summary = summaryResult.rows?.[0] || {};
  return {
    meta: {
      ...pagination,
      sortBy: safeSortBy,
      sortDir: safeSortDir,
      search
    },
    summary: {
      totalRows: Number(summary.total_rows || 0),
      activeCount: Number(summary.active_count || 0),
      expiredCount: Number(summary.expired_count || 0),
      userCount: Number(summary.user_count || 0),
      keyCount: Number(summary.key_count || 0)
    },
    options: {
      keys: (keysResult.rows || []).map((row) => ({
        value: String(row.value || 'sem_chave'),
        label: String(row.value || 'sem_chave'),
        total: Number(row.total || 0)
      }))
    },
    rows: (dataResult.rows || []).map((row) => ({
      id: Number(row.id || 0),
      user: String(row.usuario || '').trim() || null,
      key: String(row.chave || 'sem_chave').trim() || 'sem_chave',
      valueJson: row.valor_json && typeof row.valor_json === 'object' ? row.valor_json : null,
      relevance: Number(row.relevancia || 0),
      expiresAt: row.expira_em,
      createdAt: row.created_at,
      updatedAt: row.atualizado_em,
      active: Boolean(row.ativa)
    }))
  };
}

// ─── POST /api/ai/manual-chat ───────────────────────────────────────────────
router.post('/manual-chat', express.json({ limit: '50kb' }), async (req, res) => {
  const { messages } = req.body || {};
  const startedAt = Date.now();
  const origemHistorico = String(req.body?.source || 'manual_tecnico').trim().slice(0, 80) || 'manual_tecnico';
  let conversationId = normalizarConversationIdChatbot(req.body?.conversationId) || gerarConversationIdChatbot();

  if (!Array.isArray(messages) || messages.length === 0) {
    logAiChatInfo('manual-chat-payload-invalido', { motivo: 'messages_ausente_ou_vazio' });
    return res.status(400).json({ error: 'Campo messages é obrigatório.', conversationId });
  }

  const sanitizedMessages = messages.slice(-25).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 2000)
  }));

  const perguntaAtual = extrairPerguntaUsuario(sanitizedMessages);
  if (!perguntaAtual) {
    logAiChatInfo('manual-chat-payload-invalido', { motivo: 'pergunta_usuario_vazia' });
    return res.status(400).json({ error: 'Não encontrei a pergunta do usuário no histórico enviado.', conversationId });
  }

  try {
    const conversationIdRegistrada = await registrarMensagemHistoricoChatbot({
      req,
      conversationId,
      papel: 'user',
      conteudo: perguntaAtual,
      origem: origemHistorico,
      metadados: {
        scope: 'manuals_only',
        historySize: sanitizedMessages.length
      }
    });
    if (conversationIdRegistrada) conversationId = conversationIdRegistrada;
  } catch (errHistorico) {
    console.warn('[AI/ManualChat] Falha ao registrar pergunta no histórico:', errHistorico?.message || errHistorico);
  }

  if (!dbPool) {
    const mensagemErro = 'Banco de dados não configurado para consultar os manuais técnicos.';
    return res.status(503).json({ error: mensagemErro, conversationId });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const mensagemErro = 'Serviço de IA não configurado. Contate o administrador do sistema.';
    await registrarMensagemErroChatbot({
      req,
      rota: 'manual_chat',
      motivo: 'servico_ia_nao_configurado',
      pergunta: perguntaAtual,
      resposta: mensagemErro,
      httpStatus: 503,
      detalhes: { etapa: 'manual_chat', origem: origemHistorico }
    });
    await registrarMensagemHistoricoChatbot({
      req,
      conversationId,
      papel: 'assistant',
      conteudo: mensagemErro,
      origem: origemHistorico,
      metadados: { erro: true, scope: 'manuals_only' }
    });
    return res.status(503).json({ error: mensagemErro, conversationId });
  }

  let memoriaUsuario = {};
  try {
    memoriaUsuario = await carregarMemoriaUsuarioChatbot(req);
  } catch (errMemoria) {
    console.warn('[AI/ManualChat] Falha ao carregar memória do usuário:', errMemoria?.message || errMemoria);
    memoriaUsuario = {};
  }

  const perguntaContextual = montarPerguntaComMemoria(perguntaAtual, memoriaUsuario);
  const manualMediaMode = resolverModoMidiaManual(perguntaAtual);

  try {
    const respostaManual = await tentarResponderComManuais({
      apiKey,
      pergunta: perguntaContextual || perguntaAtual,
      forceManual: true,
      messages: sanitizedMessages,
      manualMediaMode
    });

    const content = String(respostaManual?.content || '').trim() || 'Não consegui montar uma resposta confiável a partir dos manuais técnicos indexados.';
    const manualPreviews = Array.isArray(respostaManual?.manualPreviews) ? respostaManual.manualPreviews : [];
    const trechos = Array.isArray(respostaManual?.trechos) ? respostaManual.trechos : [];

    await salvarMemoriaUsuarioChatbot(req, extrairMemoriaCurtaDaConversa({
      pergunta: perguntaAtual,
      resposta: content
    }));

    if (respostaIndicaLacunaConhecimento(content)) {
      await registrarLacunaConhecimentoChatbot({
        req,
        pergunta: perguntaAtual,
        motivo: 'manual_chat_sem_resposta_confiavel',
        respostaFornecida: content,
        contexto: {
          origem: 'manual_chat',
          memoria: memoriaUsuario,
          previews: manualPreviews.length,
          trechos: trechos.length
        },
        sugestaoFonte: 'Adicionar ou revisar manuais técnicos indexados'
      });
    }

    await registrarMensagemHistoricoChatbot({
      req,
      conversationId,
      papel: 'assistant',
      conteudo: content,
      origem: origemHistorico,
      metadados: {
        scope: 'manuals_only',
        manualPreviews: manualPreviews.length,
        trechos: trechos.length,
        duracaoMs: Date.now() - startedAt
      }
    });

    return res.json({
      content,
      manualPreviews,
      conversationId
    });
  } catch (err) {
    const norm = normalizarErroOpenAI(err);
    await registrarMensagemErroChatbot({
      req,
      rota: 'manual_chat',
      motivo: 'erro_openai',
      pergunta: perguntaAtual,
      resposta: norm.mensagem,
      httpStatus: norm.httpStatus,
      detalhes: {
        contexto: 'AI/ManualChat',
        origem: origemHistorico,
        status: err?.response?.status || null,
        code: err?.response?.data?.error?.code || err?.code || null,
        type: err?.response?.data?.error?.type || null,
        message: err?.response?.data?.error?.message || err?.message || null
      }
    });
    await registrarMensagemHistoricoChatbot({
      req,
      conversationId,
      papel: 'assistant',
      conteudo: norm.mensagem,
      origem: origemHistorico,
      metadados: {
        erro: true,
        scope: 'manuals_only',
        duracaoMs: Date.now() - startedAt
      }
    });
    if (norm.httpStatus >= 500) {
      console.error('[AI/ManualChat] Erro ao chamar OpenAI:', err?.response?.data || err?.message || err);
    }
    return res.status(norm.httpStatus).json({ error: norm.mensagem, conversationId });
  }
});

router.post('/manual-chat/finalize', express.json({ limit: '10kb' }), async (req, res) => {
  const conversationId = normalizarConversationIdChatbot(req.body?.conversationId);
  const origemHistorico = String(req.body?.source || 'manual_tecnico').trim().slice(0, 80) || 'manual_tecnico';
  const motivo = String(req.body?.reason || 'encerrado pelo usuario').trim().slice(0, 120) || 'encerrado pelo usuario';

  if (!conversationId) {
    return res.status(400).json({ ok: false, error: 'conversationId é obrigatório.' });
  }

  if (!dbPool) {
    return res.status(503).json({ ok: false, error: 'Banco de dados não configurado.' });
  }

  try {
    await encerrarHistoricoChatbot({
      req,
      conversationId,
      origem: origemHistorico,
      motivo
    });
    return res.json({ ok: true, conversationId });
  } catch (err) {
    console.error('[AI/ManualChat] Falha ao finalizar histórico:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'Não foi possível finalizar a conversa.' });
  }
});

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
    await registrarMensagemErroChatbot({
      req,
      rota: 'chat',
      motivo: 'servico_ia_nao_configurado',
      resposta: 'Serviço de IA não configurado. Contate o administrador do sistema.',
      httpStatus: 503,
      detalhes: { etapa: 'chat', config: 'OPENAI_API_KEY_ausente' }
    });
    return res.status(503).json({ error: 'Serviço de IA não configurado. Contate o administrador do sistema.' });
  }

  // Sanitiza: mantém apenas as últimas 25 mensagens, limita tamanho do conteúdo
  const sanitizedMessages = messages.slice(-25).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 2000)
  }));

  const perguntaAtual = extrairPerguntaUsuario(sanitizedMessages);
  let memoriaUsuario = {};
  if (perguntaAtual && dbPool) {
    try {
      memoriaUsuario = await carregarMemoriaUsuarioChatbot(req);
    } catch (errMemoria) {
      console.warn('[AI/Chat] Falha ao carregar memória do usuário:', errMemoria?.message || errMemoria);
      memoriaUsuario = {};
    }
  }
  const perguntaContextual = montarPerguntaComMemoria(perguntaAtual, memoriaUsuario);
  const memoriaPrompt = formatarValorMemoriaPrompt(memoriaUsuario);
  const manualMediaMode = resolverModoMidiaManual(perguntaAtual);
  const perguntaPedeManualQualidadeAtual = perguntaPedeManualQualidade(perguntaContextual || perguntaAtual);
  const perguntaPedeManualAtual = perguntaPedeManualBombaCalor(perguntaContextual || perguntaAtual);
  const priorizarManuaisPorContexto = devePriorizarManuaisPorContexto(perguntaAtual, memoriaUsuario);
  const priorizarManuaisQualidade = perguntaPedeManualQualidadeAtual || (priorizarManuaisPorContexto && String(memoriaUsuario?.ultimo_assunto?.assunto || '') === 'manuais_qualidade');
  const priorizarManuais = perguntaPedeManualAtual || priorizarManuaisPorContexto;
  logAiChatInfo('inicio', {
    totalMessages: sanitizedMessages.length,
    lastUserChars: perguntaAtual.length,
    memoriaItens: Object.keys(memoriaUsuario || {}).length,
    perguntaPedeManualQualidadeAtual,
    priorizarManuaisQualidade,
    priorizarManuaisPorContexto,
    perguntaPedeManualAtual,
    priorizarManuais
  });

  if (perguntaAtual && priorizarManuaisQualidade) {
    try {
      const respostaManualQualidade = await tentarResponderComManuaisQualidade({
        apiKey,
        pergunta: perguntaContextual || perguntaAtual,
        memoria: memoriaUsuario,
        manualMediaMode
      });
      if (respostaManualQualidade?.content) {
        await salvarMemoriaUsuarioChatbot(req, [
          ...extrairMemoriaCurtaDaConversa({
            pergunta: perguntaAtual,
            resposta: respostaManualQualidade.content
          }),
          ...montarMemoriaManuaisQualidade(respostaManualQualidade.manuaisQualidade)
        ]);
        logAiChatInfo('sucesso-manuais-qualidade', {
          duracaoMs: Date.now() - startedAt,
          respostaChars: respostaManualQualidade.content.length,
          manuais: Array.isArray(respostaManualQualidade.manuaisQualidade) ? respostaManualQualidade.manuaisQualidade.length : 0,
          previews: Array.isArray(respostaManualQualidade.manualPreviews) ? respostaManualQualidade.manualPreviews.length : 0
        });
        return res.json({
          content: respostaManualQualidade.content,
          manualPreviews: Array.isArray(respostaManualQualidade.manualPreviews) ? respostaManualQualidade.manualPreviews : []
        });
      }
    } catch (errManualQualidade) {
      console.warn('[AI/Chat] Fallback para próximas fontes (manuais de qualidade falharam):', errManualQualidade?.message || errManualQualidade);
    }
  }

  if (perguntaAtual && dbPool && !priorizarManuais) {
    try {
      const respostaFaq = await buscarFaqAprovadaChatbot(perguntaContextual || perguntaAtual);
      if (respostaFaq?.content) {
        await salvarMemoriaUsuarioChatbot(req, extrairMemoriaCurtaDaConversa({
          pergunta: perguntaAtual,
          resposta: respostaFaq.content
        }));
        logAiChatInfo('sucesso-faq', {
          duracaoMs: Date.now() - startedAt,
          respostaChars: respostaFaq.content.length,
          faqId: respostaFaq.id || null,
          area: respostaFaq.area || null
        });
        return res.json({ content: respostaFaq.content });
      }
    } catch (errFaq) {
      console.warn('[AI/Chat] Fallback para próximas fontes (FAQ falhou):', errFaq?.message || errFaq);
    }
  }

  if (perguntaAtual && dbPool) {
    try {
      const respostaManual = await tentarResponderComManuais({
        apiKey,
        pergunta: perguntaContextual || perguntaAtual,
        messages: sanitizedMessages,
        manualMediaMode
      });
      if (respostaManual?.content) {
        await salvarMemoriaUsuarioChatbot(req, extrairMemoriaCurtaDaConversa({
          pergunta: perguntaAtual,
          resposta: respostaManual.content
        }));
        if (respostaIndicaLacunaConhecimento(respostaManual.content)) {
          await registrarLacunaConhecimentoChatbot({
            req,
            pergunta: perguntaAtual,
            motivo: 'manual_sem_resposta_confiavel',
            respostaFornecida: respostaManual.content,
            contexto: {
              origem: 'manuais',
              memoria: memoriaUsuario,
              previews: Array.isArray(respostaManual.manualPreviews) ? respostaManual.manualPreviews.length : 0
            },
            sugestaoFonte: 'Adicionar FAQ aprovada ou novo documento/manual complementar'
          });
        }
        logAiChatInfo('sucesso-manuais', {
          duracaoMs: Date.now() - startedAt,
          respostaChars: respostaManual.content.length,
          trechos: Array.isArray(respostaManual.trechos) ? respostaManual.trechos.length : 0,
          previews: Array.isArray(respostaManual.manualPreviews) ? respostaManual.manualPreviews.length : 0
        });
        return res.json({
          content: respostaManual.content,
          manualPreviews: Array.isArray(respostaManual.manualPreviews) ? respostaManual.manualPreviews : []
        });
      }
    } catch (errManual) {
      console.warn('[AI/Chat] Fallback para modo conversa (manuais falharam):', errManual?.message || errManual);
    }
  }

  if (perguntaAtual && dbPool && priorizarManuais) {
    try {
      const respostaFaq = await buscarFaqAprovadaChatbot(perguntaContextual || perguntaAtual);
      if (respostaFaq?.content) {
        await salvarMemoriaUsuarioChatbot(req, extrairMemoriaCurtaDaConversa({
          pergunta: perguntaAtual,
          resposta: respostaFaq.content
        }));
        logAiChatInfo('sucesso-faq', {
          duracaoMs: Date.now() - startedAt,
          respostaChars: respostaFaq.content.length,
          faqId: respostaFaq.id || null,
          area: respostaFaq.area || null
        });
        return res.json({ content: respostaFaq.content });
      }
    } catch (errFaq) {
      console.warn('[AI/Chat] Fallback para próximas fontes (FAQ falhou):', errFaq?.message || errFaq);
    }
  }

  if (perguntaAtual && dbPool) {
    try {
      const respostaSql = await tentarResponderComSqlAuto({ apiKey, pergunta: perguntaContextual || perguntaAtual, req });
      if (respostaSql) {
        await salvarMemoriaUsuarioChatbot(req, extrairMemoriaCurtaDaConversa({
          pergunta: perguntaAtual,
          resposta: respostaSql
        }));
        if (respostaPrecisaRevisao(respostaSql)) {
          await registrarMensagemErroChatbot({
            req,
            rota: 'chat',
            motivo: 'resposta_auto_sql_precisa_revisao',
            pergunta: perguntaAtual,
            resposta: respostaSql,
            httpStatus: 200,
            detalhes: { origem: 'auto_sql' }
          });
          await registrarLacunaConhecimentoChatbot({
            req,
            pergunta: perguntaAtual,
            motivo: 'resposta_auto_sql_precisa_revisao',
            respostaFornecida: respostaSql,
            contexto: { origem: 'auto_sql', memoria: memoriaUsuario },
            sugestaoFonte: 'Criar FAQ aprovada ou consulta SQL direta para esse caso'
          });
        }
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
          ...(memoriaPrompt ? [{ role: 'system', content: `Contexto de memória curta do usuário:\n${memoriaPrompt}` }] : []),
          ...sanitizedMessages
        ],
        max_tokens: 600,
        temperature: 0.4
      },
      { timeout: 30000, contexto: 'AI/Chat/OpenAI' }
    );

    const content = response.data.choices[0]?.message?.content || '';
    if (!String(content || '').trim()) {
      await registrarMensagemErroChatbot({
        req,
        rota: 'chat',
        motivo: 'resposta_modelo_vazia',
        pergunta: perguntaAtual,
        resposta: '',
        httpStatus: 200,
        detalhes: { origem: 'openai_chat' }
      });
    }
    if (respostaPrecisaRevisao(content)) {
      await registrarMensagemErroChatbot({
        req,
        rota: 'chat',
        motivo: 'resposta_modelo_precisa_revisao',
        pergunta: perguntaAtual,
        resposta: content,
        httpStatus: 200,
        detalhes: { origem: 'openai_chat' }
      });
      await registrarLacunaConhecimentoChatbot({
        req,
        pergunta: perguntaAtual,
        motivo: 'resposta_modelo_precisa_revisao',
        respostaFornecida: content,
        contexto: { origem: 'openai_chat', memoria: memoriaUsuario },
        sugestaoFonte: 'Adicionar FAQ aprovada ou documento oficial sobre esse tema'
      });
    }
    await salvarMemoriaUsuarioChatbot(req, extrairMemoriaCurtaDaConversa({
      pergunta: perguntaAtual,
      resposta: content
    }));
    if (!String(content || '').trim()) {
      await registrarLacunaConhecimentoChatbot({
        req,
        pergunta: perguntaAtual,
        motivo: 'resposta_modelo_vazia',
        respostaFornecida: '',
        contexto: { origem: 'openai_chat', memoria: memoriaUsuario },
        sugestaoFonte: 'Adicionar FAQ aprovada ou melhorar contexto do sistema'
      });
    }
    logAiChatInfo('sucesso-openai', {
      duracaoMs: Date.now() - startedAt,
      respostaChars: content.length
    });
    return res.json({ content });

  } catch (err) {
    return responderErroOpenAI(res, err, 'AI/Chat', req);
  }
});

// ─── GET /api/ai/monitor ──────────────────────────────────────────────────────
router.get('/monitor', async (req, res) => {
  if (!req.session?.user?.id) {
    return res.status(401).json({ ok: false, error: 'Não autenticado.' });
  }
  if (!usuarioEhAdminChatbot(req)) {
    return res.status(403).json({ ok: false, error: 'Acesso restrito a administradores.' });
  }
  if (!dbPool) {
    return res.status(503).json({ ok: false, error: 'Banco de dados não configurado.' });
  }

  try {
    await Promise.all([
      garantirTabelaMensagensErro(),
      garantirTabelasManuaisChatbot(),
      garantirTabelasConhecimentoChatbot()
    ]);

    const [
      resumoResult,
      lacunasResult,
      errosResult,
      faqAreasResult,
      lacunasMotivoResult,
      manuaisStatusResult
    ] = await Promise.all([
      dbPool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM "Chatbot".faq_aprovadas WHERE COALESCE(status_aprovacao, 'aprovado') = 'aprovado') AS faq_aprovadas,
          (SELECT COUNT(*)::int FROM "Chatbot".faq_aprovadas WHERE created_at >= NOW() - INTERVAL '30 days' AND COALESCE(status_aprovacao, 'aprovado') = 'aprovado') AS faq_novas_30d,
          (SELECT COUNT(*)::int FROM "Chatbot".manuais_instrucao WHERE COALESCE(status_indexacao, 'pendente') = 'indexado') AS manuais_indexados,
          (SELECT COUNT(*)::int FROM "Chatbot".manuais_instrucao_chunks) AS trechos_indexados,
          (SELECT COUNT(DISTINCT usuario)::int FROM "Chatbot".memoria_usuario WHERE expira_em IS NULL OR expira_em > NOW()) AS usuarios_memoria_ativa,
          (SELECT COUNT(*)::int FROM "Chatbot".memoria_usuario WHERE expira_em IS NULL OR expira_em > NOW()) AS itens_memoria_ativos,
          (SELECT COUNT(*)::int FROM "Chatbot".lacunas_conhecimento WHERE COALESCE(status, 'novo') NOT IN ('resolvido', 'resolvida', 'fechado', 'fechada', 'concluido', 'concluida', 'descartado')) AS lacunas_abertas,
          (SELECT COUNT(*)::int FROM "Chatbot".lacunas_conhecimento WHERE created_at >= NOW() - INTERVAL '7 days') AS lacunas_7d,
          (SELECT COUNT(*)::int FROM "Chatbot".lacunas_conhecimento WHERE atualizado_em >= NOW() - INTERVAL '30 days' AND lower(COALESCE(status, '')) IN ('resolvido', 'resolvida', 'fechado', 'fechada', 'concluido', 'concluida')) AS lacunas_resolvidas_30d,
          (SELECT COUNT(*)::int FROM "Chatbot"."Mensagens_erro" WHERE criado_em >= NOW() - INTERVAL '30 days') AS erros_30d
      `),
      dbPool.query(`
        SELECT
          id,
          usuario,
          pergunta,
          motivo_falha,
          status,
          sugestao_fonte,
          COALESCE(contexto->>'origem', '') AS origem,
          created_at
        FROM "Chatbot".lacunas_conhecimento
        WHERE COALESCE(status, 'novo') NOT IN ('resolvido', 'resolvida', 'fechado', 'fechada', 'concluido', 'concluida', 'descartado')
        ORDER BY created_at DESC
        LIMIT 20
      `),
      dbPool.query(`
        SELECT
          id,
          criado_em,
          rota,
          motivo,
          usuario,
          pergunta,
          http_status
        FROM "Chatbot"."Mensagens_erro"
        ORDER BY criado_em DESC
        LIMIT 20
      `),
      dbPool.query(`
        SELECT
          COALESCE(NULLIF(area, ''), 'geral') AS area,
          COUNT(*)::int AS total
        FROM "Chatbot".faq_aprovadas
        WHERE COALESCE(status_aprovacao, 'aprovado') = 'aprovado'
        GROUP BY 1
        ORDER BY total DESC, area ASC
        LIMIT 10
      `),
      dbPool.query(`
        SELECT
          motivo_falha,
          COUNT(*)::int AS total
        FROM "Chatbot".lacunas_conhecimento
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY 1
        ORDER BY total DESC, motivo_falha ASC
        LIMIT 10
      `),
      dbPool.query(`
        SELECT
          COALESCE(NULLIF(status_indexacao, ''), 'pendente') AS status,
          COUNT(*)::int AS total
        FROM "Chatbot".manuais_instrucao
        GROUP BY 1
        ORDER BY total DESC, status ASC
      `)
    ]);

    const resumo = resumoResult.rows?.[0] || {};
    const summary = {
      faqAprovadas: Number(resumo.faq_aprovadas || 0),
      faqNovas30d: Number(resumo.faq_novas_30d || 0),
      manuaisIndexados: Number(resumo.manuais_indexados || 0),
      trechosIndexados: Number(resumo.trechos_indexados || 0),
      usuariosMemoriaAtiva: Number(resumo.usuarios_memoria_ativa || 0),
      itensMemoriaAtivos: Number(resumo.itens_memoria_ativos || 0),
      lacunasAbertas: Number(resumo.lacunas_abertas || 0),
      lacunas7d: Number(resumo.lacunas_7d || 0),
      lacunasResolvidas30d: Number(resumo.lacunas_resolvidas_30d || 0),
      erros30d: Number(resumo.erros_30d || 0)
    };

    return res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      knowledgeLevel: calcularNivelConhecimentoChatbot(summary),
      summary,
      learningReport: {
        faqPorArea: (faqAreasResult.rows || []).map((row) => ({
          area: String(row.area || '').trim() || 'geral',
          total: Number(row.total || 0)
        })),
        lacunasPorMotivo: (lacunasMotivoResult.rows || []).map((row) => ({
          motivo: String(row.motivo_falha || '').trim() || 'nao_informado',
          total: Number(row.total || 0)
        })),
        statusManuais: (manuaisStatusResult.rows || []).map((row) => ({
          status: String(row.status || '').trim() || 'pendente',
          total: Number(row.total || 0)
        }))
      },
      unresolvedQuestions: (lacunasResult.rows || []).map((row) => ({
        id: Number(row.id || 0),
        usuario: String(row.usuario || '').trim() || null,
        pergunta: String(row.pergunta || '').trim(),
        motivo: String(row.motivo_falha || '').trim() || 'nao_informado',
        status: String(row.status || '').trim() || 'novo',
        sugestaoFonte: String(row.sugestao_fonte || '').trim() || null,
        origem: String(row.origem || '').trim() || null,
        createdAt: row.created_at
      })),
      recentErrors: (errosResult.rows || []).map((row) => ({
        id: Number(row.id || 0),
        createdAt: row.criado_em,
        rota: String(row.rota || '').trim() || 'chat',
        motivo: String(row.motivo || '').trim() || 'erro_nao_classificado',
        usuario: String(row.usuario || '').trim() || null,
        pergunta: String(row.pergunta || '').trim(),
        httpStatus: row.http_status == null ? null : Number(row.http_status || 0)
      }))
    });
  } catch (err) {
    console.error('[AI/Monitor] Erro ao montar dashboard:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'Não foi possível carregar o monitoramento do chatbot.' });
  }
});

router.get('/monitor/details', async (req, res) => {
  if (!req.session?.user?.id) {
    return res.status(401).json({ ok: false, error: 'Não autenticado.' });
  }
  if (!usuarioEhAdminChatbot(req)) {
    return res.status(403).json({ ok: false, error: 'Acesso restrito a administradores.' });
  }
  if (!dbPool) {
    return res.status(503).json({ ok: false, error: 'Banco de dados não configurado.' });
  }

  const dataset = String(req.query?.dataset || 'faq').trim().toLowerCase();
  const page = parseChatbotMonitorInt(req.query?.page, 1, { min: 1, max: 9999 });
  const pageSize = parseChatbotMonitorInt(req.query?.pageSize, 20, { min: 5, max: 100 });
  const search = String(req.query?.search || '').trim().slice(0, 200);

  try {
    await Promise.all([
      garantirTabelasConhecimentoChatbot(),
      garantirTabelasHistoricoChatbot()
    ]);

    let payload = null;
    if (dataset === 'faq') {
      payload = await carregarDetalheFaqMonitorChatbot({
        page,
        pageSize,
        search,
        area: String(req.query?.area || '').trim().slice(0, 80),
        status: String(req.query?.status || '').trim().slice(0, 80),
        sortBy: String(req.query?.sortBy || 'updated_at').trim().toLowerCase(),
        sortDir: String(req.query?.sortDir || 'desc').trim().toLowerCase()
      });
    } else if (dataset === 'messages') {
      payload = await carregarDetalheMensagensMonitorChatbot({
        page,
        pageSize,
        search,
        role: String(req.query?.role || '').trim().slice(0, 80),
        origin: String(req.query?.origin || '').trim().slice(0, 120),
        conversationId: String(req.query?.conversationId || '').trim().slice(0, 120),
        user: String(req.query?.user || '').trim().slice(0, 120),
        sortBy: String(req.query?.sortBy || 'criado_em').trim().toLowerCase(),
        sortDir: String(req.query?.sortDir || 'desc').trim().toLowerCase()
      });
    } else if (dataset === 'memory') {
      payload = await carregarDetalheMemoriaMonitorChatbot({
        page,
        pageSize,
        search,
        key: String(req.query?.key || '').trim().slice(0, 120),
        user: String(req.query?.user || '').trim().slice(0, 120),
        activeState: String(req.query?.activeState || 'all').trim().toLowerCase(),
        sortBy: String(req.query?.sortBy || 'atualizado_em').trim().toLowerCase(),
        sortDir: String(req.query?.sortDir || 'desc').trim().toLowerCase()
      });
    } else {
      return res.status(400).json({ ok: false, error: 'Dataset inválido para exploração do monitoramento.' });
    }

    return res.json({
      ok: true,
      dataset,
      generatedAt: new Date().toISOString(),
      ...payload
    });
  } catch (err) {
    console.error('[AI/Monitor/Details] Erro ao carregar dataset:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'Não foi possível carregar os registros detalhados do chatbot.' });
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
    await registrarMensagemErroChatbot({
      req,
      rota: 'report',
      motivo: 'servico_ia_nao_configurado',
      pergunta: question,
      resposta: 'Serviço de IA não configurado. Contate o administrador do sistema.',
      httpStatus: 503,
      detalhes: { etapa: 'report', config: 'OPENAI_API_KEY_ausente' }
    });
    return res.status(503).json({ ok: false, error: 'Serviço de IA não configurado. Contate o administrador do sistema.' });
  }
  if (!dbPool) {
    logAiReportInfo('sem-banco', { motivo: 'DATABASE_URL_ausente' });
    await registrarMensagemErroChatbot({
      req,
      rota: 'report',
      motivo: 'banco_nao_configurado',
      pergunta: question,
      resposta: 'Banco de dados não configurado para relatórios SQL.',
      httpStatus: 503,
      detalhes: { etapa: 'report', config: 'DATABASE_URL_ausente' }
    });
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
      await registrarMensagemErroChatbot({
        req,
        rota: 'report',
        motivo: 'sql_inseguro_ou_invalido',
        pergunta: question,
        resposta: `Não foi possível gerar SQL seguro: ${erroValidacao}`,
        httpStatus: 400,
        detalhes: { sql, erroValidacao }
      });
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
      return responderErroOpenAI(res, err, 'AI/Report', req);
    }

    const msg = String(err?.message || 'Erro ao executar relatório SQL.');
    const detalhe = msg.slice(0, 300);
    console.error('[AI/Report] Erro:', detalhe);
    await registrarMensagemErroChatbot({
      req,
      rota: 'report',
      motivo: 'erro_execucao_relatorio',
      pergunta: question,
      resposta: `Não foi possível gerar/executar o relatório SQL. Detalhe: ${detalhe}`,
      httpStatus: 400,
      detalhes: { message: detalhe }
    });
    return res.status(400).json({
      ok: false,
      error: `Não foi possível gerar/executar o relatório SQL. Detalhe: ${detalhe}`
    });
  }
});

module.exports = router;
