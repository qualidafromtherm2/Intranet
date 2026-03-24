<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <style>
    /* Estilos Gerais */
    body {
      font-family: Arial, sans-serif;
      background-color: #f4f4f4;
      margin: 0;
      padding: 0;
    }

    .container {
      max-width: 800px;
      margin: 30px auto;
      background-color: #fff;
      padding: 20px 40px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.1);
      border-radius: 8px;
      position: relative;
      
    }

    .logo {
      display: block;
      margin: 0 auto 20px auto;
      max-width: 400px;
    }

  h1 {
    text-align: center;
    color: #333;
    font-size: 24px; /* Tamanho do cabeçalho principal */
  }

  label {
    display: block;
    margin-bottom: 5px;
    color: #555;
    font-size: 30px; /* Tamanho dos textos que estão acima dos campos digitaveis */
  }

    input[type="text"],
    select,
    textarea {
      width: 100%;
      padding: 7px;
      margin-bottom: 15px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 40px; /* Tamanho da fonte para o texto dentro da combobox do pesquisar serie quando passado pelas opções*/
    }

    textarea {
      resize: vertical;
    }

    button {
      background-color: #002547;
      color: #fff;
      padding: 50px 20px;
      border: none;
      border-radius: 4px;
      font-size: 30px;
      cursor: pointer;
      width: 100%;
    }

    button:hover {
      background-color: #218838;
    }

    .readonly {
      background-color: #e9ecef;
    }

    /* Classe para ocultar elementos */
    .hidden {
      display: none !important;
    }

    /* Estilos para as sugestões */
    #sugestoes {
      border: 1px solid #ccc;
      max-height: 150px;
      overflow-y: auto;
      background-color: #fff;
      position: absolute;
      z-index: 1000;
      width: calc(100% - 22px);
      font-size: 30px; /* Tamanho da fonte para o texto dentro da combobox do pesquisar serie na lista*/
    }

    .sugestao-item {
      padding: 8px;
      cursor: pointer;
    }

    .sugestao-item:hover {
      background-color: #f1f1f1;
      font-size: 40px; /* Tamanho da fonte para todos os textos dentro do card */
    }


    button:disabled {
      background-color: #ccc;
      cursor: not-allowed;
    }

  .card {
    background-color: #fff; /* Cor de fundo do card */
    border-radius: 8px; /* Cantos arredondados */
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.15); /* Sombra para dar profundidade */
    padding: 20px; /* Espaçamento interno */
    margin: 20px 0; /* Espaçamento externo */
  }

  .card input[type="text"],
  .card select,
  .card textarea {
    width: 100%; /* Largura total do campo de entrada */
    padding: 7px; /* Espaçamento interno do campo de entrada */
    margin-bottom: 15px; /* Espaçamento abaixo do campo de entrada */
    border: 1px solid #ccc; /* Borda do campo de entrada */
    border-radius: 4px; /* Cantos arredondados do campo de entrada */
    font-size: 30px; /* Tamanho da fonte dentro do card */
  }


.card-content {
    display: flex; /* Usar flexbox para duas colunas */
    flex-wrap: wrap; /* Permitir quebra de linha se necessário */
}

.column {
    flex: 1; /* Cada coluna ocupa espaço igual */
    min-width: 250px; /* Largura mínima para cada coluna */
    margin-right: 20px; /* Espaçamento entre colunas */
}

.column label {
    display: block; /* Cada label ocupa uma linha */
    margin-bottom: 5px; /* Espaçamento abaixo do label */
    color: #555; /* Cor do texto do label */
}

.column input[type="text"] {
    width: 100%; /* Largura total do campo de entrada */
    padding: 8px; /* Espaçamento interno do campo de entrada */
    margin-bottom: 15px; /* Espaçamento abaixo do campo de entrada */
    border: 1px solid #ccc; /* Borda do campo de entrada */
    border-radius: 4px; /* Cantos arredondados do campo de entrada */
    font-size: 20px; /* Tamanho da fonte dentro do card content*/
}

