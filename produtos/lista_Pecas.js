// produtos/lista_Pecas.js   (versão completa – 6 colunas)

/* ================================================================
   1. Mapa de grupos (mesmo loader de antes)
   ================================================================ */
   let tipoList = [];
   async function loadTipoMap() {
     if (tipoList.length) return;
     const resp = await fetch('/csv/Tipo.csv');
     const text = await resp.text();
     const [, ...lines] = text.split(/\r?\n/);
     tipoList = lines
       .filter(l => l.trim())
       .map(l => {
         const [grupo, descricao, tipo, tipoProd] = l.split(',');
         return {
           groupId:   parseInt(grupo, 10),
           descricao: descricao.trim(),
           tipo:      tipo.trim(),
           tipoProd:  tipoProd.trim()
         };
       });
   }
   
   /* ================================================================
      2. Agrupa por grupo → mantém igual
      ================================================================ */
   function groupAndSortByGroupId(items) {
     const map = new Map();
     tipoList.forEach(r => map.set(r.groupId, { name: r.descricao, items: [] }));
     map.set(null, { name: 'Sem categoria', items: [] });
   
     items.forEach(item => {
       const gid = parseInt(item.codigo.split('.')[0], 10);
       const bucket = map.get(gid) || map.get(null);
       bucket.items.push(item);
     });
   
     const result = [];
     for (let [gid, { name, items }] of map) {
       if (!items.length) continue;
       items.sort((a, b) =>
         a.codigo.localeCompare(b.codigo, undefined, { numeric: true })
       );
       result.push({ category: name, groupId: gid, items });
     }
     return result;
   }
   
   /* ================================================================
      3. Render principal – agora com 6 colunas
      ================================================================ */
   export async function renderListaPecas(pecasRaw) {
     await loadTipoMap();
   
     /* transforma dados brutos em objeto com as 6 colunas ------------- */
     const pecas = pecasRaw.map(p => ({
       codigo:  p.codProdMalha,
       descricao: p.descrProdMalha,
       qtd:       p.quantProdMalha ?? '',
       unidade:   p.unidProdMalha ?? '',
       valor: p.custoReal != null
  ? Number(p.custoReal).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    })
  : ''

     }));
   
     const total = pecas.length;
     document.querySelector('#listaPecasTab .content-section-title')
             .textContent = `Lista de peças (${total})`;
   
             const ul = document.getElementById('listaPecasList');
     ul.innerHTML = '';
   
     /* —— cabeçalho fixo ————————————————————————————— */
     const header = document.createElement('li');
     header.className = 'header-row';
     header.innerHTML = `
       <div>Código</div>
       <div>Descrição</div>
       <div>QTD</div>
       <div>Unidade</div>
       <div>Valor&nbsp;sugerido</div>
       <div>Abrir</div>
     `;
     ul.appendChild(header);
   
     if (!total) {
       ul.innerHTML += '<li>Nenhuma peça encontrada.</li>';
       return;
     }
   
     /* —— agrupa, ordena e renderiza ———————————— */
     const grouped = groupAndSortByGroupId(pecas);
   
     grouped.forEach(group => {
      /* ── cabeçalho da categoria ───────────────────────────── */
      const isGab = (group.groupId === 3);          // 3 = GABINETES
      /* —–– descobre “Nxx.x” dentro da descrição —–– */
let gabCode = '';
if (isGab) {
  for (const itm of group.items) {
    const m = itm.descricao.match(/N\d{2}\.\d/);  // ex.: N07.1
    if (m) { gabCode = ' ' + m[0]; break; }        // espaço &nbsp; + código
  }
}

      const h = document.createElement('li');
      h.className = `adobe-product category-header${isGab ? ' collapsible' : ''}`;
      h.dataset.expanded = (!isGab).toString();     // começa fechado se for GAB
      h.innerHTML = `
      <strong>${group.category}${gabCode}</strong>
      ${isGab ? '<i class="fas fa-plus expand-icon"></i>' : ''}
    `;
    
      ul.appendChild(h);
    
      /* ── agora vem o LOOP que faltava ─────────────────────── */
      group.items.forEach(item => {
        const li = document.createElement('li');
        li.className = `adobe-product${isGab ? ' gab-item' : ''}`;
        if (isGab) li.style.display = 'none';          // oculto se for GABINETES
    
        li.innerHTML = `
          <div class="products">${item.codigo}</div>
          <span class="status">
            <span class="status-circle green"></span>
            <span class="status-text">${item.descricao}</span>
          </span>
          <div class="qtd">${item.qtd}</div>
          <div class="unidade">${item.unidade}</div>
          <div class="valor">${item.valor}</div>
          <div class="button-wrapper">
            <button type="button" class="content-button status-button open">Abrir</button>
          </div>
        `;
        ul.appendChild(li);
    
        /* –– expandir descrição –– */
        li.querySelector('.status')
          .addEventListener('click',
            e => e.currentTarget.classList.toggle('expanded'));
    
        /* –– botão Abrir –– */
        li.querySelector('button.open')
          .addEventListener('click', () => {
            window.location.href =
              `${window.location.pathname}?produto=${encodeURIComponent(item.codigo)}`;
          });
      });         //  <<< fecha group.items.forEach
    
    });           //  <<< fecha grouped.forEach
    
/* ── LISTENER para expandir / recolher GABINETES ───────────────── */
ul.addEventListener('click', ev => {
  const header = ev.target.closest('li.category-header.collapsible');
  if (!header) return;                       // clicou em outra coisa

  const aberto = header.dataset.expanded === 'true';
  header.dataset.expanded = (!aberto).toString();

  // troca o ícone + / –
  header.querySelector('.expand-icon').className =
    'fas fa-' + (aberto ? 'plus' : 'minus') + ' expand-icon';

  /* percorre as linhas seguintes até o próximo cabeçalho,
     mostrando ou ocultando apenas as linhas marcadas como .gab-item */
  let el = header.nextElementSibling;
  while (el && !el.classList.contains('category-header')) {
    if (el.classList.contains('gab-item')) {
      el.style.display = aberto ? 'none' : 'grid';
    }
    el = el.nextElementSibling;
  }
});
}   //  ← fecha renderListaPecas

   