/*Responsável por carregar os códigos travados (lidos do arquivo CSV) e atualizar os cards conforme necessário.*/
// lockedCodes.js
export async function loadLockedCodes() {
    try {
      const response = await fetch('./logsDeCodigo.csv');
      if (!response.ok) {
        console.warn("logsDeCodigo.csv não encontrado ou erro ao carregar.");
        return new Set();
      }
      const csvText = await response.text();
      const lines = csvText.split('\n').filter(l => l.trim() !== '');
      const lockedSet = new Set();
      lines.forEach(line => {
        const [codigo] = line.split(',');
        if (codigo) lockedSet.add(codigo.trim());
      });
      return lockedSet;
    } catch (error) {
      console.error("Erro ao carregar logsDeCodigo.csv:", error);
      return new Set();
    }
  }
  
  export async function reloadLockedCodesAndRefreshCards() {
    const lockedCodes = await loadLockedCodes();
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
    return lockedCodes;
  }
  