.card .abrir-pasta {
    color: blue; /* Cor do texto como azul */
    font-size: 14px; /* Tamanho da fonte para o link */
    cursor: pointer; /* Muda o cursor para indicar que é clicável */
    text-decoration: underline; /* Adiciona sublinhado para parecer um link */
}

    </style>

    <script>



      function enviarDados() {
        // Cria um formulário dinamicamente
        var form = document.createElement('form');
        form.method = 'POST';
        form.action = 'https://vipp.visualset.com.br/vipp/inicio/index.php#google_vignette';
        form.target = '_blank'; // Abre em uma nova aba/janela

        // Campo de login
        var inputLogin = document.createElement('input');
        inputLogin.type = 'hidden';
        inputLogin.name = 'txtUsr';
        inputLogin.value = 'epsadmin132681';

        // Campo de senha
        var inputSenha = document.createElement('input');
        inputSenha.type = 'hidden';
        inputSenha.name = 'txtPwd';
        inputSenha.value = 'fhft3035';

        // Adiciona os campos ao formulário
        form.appendChild(inputLogin);
        form.appendChild(inputSenha);

        // Adiciona o formulário ao corpo do documento e o submete
        document.body.appendChild(form);
        form.submit();

        // Remove o formulário após o envio
        document.body.removeChild(form);
      }




// Função de debounce para limitar a frequência das chamadas de busca
function debounce(func, delay) {
  let timeoutId;
  return function(...args) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func.apply(this, args);
    }, delay);
  };
}

// Função para buscar produtos com debounce de 300ms
const debouncedBuscarProdutos = debounce(function() {
  var termo = document.getElementById('buscaProduto').value.trim();

  if (termo.length >= 3) { // Pelo menos 3 caracteres para iniciar a busca
    buscarProdutos(termo);
  } else {
    document.getElementById('sugestoes').innerHTML = '';
    document.getElementById('sugestoes').classList.add('hidden');
  }
}, 150); // Ajuste o delay conforme necessário




      // Variável para armazenar a descrição original
      var descricaoOriginal = '';

      // Adicionar o evento de clique ao botão após o DOM ser carregado
      document.addEventListener('DOMContentLoaded', function() {
        console.log('DOM completamente carregado e analisado');



        var botaoEnviar = document.getElementById('botaoEnviar');
        if (botaoEnviar) {
          botaoEnviar.addEventListener('click', enviarFormulario);
        } else {
          console.error('Botão "Enviar Solicitação" não encontrado.');
        }

        // Adicionar evento para verificar N° SÉRIE após seleção
        var numeroSerieInput = document.getElementById('numeroSerie');
        numeroSerieInput.addEventListener('change', verificarExistenciaOS);
      });

      /**
       * Função para verificar a existência da OS após preencher N° SÉRIE.
       */
function verificarExistenciaOS() {
  var numeroSerie = document.getElementById('numeroSerie').value.trim();
  if (numeroSerie) {
    google.script.run
      .withSuccessHandler(function(dados) {
        if (dados) {
          // OS existente encontrada, preencher os campos com os dados existentes
          document.getElementById('tipoAtendimento').value = dados.tipoAtendimento;
          document.getElementById('numeroOS').value = dados.numeroOS; // Preencher N° OS          
          document.getElementById('telefone').value = dados.telefone;
          document.getElementById('nomeCliente').value = dados.nomeCliente;
          document.getElementById('cpfCnpj').value = dados.cpfCnpj;
          document.getElementById('cep').value = dados.cep;

          // Dividir o endereço em Rua, Bairro e Número da Casa
          var enderecoParts = dados.endereco.split(', ');
          document.getElementById('rua').value = enderecoParts[0] || '';
          document.getElementById('bairro').value = enderecoParts[1] || '';
          document.getElementById('numeroCasa').value = enderecoParts[2] || '';

          document.getElementById('cidade').value = dados.cidade;
          document.getElementById('estado').value = dados.estado;
          document.getElementById('agendarCom').value = dados.agendarCom;

          // Preencher Descrição da Reclamação
          document.getElementById('descricao').value = dados.descricao || '';
          descricaoOriginal = dados.descricao || '';
          
          // Preencher os novos campos
          document.getElementById('problemaReal').value = dados.problemaReal || '';
          document.getElementById('causaRaiz').value = dados.causaRaiz || '';
          document.getElementById('acaocorretiva').value = dados.causaRaiz || '';          
          document.getElementById('status').value = dados.status || '';

          // Tornar todos os campos não editáveis, exceto "Descreva a Reclamação"
          document.getElementById('descricao').readOnly = false;
        } else {
          // OS não encontrada, permitir que o usuário preencha os campos
          limparCamposOS();

          document.getElementById('descricao').readOnly = false;
          descricaoOriginal = '';
        }
      })
      .withFailureHandler(function(error) {
        console.error('Erro ao verificar existência da OS:', error);
        limparCamposOS();
        document.getElementById('descricao').readOnly = false;
        descricaoOriginal = '';
      })
      .verificarNumeroSerie(numeroSerie);
  }
}






      /**
       * Função para limpar os campos preenchidos com dados existentes.
       */
