
  // Função chamada ao clicar em "Pausar" no modal de detalhes
  async function pausarItem() {
    // Fecha o modal de detalhes
    fecharModal();
  
    // Abre o modal de pausa
    const overlay = document.getElementById('pausarModalOverlay');
    const pauseModal = document.getElementById('pausarModal');
  
    // Carrega o CSV "Motvio_parada.csv" para preencher o listbox
    // (exemplo: a 1ª coluna tem o "motivo", a 2ª coluna tem se é Programada ou Não programada)
    let motivosProgramada = [];
    let motivosNaoProgramada = [];
    try {
        const resp = await fetch('../csv/Motvio_parada.csv');

      const csvText = await resp.text();
      const parsed = Papa.parse(csvText, {
        header: false,
        skipEmptyLines: true
      });
      // A parsed.data será um array de arrays, ex: [["Ajuste", "Programada"], ["Quebra", "Nao programada"], ...]
      parsed.data.forEach(row => {
        const motivo = row[0] ? row[0].trim() : "";
        const tipo   = row[1] ? row[1].trim() : "";
        if (!motivo || !tipo) return;
        // Normaliza para remover acentos (ex.: "não" passa a ser "nao")
        const tipoNorm = tipo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (tipoNorm === "programada") {
          motivosProgramada.push(motivo);
        } else if (tipoNorm.includes("nao")) {
          motivosNaoProgramada.push(motivo);
        }
      });
      
    } catch (error) {
      console.error("Erro ao carregar Motvio_parada.csv:", error);
    }
  
    // Data atual (formato dd/mm/yyyy)
    const now = new Date();
    const dia = String(now.getDate()).padStart(2, '0');
    const mes = String(now.getMonth() + 1).padStart(2, '0');
    const ano = now.getFullYear();
    const dataHoje = `${dia}/${mes}/${ano}`;
  
    // Hora atual (hh:mm)
    const horas = String(now.getHours()).padStart(2, '0');
    const minutos = String(now.getMinutes()).padStart(2, '0');
    const horaAtual = `${horas}:${minutos}`;
  
    // Recupera dados do item
    const { local, status, op } = window.currentItemData || {};
  
    // Monta as <option> do listbox de motivos
    // Inicialmente, exibe somente os motivos programados; ao mudar a combo "programada x não programada", trocamos
    let programadaOptions = motivosProgramada.map(m => `<option value="${m}">${m}</option>`).join('');
    let naoProgramadaOptions = motivosNaoProgramada.map(m => `<option value="${m}">${m}</option>`).join('');
  
    // Conteúdo do modal
    pauseModal.innerHTML = `
      <div class="modal-header">
        <h2>Pausar Item</h2>
      </div>
      <div class="modal-body">
        <div class="modal-field">
          <label>Data:</label>
          <input type="text" id="pausaData" value="${dataHoje}" readonly>
        </div>
        <div class="modal-field">
          <label>Local:</label>
          <input type="text" id="pausaLocal" value="${local || ''}" readonly>
        </div>
        <div class="modal-field">
          <label>Status:</label>
          <input type="text" id="pausaStatus" value="${status || ''}" readonly>
        </div>
        <div class="modal-field">
          <label>OP:</label>
          <input type="text" id="pausaOP" value="${op || ''}" readonly>
        </div>
        <div class="modal-field">
          <label>Programada / Não programada:</label>
          <select id="pausaTipo" onchange="onChangeTipoParada()">
            <option value="Programada">Programada</option>
            <option value="Nao programada">Não programada</option>
          </select>
        </div>
      <div class="modal-field">
        <label>Motivo:</label>
        <select id="pausaMotivo">
          <option value="">Selecione o motivo</option>
        </select>
      </div>

        <div class="modal-field">
          <label>Hora Início:</label>
          <input type="text" id="pausaHoraInicio" value="${horaAtual}" readonly>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-fechar" onclick="salvarPausa()">Salvar</button>
        <button class="btn-fechar" onclick="fecharPausaModal()">Cancelar</button>
      </div>
    `;
  
    // Exibe o overlay e o modal
    overlay.style.display = 'block';
    pauseModal.style.display = 'block';
  
    // Ajusta a combo de motivos para exibir os da Programada inicialmente
    const pausaMotivo = document.getElementById('pausaMotivo');
    pausaMotivo.innerHTML = programadaOptions;
  
    // Armazena em window para acesso na função onChangeTipoParada
    window.globalParadaData = {
      programadaOptions,
      naoProgramadaOptions
    };
  }
  
  // =============== PARTE 3 ===============
  // Funções para manipular o modal de pausa
  
  // Ao mudar a combo "Programada x Não programada", alteramos as opções de motivos
  function onChangeTipoParada() {
    const tipoCombo = document.getElementById('pausaTipo');
    const tipoValue = tipoCombo.value; // "Programada" ou "Nao programada"
    const pausaMotivo = document.getElementById('pausaMotivo');
  
    // Inicialmente, reseta para a opção padrão
    pausaMotivo.innerHTML = `<option value="">Selecione o motivo</option>`;
  
    if (!window.globalParadaData) return;
    const { programadaOptions, naoProgramadaOptions } = window.globalParadaData;
  
    if (tipoValue === "Programada") {
      pausaMotivo.innerHTML += programadaOptions;
    } else {
      pausaMotivo.innerHTML += naoProgramadaOptions;
    }
  }
  
  
  // Fecha o modal de pausa sem salvar
  function fecharPausaModal() {
    document.getElementById('pausarModalOverlay').style.display = 'none';
    document.getElementById('pausarModal').style.display = 'none';
  }
  
  // Exemplo simples de "salvar" a pausa
  function salvarPausa() {
    const dataVal = document.getElementById('pausaData').value;
    const localVal = document.getElementById('pausaLocal').value;
    const opVal = document.getElementById('pausaOP').value;
    const tipoVal = document.getElementById('pausaTipo').value;  // "Programada" ou "Nao programada"
    const motivoVal = document.getElementById('pausaMotivo').value;
    const horaVal = document.getElementById('pausaHoraInicio').value;
    
    const { pedido, produto, observacao, cardId } = window.currentItemData || {};
    
    if (!pedido || !produto) {
      console.error("Dados do item não encontrados.");
      return;
    }
    
    // Atualiza o status no plano_op.csv para "L2;P1P;="
    fetch('/api/plano-op/atualizar-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pedido,
        produto,
        local: localVal,
        status: "L2;P1P;="
      })
    })
    .then(response => response.json())
    .then(result => {
      console.log("Plano_op status atualizado para L2;P1P;=:", result);
      
      // Insere os dados no Paradas.csv
      const paradasData = {
        Data: dataVal,
        Local: localVal,
        status: "L2",
        OP: opVal,
        parada: tipoVal,
        motivo: motivoVal,
        h_inicio: horaVal,
        h_fim: "",
        observação: observacao || ""
      };
      
      return fetch('/api/paradas/inserir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paradasData)
      });
    })
    .then(response => response.json())
    .then(result => {
      console.log("Registro inserido em Paradas.csv:", result);
      
      // Atualiza o card para refletir a pausa (pinta de amarelo)
      const card = document.getElementById(cardId);
      if (card) {
        card.style.backgroundColor = "yellow";
        card.dataset.status = "L2;P1P;=";
      }
      alert("Pausa salva com sucesso!");
      fecharPausaModal();
    })
    .catch(error => {
      console.error("Erro ao salvar pausa:", error);
      alert("Erro ao salvar pausa.");
    });
  }
  