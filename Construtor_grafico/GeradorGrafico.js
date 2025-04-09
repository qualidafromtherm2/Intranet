// GeradorGrafico.js

let registros = [];
// Em vez de associar strings "3~380" etc., 
// definimos chaves y2..y6 => bool
let axisVisibility = {
  y2: true,
  y3: true,
  y4: true,
  y5: true,
  y6: true
};

let graph1EventListenerAttached = false;

// Arrays p/ y2..y6
let y2Positions=[], y2UserLabels={}, y2Texts=[];
let y3Positions=[], y3UserLabels={}, y3Texts=[];
let y4Positions=[], y4UserLabels={}, y4Texts=[];
let y5Positions=[], y5UserLabels={}, y5Texts=[];
let y6Positions=[], y6UserLabels={}, y6Texts=[];

// Gera array [min..max] c/ step
function makePositions(minVal, maxVal, step=0.5) {
  const arr=[];
  let v=minVal;
  while(v<=maxVal+1e-9){
    arr.push(parseFloat(v.toFixed(2)));
    v+=step;
  }
  return arr;
}

// Pega titulo do y2..y6 do DOM
function getAnnotations(){
  const a2 = document.getElementById("axis2_name")?.value || "y2";
  const a3 = document.getElementById("axis3_name")?.value || "y3";
  const a4 = document.getElementById("axis4_name")?.value || "y4";
  const a5 = document.getElementById("axis5_name")?.value || "y5";
  const a6 = document.getElementById("axis6_name")?.value || "y6";

  const gDiv = document.getElementById('graph1');
  const lay = gDiv?._fullLayout || {};
  // Posições fixas => y2=0.82, y3=0.86 etc
  let ann=[];
  if(axisVisibility.y2){
    ann.push({
      xref:'paper', yref:'paper',
      x:0.82, xanchor:'left',
      y:1.02, yanchor:'bottom',
      text:a2, showarrow:false,
      font:{color:'red'}
    });
  }
  if(axisVisibility.y3){
    ann.push({
      xref:'paper', yref:'paper',
      x:0.86, xanchor:'left',
      y:1.02, yanchor:'bottom',
      text:a3, showarrow:false,
      font:{color:'green'}
    });
  }
  if(axisVisibility.y4){
    ann.push({
      xref:'paper', yref:'paper',
      x:0.90, xanchor:'left',
      y:1.02, yanchor:'bottom',
      text:a4, showarrow:false,
      font:{color:'purple'}
    });
  }
  if(axisVisibility.y5){
    ann.push({
      xref:'paper', yref:'paper',
      x:0.95, xanchor:'left',
      y:1.02, yanchor:'bottom',
      text:a5, showarrow:false,
      font:{color:'orange'}
    });
  }
  if(axisVisibility.y6){
    ann.push({
      xref:'paper', yref:'paper',
      x:0.99, xanchor:'left',
      y:1.02, yanchor:'bottom',
      text:a6, showarrow:false,
      font:{color:'teal'}
    });
  }
  return ann;
}

function updateAxesFromControl(){
  axisVisibility.y2 = document.getElementById("chk_3_380")?.checked ?? false;
  axisVisibility.y3 = document.getElementById("chk_3_220")?.checked ?? false;
  axisVisibility.y4 = document.getElementById("chk_1_220v")?.checked ?? false;
  axisVisibility.y5 = document.getElementById("chk_y5")?.checked ?? false;
  axisVisibility.y6 = document.getElementById("chk_y6")?.checked ?? false;
  updateAxisPositions();
}

// Atribuímos posições fixas => y2=0.82, y3=0.86, y4=0.90, y5=0.94, y6=0.98
function updateAxisPositions(){
  const graphDiv=document.getElementById('graph1');
  // criamos um objeto com updates:
  let upd={
    'yaxis2.visible': axisVisibility.y2,
    'yaxis2.position': 0.80,

    'yaxis3.visible': axisVisibility.y3,
    'yaxis3.position': 0.85,

    'yaxis4.visible': axisVisibility.y4,
    'yaxis4.position': 0.90,

    'yaxis5.visible': axisVisibility.y5,
    'yaxis5.position': 0.95,

    'yaxis6.visible': axisVisibility.y6,
    'yaxis6.position': 0.99
  };
  Plotly.relayout(graphDiv, upd);

  let ann = getAnnotations();
  Plotly.relayout(graphDiv, {annotations:ann});
}

