// Criar_produto.js

// Função para carregar os dados do CSV "Tipo.csv"
async function loadTipoData() {
  try {
    const response = await fetch('csv/Tipo.csv'); // ajuste o caminho se necessário
    const csvText = await response.text();
    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      trim: true,
      delimiter: ','  // usando vírgula como delimitador
    });
    console.log("Dados Tipo:", parsed.data);
    return parsed.data; // array de objetos com as colunas: Grupo, Descrição, Tipo, Tipo do produto
  } catch (error) {
    console.error("Erro ao carregar Tipo.csv:", error);
    return [];
  }
}

// Função para carregar os dados do CSV "Origem.csv"
async function loadOrigemData() {
  try {
    const response = await fetch('csv/Origem.csv'); // ajuste o caminho se necessário
    const csvText = await response.text();
    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      trim: true,
      delimiter: ','  // usando vírgula como delimitador
    });
    console.log("Dados Origem:", parsed.data);
    return parsed.data; // array de objetos com as colunas: Sigla, origem
  } catch (error) {
    console.error("Erro ao carregar Origem.csv:", error);
    return [];
  }
}

// Função para carregar os dados do CSV "ListarNCM.csv"
async function loadNCMData() {
  try {
    const response = await fetch('csv/ListarNCM.csv'); // ajuste o caminho se necessário
    const csvText = await response.text();
    const parsed = Papa.parse(csvText, {
      header: false,      // não há cabeçalho
      skipEmptyLines: true,
      trim: true,
      delimiter: ','      // usando vírgula como delimitador
    });
    // Cada linha tem [cCodigo, cDescricao]
    return parsed.data;
  } catch (error) {
    console.error("Erro ao carregar ListarNCM.csv:", error);
    return [];
  }
}

/**
 * Função para limpar os campos do modal e preparar o layout para criação do produto.
 * Cria um container com duas colunas:
 * - A coluna da esquerda ("photo-column") exibe o carrossel com a foto e o botão para atualizar/incluir foto.
 * - A coluna da direita ("form-column") receberá os campos de dados do produto.
 *
 * Nesta versão, em vez de alterar o fundo do modal (que pode persistir ao fechar/reabrir),
 * definimos o fundo amarelo apenas no container de criação.
 */
export function clearModalFields() {
  const modalBody = document.getElementById('cardModalBody');
  if (!modalBody) return;
  
  // Limpa todo o conteúdo existente no modalBody
  modalBody.innerHTML = "";

  // Cria o container principal com duas colunas
  const container = document.createElement('div');
  container.className = "create-product-container";
  // Define o fundo amarelo apenas para essa área de criação
  container.style.backgroundColor = "yellow";
  
  // Coluna esquerda: para a foto (carrossel)
  const photoColumn = document.createElement('div');
  photoColumn.className = "photo-column";
  // Coluna direita: para os dados (formulário)
  const formColumn = document.createElement('div');
  formColumn.className = "form-column";
  
  // Insere as duas colunas no container
  container.appendChild(photoColumn);
  container.appendChild(formColumn);
  modalBody.appendChild(container);

  // --- Construindo o carrossel na coluna de foto ---
  const defaultImage = "img/logo.png";
  let slides = [];
  for (let i = 0; i < 6; i++) {
    slides.push(defaultImage);
  }

  photoColumn.innerHTML = `
    <div class="container">
      <!-- INPUTS ocultos para o slider -->
      <input type="radio" name="slider" id="slide-1-trigger" class="trigger" checked>
      <label class="btn" for="slide-1-trigger" title="Foto 1"></label>
      <input type="radio" name="slider" id="slide-2-trigger" class="trigger">
      <label class="btn" for="slide-2-trigger" title="Foto 2"></label>
      <input type="radio" name="slider" id="slide-3-trigger" class="trigger">
      <label class="btn" for="slide-3-trigger" title="Foto 3"></label>
      <input type="radio" name="slider" id="slide-4-trigger" class="trigger">
      <label class="btn" for="slide-4-trigger" title="Foto 4"></label>
      <input type="radio" name="slider" id="slide-5-trigger" class="trigger">
      <label class="btn" for="slide-5-trigger" title="Foto 5"></label>
      <input type="radio" name="slider" id="slide-6-trigger" class="trigger">
      <label class="btn" for="slide-6-trigger" title="Foto 6"></label>
      
      <!-- SLIDES -->
      <div class="slide-wrapper">
        <div id="slide-role">
          ${[0,1,2,3,4,5].map(i => `
            <div class="slide slide-${i+1}" style="background-image: url('${slides[i]}'); position: relative;">
              <button class="update-slide-btn" data-index="${i}" 
                      style="position: absolute; bottom: 5px; right: 5px; z-index: 10; 
                             font-size: 24px; padding: 8px; background: rgba(241, 14, 14, 0.8);
                             border: none; border-radius: 50%; cursor: pointer;">
                <i class="ion-ios-camera-outline" style="font-size: 24px;"></i>
              </button>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  // Adiciona os event listeners para os botões de atualizar foto
  const updateBtns = photoColumn.querySelectorAll('.update-slide-btn');
  updateBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = btn.getAttribute('data-index');
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.jpeg,.jpg,.png';
      fileInput.style.display = 'none';
      fileInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onloadend = () => {
            const slideDiv = photoColumn.querySelector(`.slide.slide-${parseInt(index) + 1}`);
            if (slideDiv) {
              slideDiv.style.backgroundImage = `url('${reader.result}')`;
              // Armazena a imagem globalmente para uso na requisição
              window.savedImageUrl = reader.result;
            }
          };
          reader.readAsDataURL(file);
        }
      });
      fileInput.click();
    });
  });

  // Limpa o conteúdo da coluna de formulário (form-column)
  formColumn.innerHTML = "";
}

