// main.js
import { showCardModal } from './modal.js';
import { toggleEditMode } from './editFields.js';
import { loadCSV, searchInCSV, fetchDetalhes } from './utils.js';

let produtosData = [];
let lockedCodes = new Set(); // Aqui guardaremos os códigos "travados"

// Botão para atualizar CSV
document.getElementById('btnAtualizarCSV').addEventListener('click', async () => {
  try {
    const hostname = window.location.hostname;
    const endpoint =
      (hostname === 'localhost' || hostname === '127.0.0.1')
        ? 'http://localhost:5001/api/produtos/generate-csv'
        : 'https://intranet-fromtherm.onrender.com/api/produtos/generate-csv';
    const response = await fetch(endpoint);
    const result = await response.json();
    if (result.success) {
      window.location.reload();
    } else {
      alert('Erro ao atualizar CSV.');
    }
  } catch (error) {
    console.error(error);
    alert('Erro ao atualizar CSV. Verifique o console.');
  }
});

/**
 * Exibe resultados (cards) na tela.
 * Se o código estiver em lockedCodes, não deixa clicar para abrir modal.
 */
function displayResults(results) {
  const resultsContainer = document.getElementById('searchResults');
  resultsContainer.innerHTML = '';

  if (results.length === 0) {
    resultsContainer.innerHTML = '<p>Nenhum resultado encontrado</p>';
    return;
  }

  const cardsContainer = document.createElement('div');
  cardsContainer.className = 'cards grid-row';

  results.forEach(result => {
    const card = document.createElement('div');
    card.className = 'card';

    // Topo do card (imagem)
    const cardTop = document.createElement('div');
    cardTop.className = 'card-top';
    const img = document.createElement('img');
    img.src = result.url_imagem || 'img/logo.png';
    img.onerror = () => { img.src = 'img/logo.png'; };
    img.alt = 'Produto';
    cardTop.appendChild(img);

    // Corpo do card (título, subtítulo, etc.)
    const cardInfo = document.createElement('div');
    cardInfo.className = 'card-info';

    const title = document.createElement('h2');
    title.style.fontWeight = 'bold';
    title.textContent = result.codigo || 'Sem código';

    const subtitle = document.createElement('p');
    subtitle.className = 'subtitle';
    subtitle.textContent = result.descricao || 'Sem descrição';

    const detalhado = document.createElement('p');
    detalhado.textContent = result.descr_detalhada || 'Sem descrição detalhada';

    cardInfo.appendChild(title);
    cardInfo.appendChild(subtitle);
    cardInfo.appendChild(detalhado);

    card.appendChild(cardTop);
    card.appendChild(cardInfo);

    // Opcional: guardamos a unidade no dataset (caso precise)
    card.dataset.unidade = result.unidade || '';

    // Verifica se o código está travado
    const codigoProduto = result.codigo || '';
    if (!lockedCodes.has(codigoProduto)) {
      // Se não estiver travado, pode clicar e abrir modal
      card.addEventListener('click', async () => {
        const omieData = await fetchDetalhes(codigoProduto);
        showCardModal(card, omieData);
      });
    } else {
      // Se ESTIVER travado, podemos opcionalmente dar alguma aparência
      card.style.opacity = '0.6';
      card.style.pointerEvents = 'none';
      card.classList.add('locked');
      // Você também pode exibir alguma badge “Bloqueado” etc.
    }

    cardsContainer.appendChild(card);
  });

  resultsContainer.appendChild(cardsContainer);
}

/**
 * Ao digitar no campo de busca, filtra e exibe resultados.
 */
document.getElementById('inpt_search').addEventListener('input', function() {
  const term = this.value.trim();
  if (!term) {
    document.getElementById('searchResults').innerHTML = '';
    return;
  }
  const results = searchInCSV(produtosData, term);
  displayResults(results);
});

/**
 * Animações visuais de foco/perda de foco no campo de busca
 */
document.getElementById('inpt_search').addEventListener('focus', function() {
  this.parentElement.classList.add('active');
});
document.getElementById('inpt_search').addEventListener('blur', function() {
  if (!this.value) {
    this.parentElement.classList.remove('active');
  }
});

/**
 * Inicializa a página: carrega dados dos produtos, carrega “lockedCodes” e exibe busca
 */
(async function initialize() {
  // Carrega CSV dos produtos
  produtosData = await loadCSV();  
  console.log("produtosData carregados:", produtosData);

  // Carrega logsDeCodigo.csv
  lockedCodes = await loadLockedCodes();
  console.log("lockedCodes (códigos travados):", lockedCodes);
})();

/**
 * Carrega e retorna um Set de códigos presentes no logsDeCodigo.csv
 */
async function loadLockedCodes() {
  try {
    // Busca o logsDeCodigo.csv
    const response = await fetch('./logsDeCodigo.csv');
    if (!response.ok) {
      console.warn("logsDeCodigo.csv não encontrado ou erro ao carregar.");
      return new Set();
    }

    const csvText = await response.text();
    // Quebra em linhas, removendo linhas vazias
    const lines = csvText.split('\n').filter(l => l.trim() !== '');

    const lockedSet = new Set();
    for (let line of lines) {
      // Cada linha: "codigo,hora"
      const [codigo] = line.split(',');
      if (codigo) {
        lockedSet.add(codigo.trim());
      }
    }
    return lockedSet;
  } catch (error) {
    console.error("Erro ao carregar logsDeCodigo.csv:", error);
    return new Set();
  }
}


// Esta função recarrega o CSV e atualiza a aparência/bloqueio dos cards já exibidos.
window.reloadLockedCodesAndRefreshCards = async function() {
  // 1) Recarrega logsDeCodigo.csv
  lockedCodes = await loadLockedCodes();

  // 2) Atualiza todos os cards
  const allCards = document.querySelectorAll('#searchResults .cards .card');
  allCards.forEach(card => {
    const h2 = card.querySelector('.card-info h2');
    if (!h2) return;
    const code = h2.textContent.trim();
    if (lockedCodes.has(code)) {
      card.classList.add('locked');
      card.style.pointerEvents = 'none';
      card.style.opacity = '0.6';
    } else {
      card.classList.remove('locked');
      card.style.pointerEvents = 'auto';
      card.style.opacity = '1';
    }
  });
};

