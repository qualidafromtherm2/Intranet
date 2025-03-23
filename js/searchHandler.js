// searchHandler.js
/*Cuida dos eventos do campo de busca e integra a lógica de pesquisa com a exibição dos resultados.*/
import { searchInCSV } from './utils.js';
import { displayResults } from './cardDisplay.js';
import { loadLockedCodes } from './lockedCodes.js';

export function initializeSearch(produtosData) {
  const searchInput = document.getElementById('inpt_search');
  searchInput.addEventListener('input', async function() {
    const term = this.value.trim();
    if (!term) {
      document.getElementById('searchResults').innerHTML = '';
      return;
    }
    const results = searchInCSV(produtosData, term);
    // Carrega os códigos travados para saber quais cards devem estar bloqueados
    const lockedCodes = await loadLockedCodes();
    displayResults(results, lockedCodes);
  });

  searchInput.addEventListener('focus', function() {
    this.parentElement.classList.add('active');
  });
  searchInput.addEventListener('blur', function() {
    if (!this.value) {
      this.parentElement.classList.remove('active');
    }
  });
}