// Recalculo pos + texts
function recalcY2(minVal, maxVal){
  y2Positions=makePositions(minVal, maxVal,0.5);
  y2Texts=y2Positions.map(p=>{
    let k=p.toFixed(2);
    return y2UserLabels[k]||k;
  });
}
function recalcY3(minVal, maxVal){
  y3Positions=makePositions(minVal, maxVal,0.5);
  y3Texts=y3Positions.map(p=>{
    let k=p.toFixed(2);
    return y3UserLabels[k]||k;
  });
}
function recalcY4(minVal, maxVal){
  y4Positions=makePositions(minVal, maxVal,0.5);
  y4Texts=y4Positions.map(p=>{
    let k=p.toFixed(2);
    return y4UserLabels[k]||k;
  });
}
function recalcY5(minVal, maxVal){
  // step=1
  y5Positions=[];
  let v=minVal;
  while(v<=maxVal+1e-9){
    y5Positions.push(parseFloat(v.toFixed(2)));
    v+=1;
  }
  y5Texts=y5Positions.map(p=>{
    let k=p.toFixed(2);
    return y5UserLabels[k]||k;
  });
}
function recalcY6(minVal, maxVal){
  // step=5
  y6Positions=[];
  let v=minVal;
  let step=5;
  while(v<=maxVal+1e-9){
    y6Positions.push(parseFloat(v.toFixed(2)));
    v+=step;
  }
  y6Texts=y6Positions.map(p=>{
    let k=p.toFixed(2);
    return y6UserLabels[k]||k;
  });
}

