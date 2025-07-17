// server.js
// Carrega as variáveis de ambiente definidas em .env
require('dotenv').config();
// Em server.js (topo do arquivo)
// chave: id da etiqueta (p.ex. número da OP), valor: { fileName, printed: boolean }

// ——————————————————————————————
// 1) Imports e configurações iniciais
// ——————————————————————————————
const express       = require('express');
const session       = require('express-session');
const fs  = require('fs');           // todas as funções sync
const fsp = fs.promises;            // parte assíncrona (equivale a fs/promises)
const path          = require('path');
const multer        = require('multer');
const fetch = require('node-fetch');
// logo após os outros requires:
const archiver = require('archiver');
const crypto   = require('crypto');
// (se você usar fetch no Node <18, também faça: const fetch = require('node-fetch');)
const { parse: csvParse }         = require('csv-parse/sync');

// ─── Config. dinâmica de etiqueta ─────────────────────────
const etqConfigPath = path.join(__dirname, 'csv', 'Configuração_etq_caracteristicas.csv');

let etqConfig = [];
function loadEtqConfig() {
  if (etqConfig.length) return;              // já carregado
  const raw = fs.readFileSync(etqConfigPath, 'utf8');
  etqConfig = csvParse(raw, { columns: true, skip_empty_lines: true })
               .sort((a, b) => Number(a.Ordem) - Number(b.Ordem)); // mantém ordem
}
loadEtqConfig();
// DEBUG ────────────────────────────────────────────────
console.log('\n⇢ Cabeçalhos que o csv-parse leu:');
console.table(etqConfig.slice(0, 5));
// Fim DEBUG ─────────────────────────────────────────────

/**
 * Separa as linhas para a coluna E (esquerda) e D (direita)
 * @param {object} cad – produto vindo do Omie
 * @returns {{E:Array, D:Array}}
 */
function separarLinhas(cad) {
// letras até encontrar o 1º dígito ou hífen
const prefixoModelo =
  ((cad.codigo || cad.modelo || '').match(/^[A-Za-z]+/) || [''])[0]
    .toUpperCase();


  return etqConfig.reduce((acc, row) => {
    const modo   = (row.modo     || '').trim().toUpperCase();   // C / E
    const coluna = (row.coluna   || '').trim().toUpperCase();   // E / D
const lista = (row.Prefixos || '')
                .toUpperCase()
                .split(';')
                .filter(Boolean);        // ['FT','FH','FTI', …]

const ehComum    = modo === 'C';
const ehDoModelo = modo === 'E' && lista.includes(prefixoModelo);


    if (ehComum || ehDoModelo) acc[coluna].push(row);
    return acc;
  }, { E: [], D: [] });
}




const { stringify: csvStringify } = require('csv-stringify/sync');
const loginOmie     = require('./routes/login_omie');
const malhaRouter   = require('./routes/malha');
const malhaConsultar= require('./routes/malhaConsultar');
const estoqueRouter = require('./routes/estoque');
const estoqueResumoRouter = require('./routes/estoqueResumo');
const authRouter    = require('./routes/auth');
const etiquetasRouter = require('./routes/etiquetas');   // ⬅️  NOVO
const omieCall      = require('./utils/omieCall');
const bcrypt = require('bcrypt');
const INACTIVE_HASH = '$2b$10$ltPcvabuKvEU6Uj1FBUmi.ME4YjVq/dhGh4Z3PpEyNlphjjXCDkTG';   // ← seu HASH_INATIVO aqui
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const {
  OMIE_APP_KEY,
  OMIE_APP_SECRET,
  GITHUB_TOKEN,
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_BRANCH,
  GITHUB_PATH
} = require('./config.server');
const KANBAN_FILE = path.join(__dirname, 'data', 'kanban.json');


/* lê o MAIOR nº que existir em QUALQUER cartão.local-[]  */
function nextOpFromKanban () {
  try {
    const items = JSON.parse(fs.readFileSync(KANBAN_FILE,'utf8'));   // ← é um array
    const nums  = items
      .flatMap(it => Array.isArray(it.local) ? it.local : [])
      .map(s => {
        const m = String(s).match(/,\s*(\d+)\s*$/);   // “…,21007”
        return m ? Number(m[1]) : NaN;
      })
      .filter(n => !Number.isNaN(n));

    const maior = nums.length ? Math.max(...nums) : 21000;
    return String(maior + 1);           // 21001, 21002, …
  } catch (err) {
    console.error('[nextOpFromKanban]', err);
    return '21001';
  }
}


// ——————————————————————————————
// 2) Cria a app e configura middlewares globais
// ——————————————————————————————
const app = express();


// ——— Etiquetas ————————————————————
const etiquetasRoot = path.join(__dirname, 'etiquetas');   // raiz única
// garante as pastas mínimas usadas hoje
fs.mkdirSync(path.join(etiquetasRoot, 'Expedicao',  'Printed'), { recursive: true });
fs.mkdirSync(path.join(etiquetasRoot, 'Recebimento', 'Printed'), { recursive: true });

function getDirs(tipo = 'Expedicao') {
  const dirTipo   = path.join(etiquetasRoot, tipo);                // p.ex. …/Expedicao
  const dirPrint  = path.join(dirTipo,    'Printed');              // …/Expedicao/Printed
  fs.mkdirSync(dirPrint, { recursive: true });
  return { dirTipo, dirPrint };
}



app.use('/etiquetas', express.static(etiquetasRoot));

// ——————————————————————————————
// proteger rotas de etiquetas com token
// ——————————————————————————————
function chkToken(req, res, next) {
  if (req.query.token !== process.env.MY_ZPL_SECRET) {
    return res.sendStatus(401);          // Unauthorized
  }
  next();
}