/**
 * Função auxiliar para criar uma linha do formulário (div com classe "form-row").
 * Recebe o texto do rótulo e o elemento do campo.
 */
function createFormRow(labelText, fieldElement) {
  const row = document.createElement('div');
  row.className = "form-row";
  const label = document.createElement('strong');
  label.textContent = labelText;
  row.appendChild(label);
  fieldElement.style.flex = "1";
  row.appendChild(fieldElement);
  return row;
}

/**
 * Função para construir o formulário de criação do produto.
 * Os campos serão inseridos na coluna de formulário ("form-column") na seguinte ordem:
 *
 *   Código:                (exibindo "xx.xx.x.xxxxx" – valor padrão, que será atualizado)
 *   Tipo:                  (select)
 *   Origem:                (select)
 *   Descrição:             (textarea de texto grande)
 *   Descrição detalhada:   (textarea)
 *   NCM:                   (input text com datalist para sugestões)
 *   EAN:                   (input text)
 *   Tipo Item:             (input text)
 *   Descrição da família:  (select)
 *   Unidade:               (select)
 *   Bloqueado:             (select)
 */
export function buildCreateProductForm() {
  const formColumn = document.querySelector('.create-product-container .form-column');
  if (!formColumn) return;

  // 1. Campo "Código:" – exibindo o valor padrão "xx.xx.x.xxxxx"
  const codigoSpan = document.createElement('span');
  codigoSpan.id = "codigoProduto";
  codigoSpan.textContent = "xx.xx.x.999999"; // este valor será atualizado conforme a lógica do seu projeto
  const codigoRow = createFormRow("Código:", codigoSpan);
  formColumn.appendChild(codigoRow);

  // 2. Campo "Tipo:" (select)
  const tipoSelect = document.createElement('select');
  tipoSelect.id = "tipoSelect";
  const defaultTipoOption = document.createElement('option');
  defaultTipoOption.value = "selecionar";
  defaultTipoOption.textContent = "selecionar";
  tipoSelect.appendChild(defaultTipoOption);
  const tipoRow = createFormRow("Tipo:", tipoSelect);
  formColumn.appendChild(tipoRow);

  // 3. Campo "Origem:" (select)
  const origemSelect = document.createElement('select');
  origemSelect.id = "origemSelect";
  const defaultOrigemOption = document.createElement('option');
  defaultOrigemOption.value = "selecionar";
  defaultOrigemOption.textContent = "selecionar";
  origemSelect.appendChild(defaultOrigemOption);
  const origemRow = createFormRow("Origem:", origemSelect);
  formColumn.appendChild(origemRow);


    // Adiciona os event listeners para atualizar a parte 1 do código
    tipoSelect.addEventListener('change', updateCodigoPart1);
    origemSelect.addEventListener('change', updateCodigoPart1);


  // 4. Campo "Descrição:" (textarea de texto grande)
  const descTextArea = document.createElement('textarea');
  descTextArea.id = "descricao";
  descTextArea.rows = 5;
  const descRow = createFormRow("Descrição:", descTextArea);
  formColumn.appendChild(descRow);

  // 5. Campo "Descrição detalhada:" (textarea)
  const descDetalhadaInput = document.createElement('textarea');
  descDetalhadaInput.id = "descricaoDetalhada";
  descDetalhadaInput.rows = 3;
  const descDetalhadaRow = createFormRow("Descrição detalhada:", descDetalhadaInput);
  formColumn.appendChild(descDetalhadaRow);

  // 6. Campo "NCM:" (input text com datalist para sugestões)
  const ncmInput = document.createElement('input');
  ncmInput.type = "text";
  ncmInput.id = "ncm";
  ncmInput.setAttribute('list', 'ncmOptions');
  const ncmRow = createFormRow("NCM:", ncmInput);
  formColumn.appendChild(ncmRow);

  // Cria o datalist para NCM
  const ncmDatalist = document.createElement('datalist');
  ncmDatalist.id = 'ncmOptions';
  formColumn.appendChild(ncmDatalist);

  // Evento: se o valor contiver vírgula, extrai apenas o código
  ncmInput.addEventListener('change', function() {
    if (ncmInput.value.indexOf(',') !== -1) {
      ncmInput.value = ncmInput.value.split(',')[0];
    }
  });

  // Evento: atualizar opções do datalist com base em "Descrição" e "Descrição detalhada"
  ncmInput.addEventListener('focus', async function() {
    const ncmData = await loadNCMData();
    const descValue = document.getElementById('descricao') ? document.getElementById('descricao').value : "";
    const descDetalhadaValue = document.getElementById('descricaoDetalhada') ? document.getElementById('descricaoDetalhada').value : "";
    const combinedText = (descValue + " " + descDetalhadaValue).toLowerCase();
    const tokens = combinedText.split(/\s+/).filter(Boolean);
    ncmDatalist.innerHTML = "";
    ncmData.forEach(row => {
      const [codigo, descricao] = row;
      if (!descricao) return;
      const lowerDesc = descricao.toLowerCase();
      const match = tokens.some(token => lowerDesc.includes(token));
      if (match) {
        const option = document.createElement('option');
        option.value = `${codigo}, ${descricao}`;
        ncmDatalist.appendChild(option);
      }
    });
  });

  // 7. Campo "EAN:" (input text)
  const eanInput = document.createElement('input');
  eanInput.type = "text";
  eanInput.id = "ean";
  const eanRow = createFormRow("EAN:", eanInput);
  formColumn.appendChild(eanRow);

  // 8. Campo "Tipo Item:" (input text)
  const tipoItemInput = document.createElement('input');
  tipoItemInput.type = "text";
  tipoItemInput.id = "tipoItem";
  const tipoItemRow = createFormRow("Tipo Item:", tipoItemInput);
  formColumn.appendChild(tipoItemRow);

  // 9. Campo "Família:" (select único)
  const familiaSelect = document.createElement('select');
  familiaSelect.id = "familiaSelect";
  const defaultFamiliaOption = document.createElement('option');
  defaultFamiliaOption.value = "";
  defaultFamiliaOption.textContent = "Selecione a família";
  familiaSelect.appendChild(defaultFamiliaOption);
  const familiaRow = createFormRow("Família:", familiaSelect);
  formColumn.appendChild(familiaRow);

  // Carrega os dados das famílias e popula o select
  loadFamiliasData().then(famílias => {
    console.log("Dados das famílias:", famílias);
    famílias.forEach(fam => {
      const option = document.createElement('option');
      option.value = fam.nomeFamilia;
      option.textContent = fam.nomeFamilia;
      option.dataset.codFamilia = fam.codFamilia;
      familiaSelect.appendChild(option);
      console.log("Opção adicionada:", option.value, option.textContent);
    });
  });

  // 10. Campo "Unidade:" (select)
  const unidadeSelect = document.createElement('select');
  unidadeSelect.id = "unidade";
  const defaultUnidadeOption = document.createElement('option');
  defaultUnidadeOption.value = "";
  defaultUnidadeOption.textContent = "Selecione a unidade";
  unidadeSelect.appendChild(defaultUnidadeOption);
  const unidades = ["UN", "KG", "LT", "MT"];
  unidades.forEach(u => {
    const option = document.createElement('option');
    option.value = u;
    option.textContent = u;
    unidadeSelect.appendChild(option);
  });
  const unidadeRow = createFormRow("Unidade:", unidadeSelect);
  formColumn.appendChild(unidadeRow);

  // 11. Campo "Bloqueado:" (select)
  const bloqueadoSelect = document.createElement('select');
  bloqueadoSelect.id = "bloqueado";
  const defaultBloqueadoOption = document.createElement('option');
  defaultBloqueadoOption.value = "";
  defaultBloqueadoOption.textContent = "Selecione Bloqueado";
  bloqueadoSelect.appendChild(defaultBloqueadoOption);
  const bloqueadoOptions = ["S", "N"];
  bloqueadoOptions.forEach(opt => {
    const option = document.createElement('option');
    option.value = opt;
    option.textContent = opt;
    bloqueadoSelect.appendChild(option);
  });
  const bloqueadoRow = createFormRow("Bloqueado:", bloqueadoSelect);
  formColumn.appendChild(bloqueadoRow);

  // Preenche o select de "Tipo" com os dados do CSV
  loadTipoData().then(tipoData => {
    tipoData.forEach(item => {
      const option = document.createElement('option');
      const valor = `${item.Grupo} - ${item["Descrição"]}`;
      option.value = valor;
      option.textContent = valor;
      option.dataset.grupo = item.Grupo;
      option.dataset.tipo = item.Tipo;
      option.dataset.tipoProduto = item["Tipo do produto"];
      tipoSelect.appendChild(option);
    });

    // Evento para atualizar o campo "Tipo Item:" quando o campo "Tipo" mudar
    tipoSelect.addEventListener('change', (event) => {
      const selectedTipo = tipoData.find(tipo => tipo.Grupo === event.target.value.split(' - ')[0]);
      if (selectedTipo) {
        tipoItemInput.value = selectedTipo['Tipo do produto'];
      }
    });
  });

  // Preenche o select de "Origem" com os dados do CSV
  loadOrigemData().then(origemData => {
    origemData.forEach(item => {
      const option = document.createElement('option');
      option.value = item.origem;
      option.textContent = item.origem;
      option.dataset.sigla = item.Sigla;
      origemSelect.appendChild(option);
    });
  });

  // Criação do botão de salvar (inserido ao final do formulário)
  const saveIcon = document.createElement('button');
  saveIcon.id = 'saveProductBtn';
  saveIcon.innerHTML = `<i class="fa fa-save"></i> Salvar Produto`;
  // Ajusta estilos para garantir visibilidade
  saveIcon.style.display = 'block';
  saveIcon.style.marginTop = "10px";
  saveIcon.style.padding = "8px 12px";
  saveIcon.style.backgroundColor = "#042444";
  saveIcon.style.color = "#fff";
  saveIcon.style.border = "none";
  saveIcon.style.borderRadius = "4px";
  saveIcon.style.cursor = "pointer";

  saveIcon.addEventListener('click', async () => {
    // Atualiza a parte 2 do código (suporte final)
    await updateCodigoPart2();
    const codigo_valor = document.getElementById('codigoProduto')?.innerText.trim();
    // ... colete os demais valores dos campos ...
    // (exemplo abaixo)
    const descricao = document.getElementById('descricao') ? document.getElementById('descricao').value.trim() : "";
    const descr_detalhada = document.getElementById('descricaoDetalhada') ? document.getElementById('descricaoDetalhada').value.trim() : "";
    const unidade = document.getElementById('unidade') ? document.getElementById('unidade').value.trim() : "";
    const ncm = document.getElementById('ncm') ? document.getElementById('ncm').value.trim() : "";
    const ean = document.getElementById('ean') ? document.getElementById('ean').value.trim() : "";
    const tipoItem = document.getElementById('tipoItem') ? document.getElementById('tipoItem').value.trim() : "";
    const descricao_familia = document.getElementById('familiaSelect') ? document.getElementById('familiaSelect').value.trim() : "";
    const bloqueado = document.getElementById('bloqueado') ? document.getElementById('bloqueado').value.trim() : "";
  
    if (!codigo_valor || !descricao || !unidade || !tipoItem || !descricao_familia || !bloqueado) {
      alert("Preencha os campos obrigatórios: Código, Descrição, Unidade, Tipo Item, Família e Bloqueado.");
      return;
    }
  
    const imagens = [];
    if (window.savedImageUrl) {
      imagens.push({ url_imagem: window.savedImageUrl });
    }
  
    const payload = {
      call: "IncluirProduto",
      param: [{
        codigo_produto_integracao: codigo_valor,
        codigo: codigo_valor,
        descricao,
        descr_detalhada,
        unidade,
        ncm,
        ean,
        tipoItem,
        imagens,
        descricao_familia,
        bloqueado
      }]
    };
  
    console.log("Payload a ser enviado para Omie:", JSON.stringify(payload, null, 2));
  
    try {
      const response = await fetch('http://localhost:5001/api/produtos/incluir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (data && data.faultcode) {
        alert("Erro ao incluir produto: " + data.faultstring);
      } else {
        alert("Produto incluído com sucesso!");
      }
    } catch (error) {
      console.error("Erro na requisição para incluir produto:", error);
      alert("Erro ao incluir produto. Verifique o console.");
    }
  });
  

  formColumn.appendChild(saveIcon);
}

