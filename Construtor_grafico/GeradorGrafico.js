// GeradorGrafico.js

// Array para armazenar os registros (equivalente ao st.session_state["registros"])
let registros = [];

// Variável global para controlar a visibilidade dos eixos secundários
let axisVisibility = {
  '3~380': true,
  '3~220': true,
  '1~220v': true
};

// Flag para garantir que o listener do gráfico seja adicionado apenas uma vez
let graph1EventListenerAttached = false;

/**
 * Lê o estado dos checkboxes para os eixos e atualiza a variável axisVisibility.
 */
function updateAxesFromControl() {
  axisVisibility['3~380'] = document.getElementById("chk_3_380")?.checked || false;
  axisVisibility['3~220'] = document.getElementById("chk_3_220")?.checked || false;
  axisVisibility['1~220v'] = document.getElementById("chk_1_220v")?.checked || false;
  updateAxisPositions();
}

/**
 * Atualiza a posição dos eixos secundários (yaxis2, yaxis3 e yaxis4) de modo que o primeiro eixo visível fique na posição 0.80, o segundo em 0.85 e o terceiro em 0.90.
 */
function updateAxisPositions() {
  // Verifica quais eixos estão visíveis, na ordem fixa: 3~380, 3~220, 1~220v
  let visibleAxes = [];
  if (axisVisibility['3~380']) visibleAxes.push('3~380');
  if (axisVisibility['3~220']) visibleAxes.push('3~220');
  if (axisVisibility['1~220v']) visibleAxes.push('1~220v');

  // Define as posições com base na quantidade de eixos visíveis
  let count = visibleAxes.length;
  let positions = [];
  if (count === 3) {
    positions = [0.80, 0.90, 0.99];
  } else if (count === 2) {
    positions = [0.80, 0.90];
  } else if (count === 1) {
    positions = [0.80];
  }

  let updateObj = {};
  let index = 0;

  // Atualiza yaxis2 (primeiro eixo secundário, originalmente 3~380)
  if (axisVisibility['3~380']) {
    updateObj['yaxis2.visible'] = true;
    updateObj['yaxis2.position'] = positions[index++];
  } else {
    updateObj['yaxis2.visible'] = false;
  }

  // Atualiza yaxis3 (segundo eixo, originalmente 3~220)
  if (axisVisibility['3~220']) {
    updateObj['yaxis3.visible'] = true;
    updateObj['yaxis3.position'] = positions[index++];
  } else {
    updateObj['yaxis3.visible'] = false;
  }

  // Atualiza yaxis4 (terceiro eixo, originalmente 1~220v)
  if (axisVisibility['1~220v']) {
    updateObj['yaxis4.visible'] = true;
    updateObj['yaxis4.position'] = positions[index++];
  } else {
    updateObj['yaxis4.visible'] = false;
  }

  const graphDiv = document.getElementById('graph1');
  Plotly.relayout(graphDiv, updateObj);
}

/**
 * Atualiza os rótulos dos inputs na coluna "Corrente" (para os ranges dos eixos) com base
 * nos valores dos campos de edição dos nomes dos eixos secundários.
 */
function updateCorrenteLabels() {
  // Se os elementos não existirem, não faz nada
  const labelTri380 = document.getElementById("label_tri380");
  const labelTri220 = document.getElementById("label_tri220");
  const labelTri300 = document.getElementById("label_tri300");

  const axis2Title = document.getElementById("axis2_name")?.value || "3~380";
  const axis3Title = document.getElementById("axis3_name")?.value || "3~220";
  const axis4Title = document.getElementById("axis4_name")?.value || "1~220v";

  if (labelTri380) labelTri380.innerText = axis2Title;
  if (labelTri220) labelTri220.innerText = axis3Title;
  if (labelTri300) labelTri300.innerText = axis4Title;
}

/**
 * Gera o gráfico único com 4 eixos (y, y2, y3, y4).
 * Os rótulos do gráfico, do eixo X e Y1, e dos eixos secundários são lidos de campos de entrada.
 */
