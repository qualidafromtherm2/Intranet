// 2. cardDisplay.js
/*Contém as funções responsáveis por montar e exibir os cards, além de gerenciar os eventos de clique (ex.: abrir o modal se o produto não estiver travado).*/
import { showCardModal } from './modal.js';
import { fetchDetalhes } from './utils.js';

export function displayResults(results, lockedCodes) {
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

    // Cria o topo do card (imagem)
    const cardTop = document.createElement('div');
    cardTop.className = 'card-top';
    const img = document.createElement('img');
    img.src = result.url_imagem || 'img/logo.png';
    img.onerror = () => { img.src = 'img/logo.png'; };
    img.alt = 'Produto';
    cardTop.appendChild(img);

    // Cria o corpo do card
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

    // Guarda a unidade no dataset se necessário
    card.dataset.unidade = result.unidade || '';

    // Se o código não estiver na lista de travados, adiciona o evento para abrir o modal
    const codigoProduto = result.codigo || '';
    if (!lockedCodes.has(codigoProduto)) {
      card.addEventListener('click', async () => {
        const omieData = await fetchDetalhes(codigoProduto);
        showCardModal(card, omieData);
      });
    } else {
      card.style.opacity = '0.6';
      card.style.pointerEvents = 'none';
      card.classList.add('locked');
    }

    cardsContainer.appendChild(card);
  });

  resultsContainer.appendChild(cardsContainer);
}