function updateCodigoPart1() {
  const codigoField = document.getElementById("codigoProduto");
  if (!codigoField) return;
  // Se o código já possui um sufixo (quatro partes), extraímos apenas os três primeiros
  let parts = codigoField.innerText.split(".");
  if (parts.length < 3) {
    parts = ["xx", "xx", "x"];
  } else {
    parts = parts.slice(0, 3);
  }
  const tipoSelect = document.getElementById("tipoSelect");
  if (tipoSelect && tipoSelect.value !== "selecionar") {
    const selectedTipoOption = tipoSelect.options[tipoSelect.selectedIndex];
    const grupo = selectedTipoOption.dataset.grupo ? selectedTipoOption.dataset.grupo.padStart(2, "0") : "xx";
    const tipo = selectedTipoOption.dataset.tipo || "xx";
    parts[0] = grupo;
    parts[1] = tipo;
  }
  const origemSelect = document.getElementById("origemSelect");
  if (origemSelect && origemSelect.value !== "selecionar") {
    const selectedOrigemOption = origemSelect.options[origemSelect.selectedIndex];
    const sigla = selectedOrigemOption.dataset.sigla || "x";
    parts[2] = sigla;
  }
  // Atualiza o campo com a parte 1, garantindo que termine com um ponto (.) para separar do sufixo
  codigoField.innerText = parts.join(".") + ".";
}


