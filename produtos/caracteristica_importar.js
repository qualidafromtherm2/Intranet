// produtos/caracteristica_importar.js

const API_BASE         = window.location.origin;
const SELECTOR_MODELO  = '#productTitle';
const LABEL_OMIE       = 'Código OMIE';
const SEARCH_INPUT_SEL = 'input[placeholder="Pesquisar produto"]';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 1) carrega e parseia CSV
let _csvData = null;
async function loadCsvData() {
  if (_csvData) return _csvData;
  const resp = await fetch('/produtos/dadosEtiquetasMaquinas - dadosFT.csv');
  if (!resp.ok) throw new Error(`CSV não encontrado (status ${resp.status})`);
  const text = await resp.text();
  _csvData = Papa.parse(text, { skipEmptyLines: true }).data;
  return _csvData;
}

// 2) espera o modelo aparecer na página
function waitForModel(modelo, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function check() {
      const el = document.querySelector(SELECTOR_MODELO);
      if (el?.textContent.trim() === modelo) return resolve();
      if (Date.now() - start > timeout) return reject(new Error(`Timeout aguardando modelo ${modelo}`));
      setTimeout(check, 200);
    })();
  });
}

// 3) pesquisa o produto no campo de busca
async function searchModel(modelo) {
  const input = document.querySelector(SEARCH_INPUT_SEL);
  if (!input) throw new Error('Input de pesquisa não encontrado');
  input.value = modelo;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  await waitForModel(modelo);
  await sleep(500);
}

// 4) importa características para o produto atual
async function importCurrentProduct() {
  const elModel = document.querySelector(SELECTOR_MODELO);
  if (!elModel) throw new Error(`Elemento "${SELECTOR_MODELO}" não encontrado`);
  const modelo = elModel.textContent.trim();

  // busca linha "Código OMIE"
  const linhaOmie = Array.from(document.querySelectorAll('li')).find(li => {
    return li.querySelector('div:first-child')?.textContent.trim() === LABEL_OMIE;
  });
  if (!linhaOmie) {
    console.warn(`Código OMIE não encontrado para o produto ${modelo}, pulando produto.`);
    return;
  }
  const elNum = linhaOmie.querySelector('.status-text');
  if (!elNum) {
    console.warn(`.status-text não encontrado para Código OMIE em ${modelo}, pulando produto.`);
    return;
  }
  const nCodProd = elNum.textContent.trim();

  console.log(`→ Importando ${modelo} (nCodProd=${nCodProd})`);

  const tabelas = await loadCsvData();
  const headers = tabelas[0];
  const linha = tabelas.find(r => r[0].trim() === modelo);
  if (!linha) {
    console.warn(`Modelo "${modelo}" não está no CSV, pulando.`);
    return;
  }

  console.group(`Características de ${modelo}`);
  for (let col = 2; col <= 24; col++) {
    const caract = headers[col]?.trim();
    let conteudo = linha[col]?.trim();
    if (!caract || !conteudo) continue;
    if (conteudo.endsWith('_7E')) conteudo = conteudo.replace(/_7E$/, '~');

    const body = {
      call: 'IncluirCaractProduto',
      param: [{
        nCodProd,
        cCodIntCaract: caract,
        cConteudo: conteudo,
        cExibirItemNF: 'N',
        cExibirItemPedido: 'N',
        cExibirOrdemProd: 'N'
      }]
    };

    console.log(` ▶ [${caract}]`, body);
    const resp = await fetch(`${API_BASE}/api/omie/prodcaract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (resp.ok) {
      const json = await resp.json();
      console.log(` ✔ [${caract}]`, json);
    } else {
      const text = await resp.text();
      console.error(` ✖ [${caract}] HTTP ${resp.status}:`, text);

      let inner;
      try {
        inner = JSON.parse(JSON.parse(text).error);
      } catch {}

      // Produto inativo
      if (inner?.faultcode === 'SOAP-ENV:Client-115') {
        alert(`❌ O produto "${modelo}" está inativo. Pulando produto.`);
        return;
      }
      // Duplicata de característica
      if (inner?.faultcode === 'SOAP-ENV:Client-102') {
        console.warn(`⚠️ Característica [${caract}] já cadastrada para ${modelo}, pulando restante.`);
        return;
      }
      // Rate limit
      if (inner?.faultcode === 'MISUSE_API_PROCESS') {
        const match = inner.faultstring.match(/Tente novamente em\s*(\d+)\s*segundos/);
        const segs = match ? parseInt(match[1], 10) : 0;
        const mins = segs ? Math.ceil(segs / 60) : 0;
        alert(`⚠️ Rate limit atingido. Aguarde ${mins} minuto(s).`);
        throw new Error('RATE_LIMIT');
      }
    }

    await sleep(500);
  }
  console.groupEnd();
}

// 5) Importação em lote de linhas A2 até A9 (índices 1..8), pulando modelos que terminem com 'W'
async function importAllProducts() {
  const data = await loadCsvData();
  const rows = data.slice(1, 9); // linhas A2 (índice1) até A9 (índice8)
  let aborted = false;
  for (const row of rows) {
    const modelo = row[0]?.trim();
    if (!modelo) continue;
    if (/W$/i.test(modelo)) {
      console.log(`Modelo ${modelo} termina com 'W', pulando.`);
      continue;
    }

    try {
      console.group(`=== ${modelo} ===`);
      await searchModel(modelo);
      await importCurrentProduct();
      console.groupEnd();
      await sleep(1000);
    } catch (err) {
      if (err.message === 'RATE_LIMIT') {
        aborted = true;
        break;
      }
      console.error(`Erro no produto ${modelo}:`, err);
      console.groupEnd();
      continue;
    }
  }
  if (aborted) {
    alert('⏸️ Importação interrompida.');
  } else {
    alert('🏁 Importação em lote concluída.');
  }
}

// 6) usa apenas o botão existente "incluir-conteudo"
export function inicializarImportacaoCaracteristicas() {
  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-action="incluir-conteudo"]')) {
      if (confirm('Executar importação em lote de todos os produtos (linhas 2-9)?')) {
        try {
          await importAllProducts();
        } catch {}
      }
    }
  });
}