function gerarGrafico(){
  // le inputs
  const graphTitle=document.getElementById("graph_title")?.value||"Nome do grafico";
  const y1Title=document.getElementById("y1_title")?.value||"Nome do eixo y1";
  const xTitle=document.getElementById("x_title")?.value||"Nome do eixo x";

  const pressao_inicial=parseFloat(document.getElementById("pressao_inicial").value);
  const pressao_final= parseFloat(document.getElementById("pressao_final").value);
  const pressao_tick= parseFloat(document.getElementById("pressao_tick").value);

  const temp_min=parseFloat(document.getElementById("agua_temp_min").value);
  const temp_max=parseFloat(document.getElementById("agua_temp_max").value);
  const agua_tick_y=parseFloat(document.getElementById("agua_tick_y").value);

  const tri380_min=parseFloat(document.getElementById("tri380_min").value);
  const tri380_max=parseFloat(document.getElementById("tri380_max").value);
  const tri220_min=parseFloat(document.getElementById("tri220_min").value);
  const tri220_max=parseFloat(document.getElementById("tri220_max").value);
  const tri300_min=parseFloat(document.getElementById("tri300_min").value);
  const tri300_max=parseFloat(document.getElementById("tri300_max").value);

  const y5_min=parseFloat(document.getElementById("y5_min").value);
  const y5_max=parseFloat(document.getElementById("y5_max").value);

  const y6_min=parseFloat(document.getElementById("y6_min").value);
  const y6_max=parseFloat(document.getElementById("y6_max").value);

  // recalc pos
  recalcY2(tri380_min, tri380_max);
  recalcY3(tri220_min, tri220_max);
  recalcY4(tri300_min, tri300_max);
  recalcY5(y5_min, y5_max);
  recalcY6(y6_min, y6_max);

  // data => dummy y2..y6
  let xBase=[], yTempBase=[];
  const numPoints=13;
  for(let i=0;i<numPoints;i++){
    let xp=pressao_inicial + i*(pressao_final-pressao_inicial)/(numPoints-1);
    let tp=temp_min + i*(temp_max-temp_min)/(numPoints-1);
    xBase.push(xp);
    yTempBase.push(tp);
  }

  let data=[
    // y1
    {
      x:xBase, 
      y:yTempBase,
      mode:'lines',
      name:'água (y1)',
      line:{color:'blue'},
      yaxis:'y',
      showlegend:false
    },
    // y2 dummy
    {x:[NaN], y:[NaN], yaxis:'y2', type:'scatter', mode:'lines', line:{width:0}, marker:{opacity:0}, showlegend:false, hoverinfo:'none'},
    // y3
    {x:[NaN], y:[NaN], yaxis:'y3', type:'scatter', mode:'lines', line:{width:0}, marker:{opacity:0}, showlegend:false, hoverinfo:'none'},
    // y4
    {x:[NaN], y:[NaN], yaxis:'y4', type:'scatter', mode:'lines', line:{width:0}, marker:{opacity:0}, showlegend:false, hoverinfo:'none'},
    // y5
    {x:[NaN], y:[NaN], yaxis:'y5', type:'scatter', mode:'lines', line:{width:0}, marker:{opacity:0}, showlegend:false, hoverinfo:'none'},
    // y6
    {x:[NaN], y:[NaN], yaxis:'y6', type:'scatter', mode:'lines', line:{width:0}, marker:{opacity:0}, showlegend:false, hoverinfo:'none'},
  ];

  // Marcadores no y1
  registros.forEach((reg, idx)=>{
    data.push({
      x:[reg.pressao],
      y:[reg.temp],
      mode:'markers+text',
      text:[`Temp: ${reg.temp}°C\nVal: ${reg.tri_valor}`],
      textposition:'top center',
      marker:{color:'blue', size:10},
      name:`Reg${idx+1}-Água`,
      yaxis:'y',
      showlegend:false
    });
  });

  const layout={
    paper_bgcolor:'#fff',
    plot_bgcolor:'#fff',
    margin:{l:50,r:60,t:50,b:50},
    title:graphTitle,
    showlegend:false,
    xaxis:{
      domain:[0,0.8],
      range:[pressao_inicial, pressao_final],
      dtick:pressao_tick,
      title:xTitle,
      showgrid:true,
      gridcolor:'#ccc',
      showline:true,
      linecolor:'black',
      linewidth:2
    },
    yaxis:{
      range:[temp_min, temp_max],
      dtick:agua_tick_y,
      title:y1Title,
      showgrid:true,
      gridcolor:'#ccc',
      showline:true,
      linecolor:'black',
      linewidth:2
    },
    // Eixo y2 => fix pos=0.82 => set no updateAxisPositions
    yaxis2:{
      type:'linear',
      range:[tri380_min, tri380_max],
      tickmode:'array',
      tickvals:y2Positions,
      ticktext:y2Texts,
      overlaying:'y',
      side:'right',
      anchor:'free',
      visible:true, // definimos como true, mas updateAxisPositions ajusta
      showline:true,
      linecolor:'red',
      linewidth:2,
      showgrid:false,
      ticks:'outside',
      ticklen:8,
      tickwidth:2
    },
    // y3 => fix pos=0.86
    yaxis3:{
      type:'linear',
      range:[tri220_min, tri220_max],
      tickmode:'array',
      tickvals:y3Positions,
      ticktext:y3Texts,
      overlaying:'y',
      side:'right',
      anchor:'free',
      visible:true,
      showline:true,
      linecolor:'green',
      linewidth:2,
      showgrid:false,
      ticks:'outside',
      ticklen:8,
      tickwidth:2
    },
    // y4 => pos=0.90
    yaxis4:{
      type:'linear',
      range:[tri300_min, tri300_max],
      tickmode:'array',
      tickvals:y4Positions,
      ticktext:y4Texts,
      overlaying:'y',
      side:'right',
      anchor:'free',
      visible:true,
      showline:true,
      linecolor:'purple',
      linewidth:2,
      showgrid:false,
      ticks:'outside',
      ticklen:8,
      tickwidth:2
    },
    // y5 => pos=0.94
    yaxis5:{
      type:'linear',
      range:[y5_min,y5_max],
      tickmode:'array',
      tickvals:y5Positions,
      ticktext:y5Texts,
      overlaying:'y',
      side:'right',
      anchor:'free',
      visible:true,
      showline:true,
      linecolor:'orange',
      linewidth:2,
      showgrid:false,
      ticks:'outside',
      ticklen:8,
      tickwidth:2
    },
    // y6 => pos=0.98
    yaxis6:{
      type:'linear',
      range:[y6_min,y6_max],
      tickmode:'array',
      tickvals:y6Positions,
      ticktext:y6Texts,
      overlaying:'y',
      side:'right',
      anchor:'free',
      visible:true,
      showline:true,
      linecolor:'teal',
      linewidth:2,
      showgrid:false,
      ticks:'outside',
      ticklen:8,
      tickwidth:2
    },
    annotations:[]
  };

  Plotly.newPlot('graph1', data, layout).then(()=>{
    // Chamamos updateAxisPositions para forçar (in)visibilidade e pos fixas
    updateAxisPositions();
  });

  if(!graph1EventListenerAttached){
    const gDiv=document.getElementById('graph1');
    gDiv.on('plotly_legendclick', ev=>{/* ignorado showlegend:false */});
    graph1EventListenerAttached=true;
  }
}

