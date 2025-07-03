/*  src/zpl/templates.js  */
const layoutFTeFH = `^XA
^CF0,30
^FO50,40 ^FB600,1,0,C ^FD${'' /* SERIE */}^FS
^CF0,60
^FO50,100 ^FD${'' /* MODELO */}^FS
^FO50,200 ^FD${'' /* DATA */}^FS
^XZ`;

const layoutFTiBR = `^XA
^CF0,30
^FO50,40 ^FB600,1,0,C ^FD${'' /* SERIE */}^FS
^CF0,60
^FO50,100 ^FD${'' /* MODELO */}^FS
^FO50,240 ^FD${'' /* DATA */}^FS
^XZ`;

function gerarZPL_FTeFH (modelo, numeroSerie) {
  return layoutFTeFH
    .replace('${"" /* SERIE */}',  numeroSerie)
    .replace('${"" /* MODELO */}', modelo)
    .replace('${"" /* DATA */}',   '');
}

function gerarZPL_FTiBR (modelo, numeroSerie) {
  return layoutFTiBR
    .replace('${"" /* SERIE */}',  numeroSerie)
    .replace('${"" /* MODELO */}', modelo)
    .replace('${"" /* DATA */}',   '');
}

module.exports = { gerarZPL_FTeFH, gerarZPL_FTiBR };
