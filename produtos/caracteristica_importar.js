// produtos/caracteristica_importar.js

const API_BASE = window.location.origin;
const sleep    = ms => new Promise(r => setTimeout(r, ms));

// Seletor do modelo (FT20B35W)
const SELECTOR_MODELO = '#productTitle';
// Label da linha que contém o código OMIE
const LABEL_OMIE       = 'Código OMIE';

export function inicializarImportacaoCaracteristicas() {
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="incluir-conteudo"]');
    if (!btn) return;
    if (!confirm('Executar envio em massa de características?')) return;

    try {
      // 1) busca modelo na página
      const elModel = document.querySelector(SELECTOR_MODELO);
      if (!elModel) throw new Error(`não achei o elemento de modelo ("${SELECTOR_MODELO}")`);
      const modelo = elModel.textContent.trim();

      // 2) busca nCodProd na linha "Código OMIE"
      const linhas = Array.from(document.querySelectorAll('li'));
      const linhaOmie = linhas.find(li => {
        const lbl = li.querySelector('div:first-child')?.textContent.trim();
        return lbl === LABEL_OMIE;
      });
      if (!linhaOmie) throw new Error(`não achei a linha "${LABEL_OMIE}"`);
      const elNum = linhaOmie.querySelector('.status-text');
      if (!elNum) throw new Error(`não achei o .status-text na linha "${LABEL_OMIE}"`);
      const nCodProd = elNum.textContent.trim();

      console.log(`→ Modelo:  ${modelo}`);
      console.log(`→ nCodProd: ${nCodProd}`);

      // 3) carrega e parseia o CSV
      const respCsv = await fetch('/produtos/dadosEtiquetasMaquinas - dadosFT.csv');
      if (!respCsv.ok) throw new Error(`CSV não encontrado (status ${respCsv.status})`);
      const csvText = await respCsv.text();
      const { data: tabelas } = Papa.parse(csvText, { skipEmptyLines: true });
      const headers = tabelas[0];

      // 4) encontra a linha do modelo (coluna A)
      const linha = tabelas.find(r => r[0].trim() === modelo);
      if (!linha) {
        alert(`❌ Modelo "${modelo}" não encontrado no CSV.`);
        return;
      }

      // 5) envia UMA a UMA as colunas C(2) a Y(24)
      let total = 0;
      let interromper = false;

      console.groupCollapsed(`→ Enviando características de ${modelo}`);
      for (let col = 2; col <= 24; col++) {
        const caract = headers[col]?.trim();
        let conteudo = linha[col]?.trim();
        if (!caract || !conteudo) continue;
        if (conteudo.endsWith('_7E')) conteudo = conteudo.replace(/_7E$/, '~');

        const body = {
          call:  'IncluirCaractProduto',
          param: [{
            nCodProd:          nCodProd,
            cCodIntCaract:     caract,
            cConteudo:         conteudo,
            cExibirItemNF:     'N',
            cExibirItemPedido: 'N',
            cExibirOrdemProd:  'N',
          }]
        };

        console.log(`  ▶ [${caract}]`, body);
        const resp = await fetch(`${API_BASE}/api/omie/prodcaract`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body)
        });

        if (resp.ok) {
          const json = await resp.json();
          console.log(`  ✔ [${caract}]`, json);
        } else {
          const text = await resp.text();
          console.error(`  ✖ [${caract}] HTTP ${resp.status}:`, text);

          // tenta parsear o erro JSON
          let outer, inner;
          try {
            outer = JSON.parse(text);
            inner = JSON.parse(outer.error);
          } catch {
            inner = null;
          }

          // 6a) Erro de produto inativo (Client-115)
          if (inner?.faultcode === 'SOAP-ENV:Client-115' && inner.faultstring.includes('está inativo')) {
            alert(`❌ O produto "${modelo}" está inativo em Omie. Interrompendo envio.`);
            interromper = true;
          }
          // 6b) Erro de bloqueio por consumo indevido (MISUSE_API_PROCESS)
          else if (inner?.faultcode === 'MISUSE_API_PROCESS' && /Tente novamente em\s*(\d+)\s*segundos/.test(inner.faultstring)) {
            const seconds = parseInt(inner.faultstring.match(/Tente novamente em\s*(\d+)\s*segundos/)[1], 10);
            const minutes = Math.ceil(seconds / 60);
            alert(`⚠️ API bloqueada por consumo indevido. Tente novamente em ${minutes} minuto(s).`);
            interromper = true;
          }

          if (interromper) break;
        }

        total++;
        // throttle: no máximo ~3 reqs/s
        await sleep(350);
      }
      console.groupEnd();

      if (!interromper) {
        alert(`✅ Concluído!\nTotal de características enviadas: ${total}`);
      }
    } catch (err) {
      console.error('❌ Falha na importação:', err);
      alert('Erro: ' + err.message);
    }
  });
}