async function updateCodigoPart2() {
  const codigoField = document.getElementById("codigoProduto");
  if (!codigoField) return;
  // A parte 1 já deve estar formada, por exemplo "xx.xx.x."
  let part1 = codigoField.innerText;
  // Se não terminar com ponto, forçamos:
  if (!part1.endsWith(".")) {
    let parts = part1.split(".");
    if (parts.length >= 3) {
      part1 = parts.slice(0, 3).join(".") + ".";
    }
  }
  // Busca o total de registros via endpoint do servidor
  const total = await fetchTotalProdutosFromServer();
  let suffix;
  if (total === null) {
    suffix = "xxxxx";
  } else {
    // Agora soma 1 ao total
    const newTotal = total + 1;
    const totalStr = newTotal.toString();
    // Novo sufixo: prefixo fixo "10" concatenado com o valor (total+1)
    suffix = "10" + totalStr;
  }
  // Atualiza o campo concatenando a parte 1 e o novo sufixo
  codigoField.innerText = part1 + suffix;
}




/**
 * Função para atualizar o campo "Código:" com base nas seleções dos campos "Tipo" e "Origem".
 * O código é composto por 4 partes separadas por ponto: [grupo].[tipo].[origem].[sufixo]
 * O valor padrão é "xx.xx.x.xxxxx".
 */