function limparCamposOS() {
  document.getElementById('tipoAtendimento').value = '';
  document.getElementById('telefone').value = '';
  document.getElementById('nomeCliente').value = '';
  document.getElementById('cpfCnpj').value = '';
  document.getElementById('cep').value = '';
  document.getElementById('rua').value = '';
  document.getElementById('bairro').value = '';
  document.getElementById('numeroCasa').value = '';
  document.getElementById('cidade').value = '';
  document.getElementById('estado').value = '';
  document.getElementById('agendarCom').value = '';
  document.getElementById('descricao').value = '';
  document.getElementById('problemaReal').value = ''; // Corrigido
  document.getElementById('causaRaiz').value = '';    // Corrigido
  document.getElementById('acaocorretiva').value = '';
  descricaoOriginal = '';
}




function enviarFormulario() {
  console.log('Função enviarFormulario chamada');
  var formData = {};
  var elements = document.getElementById('formulario').elements;
  for (var i = 0; i < elements.length; i++) {
    var item = elements.item(i);
    formData[item.name] = item.value;
  }

  // Validação: Verificar se N° SÉRIE está preenchido
  //if (!formData.numeroSerie) {
    // Sem mensagens de alerta
    //document.getElementById('botaoEnviar').disabled = false;
    //return;
  //}

  // Perguntar ao usuário se deseja gerar o PDF
  var gerarPDF = confirm('Deseja gerar o PDF?');

  // Adicionar essa informação ao formData
  formData.gerarPDF = gerarPDF;

  // Desabilitar o botão "Enviar Solicitação" para evitar múltiplos cliques
  document.getElementById('botaoEnviar').disabled = true;

  // Chamar a função do lado do servidor com a ordem correta
  google.script.run
    .withSuccessHandler(function(mensagemSucesso) {
      // Habilitar o botão novamente
      document.getElementById('botaoEnviar').disabled = false;

      // Limpar o formulário
      document.getElementById('formulario').reset();
      document.getElementById('sugestoes').innerHTML = '';
      document.getElementById('sugestoes').classList.add('hidden');

      // Resetar a variável de descrição original
      descricaoOriginal = '';

      // Mostrar a mensagem de sucesso recebida do servidor
      alert(mensagemSucesso);
    })
    .withFailureHandler(function(error) {
      // Habilitar o botão novamente
      document.getElementById('botaoEnviar').disabled = false;
      console.error('Erro ao enviar dados:', error);
    })
    .enviarDados(formData); // A chamada da função do servidor deve vir após os manipuladores
}