// Sessão (cookies) para manter usuário logado
app.use(session({
  secret: 'uma_chave_secreta_forte', // troque por algo mais seguro
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 1 dia
    httpOnly: true,
    secure: false              // em produção, true se rodar via HTTPS
  }
}));
const LOG_FILE = path.join(__dirname, 'data', 'kanban.log');  // ou outro nome

app.post('/api/logs/arrasto', express.json(), (req, res) => {
  const log = req.body;
  const linha = `[${log.timestamp}] ${log.etapa} – Pedido: ${log.pedido}, Código: ${log.codigo}, Qtd: ${log.quantidade}\n`;

  fs.appendFile(LOG_FILE, linha, err => {
    if (err) {
      console.error('Erro ao gravar log:', err);
      return res.status(500).json({ error: 'Falha ao registrar log' });
    }
    res.json({ ok: true });
  });
});

const kanbanRouter = require('./routes/kanban');
app.use('/api/kanban', kanbanRouter);

// Parser JSON para todas as rotas
app.use(express.json());
// Multer para upload de imagens
const upload = multer({ storage: multer.memoryStorage() });


// ——————————————————————————————
// 3) Inicializa Octokit (GitHub) e monta todas as rotas
// ——————————————————————————————
(async () => {
  const { Octokit } = await import('@octokit/rest');
  const octokit = new Octokit({ auth: GITHUB_TOKEN });


/* ============================================================================
   2) Lista pendentes (lê direto a pasta)
   ============================================================================ */
app.get('/api/etiquetas/pending', (req, res) => {
  const { dirTipo } = getDirs('Expedicao');               // só “Expedicao” hoje
  const files = fs.readdirSync(dirTipo).filter(f => f.endsWith('.zpl'));

  const list = files.map(f => ({
    id: f.match(/^etiqueta_(.+)\.zpl$/)[1],
    zplUrl: `${req.protocol}://${req.get('host')}/etiquetas/Expedicao/${f}`
  }));

  res.json(list);
});

/* ============================================================================
   3) Marca como impressa (move para …/Printed)
   ============================================================================ */
app.post('/api/etiquetas/:id/printed', (req, res) => {
  const id = req.params.id;
  const { dirTipo, dirPrint } = getDirs('Expedicao');
  const src = path.join(dirTipo,  `etiqueta_${id}.zpl`);
  const dst = path.join(dirPrint, `etiqueta_${id}.zpl`);

  if (!fs.existsSync(src)) return res.sendStatus(404);
  try {
    fs.renameSync(src, dst);
    res.sendStatus(200);
  } catch (err) {
    console.error('[etiquetas/printed] Falha ao mover:', err);
    res.status(500).json({ error: 'Falha ao mover etiqueta' });
  }
});

/**
 * Quebra um texto em linhas de até maxChars caracteres, 
 * sempre respeitando os espaços.
 */
function wrapText(text, maxChars) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length <= maxChars) {
      current = (current + ' ' + w).trim();
    } else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/* ============================================================================
   /api/etiquetas – gera o .zpl da etiqueta no layout “compacto” aprovado
   ============================================================================ */
app.post('/api/etiquetas', async (req, res) => {
  try {
    const { numeroOP, tipo = 'Expedicao', codigo } = req.body;

      // Garante existência da pasta dinâmica (Teste ou Expedicao)
  const folder = path.join(__dirname, 'etiquetas', tipo);
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }

    if (!numeroOP) return res.status(400).json({ error: 'Falta numeroOP' });

    /* ---------------------------------------------------------------------
       1) Consulta Omie (se veio código)
    --------------------------------------------------------------------- */
    let produtoDet = {};
    if (codigo) {
      produtoDet = await omieCall(
        'https://app.omie.com.br/api/v1/geral/produtos/',
        {
          call:       'ConsultarProduto',
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param:      [{ codigo }]
        }
      );
    }

    /* ---------------------------------------------------------------------
       2) Diretório de saída
    --------------------------------------------------------------------- */
    const { dirTipo } = getDirs(tipo);

    /* ---------------------------------------------------------------------
       3) Data de fabricação (MM/AAAA)
    --------------------------------------------------------------------- */
    const hoje          = new Date();
    const hojeFormatado =
      `${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`;

    /* ---------------------------------------------------------------------
       4) Características → objeto d   (troca ~ → _7E)
    --------------------------------------------------------------------- */
    const cad = produtoDet.produto_servico_cadastro?.[0] || produtoDet;
    // -------------------------------------------------------------
// código interno do produto (vem do Omie)
// -------------------------------------------------------------
// -------------------------------------------------------------
// MODELO na etiqueta = código com hífen antes do 1º dígito
// Ex.: ft160 → ft-160   |   FH200 → FH-200   |   fti25b → fti-25b
// -------------------------------------------------------------
const modeloParaEtiqueta = (cad.codigo || '')
  .replace(/^([A-Za-z]+)(\d)/, '$1-$2');


    const d   = {};
    const encodeTilde = s => (s || '').replace(/~/g, '_7E');

    (cad.caracteristicas || []).forEach(c => {
      d[c.cCodIntCaract] = encodeTilde(c.cConteudo);
    });

    d.modelo          = cad.modelo      || '';
    d.ncm             = cad.ncm         || '';
    d.pesoLiquido     = cad.peso_liq    || '';
    d.dimensaoProduto =
      `${cad.largura || ''}x${cad.profundidade || ''}x${cad.altura || ''}`;

    const z = v => v || '';            // evita undefined em ^FD

/* ---------------------------------------------------------------------
   5) ZPL – mesmo layout, mas linhas dinâmicas a partir do CSV
--------------------------------------------------------------------- */
const linhas = separarLinhas(cad);     // usa função criada no topo

// parâmetros de espaçamento (ajuste só se mudar fonte ou margens)
const startY_E = 540;  // Y inicial da coluna esquerda
const startY_D = 540;  // Y inicial da coluna direita

const CHAR_W        = 11;  // acertado na calibragem
const STEP_ITEM     = 40;  // distância até o próximo item “normal”
const STEP_SUFIXO   = 30;  // distância quando é só o sufixo “(…)”
const STEP_WRAP     = 20;  // distância entre linhas quebradas do MESMO rótulo


function montarColuna(col, startY, xLabel, xValue) {
  const blocos = [];
  let   y      = startY;

  const xParenByBase = {};        // base → X do '('
  let   baseAnterior = '';

  for (const row of col) {
    const cod   = (row.Caracteristica || '').trim();
    const valor = z(d[cod]);

    /* separa base + sufixo */
    const full = (row.Label || '').trim();
    const m    = full.match(/^(.+?)\s*\(([^()]+)\)\s*$/);
    const base   = m ? m[1].trim() : full;
    const sufixo = m ? `(${m[2]})`  : '';

    const sufixoOnly = base === baseAnterior && sufixo;

    /* decide texto + X */
    let labelPrint, xLabelNow = xLabel;
    if (sufixoOnly) {
      labelPrint = sufixo;
      xLabelNow  = xParenByBase[base];
    } else {
      labelPrint   = full;
      baseAnterior = base;
      const p = full.indexOf('(');
      if (p >= 0) xParenByBase[base] = xLabel + p * CHAR_W;
    }

    /* quebra >25 chars --------------- */
    const LIM = 25;
    const partes = [];
    let txt = labelPrint;
    while (txt.length > LIM) {
      const pos = txt.lastIndexOf(' ', LIM);
      if (pos > 0) { partes.push(txt.slice(0,pos)); txt = txt.slice(pos+1); }
      else break;
    }
    partes.push(txt);

    /* imprime LABEL(es) --------------- */
    partes.forEach((ln, idx) => {
      const stepIntra = idx === 0 ? 0 : STEP_WRAP; // 1ª linha = 0
      blocos.push(
        `^A0R,25,25`,
        `^FO${y - stepIntra},${xLabelNow}^FD${ln}^FS`
      );
      y -= stepIntra;          // só para linhas quebradas
    });

    /* imprime VALOR ------------------- */
    blocos.push(
      `^A0R,20,20`,
      `^FO${y},${xValue}^FB200,1,0,R^FH_^FD${valor}^FS`
    );

    /* avança para o PRÓXIMO item ------ */
    y -= sufixoOnly ? STEP_SUFIXO : STEP_ITEM;
  }

  return blocos.join('\n');
}

const blocoE = montarColuna(linhas.E, startY_E,  25, 240); // esquerda
const blocoD = montarColuna(linhas.D, startY_D, 470, 688); // direita



const zpl = `
^XA
^CI28
^PW1150
^LL700

; ── Cabeçalho fixo ───────────────────────────────────────────────────────
^A0R,42,40
^FO640,15^FDBOMBA DE CALOR FROMTHERM^FS
^A0R,20,20
^FO650,690^FD FABRICAÇÃO:^FS
^A0R,20,20
^FO650,820^FH_^FD${hojeFormatado}^FS

^FO580,20^GB60,375,2^FS
^A0R,22,22
^FO593,35^FDMODELO^FS
^A0R,40,40
^FO585,120^FH_^FD${z(modeloParaEtiqueta)}^FS
^FO580,400^GB60,190,2^FS
^A0R,25,25
^FO585,405^FH_^FDNCM: ${z(d.ncm)}^FS

^FO580,595^GB60,235,60^FS
^A0R,25,25                 ; tamanho da letra do NS numero de serie
^FO585,600^FR^FDNS:^FS
^A0R,40,40
^FO585,640^FR^FH_^FD${numeroOP}^FS   ; X aproximado
^FO580,825^BQN,2,3^FH_^FDLA,${numeroOP}^FS
^FO30,450^GB545,2,2^FS

; ── BLOCO ESQUERDO (CSV) ────────────────────────────────────────────────
${blocoE}

; ── BLOCO DIREITO (CSV) ─────────────────────────────────────────────────
${blocoD}

^XZ
`;


    /* ---------------------------------------------------------------------
       6) Salva o arquivo .zpl
    --------------------------------------------------------------------- */
    const fileName = `etiqueta_${numeroOP}.zpl`;
    fs.writeFileSync(path.join(dirTipo, fileName), zpl.trim(), 'utf8');

    return res.json({ ok: true });
  } catch (err) {
    console.error('[etiquetas] erro →', err);
    return res.status(500).json({ error: 'Erro ao gerar etiqueta' });
  }
});