async function updateCodigo() {
  const codigoField = document.getElementById("codigoProduto");
  if (!codigoField) return;
  let parts = codigoField.innerText.split(".");
  if (parts.length !== 4) {
    parts = ["xx", "xx", "x", "xxxxx"];
  }
  const tipoSelect = document.getElementById("tipoSelect");
  if (tipoSelect && tipoSelect.value !== "selecionar") {
    const selectedTipoOption = tipoSelect.options[tipoSelect.selectedIndex];
    const grupo = selectedTipoOption.dataset.grupo ? selectedTipoOption.dataset.grupo.padStart(2, "0") : "xx";
    const tipo = selectedTipoOption.dataset.tipo || "xx";
    parts[0] = grupo;
    parts[1] = tipo;
  }
  const origemSelect = document.getElementById("origemSelect");
  if (origemSelect && origemSelect.value !== "selecionar") {
    const selectedOrigemOption = origemSelect.options[origemSelect.selectedIndex];
    const sigla = selectedOrigemOption.dataset.sigla || "x";
    parts[2] = sigla;
  }
  // Busca o total de registros via endpoint do servidor
  const total = await fetchTotalProdutosFromServer();
  if (total === null) {
    parts[3] = "xxxxx";
  } else {
    const totalStr = total.toString();
    // Define o prefixo: "10" se total tiver até 4 dígitos; "11" se tiver 5 ou mais dígitos
    let prefix = totalStr.length >= 5 ? "11" : "10";
    parts[3] = prefix + totalStr;
  }
  codigoField.innerText = parts.join(".");
}