// Função para buscar produtos
function buscarProdutos() {
  var termo = document.getElementById('buscaProduto').value;

  if (termo.length >= 2) { // Pelo menos 2 caracteres para avaliar o segundo caractere
    google.script.run.withSuccessHandler(exibirSugestoes).buscarProdutos(termo);
  } else {
    document.getElementById('sugestoes').innerHTML = '';
    document.getElementById('sugestoes').classList.add('hidden');
  }
}



  // Função para exibir sugestões
  function exibirSugestoes(listaProdutos) {
    var sugestoesDiv = document.getElementById('sugestoes');
    sugestoesDiv.innerHTML = '';
    if (listaProdutos.length > 0) {
      listaProdutos.forEach(function(produto) {
        var div = document.createElement('div');
        div.textContent = produto.descricao; // Descrição ajustada no backend
        div.classList.add('sugestao-item');
        div.onclick = function() {
          selecionarProduto(produto);
        };
        sugestoesDiv.appendChild(div);
      });
      sugestoesDiv.classList.remove('hidden');
    } else {
      sugestoesDiv.classList.add('hidden');
    }
  }



      /**
       * Função para selecionar um produto e preencher os campos.
       */
  // Função para selecionar um produto
  function selecionarProduto(produto) {
    document.getElementById('buscaProduto').value = produto.descricao;
    document.getElementById('numeroSerie').value = produto.numeroSerie; // Sempre da coluna A
    document.getElementById('op').value = produto.op;
    document.getElementById('modelo').value = produto.modelo;
    document.getElementById('revenda').value = produto.revenda;
    document.getElementById('dataVenda').value = produto.dataVenda;

    // Limpar sugestões e campo de busca
    document.getElementById('sugestoes').innerHTML = '';
    document.getElementById('sugestoes').classList.add('hidden');

    // Verificar existência da OS após selecionar o produto
    verificarExistenciaOS();
  }

      /**
       * Função para buscar endereço pelo CEP
       */
      function buscarCEP() {
        var cep = document.getElementById('cep').value.replace(/\D/g, '');
        if (cep !== '') {
          var validacep = /^[0-9]{8}$/;
          if (validacep.test(cep)) {
            // Preenche os campos com "..." enquanto consulta a API
            document.getElementById('rua').value = '...';
            document.getElementById('bairro').value = '...';
            document.getElementById('cidade').value = '...';
            document.getElementById('estado').value = '...';

            // Consulta a API ViaCEP
            var script = document.createElement('script');
            script.src = 'https://viacep.com.br/ws/' + cep + '/json/?callback=callbackViaCEP';
            document.body.appendChild(script);
          } else {
            // Sem mensagens de alerta
          }
        }
      }

      /**
       * Callback para tratar a resposta da API ViaCEP
       */
      function callbackViaCEP(conteudo) {
        if (!('erro' in conteudo)) {
          // Atualiza os campos com os valores retornados
          document.getElementById('rua').value = conteudo.logradouro;
          document.getElementById('bairro').value = conteudo.bairro;
          document.getElementById('cidade').value = conteudo.localidade;
          document.getElementById('estado').value = conteudo.uf;
        } else {
          // CEP não encontrado
        }
      }



        function abrirPastaOS(event) {
    event.preventDefault(); // Previne o comportamento padrão do link

    var numeroSerie = document.getElementById('numeroSerie').value.trim();
    
    if (numeroSerie === "") {
      // Abrir a pasta padrão
      window.open('https://drive.google.com/drive/folders/1d5Fuvie1bFR7IXsKpp0nIgjKLUb5SEux', '_blank');
    } else {
      // Chamar a função do servidor para obter a URL da pasta específica
      google.script.run.withSuccessHandler(function(url) {
        if (url) {
          window.open(url, '_blank');
        } else {
          // Se a pasta não for encontrada, abrir a pasta padrão e alertar o usuário
          window.open('https://drive.google.com/drive/folders/1d5Fuvie1bFR7IXsKpp0nIgjKLUb5SEux', '_blank');
          alert('Pasta para a OS com N° SÉRIE "' + numeroSerie + '" não encontrada. Abrindo pasta padrão.');
        }
      }).getPastaURL(numeroSerie);
    }
  }




    </script> 
</head>
<body>
  <div class="container">
    <img src="https://live.staticflickr.com/65535/54023835743_932b0ec243_w.jpg" alt="Logo" class="logo">
    <h1>Solicitação de Assistência Técnica</h1>
        <form id="formulario">




<!-- Inicio de card principal -->
<div class="card">
    
        <!-- Fora do card central -->
        <label for="buscaProduto">Pesquisar numero de série:</label>

        <a href="#" onclick="abrirPastaOS(event)" class="abrir-pasta">Abrir pasta da OS</a>

        <input type="text" id="buscaProduto" name="buscaProduto" oninput="debouncedBuscarProdutos()" autocomplete="off">
        <div id="sugestoes" class="hidden"></div>
        <!-- Fora do card central -->
</div>
      DADOS DE VENDA