app.get('/api/op/next-code/:dummy', (req,res)=>{ return res.json({ nextCode: nextOpFromKanban() }); });
  // ——————————————————————————————
  // 3.1) Rotas CSV (Tipo.csv)
  // ——————————————————————————————
  app.post('/api/omie/updateTipo', (req, res) => {
    const { groupId, listaPecas } = req.body;
const csvPath = path.join(__dirname, 'csv', 'Configuração_etq_caracteristicas.csv');
const csvText = fs.readFileSync(csvPath, 'utf8');
// OBS.: o arquivo usa “;” – indicamos o delimitador explicitamente
const rows = csvParse(csvText, {
  columns:           true,
  skip_empty_lines:  true,
  delimiter:         ','          // <<< a parte que estava faltando
});

    const updated = rows.map(row => {
      if (+row.Grupo === groupId) row['lista_peças'] = listaPecas;
      return row;
    });

    fs.writeFileSync(csvPath, csvStringify(updated, { header: true }), 'utf8');
    res.json({ ok: true });
  });


  // para imprimir etiquetas ZPL

const uuid = require('uuid').v4;  // para gerar um nome único, se desejar


  app.post('/api/omie/updateNaoListar', (req, res) => {
    const { groupId, prefix } = req.body;
    const csvPath = path.join(__dirname, 'csv', 'Tipo.csv');
    const text    = fs.readFileSync(csvPath, 'utf8');
    const rows    = csvParse(text, { columns: true, skip_empty_lines: true });

    const updated = rows.map(row => {
      if (+row.Grupo === groupId) {
        const arr = row.nao_listar_comeca_com
                      .replace(/(^"|"$)/g,'')
                      .split(',')
                      .filter(s => s);
        if (!arr.includes(prefix)) arr.push(prefix);
        row.nao_listar_comeca_com = arr.join(',');
      }
      return row;
    });

    fs.writeFileSync(csvPath, csvStringify(updated, { header: true }), 'utf8');
    res.json({ ok: true });
  });