// init => +painéis y2..y6
function init(){
  document.getElementById('toggleRegistro')?.addEventListener('click', ()=>{
    const f=document.getElementById('registroForm');
    f.style.display=(f.style.display==='none')?'block':'none';
  });
  document.getElementById('enviarRegistro')?.addEventListener('click', ()=>{
    const temp = parseFloat(document.getElementById("temp").value);
    const pressao = parseFloat(document.getElementById("pressao").value);
    const modelo = document.getElementById("modelo").value;
    const tri_valor = parseFloat(document.getElementById("tri_valor").value);
    registros.push({temp, pressao, modelo, tri_valor});
    alert("Registro adicionado!");
    document.getElementById("registroForm").style.display='none';
    gerarGrafico();
  });

  initY2Panel();
  initY3Panel();
  initY4Panel();
  initY5Panel();
  initY6Panel();

  gerarGrafico();
}

// y2 => invert + oninput => gerarGrafico
function initY2Panel(){
  const btn=document.getElementById('btnY2Ticks');
  const panel=document.getElementById('panelY2');
  btn.textContent='+';
  btn.addEventListener('click',()=>{
    if(panel.style.display==='none'){
      panel.style.display='block';
      btn.textContent='-';
      renderY2Texts();
    } else {
      panel.style.display='none';
      btn.textContent='+';
    }
  });
}
function renderY2Texts(){
  const container=document.getElementById('y2TicksContainer');
  container.innerHTML='';
  for(let i=y2Positions.length-1;i>=0;i--){
    const pos=y2Positions[i];
    let row=document.createElement('div');
    row.style.marginBottom='4px';
    let lb=document.createElement('span');
    lb.textContent=`Pos ${pos}: `;
    lb.style.marginRight='4px';
    row.appendChild(lb);

    let inp=document.createElement('input');
    inp.type='text';
    inp.value=y2Texts[i];
    inp.oninput= e=>{
      y2UserLabels[pos.toFixed(2)] = e.target.value;
      y2Texts[i] = e.target.value;
      gerarGrafico();
    };
    row.appendChild(inp);
    container.appendChild(row);
  }
}

// y3
function initY3Panel(){
  const btn=document.getElementById('btnY3Ticks');
  const panel=document.getElementById('panelY3');
  btn.textContent='+';
  btn.addEventListener('click',()=>{
    if(panel.style.display==='none'){
      panel.style.display='block';
      btn.textContent='-';
      renderY3Texts();
    } else {
      panel.style.display='none';
      btn.textContent='+';
    }
  });
}
function renderY3Texts(){
  const container=document.getElementById('y3TicksContainer');
  container.innerHTML='';
  for(let i=y3Positions.length-1;i>=0;i--){
    const pos=y3Positions[i];
    let row=document.createElement('div');
    row.style.marginBottom='4px';
    let lb=document.createElement('span');
    lb.textContent=`Pos ${pos}: `;
    lb.style.marginRight='4px';
    row.appendChild(lb);

    let inp=document.createElement('input');
    inp.type='text';
    inp.value=y3Texts[i];
    inp.oninput=e=>{
      y3UserLabels[pos.toFixed(2)] = e.target.value;
      y3Texts[i] = e.target.value;
      gerarGrafico();
    };
    row.appendChild(inp);
    container.appendChild(row);
  }
}

