// Duplicar_produto.js


import { clearModalFields, buildCreateProductForm, setElementStyles } from './Criar_produto.js';


function openCreateModalWithData(produtoData) {
    const modal = document.getElementById('cardModal');
    modal.classList.add('create-product-mode');
    modal.style.display = 'flex';
    setElementStyles(modal, {
      width: '100%',
      position: 'fixed',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)'
    });
    
    // Se o modal de criação precisa ser reconstruído, chame as funções abaixo.
    // Se clearModalFields() apagar tudo, você pode reconstruir o layout e em seguida repopular os campos.
    clearModalFields();
    buildCreateProductForm();
    
    // Agora, preenche os campos com os dados do produto (do modal pai).
    // Esses IDs devem corresponder aos elementos criados em buildCreateProductForm.
    const codigoEl = document.getElementById('codigoProduto');
    if (codigoEl) codigoEl.innerText = produtoData.codigo || "xx.xx.x.999999";
    const descEl = document.getElementById('descricao');
    if (descEl) descEl.value = produtoData.descricao || "";
    const descrDetalhadaEl = document.getElementById('descricaoDetalhada');
    if (descrDetalhadaEl) descrDetalhadaEl.value = produtoData.descr_detalhada || "";
    const ncmEl = document.getElementById('ncm');
    if (ncmEl) ncmEl.value = produtoData.ncm || "";
    const eanEl = document.getElementById('ean');
    if (eanEl) eanEl.value = produtoData.ean || "";
    const tipoItemEl = document.getElementById('tipoItem');
    if (tipoItemEl) tipoItemEl.value = produtoData.tipoItem || "";
    
    // Para selects, defina o valor se os options já foram populados:
    const familiaSelect = document.getElementById('familiaSelect');
    if (familiaSelect) familiaSelect.value = produtoData.descricao_familia || "";
    const unidadeSelect = document.getElementById('unidade');
    if (unidadeSelect) unidadeSelect.value = produtoData.unidade || "";
    const bloqueadoSelect = document.getElementById('bloqueado');
    if (bloqueadoSelect) bloqueadoSelect.value = produtoData.bloqueado || "";
  }
  

  document.body.addEventListener('click', (e) => {
    const duplicateBtn = e.target.closest('#duplicarProduto');
    if (duplicateBtn) {
      e.preventDefault();
      console.log('Botão Duplicar produto clicado');
    
      // O modal pai é o modal que já está aberto com o card expandido.
      const modalPai = document.getElementById('cardModal');
      // Supondo que o conteúdo do modal pai esteja dentro de .card-info
      const cardInfo = modalPai.querySelector('.card-info');
    
      // Para os dados que estão fora da coluna (como o código, descrição e descrição detalhada)
      const codigo = cardInfo.querySelector('h2') ? cardInfo.querySelector('h2').innerText.trim() : "";
    
      // Supondo que os primeiros dois <p> de cardInfo sejam Descrição e Descrição detalhada:
      const pElements = cardInfo.querySelectorAll('p');
      const descricao = pElements[0] ? pElements[0].innerText.replace("Descrição:", "").trim() : "";
      const descr_detalhada = pElements[1] ? pElements[1].innerText.replace("Descrição detalhada:", "").trim() : "";
    
      // Agora, para os demais campos, vamos supor que eles estão na coluna esquerda dentro de um container com classe .modal-column.left
      const leftCol = cardInfo.querySelector('.modal-column.left');
      // Se leftCol existir, extraia os demais valores com base nos rótulos:
      const ncm = leftCol ? extractFieldValue(leftCol, "NCM:") : "";
      const ean = leftCol ? extractFieldValue(leftCol, "EAN:") : "";
      const tipoItem = leftCol ? extractFieldValue(leftCol, "Tipo Item:") : "";
      const descricao_familia = leftCol ? extractFieldValue(leftCol, "Descrição da família:") : "";
      const unidade = leftCol ? extractFieldValue(leftCol, "Unidade:") : "";
      const bloqueado = leftCol ? extractFieldValue(leftCol, "Bloqueado:") : "";
    
      // Monte o objeto com os dados do produto
      const produtoData = {
        codigo,
        descricao,
        descr_detalhada,
        ncm,
        ean,
        tipoItem,
        descricao_familia,
        unidade,
        bloqueado
      };
    
      console.log("Dados coletados para duplicar:", produtoData);
      // Abre o modal de criação (no Duplicar_produto.js) já pré-preenchido
      openCreateModalWithData(produtoData);
    }
  });
  
  
  function extractFieldValue(container, label) {
    // Procura todos os <p> dentro do container
    const ps = container.querySelectorAll('p');
    for (const p of ps) {
      const text = p.innerText.trim();
      if (text.startsWith(label)) {
        return text.replace(label, "").trim();
      }
    }
    return "";
  }
  
  