// rota para listar ordem de produção para ver qual a ultima op gerada
app.post('/api/omie/produtos/op', async (req, res) => {
  try {


const novoCodInt = nextOpFromKanban();      // ex.: "21001"

    const linha = `[${new Date().toISOString()}] Geração de OP – Pedido: ${req.body.param?.[0]?.identificacao?.nCodPed}, Código OP: ${novoCodInt}\n`;
fs.appendFile(LOG_FILE, linha, err => {
  if (err) console.error('Erro ao gravar log de OP:', err);
});

    // ---- monta payload FINAL (usa tudo que veio do front) ----
    const front = req.body;                         // título, qtde, etc.
    front.param[0].identificacao.cCodIntOP = novoCodInt;

    // ---- tenta criar OP; se colidir, faz +1 até 5 tentativas ----
    let tentativa = 0;
    let resposta;
    while (tentativa < 5) {
 resposta = await omieCall(
   'https://app.omie.com.br/api/v1/produtos/op/',
   front
 );
      if (resposta?.faultcode === 'SOAP-ENV:Client-102') {   // duplicado
        tentativa++;
        continue;
      }
      break;  // sucesso ou outro erro
    }

    res.status(resposta?.faultstring ? 500 : 200).json(resposta);
  } catch (err) {
    console.error('[produtos/op] erro →', err);
    res.status(err.status||500).json({ error:String(err) });
  }
});

  // lista pedidos
app.post('/api/omie/pedidos', express.json(), async (req, res) => {
  try {
    const data = await omieCall(
      'https://app.omie.com.br/api/v1/produtos/pedido/',
      {
        call:       'ListarPedidos',
        app_key:    OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param:      req.body.param
      }
    );
    return res.json(data);
  } catch (err) {
    console.error('[pedidos] erro →', err);
    return res
      .status(err.status || 500)
      .json({ error: err.faultstring || err.message });
  }
});


// ------------------------------------------------------------------
// Alias: /api/omie/produto  →  mesma lógica de /api/omie/produtos
// ------------------------------------------------------------------
app.post('/api/omie/produto', async (req, res) => {
  try {
    const data = await omieCall(
      'https://app.omie.com.br/api/v1/geral/produtos/',
      {
        call:       req.body.call,    // ex.: "ConsultarProduto"
        app_key:    OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param:      req.body.param
      }
    );
    return res.json(data);
  } catch (err) {
    console.error('[produto] erro →', err);
    return res
      .status(err.status || 500)
      .json({ error: err.faultstring || err.message });
  }
});

// ─── Rota para ConsultarCliente ───
app.post('/api/omie/cliente', express.json(), async (req, res) => {
  try {
    const data = await omieCall(
      'https://app.omie.com.br/api/v1/geral/clientes/',
      {
        call:       'ConsultarCliente',
        app_key:    OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param:      req.body.param
      }
    );
    return res.json(data);
  } catch (err) {
    console.error('[cliente] erro →', err);
    return res
      .status(err.status || 500)
      .json({ error: err.faultstring || err.message });
  }
});


// ─── Rota para ConsultarPedido ───
// ─── Rota para ConsultarPedido (com debug) ───
app.post('/api/omie/pedido', express.json(), async (req, res) => {
  console.log('[pedido] body recebido →', JSON.stringify(req.body, null, 2));
  console.log('[pedido] chaves Omie →', OMIE_APP_KEY, OMIE_APP_SECRET ? 'OK' : 'MISSING');
  try {
    const data = await omieCall(
      'https://app.omie.com.br/api/v1/produtos/pedido/',
      {
        call:       'ConsultarPedido',
        app_key:    OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param:      req.body.param
      }
    );
    console.log('[pedido] resposta OMIE →', JSON.stringify(data, null, 2));
    return res.json(data);
  } catch (err) {
    console.error('[pedido] erro ao chamar OMIE →', err.faultstring || err.message, err);
    return res
      .status(err.status || 500)
      .json({ error: err.faultstring || err.message });
  }
});


// ─── Proxy manual para ObterEstoqueProduto ───
app.post('/api/omie/estoque/resumo', express.json(), async (req, res) => {
  console.log('[server][estoque/resumo] req.body.param:', req.body.param);
  try {
    const data = await omieCall(
      'https://app.omie.com.br/api/v1/estoque/resumo/',
      {
        call:       'ObterEstoqueProduto',
        app_key:    OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param:      req.body.param
      }
    );
    console.log('[server][estoque/resumo] OMIE respondeu:', data);
    return res.json(data);
  } catch (err) {
    console.error('[server][estoque/resumo] ERRO →', err);
    return res
      .status(err.status || 500)
      .json({ error: err.faultstring || err.message });
  }
});