/**
 * Função para aplicar estilos a um elemento.
 */
export function setElementStyles(element, styles) {
  Object.keys(styles).forEach(prop => {
    element.style[prop] = styles[prop];
  });
}


/**
 * Delegação de eventos: quando o botão "Criar produto" for clicado,
 * limpa o modal e constrói o layout com o carrossel à esquerda e o formulário à direita.
 */
document.body.addEventListener('click', (e) => {
  const btn = e.target.closest('#criarProduto');
  if (btn) {
    e.preventDefault();
    console.log('Botão Criar produto clicado (delegado)');
    
    const modal = document.getElementById('cardModal');
    modal.classList.add('create-product-mode');
    
    // Exibe o modal
    modal.style.display = 'flex';
    
    // Centraliza o modal usando position fixed e transform:
    setElementStyles(modal, {
      width: '100%',
      position: 'fixed',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)'
    });
    
    clearModalFields();
    buildCreateProductForm();
  }
});

/**
 * Função para carregar os dados das famílias via API
 */
async function loadFamiliasData() {
  try {
    const response = await fetch('/api/familias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!response.ok) {
      throw new Error(`Erro na requisição: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    console.log("Resposta da API Omie para famílias:", data);
    return data.famCadastro || [];
  } catch (error) {
    console.error("Erro ao carregar famílias:", error);
    return [];
  }
}


async function fetchTotalProdutosFromServer() {
  try {
    const response = await fetch('http://localhost:5001/api/produtos/total-produtos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json();
    return data.total_de_registros;
  } catch (error) {
    console.error("Erro ao buscar total de produtos do servidor:", error);
    return null;
  }
}

