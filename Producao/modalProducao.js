// Producao/modalProducao.js

function initModalProducao() {
    // Localiza o botão com title="OP" (no HTML do modalProducao)
    const opBtn = document.querySelector('.main-tabs button[title="OP"]');
    if (!opBtn) {
      console.warn("Botão OP não encontrado no modal de Produção.");
      return;
    }
  
    // Se encontrar, configura o clique
    opBtn.addEventListener('click', function(event) {
      event.preventDefault();
    
      // Fecha o modal, se desejar
      if (typeof fecharProducaoModal === 'function') {
        fecharProducaoModal();
      }
    
      // Agora, em vez de fetch, abrimos diretamente em uma nova aba
      window.open('abertura_op/abertura_op.html', '_blank');
    });
    
  }
  
  // Não chamamos initModalProducao() imediatamente aqui
  // pois precisamos esperar o HTML do modal ser injetado no DOM.
  