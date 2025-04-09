// main.js
import { showCardModal } from './modal.js';
import { toggleEditMode } from './editFields.js';
import { loadCSV, searchInCSV, fetchDetalhes } from './utils.js';
import { updateCSV } from './updateCSV.js';
import { initializeSearch } from './searchHandler.js';
import { loadLockedCodes } from './lockedCodes.js';

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
/**
 * Exibe resultados (cards) na tela.
 * Se o código estiver em lockedCodes, não deixa clicar para abrir modal.
 */
function displayResults(results) {
  // Define um critério para mobile (ex: telas com largura <= 768px)
  const isMobile = window.innerWidth <= 768;

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

    // Cria o container do topo do card
    const cardTop = document.createElement('div');
    cardTop.className = 'card-top';

    if (!isMobile) {
      // Em dispositivos não móveis, adiciona a imagem
      const img = document.createElement('img');
      img.src = result.url_imagem || 'img/logo.png';
      img.onerror = () => { img.src = 'img/logo.png'; };
      img.alt = 'Produto';
      // Adiciona lazy loading para melhorar o desempenho
      img.setAttribute('loading', 'lazy');
      cardTop.appendChild(img);
    } else {
      // Em dispositivos móveis, não carrega a imagem nos cards.
      // Você pode mostrar um placeholder ou deixar vazio.
    }

    // Cria o container das informações do card
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

    // Ao clicar no card, abre o modal e carrega as imagens normalmente (independente do dispositivo)
    card.addEventListener('click', async () => {
      const omieData = await fetchDetalhes(result.codigo);
      showCardModal(card, omieData);
    });

    cardsContainer.appendChild(card);
  });

  resultsContainer.appendChild(cardsContainer);

  // Ajusta o posicionamento dos cards conforme o estado do menu lateral
  adjustCardsAlignment();
}


/**
 * Ajusta o alinhamento do container de resultados (#searchResults)
 * - Se o menu lateral estiver expandido (classe "expanded"), posiciona os cards à direita.
 * - Se estiver fechado, centraliza o container.
 */
function adjustCardsAlignment() {
  const searchResults = document.getElementById('searchResults');
  const menu = document.querySelector('nav.main-menu');

  if (menu && menu.classList.contains('expanded')) {
    // Menu aberto: posiciona os cards à direita (para não atrapalhar o menu)
    searchResults.style.left = "auto";
    searchResults.style.right = "20px"; // ajuste conforme necessário
    searchResults.style.transform = "none";
  } else {
    // Menu fechado: centraliza os cards
    searchResults.style.left = "50%";
    searchResults.style.right = "auto";
    searchResults.style.transform = "translateX(-50%)";
  }
}


// Obtenha o campo de busca
const searchInput = document.getElementById('inpt_search');
// Define se é dispositivo móvel com base na largura da janela
const isMobile = window.innerWidth <= 768;

// Para dispositivos móveis, realiza a busca somente quando o usuário pressionar "Enter"
if (isMobile) {
  searchInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      const term = this.value.trim();
      if (!term) {
        document.getElementById('searchResults').innerHTML = '';
        return;
      }
      const results = searchInCSV(produtosData, term);
      displayResults(results);
    }
  });
} else {
  // Para desktops, a busca ocorre conforme o usuário digita
  searchInput.addEventListener('input', function() {
    const term = this.value.trim();
    if (!term) {
      document.getElementById('searchResults').innerHTML = '';
      return;
    }
    const results = searchInCSV(produtosData, term);
    displayResults(results);
  });
}

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
/**
 * Inicializa a página: carrega dados dos produtos, carrega “lockedCodes” e exibe busca
 */
(async function initialize() {
  // Carrega CSV dos produtos
  produtosData = await loadCSV();
  console.log("produtosData carregados:", produtosData);

  // Carrega os códigos "travados" a partir do logsDeCodigo.csv
  lockedCodes = await loadLockedCodes();
  console.log("lockedCodes (códigos travados):", lockedCodes);

  // Inicializa os eventos do campo de busca utilizando os dados carregados
  // initializeSearch(produtosData); // REMOVA ou COMENTE ESSA LINHA
})();


/**
 * Esta função recarrega o CSV e atualiza a aparência/bloqueio dos cards já exibidos.
 */
window.reloadLockedCodesAndRefreshCards = async function() {
  // Recarrega os códigos travados
  lockedCodes = await loadLockedCodes();

  // Atualiza todos os cards
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


document.getElementById('btnSincronizarNCM').addEventListener('click', async () => {
  try {
    const hostname = window.location.hostname;
    const endpoint = (hostname === 'localhost' || hostname === '127.0.0.1')
      ? 'http://localhost:5001/api/produtos/sincronizar-ncm'
      : 'https://intranet-fromtherm.onrender.com/api/produtos/sincronizar-ncm';
    const response = await fetch(endpoint, { method: 'POST' });
    const result = await response.json();
    if (result.success) {
      alert('Sincronização NCM concluída com sucesso!');
    } else {
      alert('Erro ao sincronizar NCM.');
    }
  } catch (error) {
    console.error(error);
    alert('Erro ao sincronizar NCM. Verifique o console.');
  }
});