<div class="card">
      <!-- Inicio do card central content -->
      <div class="card-content">
        <div class="column"> <!-- Conluna a esquerda -->

            <label for="numeroSerie">N° SÉRIE:</label>
            <input type="text" id="numeroSerie" name="numeroSerie" readonly class="readonly">

            <label for="numeroOS">N° OS:</label>
            <input type="text" id="numeroOS" name="numeroOS" readonly class="readonly">

            <label for="op">O.P.:</label>
            <input type="text" id="op" name="op" readonly class="readonly">

        </div>

        <div class="column"> <!-- Conluna a direita -->

            <label for="modelo">MODELO:</label>
            <input type="text" id="modelo" name="modelo" readonly class="readonly">

            <label for="revenda">REVENDA:</label>
            <input type="text" id="revenda" name="revenda" readonly class="readonly">

            <label for="dataVenda">DATA DE VENDA:</label>
            <input type="text" id="dataVenda" name="dataVenda" readonly class="readonly">

            
        </div>
      </div>
</div>
        DADOS DE OS
<div class="card">

      <!-- Inicio desta Label q esta dentro do grid principal -->
      <label for="tipoAtendimento">Tipo de Atendimento:</label>
      <select id="tipoAtendimento" name="tipoAtendimento">
        <option value="" disabled selected>Selec. uma opção</option>
        <option value="QUALIDADE">QUALIDADE</option>
        <option value="COMERCIAL">COMERCIAL</option>
        <option value="EXTENSÃO GARANTIA">EXTENSÃO GARANTIA</option>
      </select>
      <!-- Fim desta Label q esta dentro do grid principal -->


      <!-- Inicio do card central content -->
    <div class="card-content"> <!-- Conluna a esquerda -->
      <div class="column">

        <label for="nomeCliente">Nome Revenda/Cliente:</label>
        <input type="text" id="nomeCliente" name="nomeCliente" >

        <label for="cpfCnpj">CPF/CNPJ:</label>
        <input type="text" id="cpfCnpj" name="cpfCnpj" >

        <label for="bairro">Bairro:</label>
        <input type="text" id="bairro" name="bairro" readonly>

        <label for="estado">Estado:</label>
        <input type="text" id="estado" name="estado" readonly>

      </div>

      <div class="column"> <!-- Conluna a direita -->

      <label for="telefone">Número de Telefone:</label>
      <input type="text" id="telefone" name="telefone">

      <label for="cep">CEP:</label>
      <input type="text" id="cep" name="cep" onblur="buscarCEP()">

      <label for="cidade">Cidade:</label>
      <input type="text" id="cidade" name="cidade" readonly>

      <label for="numeroCasa">Número:</label>
      <input type="text" id="numeroCasa" name="numeroCasa" >

      </div>

    </div>

    <div class="card-content"> <!-- Conluna a esquerda -->
      <!-- Inicio desta Label q esta dentro do grid principal -->
      <label for="rua">Rua:</label>
      <input type="text" id="rua" name="rua" readonly>

      <label for="agendarCom">Agendar Atendimento com:</label>
      <input type="text" id="agendarCom" name="agendarCom" >
      
      <label for="descricao">Descreva a Reclamação:</label>
      <textarea id="descricao" name="descricao" rows="6" placeholder="Digite aqui a descrição do problema"></textarea>
      <!-- Fim desta Label q esta dentro do grid principal -->
    </div>

</div>

        ENVIO DE PÇS
<div class="card">

    <button type="button" id="botaovipp" onclick="enviarDados()">Enviar PÇS</button>

</div>

        FECHAMENTO
<div class="card">

      <label for="status">Status:</label>
      <select id="status" name="status">
        <option value="" disabled selected>Selecione o status</option>
        <option value="Aberto">Aberto</option>
        <option value="Fechado">Fechado</option>
      </select>
      
<label for="problemaReal">Problema real:</label>
<input type="text" id="problemaReal" name="problemaReal" placeholder="Descreva o problema real">

<label for="causaRaiz">Causa raiz:</label>
<textarea id="causaRaiz" name="causaRaiz" rows="4" placeholder="Descreva a causa raiz"></textarea>

<label for="acaocorretiva">Ação corretiva:</label> <!-- Corrigido -->
<textarea id="acaocorretiva" name="acaocorretiva" rows="4" placeholder="Descreva a ação corretiva"></textarea>


<!-- Fim do card principal-->
</div>


      <button type="button" id="botaoEnviar">Enviar Solicitação</button>

      </form>

  </div>

</body>
</html>