// server.js (ou onde você centraliza as rotas OMIE)

// Rota para servir de proxy à chamada de PosicaoEstoque do OMIE
app.post('/api/omie/estoque/consulta', express.json(), async (req, res) => {
  console.log('[estoque/consulta] req.body →', JSON.stringify(req.body, null, 2));
  try {
    const omieResponse = await fetch('https://app.omie.com.br/api/v1/estoque/consulta/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const text = await omieResponse.text();
    console.log('[estoque/consulta] OMIE responded status', omieResponse.status, 'body:', text);
    if (!omieResponse.ok) {
      return res.status(omieResponse.status).send(text);
    }
    const json = JSON.parse(text);
    return res.json(json);
  } catch (err) {
    console.error('[estoque/consulta] Erro ao chamar OMIE:', err);
    // devolve o erro para o cliente para depuração
    return res.status(err.status || 500).json({
      error: err.faultstring || err.message,
      stack: err.stack
    });
  }
});



// server.js

// Rota para listar pedidos (já existente? senão adicione-a)
app.post('/api/omie/pedidos', async (req, res) => {
  try {
    const payload = req.body;
    const omieResponse = await fetch('https://app.omie.com.br/api/v1/produtos/pedido/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!omieResponse.ok) {
      return res.status(omieResponse.status).json({ error: `OMIE retornou ${omieResponse.status}` });
    }
    const json = await omieResponse.json();
    return res.json(json);
  } catch (err) {
    console.error('Erro no servidor ao chamar OMIE/ListarPedidos:', err);
    return res.status(500).json({ error: 'Erro interno ao listar pedidos' });
  }
});

// server.js (dentro do seu IIFE, após as outras rotas OMIE)
app.post(
  '/api/omie/contatos-incluir',
  express.json(),
  async (req, res) => {
    const usersFile = path.join(__dirname, 'data', 'users.json');

    // 0) carrega lista local de usuários
    let users = [];
    try {
      users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    } catch (e) {
      // se falhar ao ler, considere vazio
      users = [];
    }

    // 1) extrai o username que vai ser criado
    const newUsername = req.body.identificacao.cCodInt;

    // 2) verifica duplicidade local
    if (users.some(u => u.username.toLowerCase() === newUsername.toLowerCase())) {
      return res
        .status(400)
        .json({ error: `Já existe um usuário com o nome "${newUsername}".` });
    }

    try {
      // 3) chama o OMIE para incluir o contato
      const omieResult = await omieCall(
        'https://app.omie.com.br/api/v1/crm/contatos/',
        {
          call:       'IncluirContato',
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param:      [ req.body ]
        }
      );

      // 4) só se OMIE aprovou, insere no users.json
      const newId = users.length
        ? Math.max(...users.map(u => u.id)) + 1
        : 1;

      const plainPwd    = '123';
      const passwordHash = bcrypt.hashSync(plainPwd, 10);

      const { cNome, cSobrenome } = req.body.identificacao;
      const fullName = `${cNome} ${cSobrenome || ''}`.trim();
      const msn = [
        `Seja bem vindo ao SIGFT (Sistema Integrado de Gestão FromTherm) ${fullName}, seja bem vindo.`
      ];

      users.push({
        id:           newId,
        username:     newUsername,
        passwordHash,
        roles:        [],
        msn
      });

      fs.writeFileSync(usersFile, JSON.stringify(users, null, 2), 'utf8');

      // 5) retorna sucesso
      return res.json(omieResult);

    } catch (err) {
      console.error('[contatos-incluir] erro →', err);
      return res
        .status(err.status || 500)
        .json({ error: err.faultstring || err.message });
    }
  }
);

// logo depois das outras rotas /api/omie/*
app.post(
  '/api/omie/contatos-excluir',
  express.json(),
  async (req, res) => {
    try {
      const { cCodInt } = req.body;
      const data = await omieCall(
        'https://app.omie.com.br/api/v1/crm/contatos/',
        {
          call:       'ExcluirContato',
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param:      [ { cCodInt } ]
        }
      );
      console.log('[contatos-excluir] resposta →', data);
      return res.json(data);
    } catch (err) {
      console.error('[contatos-excluir] erro →', err);
      return res
        .status(err.status || 500)
        .json({ error: err.faultstring || err.message });
    }
  }
);


  app.post('/api/omie/removeNaoListar', (req, res) => {
    const { groupId, prefix } = req.body;
    const csvPath = path.join(__dirname, 'csv', 'Tipo.csv');
    const text    = fs.readFileSync(csvPath, 'utf8');
    const rows    = csvParse(text, { columns: true, skip_empty_lines: true });

    const updated = rows.map(row => {
      if (+row.Grupo === groupId) {
        const arr = row.nao_listar_comeca_com
                      .replace(/(^"|"$)/g,'')
                      .split(',')
                      .filter(s => s && s !== prefix);
        row.nao_listar_comeca_com = arr.join(',');
      }
      return row;
    });

    fs.writeFileSync(csvPath, csvStringify(updated, { header: true }), 'utf8');
    res.json({ ok: true });
  });


  // ——————————————————————————————
  // 3.2) Rotas de autenticação e proxy OMIE
  // ——————————————————————————————
  app.use('/api/omie/login', loginOmie);
  app.use('/api/auth',     authRouter);
  app.use('/api/etiquetas', etiquetasRouter);   // ⬅️  NOVO
  app.use('/api/users', require('./routes/users'));

  app.use('/api/omie/estoque',       estoqueRouter);
  // app.use('/api/omie/estoque/resumo',estoqueResumoRouter);

  app.post('/api/omie/produtos', async (req, res) => {
    console.log('☞ BODY recebido em /api/omie/produtos:', req.body);

    try {
      const data = await omieCall(
        'https://app.omie.com.br/api/v1/geral/produtos/',
        {
          call:       req.body.call,
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param:      req.body.param
        }
      );
      res.json(data);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });


app.post(
  '/api/omie/contatos-alterar',
  express.json(),
  async (req, res) => {
    try {
      // chama a API REST do OMIE para AlterarContato
      const data = await omieCall(
        'https://app.omie.com.br/api/v1/crm/contatos/',
        {
          call:      'AlterarContato',
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param:     [ req.body ]           // OMIE espera array
        }
      );

     /* ───────────────────────────────────────────────
        Se Inativo = 'S' → troca passwordHash no users.json
     ─────────────────────────────────────────────── */
     const flagInativo = (req.body.telefone_email?.cNumFax || '')
                           .trim().toUpperCase();
     if (flagInativo === 'S') {
       const users   = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
       const username = (req.body.identificacao?.cCodInt || '').toLowerCase();
       const userObj  = users.find(u => u.username.toLowerCase() === username);
       if (userObj && userObj.passwordHash !== INACTIVE_HASH) {
         userObj.passwordHash = INACTIVE_HASH;
         fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
         console.log(`[Inativo] passwordHash redefinido para ${username}`);
       }
     }

      return res.json(data);

    } catch (err) {
      console.error('[contatos-alterar] erro →', err);
      return res
        .status(err.status || 500)
        .json({ error: err.faultstring || err.message });
    }
  }
);


  app.post('/api/omie/familias', async (req, res) => {
    try {
      const data = await omieCall(
        'https://app.omie.com.br/api/v1/geral/familias/',
        {
          call:       req.body.call,
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param:      req.body.param
        }
      );
      res.json(data);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post('/api/omie/caracteristicas', async (req, res) => {
    try {
      const { call, param } = req.body;
      const data = await omieCall(
        'https://app.omie.com.br/api/v1/geral/caracteristicas/',
        {
          call,
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param
        }
      );
      res.json(data);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post('/api/omie/prodcaract', async (req, res) => {
    try {
      const { call, param } = req.body;
      const data = await omieCall(
        'https://app.omie.com.br/api/v1/geral/prodcaract/',
        {
          call,
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param
        }
      );
      res.json(data);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });


  // ——————————————————————————————
  // 3.3) Rotas de produtos e características
  // ——————————————————————————————
  app.get('/api/produtos/detalhes/:codigo', async (req, res) => {
    try {
      const data = await omieCall(
        'https://app.omie.com.br/api/v1/geral/produtos/',
        {
          call:       'ConsultarProduto',
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param:      [{ codigo: req.params.codigo }]
        }
      );
      return res.json(data);
    } catch (err) {
      if (err.message.includes('faultstring')) {
        return res.json({ error: 'Produto não cadastrado' });
      }
      return res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/produtos/alterar', async (req, res) => {
    try {
      const data = await omieCall(
        'https://app.omie.com.br/api/v1/geral/produtos/',
        {
          call:       'UpsertProduto',
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param:      [req.body.produto_servico_cadastro]
        }
      );
      res.json(data);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post('/api/prodcaract/alterar', async (req, res) => {
    try {
      const data = await omieCall(
        'https://app.omie.com.br/api/v1/geral/prodcaract/',
        {
          call:       'AlterarCaractProduto',
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param:      req.body.param
        }
      );
      res.json(data);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });


  // ——————————————————————————————
  // 3.4) Rotas de “malha” (estrutura de produto)
  // ——————————————————————————————
  app.post('/api/malha', async (req, res) => {
    try {
      const result = await require('./routes/helpers/malhaEstrutura')(req.body);
      res.json(result);
    } catch (err) {
      if (err.message.includes('Client-103') || err.message.includes('não encontrado')) {
        return res.json({ itens: [] });
      }
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post('/api/omie/malha', async (req, res) => {
    try {
      const data = await omieCall(
        'https://app.omie.com.br/api/v1/geral/malha/',
        {
          call:       req.body.call,
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param:      req.body.param
        }
      );
      res.json(data);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });


// dentro do seu IIFE, logo após:
//   app.post('/api/omie/malha', …)
// e antes de: app.use('/api/malha/consultar', malhaConsultar);
app.post(
  '/api/omie/estrutura',
  express.json(),
  async (req, res) => {
    try {
      // chama o OMIE /geral/malha/ com call=ConsultarEstrutura
      const data = await omieCall(
        'https://app.omie.com.br/api/v1/geral/malha/',
        {
          call:       'ConsultarEstrutura',
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param:      req.body.param
        }
      );
      return res.json(data);
    } catch (err) {
      console.error('[estrutura] erro →', err.faultstring || err.message);
      return res
        .status(err.status || 500)
        .json({ error: err.faultstring || err.message });
    }
  }
);



  app.use('/api/malha/consultar', malhaConsultar);


  // ——————————————————————————————
  // 3.5) Upload / Deleção de fotos
  // ——————————————————————————————
  app.post(
    '/api/produtos/:codigo/foto',
    upload.single('file'),
    async (req, res) => {
      try {
        const { codigo } = req.params;
        const index      = parseInt(req.body.index, 10);
        const file       = req.file;
        const ext        = file.mimetype.split('/')[1];
        const safeLabel  = req.body.label.replace(/[\/\\?#]/g, '-');
        const filename   = `${safeLabel} ${codigo}.${ext}`;
        const ghPath     = `${GITHUB_PATH}/${filename}`;

        let sha;
        try {
          const { data } = await octokit.repos.getContent({
            owner: GITHUB_OWNER,
            repo:  GITHUB_REPO,
            path:  ghPath,
            ref:   GITHUB_BRANCH
          });
          sha = data.sha;
        } catch (err) {
          if (err.status !== 404) throw err;
        }

        await octokit.repos.createOrUpdateFileContents({
          owner:   GITHUB_OWNER,
          repo:    GITHUB_REPO,
          branch:  GITHUB_BRANCH,
          path:    ghPath,
          message: `Atualiza ${req.body.label} do produto ${codigo}`,
          content: file.buffer.toString('base64'),
          sha
        });

        const rawUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${encodeURIComponent(ghPath)}`;
        const produto = await omieCall(
          'https://app.omie.com.br/api/v1/geral/produtos/',
          {
            call:       'ConsultarProduto',
            app_key:    OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param:      [{ codigo }]
          }
        );

        const imgs = (produto.imagens || []).map(i => i.url_imagem);
        if (!isNaN(index) && index >= 0 && index < imgs.length) {
          imgs[index] = rawUrl;
        } else {
          imgs.push(rawUrl);
        }

        await omieCall(
          'https://app.omie.com.br/api/v1/geral/produtos/',
          {
            call:       'AlterarProduto',
            app_key:    OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param:      [{ codigo, imagens: imgs.map(u => ({ url_imagem: u })) }]
          }
        );

        res.json({ imagens: imgs });
      } catch (err) {
        console.error('Erro no upload GitHub/Omie:', err);
        res.status(err.status || 500).json({ error: err.message });
      }
    }
  );

  app.post(
    '/api/produtos/:codigo/foto-delete',
    express.json(),
    async (req, res) => {
      try {
        const { codigo } = req.params;
        const { index }  = req.body;
        const rawLogo    = `${req.protocol}://${req.get('host')}/img/logo.png`;

        const produto = await omieCall(
          'https://app.omie.com.br/api/v1/geral/produtos/',
          {
            call:       'ConsultarProduto',
            app_key:    OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param:      [{ codigo }]
          }
        );
        const imgs = (produto.imagens || []).map(i => i.url_imagem);
        if (index >= 0 && index < imgs.length) {
          imgs[index] = rawLogo;
        }

        await omieCall(
          'https://app.omie.com.br/api/v1/geral/produtos/',
          {
            call:       'AlterarProduto',
            app_key:    OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param:      [{ codigo, imagens: imgs.map(u => ({ url_imagem: u })) }]
          }
        );

        res.json({ imagens: imgs });
      } catch (err) {
        console.error('Erro ao deletar foto no Omie:', err);
        res.status(err.status || 500).json({ error: err.message });
      }
    }
  );

// substitua seu fetch manual por isto:
// dentro do seu IIFE em server.js, antes de app.use(express.static)
app.post(
  '/api/omie/anexo-file',
  upload.single('file'),
  async (req, res) => {
    try {
      const file     = req.file;
      const filename = file.originalname;
      // o client envia req.body.param como JSON-stringify
      const param0   = (req.body.param && JSON.parse(req.body.param)[0]) || {};
      const nId      = Number(param0.nId);
      const cCodInt  = param0.cCodIntAnexo;
      const cTabela  = param0.cTabela;

      // 1) monta o ZIP em memória de forma determinística
      const archive = archiver('zip', { zlib: { level: 9 } });
      const chunks  = [];
      archive.on('data', chunk => chunks.push(chunk));
      archive.append(file.buffer, {
        name: filename,
        date: new Date(0)           // força timestamp constante
      });
      await archive.finalize();
      const zipBuffer = Buffer.concat(chunks);
      const base64Zip = zipBuffer.toString('base64');

      // 2) calcula MD5 do ZIP
      const md5zip = crypto
        .createHash('md5')
        .update(zipBuffer)
        .digest('hex');

      // 3) prepara o objeto comum de param
      const buildParam = md5 => ({
        cCodIntAnexo: cCodInt,
        cTabela,
        nId,
        cNomeArquivo: filename,
        cTipoArquivo: filename.split('.').pop(),
        cMd5:         md5,
        cArquivo:     base64Zip
      });

      // 4) tentativa única, ou fallback se o OMIE reclamar do MD5
      let resultado;
      try {
        resultado = await omieCall(
          'https://app.omie.com.br/api/v1/geral/anexo/',
          {
            call:     'IncluirAnexo',
            app_key:  OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param:    [ buildParam(md5zip) ]
          }
        );
      } catch (err) {
        // extrai o MD5 que o OMIE esperava
        const msg = err.faultstring || err.message || '';
        const m   = msg.match(/Esperado\s+o\s+MD5\s*\[([0-9a-f]+)\]/i);
        if (m && m[1]) {
          // refaz a chamada com o MD5 “mágico”
          resultado = await omieCall(
            'https://app.omie.com.br/api/v1/geral/anexo/',
            {
              call:     'IncluirAnexo',
              app_key:  OMIE_APP_KEY,
              app_secret: OMIE_APP_SECRET,
              param:    [ buildParam(m[1]) ]
            }
          );
        } else {
          throw err;
        }
      }

      return res.json(resultado);
    } catch (err) {
      console.error('🔥 Erro no /api/omie/anexo-file:', err);
      return res
        .status(500)
        .json({ error: 'Falha ao processar anexo', details: err.faultstring || err.message });
    }
  }
);
// Listar anexos
app.post('/api/omie/anexo-listar', express.json(), async (req, res) => {
  try {
    const data = await omieCall(
      'https://app.omie.com.br/api/v1/geral/anexo/',
      {
        call:    'ListarAnexo',
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [ req.body ] // { cTabela, nId, cCodIntAnexo? }
      }
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Excluir anexo
app.post('/api/omie/anexo-excluir', express.json(), async (req, res) => {
  try {
    const { cTabela, nId, cCodIntAnexo, nIdAnexo } = req.body;
    const data = await omieCall(
      'https://app.omie.com.br/api/v1/geral/anexo/',
      {
        call:    'ExcluirAnexo',
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [{ cTabela, nId, cCodIntAnexo, nIdAnexo }]
      }
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Obter o link do anexo (cLinkDownload) via OMIE “ObterAnexo”
app.post('/api/omie/anexo-obter', express.json(), async (req, res) => {
  try {
    const { cTabela, nId, cCodIntAnexo, cNomeArquivo } = req.body;
    // monta o objeto de param aceitando _ou_ cCodIntAnexo _ou_ cNomeArquivo
    const paramObj = { cTabela, nId };
    if (cNomeArquivo) paramObj.cNomeArquivo = cNomeArquivo;
    else              paramObj.cCodIntAnexo = cCodIntAnexo;

    const result = await omieCall(
      'https://app.omie.com.br/api/v1/geral/anexo/',
      {
        call:      'ObterAnexo',
        app_key:   OMIE_APP_KEY,
        app_secret:OMIE_APP_SECRET,
        param:     [ paramObj ]
      }
    );

    // OMIE devolve array com 1 objeto
    const obj = Array.isArray(result) ? result[0] : result;
    return res.json({
      cLinkDownload: obj.cLinkDownload,
      cTipoArquivo:  obj.cTipoArquivo,
      cNomeArquivo:  obj.cNomeArquivo
    });
  } catch (err) {
    console.error('Erro em /api/omie/anexo-obter:', err);
    res.status(err.status || 500).json({ error: err.faultstring || err.message });
  }
});


// Proxy ViaCEP para evitar problemas de CORS
app.get('/api/viacep/:cep', async (req, res) => {
  try {
    const cep = req.params.cep.replace(/\D/g, '');
    const viacepRes = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    if (!viacepRes.ok) {
      return res.status(viacepRes.status).json({ error: 'ViaCEP retornou erro' });
    }
    const data = await viacepRes.json();
    return res.json(data);
  } catch (err) {
    console.error('Erro no proxy ViaCEP:', err);
    return res.status(500).json({ error: err.message });
  }
});
// ────────────────────────────────────────────
// Kanban local (GET lê, POST grava)
// ────────────────────────────────────────────
app.get('/api/kanban', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(KANBAN_FILE, 'utf8'));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/kanban', express.json(), (req, res) => {
  try {
    fs.writeFileSync(KANBAN_FILE, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ────────────────────────────────────────────
// 4) Sirva todos os arquivos estáticos (CSS, JS, img) normalmente
// ────────────────────────────────────────────
app.use(express.static(path.join(__dirname)));

// ────────────────────────────────────────────
// 5) Só para rotas HTML do seu SPA, devolva o index
// ────────────────────────────────────────────
// Isso não intercepta /menu_produto.js, /requisicoes_omie/xx.js, etc.
app.get(['/', '/menu_produto.html', '/kanban/*'], (req, res) => {
  res.sendFile(path.join(__dirname, 'menu_produto.html'));
});

app.post('/api/produtos/caracteristicas-aplicar-teste', express.json(), async (req, res) => {
  try {
    const csvPath = path.join(__dirname, 'produtos', 'dadosEtiquetasMaquinas - dadosFT.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf8');
    const linhas = csvParse(csvContent, { delimiter: ',', from_line: 1 });

    const headers = linhas[0]; // Cabeçalho
    const resultados = [];

    const app_key = process.env.OMIE_APP_KEY;
    const app_secret = process.env.OMIE_APP_SECRET;

    // Percorre da linha 2 em diante
    for (let linhaIndex = 1; linhaIndex < linhas.length; linhaIndex++) {
      const valores = linhas[linhaIndex];
      const codigoProduto = valores[0]; // Coluna A

      if (!codigoProduto?.trim()) break; // parou ao encontrar linha vazia

      for (let i = 2; i <= 24; i++) { // Colunas C a Y
        const caract = headers[i];
        let conteudo = valores[i];
if (conteudo?.endsWith('_7E')) {
  conteudo = conteudo.replace('_7E', '~');
}

        if (!caract?.trim() || !conteudo?.trim()) continue;

        const body = {
          call: 'IncluirCaractProduto',
          app_key,
          app_secret,
          param: [{
            cCodIntProd:        codigoProduto,
            cCodIntCaract:      caract,
            cConteudo:          conteudo,
            cExibirItemNF:      'N',
            cExibirItemPedido:  'N',
            cExibirOrdemProd:   'N'
          }]
        };

        const resp = await fetch('https://app.omie.com.br/api/v1/geral/prodcaract/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        const json = await resp.json();
        resultados.push({
          produto: codigoProduto,
          caract,
          conteudo,
          resposta: json
        });

        await new Promise(r => setTimeout(r, 350)); // respeita limite
      }
    }

    res.json({ total: resultados.length, resultados });
  } catch (err) {
    console.error('[caracteristicas-aplicar-teste] erro:', err);
    res.status(500).json({ error: 'Erro ao aplicar características em múltiplos produtos' });
  }
});





  // ——————————————————————————————
  // 5) Inicia o servidor
  // ——————————————————————————————
const PORT = process.env.PORT || 5001;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () =>
  console.log(`Servidor rodando em http://${HOST}:${PORT}`)
);


})();