function gerarGrafico() {
  // Lê os rótulos dinâmicos; se os campos não existirem, usa valores padrão.
  const graphTitle = document.getElementById("graph_title")?.value || "Nome do grafico";
  const y1Title = document.getElementById("y1_title")?.value || "Nome do eixo y1";
  const xTitle = document.getElementById("x_title")?.value || "Nome do eixo x";

  // Para os eixos secundários, os títulos são lidos dos campos de entrada
  const axis2Title = document.getElementById("axis2_name")?.value || "3~380";
  const axis3Title = document.getElementById("axis3_name")?.value || "3~220";
  const axis4Title = document.getElementById("axis4_name")?.value || "1~220v";

  const pressao_inicial = parseFloat(document.getElementById("pressao_inicial").value);
  const pressao_final = parseFloat(document.getElementById("pressao_final").value);
  const pressao_tick = parseFloat(document.getElementById("pressao_tick").value);

  const temp_min = parseFloat(document.getElementById("agua_temp_min").value);
  const temp_max = parseFloat(document.getElementById("agua_temp_max").value);
  const agua_tick_y = parseFloat(document.getElementById("agua_tick_y").value);

  const tri380_min = parseFloat(document.getElementById("tri380_min").value);
  const tri380_max = parseFloat(document.getElementById("tri380_max").value);

  const tri220_min = parseFloat(document.getElementById("tri220_min").value);
  const tri220_max = parseFloat(document.getElementById("tri220_max").value);

  const tri300_min = parseFloat(document.getElementById("tri300_min").value);
  const tri300_max = parseFloat(document.getElementById("tri300_max").value);

  // Gera 13 pontos igualmente espaçados
  const numPoints = 13;
  let xBase = [], yTempBase = [], y380Base = [], y220Base = [], y300Base = [];
  for (let i = 0; i < numPoints; i++) {
    let p = pressao_inicial + i * (pressao_final - pressao_inicial) / (numPoints - 1);
    let t = temp_min + i * (temp_max - temp_min) / (numPoints - 1);
    xBase.push(p);
    yTempBase.push(t);
    y380Base.push(tri380_min + i * (tri380_max - tri380_min) / (numPoints - 1));
    y220Base.push(tri220_min + i * (tri220_max - tri220_min) / (numPoints - 1));
    y300Base.push(tri300_min + i * (tri300_max - tri300_min) / (numPoints - 1));
  }

  const data = [
    {
      x: xBase,
      y: yTempBase,
      mode: 'lines',
      name: 'água °c',
      line: { color: 'blue' },
      yaxis: 'y'
    },
    {
      x: xBase,
      y: y380Base,
      mode: 'lines',
      name: axis2Title,
      line: { color: 'red' },
      yaxis: 'y2'
    },
    {
      x: xBase,
      y: y220Base,
      mode: 'lines',
      name: axis3Title,
      line: { color: 'green' },
      yaxis: 'y3'
    },
    {
      x: xBase,
      y: y300Base,
      mode: 'lines',
      name: axis4Title,
      line: { color: 'purple' },
      yaxis: 'y4'
    }
  ];

  registros.forEach((reg, idx) => {
    data.push({
      x: [reg.pressao],
      y: [reg.temp],
      mode: 'markers+text',
      text: [`Temp: ${reg.temp}°C\nVal: ${reg.tri_valor}`],
      textposition: 'top center',
      marker: { color: 'blue', size: 10 },
      name: `Reg${idx + 1} - Água`,
      yaxis: 'y'
    });
    let color = 'red', axis = 'y2';
    if (reg.modelo === '3~220') { color = 'green'; axis = 'y3'; }
    if (reg.modelo === '1~220v') { color = 'purple'; axis = 'y4'; }
    data.push({
      x: [reg.pressao],
      y: [reg.tri_valor],
      mode: 'markers+text',
      text: [`${reg.modelo}: ${reg.tri_valor}`],
      textposition: 'bottom center',
      marker: { color: color, size: 10 },
      name: `Reg${idx + 1} - ${reg.modelo}`,
      yaxis: axis
    });
  });

  const layout = {
    paper_bgcolor: '#fff',
    plot_bgcolor: '#fff',
    margin: { l: 50, r: 50, t: 50, b: 50 },
    title: graphTitle,
    showlegend: false, // Remove a legenda nativa
    xaxis: {
      domain: [0, 0.8],
      range: [pressao_inicial, pressao_final],
      dtick: pressao_tick,
      title: xTitle,
      showgrid: true,
      gridcolor: '#ccc',
      showline: true,
      linecolor: 'black',
      linewidth: 2,
      ticks: 'outside',
      mirror: false
    },
    yaxis: {
      range: [temp_min, temp_max],
      dtick: agua_tick_y,
      title: y1Title,
      showgrid: true,
      gridcolor: '#ccc',
      showline: true,
      linecolor: 'black',
      linewidth: 2,
      ticks: 'outside',
      mirror: false
    },
    yaxis2: {
      range: [tri380_min, tri380_max],
      dtick: 0.5,
      showgrid: false,
      showline: true,
      linecolor: 'red',
      linewidth: 2,
      ticks: 'outside',
      mirror: false,
      overlaying: 'y',
      side: 'right',
      anchor: 'free',
      position: 0.79, // valor base; updateAxisPositions ajustará
      visible: axisVisibility['3~380'],
      title: axis2Title
    },
    yaxis3: {
      range: [tri220_min, tri220_max],
      dtick: 0.5,
      showgrid: false,
      showline: true,
      linecolor: 'green',
      linewidth: 2,
      ticks: 'outside',
      mirror: false,
      overlaying: 'y',
      side: 'right',
      anchor: 'free',
      position: 0.90, // valor base; updateAxisPositions ajustará
      visible: axisVisibility['3~220'],
      title: axis3Title
    },
    yaxis4: {
      range: [tri300_min, tri300_max],
      dtick: 0.5,
      showgrid: false,
      showline: true,
      linecolor: 'purple',
      linewidth: 2,
      ticks: 'outside',
      mirror: false,
      overlaying: 'y',
      side: 'right',
      anchor: 'free',
      position: 0.99, // valor base; updateAxisPositions ajustará
      visible: axisVisibility['1~220v'],
      title: axis4Title
    }
  };

  Plotly.newPlot('graph1', data, layout);
  updateAxisPositions();
  updateCorrenteLabels();

  if (!graph1EventListenerAttached) {
    const graphDiv = document.getElementById('graph1');
    graphDiv.on('plotly_legendclick', function(eventData) {
      const traceName = eventData.data[eventData.curveNumber].name;
      if (traceName.includes('3~380')) {
        axisVisibility['3~380'] = !axisVisibility['3~380'];
      } else if (traceName.includes('3~220')) {
        axisVisibility['3~220'] = !axisVisibility['3~220'];
      } else if (traceName.includes('1~220v')) {
        axisVisibility['1~220v'] = !axisVisibility['1~220v'];
      } else {
        return;
      }
      updateAxisPositions();
    });
    graph1EventListenerAttached = true;
  }
}

function init() {
  document.getElementById("toggleRegistro").addEventListener("click", () => {
    const form = document.getElementById("registroForm");
    form.style.display = (form.style.display === "none") ? "block" : "none";
  });

  document.getElementById("enviarRegistro").addEventListener("click", () => {
    const temp = parseFloat(document.getElementById("temp").value);
    const pressao = parseFloat(document.getElementById("pressao").value);
    const modelo = document.getElementById("modelo").value;
    const tri_valor = parseFloat(document.getElementById("tri_valor").value);
    registros.push({ temp, pressao, modelo, tri_valor });
    alert("Registro adicionado!");
    document.getElementById("registroForm").style.display = "none";
    gerarGrafico();
  });

  gerarGrafico();
}

document.addEventListener("DOMContentLoaded", init);
