  
  
  // Adiciona um listener a cada botão secundário gerado
  function initListenersBotoesSecundarios() {
    // Seleciona todos os botões secundários (exemplo: botões dentro de .sub-tabs-linha)
    const botoes = document.querySelectorAll('.sub-tabs-linha .round-button');
    botoes.forEach(botao => {
      botao.addEventListener('click', function() {
        // Ao clicar, carrega os campos do CSV e expande o modal para baixo
        carregarResultadoTeste();
      });
    });
  }
  
  // Função para coletar os dados do formulário e salvar no CSV
  function salvarResultado() {
    const form = document.getElementById('resultadoForm');
    const formData = new FormData(form);
    const dados = {};
  
    // Constrói um objeto com os dados digitados
    formData.forEach((value, key) => {
      dados[key] = value;
    });
  
    // Converte os dados em uma linha CSV (por exemplo, separando por vírgula)
    const novaLinha = Object.values(dados).join(',') + '\n';
  
    // Envia os dados para o servidor para que sejam adicionados ao CSV
    fetch('/api/salvar-resultado', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: novaLinha
    }).then(response => {
      if (response.ok) {
        alert('Resultado salvo com sucesso!');
        // Opcional: Esconde novamente o container dos resultados
        document.getElementById('resultadoContainer').style.display = 'none';
      } else {
        alert('Falha ao salvar o resultado.');
      }
    }).catch(err => console.error(err));
  }
  
  // Inicializa os listeners para os botões secundários quando o DOM estiver carregado
  document.addEventListener('DOMContentLoaded', initListenersBotoesSecundarios);
  