// y4
function initY4Panel(){
  const btn=document.getElementById('btnY4Ticks');
  const panel=document.getElementById('panelY4');
  btn.textContent='+';
  btn.addEventListener('click',()=>{
    if(panel.style.display==='none'){
      panel.style.display='block';
      btn.textContent='-';
      renderY4Texts();
    } else {
      panel.style.display='none';
      btn.textContent='+';
    }
  });
}
function renderY4Texts(){
  const container=document.getElementById('y4TicksContainer');
  container.innerHTML='';
  for(let i=y4Positions.length-1;i>=0;i--){
    const pos=y4Positions[i];
    let row=document.createElement('div');
    row.style.marginBottom='4px';
    let lb=document.createElement('span');
    lb.textContent=`Pos ${pos}: `;
    lb.style.marginRight='4px';
    row.appendChild(lb);

    let inp=document.createElement('input');
    inp.type='text';
    inp.value=y4Texts[i];
    inp.oninput=e=>{
      y4UserLabels[pos.toFixed(2)] = e.target.value;
      y4Texts[i] = e.target.value;
      gerarGrafico();
    };
    row.appendChild(inp);
    container.appendChild(row);
  }
}

// y5
function initY5Panel(){
  const btn=document.getElementById('btnY5Ticks');
  const panel=document.getElementById('panelY5');
  btn.textContent='+';
  btn.addEventListener('click',()=>{
    if(panel.style.display==='none'){
      panel.style.display='block';
      btn.textContent='-';
      renderY5Texts();
    } else {
      panel.style.display='none';
      btn.textContent='+';
    }
  });
}
function renderY5Texts(){
  const container=document.getElementById('y5TicksContainer');
  container.innerHTML='';
  for(let i=y5Positions.length-1;i>=0;i--){
    const pos=y5Positions[i];
    let row=document.createElement('div');
    row.style.marginBottom='4px';
    let lb=document.createElement('span');
    lb.textContent=`Pos ${pos}: `;
    lb.style.marginRight='4px';
    row.appendChild(lb);

    let inp=document.createElement('input');
    inp.type='text';
    inp.value=y5Texts[i];
    inp.oninput=e=>{
      y5UserLabels[pos.toFixed(2)] = e.target.value;
      y5Texts[i] = e.target.value;
      gerarGrafico();
    };
    row.appendChild(inp);
    container.appendChild(row);
  }
}

// y6
function initY6Panel(){
  const btn=document.getElementById('btnY6Ticks');
  const panel=document.getElementById('panelY6');
  btn.textContent='+';
  btn.addEventListener('click',()=>{
    if(panel.style.display==='none'){
      panel.style.display='block';
      btn.textContent='-';
      renderY6Texts();
    } else {
      panel.style.display='none';
      btn.textContent='+';
    }
  });
}
function renderY6Texts(){
  const container=document.getElementById('y6TicksContainer');
  container.innerHTML='';
  for(let i=y6Positions.length-1;i>=0;i--){
    const pos=y6Positions[i];
    let row=document.createElement('div');
    row.style.marginBottom='4px';
    let lb=document.createElement('span');
    lb.textContent=`Pos ${pos}: `;
    lb.style.marginRight='4px';
    row.appendChild(lb);

    let inp=document.createElement('input');
    inp.type='text';
    inp.value=y6Texts[i];
    inp.oninput=e=>{
      y6UserLabels[pos.toFixed(2)] = e.target.value;
      y6Texts[i] = e.target.value;
      gerarGrafico();
    };
    row.appendChild(inp);
    container.appendChild(row);
  }
}

document.addEventListener('DOMContentLoaded', init);
