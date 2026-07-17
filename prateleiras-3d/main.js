/**
 * Porta-pallet 3D — cena isolada (Three.js).
 * Visual inspirado em img/armazem3d_side.png e img/estante_aisle.png
 * Pasta inteira removível sem afetar o restante da intranet.
 */
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

let canvas = document.getElementById('c');
const blocker = document.getElementById('blocker');
const btnEnter = document.getElementById('btnEnter');
const hud = document.getElementById('hud');
const webglError = document.getElementById('webglError');

const isEmbed = new URLSearchParams(location.search).has('embed');
if (isEmbed) {
  document.body.classList.add('is-embed');
  const back = document.getElementById('backLinkWrap');
  if (back) back.hidden = true;
  const openTab = document.getElementById('btnOpenNewTab');
  if (openTab) openTab.hidden = false;
}

function showWebglError(detail) {
  const embedHint = isEmbed
    ? '\n\nDica: use também "Abrir em nova aba" depois de abrir o Chrome pelo atalho WebGL.'
    : '';
  const msg = (
    'WebGL não iniciou neste Chrome.\n\n' +
    'Neste PC (AMD + placa extra), só ligar "Aceleração de hardware" no menu NÃO basta.\n\n' +
    'Faça assim:\n' +
    '1) Feche TODAS as janelas do Chrome\n' +
    '2) No terminal, rode:\n' +
    '   ./prateleiras-3d/abrir-com-gpu.sh\n' +
    '   (ou: ~/.local/bin/google-chrome-webgl)\n' +
    '3) Na janela que abrir → Explorar 3D → Entrar\n\n' +
    'URL: ' + window.location.href +
    embedHint +
    (detail ? '\n\nDetalhe: ' + detail : '')
  );
  webglError.hidden = false;
  webglError.textContent = msg;
  btnEnter.disabled = false;
  btnEnter.textContent = 'Tentar iniciar 3D';
  const openTab = document.getElementById('btnOpenNewTab');
  if (openTab) openTab.hidden = false;
  const gpuHelp = document.getElementById('gpuHelp');
  if (gpuHelp) gpuHelp.hidden = false;
  if (!document.getElementById('btnRetryWebgl')) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.id = 'btnRetryWebgl';
    retry.className = 'btn';
    retry.style.marginTop = '10px';
    retry.textContent = 'Já abri pelo atalho WebGL — tentar de novo';
    retry.addEventListener('click', () => {
      const u = new URL(window.location.href);
      u.searchParams.set('_', String(Date.now()));
      window.location.replace(u.toString());
    });
    webglError.insertAdjacentElement('afterend', retry);
  }
}

function disposeRenderer(r) {
  if (!r) return;
  try {
    r.dispose();
    const gl = r.getContext();
    if (gl && gl.getExtension('WEBGL_lose_context')) {
      gl.getExtension('WEBGL_lose_context').loseContext();
    }
  } catch (_) { /* ignore */ }
}

/**
 * Um canvas só aceita UM tipo de contexto na vida (webgl OU webgl2).
 * Se a 1ª tentativa cria webgl2 e falha depois, o mesmo canvas nunca mais
 * devolve webgl — era isso que quebrava tudo ("webgl2 indisponível").
 * Solução: cada tentativa usa um canvas NOVO e o coloca no lugar do antigo.
 */
function freshCanvas() {
  const nc = document.createElement('canvas');
  nc.id = canvas.id;
  canvas.replaceWith(nc);
  canvas = nc;
  return nc;
}

function createRenderer() {
  const glOpts = {
    antialias: false,
    alpha: false,
    depth: true,
    stencil: false,
    failIfMajorPerformanceCaveat: false,
    powerPreference: 'low-power',
    preserveDrawingBuffer: false,
  };
  const attempts = [
    (c) => {
      const gl = c.getContext('webgl', glOpts);
      if (!gl) throw new Error('webgl indisponível');
      return new THREE.WebGLRenderer({ canvas: c, context: gl, antialias: false, alpha: false });
    },
    (c) => {
      const gl = c.getContext('webgl2', glOpts);
      if (!gl) throw new Error('webgl2 indisponível');
      return new THREE.WebGLRenderer({ canvas: c, context: gl, antialias: false, alpha: false });
    },
    (c) => {
      const gl = c.getContext('experimental-webgl', glOpts);
      if (!gl) throw new Error('experimental-webgl indisponível');
      return new THREE.WebGLRenderer({ canvas: c, context: gl, antialias: false, alpha: false });
    },
    (c) => new THREE.WebGLRenderer({ canvas: c, ...glOpts }),
  ];
  let lastErr = null;
  for (const fn of attempts) {
    try {
      return fn(freshCanvas());
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Error creating WebGL context.');
}

function probeWebGL() {
  // Canvas separado para cada tipo — um canvas só aceita um tipo de contexto.
  const c1 = document.createElement('canvas');
  if (c1.getContext('webgl', { failIfMajorPerformanceCaveat: false })) return true;
  const c2 = document.createElement('canvas');
  return !!c2.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
}

const PLAYER = {
  radius: 0.32,
  speed: 4.5,
  vSpeed: 3.8,
  eye: 1.65,
  eyeMin: 0.45,
};

/** Barracão — área reduzida para não derrubar WebGL no PC. */
const HALL_SIZE_MUL = 1.25;
const HALL_HEIGHT_MUL = 1.2;

/** Layout igual ao Armazém 3D (foto + grid). */
const BAYS = 10;   // colunas / edifícios ao longo do corredor
const LEVELS = 6;  // níveis (ROWS no arm3d)
const BAY_W = 1.15;
const BAY_D = 1.05;
const LEVEL_H = 0.95;
const POST_W = 0.07;
const BEAM_H = 0.06;
const BEAM_D = 0.07;
const RACK_H = LEVELS * LEVEL_H + 0.35;
const RACK_LEN = BAYS * BAY_W;
const AISLE_W = 2.6;

const ORANGE = 0xf97316;
const WOOD_DARK = 0x8b6914;
const FLOOR_COL = 0xd0d5dc;
const WALL_COL = 0xf4f6f8;
const CEIL_COL = 0xffffff;

const colliders = [];
const keys = Object.create(null);

let appRenderer = null;
let sceneBooted = false;
let enterPlayFn = null;

function tryBootScene() {
  if (sceneBooted) return true;
  try {
    if (appRenderer) disposeRenderer(appRenderer);
    appRenderer = createRenderer();
    boot(appRenderer);
    sceneBooted = true;
    webglError.hidden = true;
    return true;
  } catch (err) {
    console.error(err);
    sceneBooted = false;
    appRenderer = null;
    showWebglError(err && err.message ? err.message : String(err));
    return false;
  }
}

btnEnter.addEventListener('click', () => {
  if (!sceneBooted && !tryBootScene()) return;
  enterPlayFn?.();
});

// Depois de uma recuperação automática (reload), já deixa a cena pronta
if (sessionStorage.getItem('p3d_auto_boot') === '1') {
  sessionStorage.removeItem('p3d_auto_boot');
  setTimeout(() => tryBootScene(), 50);
}

const btnOpenNewTab = document.getElementById('btnOpenNewTab');
if (btnOpenNewTab) {
  btnOpenNewTab.addEventListener('click', () => {
    const u = new URL('/prateleiras-3d/', window.location.origin);
    window.open(u.toString(), '_blank', 'noopener');
  });
}

if (!probeWebGL()) {
  const hint = document.querySelector('.hint');
  if (hint) {
    hint.innerHTML = 'Aceleração no menu já está ligada? Neste PC ainda precisa abrir o Chrome pelo <strong>atalho WebGL</strong> (veja abaixo).';
    hint.style.color = '#fbbf24';
  }
  const gpuHelp = document.getElementById('gpuHelp');
  if (gpuHelp) gpuHelp.hidden = false;
}

function boot(renderer) {
  // pixelRatio 1 = bem mais leve (evita Chrome bloquear WebGL neste PC)
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // ——— Recuperação automática de perda de contexto WebGL ———
  // preventDefault() diz ao Chrome "eu cuido disso": ele tenta restaurar o
  // contexto em vez de contar a queda contra o site (que é o que leva o
  // Chrome a desligar o WebGL do navegador inteiro).
  let ctxLost = false;
  let ctxReloadTimer = null;

  function recoveryOverlay(show) {
    let el = document.getElementById('ctxRecovering');
    if (!el && show) {
      el = document.createElement('div');
      el.id = 'ctxRecovering';
      el.style.cssText =
        'position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;' +
        'background:rgba(10,12,16,.88);color:#e6edf3;font:600 18px ui-sans-serif,system-ui,sans-serif;';
      el.textContent = 'Recuperando o 3D… aguarde';
      document.body.appendChild(el);
    }
    if (el) el.style.display = show ? 'flex' : 'none';
  }

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    ctxLost = true;
    recoveryOverlay(true);
    // Se o Chrome não devolver o contexto em 6s, recarrega a página sozinho
    // (no máximo 2 vezes seguidas, para não entrar em loop).
    clearTimeout(ctxReloadTimer);
    ctxReloadTimer = setTimeout(() => {
      const n = Number(sessionStorage.getItem('p3d_ctx_reloads') || '0');
      if (n < 2) {
        sessionStorage.setItem('p3d_ctx_reloads', String(n + 1));
        sessionStorage.setItem('p3d_auto_boot', '1');
        window.location.reload();
      } else {
        recoveryOverlay(false);
        showWebglError('O WebGL caiu várias vezes seguidas. Feche TODAS as janelas do Chrome e abra de novo pelo atalho WebGL.');
      }
    }, 6000);
  }, false);

  canvas.addEventListener('webglcontextrestored', () => {
    clearTimeout(ctxReloadTimer);
    ctxLost = false;
    recoveryOverlay(false);
  }, false);

  // Rodou estável por 60s → zera o contador de recargas automáticas.
  setTimeout(() => {
    if (!ctxLost) sessionStorage.removeItem('p3d_ctx_reloads');
  }, 60000);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe8eef4);
  // Sem fog — mais leve e sem “desfoque” nos banners

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 120);
  camera.position.set(0, PLAYER.eye, RACK_LEN / 2 + 2);

  const controls = new PointerLockControls(camera, document.body);
  const touchPad = document.getElementById('touchPad');
  const btnExitTouch = document.getElementById('btnExitTouch');

  const forceTouch = new URLSearchParams(location.search).has('touch');
  const isTouchUI =
    forceTouch ||
    window.matchMedia('(pointer: coarse)').matches ||
    (navigator.maxTouchPoints > 1 && window.matchMedia('(hover: none)').matches);

  if (isTouchUI) document.body.classList.add('is-touch');

  let playing = false;

  function enterPlay() {
    if (btnEnter.disabled) return;
    if (isTouchUI) {
      playing = true;
      blocker.hidden = true;
      hud.hidden = false;
      touchPad.hidden = false;
      document.getElementById('crosshair').hidden = false;
      return;
    }
    try {
      controls.lock();
    } catch (err) {
      console.error(err);
      showWebglError('Pointer Lock bloqueado: ' + (err.message || err));
    }
  }
  enterPlayFn = enterPlay;

  function exitPlay() {
    playing = false;
    touchPad.hidden = true;
    document.getElementById('crosshair').hidden = true;
    document.getElementById('lookBalloon').hidden = true;
    const fp = document.getElementById('foraPanel');
    if (fp) fp.hidden = true;
    if (controls.isLocked) controls.unlock();
    blocker.hidden = false;
    hud.hidden = true;
  }

  btnExitTouch.addEventListener('click', (e) => {
    e.stopPropagation();
    exitPlay();
  });

  controls.addEventListener('lock', () => {
    playing = true;
    blocker.hidden = true;
    hud.hidden = false;
    touchPad.hidden = true;
    document.getElementById('crosshair').hidden = false;
  });
  controls.addEventListener('unlock', () => {
    if (inspectMode) return; // painel fixado: mantém a cena e o balão na tela
    if (!isTouchUI) {
      playing = false;
      blocker.hidden = false;
      hud.hidden = true;
      document.getElementById('crosshair').hidden = true;
      document.getElementById('lookBalloon').hidden = true;
      const fp = document.getElementById('foraPanel');
      if (fp) fp.hidden = true;
    }
  });

  // ——— Olhar por arraste (tablet / embed sem pointer lock) ———
  const LOOK_SENS = 0.0045;
  const PI_2 = Math.PI / 2;
  let lookPointerId = null;
  let lookLastX = 0;
  let lookLastY = 0;

  function onLookStart(e) {
    if (!playing || controls.isLocked) return;
    if (e.target.closest && e.target.closest('#touchPad')) return;
    lookPointerId = e.pointerId;
    lookLastX = e.clientX;
    lookLastY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  }
  function onLookMove(e) {
    if (!playing || controls.isLocked) return;
    if (lookPointerId !== e.pointerId) return;
    const dx = e.clientX - lookLastX;
    const dy = e.clientY - lookLastY;
    lookLastX = e.clientX;
    lookLastY = e.clientY;
    controls.getObject().rotation.y -= dx * LOOK_SENS;
    camera.rotation.x -= dy * LOOK_SENS;
    camera.rotation.x = Math.max(-PI_2 + 0.05, Math.min(PI_2 - 0.05, camera.rotation.x));
  }
  function onLookEnd(e) {
    if (lookPointerId !== e.pointerId) return;
    lookPointerId = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  }
  canvas.addEventListener('pointerdown', onLookStart);
  canvas.addEventListener('pointermove', onLookMove);
  canvas.addEventListener('pointerup', onLookEnd);
  canvas.addEventListener('pointercancel', onLookEnd);

  touchPad.querySelectorAll('.wasd-btn').forEach((btn) => {
    const code = btn.getAttribute('data-key');
    const setDown = (down, ev) => {
      if (ev) { ev.preventDefault(); ev.stopPropagation(); }
      keys[code] = down;
      btn.classList.toggle('is-down', down);
    };
    btn.addEventListener('pointerdown', (e) => {
      try { btn.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      setDown(true, e);
    });
    btn.addEventListener('pointerup', (e) => setDown(false, e));
    btn.addEventListener('pointercancel', (e) => setDown(false, e));
    btn.addEventListener('lostpointercapture', () => setDown(false));
  });

  // ——— Materiais Basic (leve) ———
  const orangeMat = new THREE.MeshBasicMaterial({ color: ORANGE });
  const woodDarkMat = new THREE.MeshBasicMaterial({ color: WOOD_DARK });
  const floorMat = new THREE.MeshBasicMaterial({ color: FLOOR_COL });
  const wallMat = new THREE.MeshBasicMaterial({ color: WALL_COL });
  const ceilMat = new THREE.MeshBasicMaterial({ color: CEIL_COL });
  const slotPlateOccMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  // Fundo preto do porta-pallet (chapa única no lugar da estrutura 3D)
  const rackBackMat = new THREE.MeshBasicMaterial({ color: 0x0d0d0d, side: THREE.DoubleSide });
  // Largura menor que o espaço entre slots (0.44 × BAY_W) — sem sobrepor a placa vizinha
  const PLATE_W = BAY_W * 0.40;
  const PLATE_H = LEVEL_H * 0.62;
  const plateGeo = new THREE.PlaneGeometry(PLATE_W, PLATE_H);

  // Uma luz só
  scene.add(new THREE.AmbientLight(0xffffff, 1.2));

  // ——— Chão / paredes claras (barracão 2× área, +50% altura) ———
  const floorW = 42 * HALL_SIZE_MUL;
  const floorD = (RACK_LEN + 16) * HALL_SIZE_MUL;
  const wallT = 0.4;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorW, floorD), floorMat);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const wallH = (RACK_H + 1.5) * HALL_HEIGHT_MUL;
  const eyeMax = wallH - 0.6;
  function addWall(cx, cz, sx, sz) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, wallH, sz), wallMat);
    mesh.position.set(cx, wallH / 2, cz);
    scene.add(mesh);
    colliders.push({
      minX: cx - sx / 2, maxX: cx + sx / 2,
      minZ: cz - sz / 2, maxZ: cz + sz / 2,
    });
  }
  addWall(0, -floorD / 2, floorW, wallT);
  addWall(0, floorD / 2, floorW, wallT);
  addWall(-floorW / 2, 0, wallT, floorD);
  addWall(floorW / 2, 0, wallT, floorD);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(floorW - 0.2, floorD - 0.2), ceilMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = wallH - 0.05;
  scene.add(ceiling);

  /**
   * Endereço igual ao Armazém 3D:
   * RR-NN-CC-PPP  (rua, nível 01–06, edifício, 001/002)
   * E → CC ímpar; D → CC par
   */
  function buildEndereco(rua, nivel, colNum, lado, pos /* '001'|'002' */) {
    const ruaStr = String(rua).padStart(2, '0');
    const nivelStr = String(nivel).padStart(2, '0');
    const edificioNum = lado === 'E' ? (2 * colNum - 1) : (2 * colNum);
    const colunaStr = String(edificioNum).padStart(2, '0');
    return `${ruaStr}-${nivelStr}-${colunaStr}-${pos}`;
  }

  const slotMeshes = []; // só caixas com produto
  const slotRegistry = new Map(); // endereco → dados para criar mesh sob demanda
  const overflowMeshes = []; // banners "Fora do mapa" no fim de cada fileira
  let ocupacao = {}; // preenchido após carregar API

  function complementoDosItens(itens) {
    const comps = [];
    for (const it of itens || []) {
      const c = String(it.complemento || '').trim();
      if (c && !comps.includes(c)) comps.push(c);
    }
    return comps.join(', ');
  }

  // ——— Fotos dos produtos desenhadas na posição (só perto da câmera) ———
  const imgCache = new Map(); // url → { img, ok, loading }

  function fotoProxyUrl(url) {
    return `/api/prateleiras3d/foto?url=${encodeURIComponent(url)}`;
  }

  function loadFoto(url, onReady) {
    let rec = imgCache.get(url);
    if (rec) {
      if (!rec.loading) onReady();
      else rec.cbs.push(onReady);
      return rec;
    }
    rec = { img: new Image(), ok: false, loading: true, cbs: [onReady] };
    imgCache.set(url, rec);
    rec.img.onload = () => {
      rec.ok = true;
      rec.loading = false;
      rec.cbs.forEach((cb) => cb());
      rec.cbs = [];
    };
    rec.img.onerror = () => {
      rec.ok = false;
      rec.loading = false;
      rec.cbs.forEach((cb) => cb());
      rec.cbs = [];
    };
    rec.img.src = fotoProxyUrl(url);
    return rec;
  }

  const SLOT_TEX_W = 128;
  const SLOT_TEX_H = 176;
  const SLOT_VIS_ROWS = 3; // linhas de foto visíveis (rolagem mostra o resto)

  function slotGridInfo(n) {
    const cols = n <= 3 ? 1 : 2;
    const totalRows = Math.max(1, Math.ceil(n / cols));
    const visRows = Math.min(SLOT_VIS_ROWS, totalRows);
    return { cols, totalRows, visRows, maxScroll: Math.max(0, totalRows - visRows) };
  }

  /** Desenha as fotos dos produtos no canvas da posição (com rolagem). */
  function paintSlotPhotos(mesh) {
    const ud = mesh.userData;
    if (!ud.slotCanvas) return;
    const c = ud.slotCanvas;
    const ctx = c.getContext('2d');
    const W = c.width;
    const H = c.height;
    const itens = ud.itens || [];

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#16a34a';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, W - 4, H - 4);

    const n = itens.length;
    if (!n) { ud.slotTex.needsUpdate = true; return; }

    const { cols, totalRows, visRows, maxScroll } = slotGridInfo(n);
    ud.photoScroll = Math.max(0, Math.min(Number(ud.photoScroll) || 0, maxScroll));
    const temBarra = maxScroll > 0;
    const pad = 5;
    const barW = temBarra ? 8 : 0;
    const areaW = W - pad * 2 - barW;
    const areaH = H - pad * 2;
    const cellW = areaW / cols;
    const cellH = areaH / visRows;

    const startIdx = ud.photoScroll * cols;
    for (let k = 0; k < visRows * cols; k++) {
      const idx = startIdx + k;
      if (idx >= n) break;
      const it = itens[idx];
      const cx = pad + (k % cols) * cellW;
      const cy = pad + Math.floor(k / cols) * cellH;
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx + 1, cy + 1, cellW - 2, cellH - 2);
      ctx.clip();
      const url = it.foto_url;
      const rec = url ? imgCache.get(url) : null;
      if (url && rec && rec.ok) {
        // Foto ocupa TODO o espaço da célula (cover)
        const iw = rec.img.naturalWidth || 1;
        const ih = rec.img.naturalHeight || 1;
        const s = Math.max((cellW - 2) / iw, (cellH - 2) / ih);
        const dw = iw * s;
        const dh = ih * s;
        ctx.drawImage(rec.img, cx + 1 + (cellW - 2 - dw) / 2, cy + 1 + (cellH - 2 - dh) / 2, dw, dh);
      } else {
        // Sem foto (ou ainda carregando) → código do produto
        ctx.fillStyle = '#f3f4f6';
        ctx.fillRect(cx + 1, cy + 1, cellW - 2, cellH - 2);
        ctx.fillStyle = '#374151';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${Math.max(9, Math.floor(cellH * 0.16))}px ui-sans-serif, system-ui, sans-serif`;
        let cod = String(it.codigo_produto || '—');
        while (cod.length > 3 && ctx.measureText(cod).width > cellW - 8) cod = cod.slice(0, -1);
        ctx.fillText(cod, cx + cellW / 2, cy + cellH / 2);
        if (url && (!rec || rec.loading)) {
          loadFoto(url, () => { if (ud.hasLabelTex) paintSlotPhotos(mesh); });
        }
      }
      ctx.restore();
      ctx.strokeStyle = '#d1d5db';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx + 0.5, cy + 0.5, cellW - 1, cellH - 1);
    }

    // Barra de rolagem (segurar e arrastar para ver o resto)
    if (temBarra) {
      const bx = W - pad - barW;
      ctx.fillStyle = '#e5e7eb';
      ctx.fillRect(bx, pad, barW, areaH);
      const thumbH = Math.max(18, areaH * (visRows / totalRows));
      const thumbY = pad + (areaH - thumbH) * (ud.photoScroll / maxScroll);
      ctx.fillStyle = '#16a34a';
      ctx.fillRect(bx + 1, thumbY, barW - 2, thumbH);
    }
    ud.slotTex.needsUpdate = true;
  }

  function aggregateItens(lista) {
    const map = {};
    for (const it of lista || []) {
      const cod = String(it.codigo_produto || '?').trim();
      if (!cod) continue;
      if (!map[cod]) map[cod] = { ...it, codigo_produto: cod, qtd: 0 };
      map[cod].qtd += Number(it.qtd) || 0;
      if (!map[cod].foto_url && it.foto_url) map[cod].foto_url = it.foto_url;
      if (!map[cod].descricao && it.descricao) map[cod].descricao = it.descricao;
      if (!map[cod].complemento && it.complemento) map[cod].complemento = it.complemento;
    }
    return Object.values(map).filter((i) => (Number(i.qtd) || 0) > 0);
  }

  function buildGridSet(rua, lado) {
    const set = new Set();
    for (let nivel = 1; nivel <= LEVELS; nivel++) {
      for (let colNum = 1; colNum <= BAYS; colNum++) {
        set.add(buildEndereco(rua, nivel, colNum, lado, '001'));
        set.add(buildEndereco(rua, nivel, colNum, lado, '002'));
      }
    }
    return set;
  }

  /** Mesma regra do Armazém 3D (painel "Fora do mapa"). */
  function listForaDoMapa(rua, lado) {
    const ruaStr = String(rua).padStart(2, '0');
    const prefix = `${ruaStr}-`;
    const gridSet = buildGridSet(rua, lado);
    const otherSet = buildGridSet(rua, lado === 'E' ? 'D' : 'E');
    const fora = [];
    for (const [end, itens] of Object.entries(ocupacao)) {
      if (!String(end).startsWith(prefix)) continue;
      if (gridSet.has(end) || otherSet.has(end)) continue;
      const partes = String(end).split('-');
      let pertenceLado = false;
      if (partes.length >= 3 && /^\d+$/.test(partes[2])) {
        const edif = parseInt(partes[2], 10);
        const isImpar = edif % 2 === 1;
        pertenceLado = (lado === 'E') ? isImpar : !isImpar;
      } else {
        pertenceLado = true;
      }
      if (!pertenceLado) continue;
      const vis = aggregateItens(itens);
      if (!vis.length) continue;
      fora.push({ endereco: end, itens: vis });
    }
    fora.sort((a, b) => String(a.endereco).localeCompare(String(b.endereco), 'pt-BR'));
    return fora;
  }

  // Uma única textura leve compartilhada por todos os banners 3D
  function makeSharedBannerMat() {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1c1917';
    ctx.fillRect(0, 0, 256, 512);
    ctx.fillStyle = '#92400e';
    ctx.fillRect(0, 0, 256, 90);
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 28px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FORA DO MAPA', 128, 36);
    ctx.fillStyle = '#fde68a';
    ctx.font = '16px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('Mira aqui = lista na tela', 128, 68);
    ctx.fillStyle = '#a8a29e';
    ctx.font = '18px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('(role a lista no painel)', 128, 280);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return new THREE.MeshBasicMaterial({
      map: tex,
      fog: false,
      toneMapped: false,
    });
  }
  const sharedBannerMat = makeSharedBannerMat();

  const _wp = new THREE.Vector3();
  let labelTexAcc = 0;

  function ensureSlotMesh(rec) {
    if (rec.mesh) return rec.mesh;
    // Chapa (placa) voltada para o corredor — bem mais leve que caixa 3D
    const plate = new THREE.Mesh(plateGeo, slotPlateOccMat);
    plate.rotation.y = Math.PI / 2;
    plate.position.set(rec.px, rec.py, rec.pz);
    plate.userData = {
      endereco: rec.endereco,
      tipo: 'slot',
      rua: rec.rua,
      lado: rec.lado,
      nivel: rec.nivel,
      colNum: rec.colNum,
      ocupado: true,
      complemento: '',
      hasLabelTex: false,
      itens: [],
      photoScroll: 0,
    };
    rec.group.add(plate);
    rec.mesh = plate;
    slotMeshes.push(plate);
    return plate;
  }

  function removeSlotMesh(rec) {
    if (!rec.mesh) return;
    const idx = slotMeshes.indexOf(rec.mesh);
    if (idx >= 0) slotMeshes.splice(idx, 1);
    const mat = rec.mesh.material;
    if (mat && mat !== slotPlateOccMat) mat.dispose();
    rec.group.remove(rec.mesh);
    rec.mesh = null;
  }

  function setSlotSolid(mesh) {
    const ud = mesh.userData;
    if (mesh.material && mesh.material !== slotPlateOccMat) mesh.material.dispose();
    if (ud.slotTex) { ud.slotTex.dispose(); ud.slotTex = null; ud.slotCanvas = null; }
    mesh.material = slotPlateOccMat;
    ud.hasLabelTex = false;
  }

  function setSlotLabeled(mesh) {
    const ud = mesh.userData;
    if (ud.hasLabelTex) return;
    const c = document.createElement('canvas');
    c.width = SLOT_TEX_W;
    c.height = SLOT_TEX_H;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    if (mesh.material && mesh.material !== slotPlateOccMat) mesh.material.dispose();
    mesh.material = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false });
    ud.slotCanvas = c;
    ud.slotTex = tex;
    ud.hasLabelTex = true;
    paintSlotPhotos(mesh);
  }

  // Cria as texturas de foto de TODAS as posições ocupadas, mas aos poucos
  // (poucas por quadro) — evita o pico que derruba o WebGL nesta máquina.
  // Uma vez criada, a foto NUNCA some (não volta a ficar branca de longe).
  const BUILD_PER_TICK = 4;
  function updateNearbySlotLabels(dt) {
    labelTexAcc += dt;
    if (labelTexAcc < 0.12) return;
    labelTexAcc = 0;
    const cam = controls.getObject().position;
    const pendentes = [];
    for (const mesh of slotMeshes) {
      if (!mesh.visible || mesh.userData.hasLabelTex) continue;
      mesh.getWorldPosition(_wp);
      pendentes.push({ mesh, d: _wp.distanceTo(cam) });
    }
    if (!pendentes.length) return;
    // Prioriza as mais próximas da câmera (aparecem primeiro onde o usuário olha)
    pendentes.sort((a, b) => a.d - b.d);
    for (let i = 0; i < Math.min(BUILD_PER_TICK, pendentes.length); i++) {
      setSlotLabeled(pendentes[i].mesh);
    }
  }

  /**
   * Fileira porta-pallet com 2 posições por bay (001 e 002), como no grid 2D.
   * lado: 'E' | 'D'
   * faceSign: +1 (E) | -1 (D) — banner sempre no extremo −Z do mundo (visão inicial).
   */
  /**
   * Face inteira do porta-pallet (fundo + postes + vigas + plaquinhas de nível)
   * numa ÚNICA textura compartilhada — 1 plano por fileira, bem leve.
   */
  function makeRackFaceMat(bays) {
    const TW = 2048;
    const TH = 1024;
    const c = document.createElement('canvas');
    c.width = TW;
    c.height = TH;
    const ctx = c.getContext('2d');
    const rowLen = bays * BAY_W;
    const pxZ = TW / rowLen;     // px por metro no comprimento
    const pxY = TH / RACK_H;     // px por metro na altura
    const yPix = (y) => TH - y * pxY;

    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, TW, TH);

    // Postes verticais laranja (limites dos edifícios)
    ctx.fillStyle = '#f97316';
    const postPx = Math.max(6, POST_W * pxZ);
    for (let i = 0; i <= bays; i++) {
      const xpx = i * BAY_W * pxZ;
      ctx.fillRect(xpx - postPx / 2, 0, postPx, TH);
    }
    // Vigas horizontais laranja (cada nível)
    const beamPx = Math.max(6, BEAM_H * pxY);
    for (let lv = 0; lv < LEVELS; lv++) {
      const ypx = yPix(0.2 + lv * LEVEL_H);
      ctx.fillRect(0, ypx - beamPx / 2, TW, beamPx);
    }
    // Plaquinha "Nível N" no topo de cada vão
    const plateW = 0.72 * pxZ;
    const plateH = 0.17 * pxY;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let lv = 0; lv < LEVELS; lv++) {
      const nivel = lv + 1;
      const yTopo = 0.2 + lv * LEVEL_H + LEVEL_H - 0.14;
      const ypx = yPix(yTopo);
      for (let i = 0; i < bays; i++) {
        const xpx = (i + 0.5) * BAY_W * pxZ;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(xpx - plateW / 2, ypx - plateH / 2, plateW, plateH);
        ctx.strokeStyle = '#16a34a';
        ctx.lineWidth = 3;
        ctx.strokeRect(xpx - plateW / 2, ypx - plateH / 2, plateW, plateH);
        ctx.fillStyle = '#111827';
        ctx.font = `bold ${Math.floor(plateH * 0.62)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillText(`Nível ${nivel}`, xpx, ypx + 1);
      }
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  }
  // Cache: 1 material por quantidade de colunas (10, 11 ou 12)
  const rackFaceMats = {};
  function getRackFaceMat(bays) {
    if (!rackFaceMats[bays]) rackFaceMats[bays] = makeRackFaceMat(bays);
    return rackFaceMats[bays];
  }

  function createPortaPalletRow(rua, lado, faceSign, bays) {
    const group = new THREE.Group();
    group.name = `R${rua}_${lado}`;
    const rowLen = bays * BAY_W;
    const halfL = rowLen / 2;

    // Face única com toda a estrutura desenhada
    const face = new THREE.Mesh(new THREE.PlaneGeometry(rowLen, RACK_H), getRackFaceMat(bays));
    face.rotation.y = Math.PI / 2;
    face.position.set(0.02, RACK_H / 2, 0);
    group.add(face);

    for (let lv = 0; lv < LEVELS; lv++) {
      const y = 0.2 + lv * LEVEL_H;
      const nivel = lv + 1; // 1 embaixo … 6 em cima (igual Armazém 3D)
      for (let i = 0; i < bays; i++) {
        const zBay = -halfL + (i + 0.5) * BAY_W;
        // Espelho igual ao Armazém 3D: edifício 01 (E) e 02 (D) na MESMA ponta
        // (lado do spawn, world +Z). Grupo faceSign>0 não gira; faceSign<0 gira 180°.
        const colNum = faceSign > 0 ? (bays - i) : (i + 1);

        // Duas posições no bay (001/002), espelhadas entre as faces
        const slots = lado === 'E'
          ? [{ pos: '002', t: 0.22 }, { pos: '001', t: -0.22 }]
          : [{ pos: '001', t: 0.22 }, { pos: '002', t: -0.22 }];

        for (const slot of slots) {
          const endereco = buildEndereco(rua, nivel, colNum, lado, slot.pos);
          const z = zBay + slot.t * BAY_W;
          const py = y + BEAM_H / 2 + PLATE_H / 2 + 0.06;
          slotRegistry.set(endereco, {
            group,
            px: 0.06,
            py,
            pz: z,
            endereco,
            rua,
            lado,
            nivel,
            colNum,
            mesh: null,
          });
        }
      }
    }

    // Banner leve (1 textura compartilhada) — lista completa vai para painel HTML
    const bannerW = 1.2;
    const bannerH = RACK_H * 0.85;
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(bannerW, bannerH), sharedBannerMat);
    banner.rotation.y = Math.PI / 2;
    // Banner no FUNDO (extremo −Z do mundo, oposto ao spawn)
    const zBanner = faceSign > 0
      ? -(halfL + bannerW / 2 + 0.08)
      : halfL + bannerW / 2 + 0.08;
    banner.position.set(0.06, bannerH / 2 + 0.08, zBanner);
    banner.userData = { tipo: 'overflow', rua, lado, fora: [] };
    group.add(banner);
    overflowMeshes.push(banner);

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, bannerH + 0.06, bannerW + 0.06),
      orangeMat
    );
    frame.position.set(0.02, bannerH / 2 + 0.08, zBanner);
    group.add(frame);

    return group;
  }

  function addColliderAt(x, z, w, d) {
    const c = {
      minX: x - w / 2, maxX: x + w / 2,
      minZ: z - d / 2, maxZ: z + d / 2,
      disabled: false,
    };
    colliders.push(c);
    return c;
  }

  /**
   * Blocos físicos de prateleira (parede, pares colados, ponta):
   * usados para "afastar" o bloco atrás do usuário quando ele anda de ré.
   */
  const blocks = [];
  function newBlock() {
    const b = { rows: [], slabs: [], hidden: false };
    blocks.push(b);
    return b;
  }
  function blockBounds(b) {
    if (b._bb) return b._bb;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const r of b.rows) {
      minX = Math.min(minX, r.collider.minX); maxX = Math.max(maxX, r.collider.maxX);
      minZ = Math.min(minZ, r.collider.minZ); maxZ = Math.max(maxZ, r.collider.maxZ);
    }
    b._bb = { minX, maxX, minZ, maxZ };
    return b._bb;
  }
  function setBlockHidden(b, hidden) {
    if (b.hidden === hidden) return;
    b.hidden = hidden;
    for (const r of b.rows) {
      r.group.visible = !hidden;
      r.collider.disabled = hidden;
    }
    for (const s of b.slabs) s.visible = !hidden;
  }

  // Espessura visual da chapa do porta-pallet (fundo + divisórias + placas)
  const RACK_T = 0.16;
  const slabMeshes = []; // blocos maciços pretos (fundo/miolo dos porta-pallets)

  function placeRow(x, faceSign, ruaNum, lado, bays) {
    const row = createPortaPalletRow(ruaNum, lado, faceSign, bays);
    const rowLen = bays * BAY_W;
    // Ponta do spawn (+Z) alinhada em todas as fileiras; colunas extras crescem p/ o fundo (−Z)
    const zC = RACK_LEN / 2 - rowLen / 2;
    row.rotation.y = faceSign > 0 ? 0 : Math.PI;
    row.position.set(x, 0, zC);
    scene.add(row);
    const col = addColliderAt(x, zC, RACK_T + 0.2, rowLen + 0.1);
    return { group: row, collider: col };
  }

  // Bloco preto maciço: fundo das duas faces + tampa o vão entre as costas
  function addRackSlab(xCenter, width, bays) {
    const len = bays * BAY_W;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(width, RACK_H, len),
      rackBackMat
    );
    slab.position.set(xCenter, RACK_H / 2, RACK_LEN / 2 - len / 2);
    scene.add(slab);
    slabMeshes.push(slab);
    return slab;
  }

  /**
   * Corredor = rua: cada rua tem lado D de um lado e lado E do outro.
   * Blocos físicos colados (maciços):
   * [parede] R1D | rua01 | R1E‖R2D | rua02 | R2E‖R3D | rua03 | R3E‖R4D | rua04 | R4E (espaço vazio)
   */
  const BACK_GAP = 0.12; // distância entre centros de um par colado
  const WALL_GAP = 0.08; // folga mínima parede ↔ costa do R1D
  const aisles = {};

  // Colunas por fileira: parede tem +2, as do meio +1, a última (longe da parede) fica com as 10
  const BAYS_WALL = BAYS + 2;  // R1 E (parede)
  const BAYS_MID = BAYS + 1;   // R1 D … R4 E
  const BAYS_LAST = BAYS;      // R4 D (mais longe da parede)

  // R1 lado E (edifícios ímpares, 01 primeiro) encostado na parede direita
  let x = floorW / 2 - wallT / 2 - WALL_GAP - RACK_T / 2;
  const firstRackX = x;
  let blk = newBlock();
  blk.rows.push(placeRow(x, -1, 1, 'E', BAYS_WALL));
  blk.slabs.push(addRackSlab(x + 0.06, 0.12, BAYS_WALL)); // miolo atrás da face, em direção à parede
  aisles[1] = x - RACK_T / 2 - AISLE_W / 2;
  x = aisles[1] - AISLE_W / 2 - RACK_T / 2;

  // Par R1D (face +X, para a rua 01) ‖ R2E (face −X, para a rua 02)
  blk = newBlock();
  blk.rows.push(placeRow(x, +1, 1, 'D', BAYS_MID));
  blk.slabs.push(addRackSlab(x - BACK_GAP / 2, BACK_GAP, BAYS_MID));
  x -= BACK_GAP;
  blk.rows.push(placeRow(x, -1, 2, 'E', BAYS_MID));
  aisles[2] = x - RACK_T / 2 - AISLE_W / 2;
  x = aisles[2] - AISLE_W / 2 - RACK_T / 2;

  // Par R2D ‖ R3E
  blk = newBlock();
  blk.rows.push(placeRow(x, +1, 2, 'D', BAYS_MID));
  blk.slabs.push(addRackSlab(x - BACK_GAP / 2, BACK_GAP, BAYS_MID));
  x -= BACK_GAP;
  blk.rows.push(placeRow(x, -1, 3, 'E', BAYS_MID));
  aisles[3] = x - RACK_T / 2 - AISLE_W / 2;
  x = aisles[3] - AISLE_W / 2 - RACK_T / 2;

  // Par R3D ‖ R4E
  blk = newBlock();
  blk.rows.push(placeRow(x, +1, 3, 'D', BAYS_MID));
  blk.slabs.push(addRackSlab(x - BACK_GAP / 2, BACK_GAP, BAYS_MID));
  x -= BACK_GAP;
  blk.rows.push(placeRow(x, -1, 4, 'E', BAYS_MID));
  aisles[4] = x - RACK_T / 2 - AISLE_W / 2;
  x = aisles[4] - AISLE_W / 2 - RACK_T / 2;

  // R4 lado D sozinho, ao lado do espaço vazio
  blk = newBlock();
  blk.rows.push(placeRow(x, +1, 4, 'D', BAYS_LAST));
  blk.slabs.push(addRackSlab(x - 0.06, 0.12, BAYS_LAST));
  const lastRackX = x;

  // ——— Etiqueta de rua PINTADA NO CHÃO, na entrada de cada corredor ———
  function makeRuaFloorTag(ruaNum) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#166534';
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, 244, 116);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 40px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('RUA', 128, 44);
    ctx.font = 'bold 64px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(String(ruaNum).padStart(2, '0'), 128, 92);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    const tag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 0.65),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
    );
    // Colada no chão, com o texto legível para quem chega do spawn (+Z)
    tag.rotation.x = -Math.PI / 2;
    tag.position.set(aisles[ruaNum], 0.02, RACK_LEN / 2 + 0.9);
    scene.add(tag);
  }
  for (const n of [1, 2, 3, 4]) makeRuaFloorTag(n);

  // ——— Quadros nas paredes: KANBAN (parede do fundo) + RELATÓRIO (parede lateral) ———
  let kanbanBoardMesh = null;
  let relatorioBoardMesh = null;

  function addKanbanWallBoard() {
    const KFONT = 'ui-sans-serif, system-ui, sans-serif';
    const W = 2048;
    const H = 1024;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 3.5),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
    );
    // Parede do FUNDO (−Z): andando reto a partir do spawn chega nela
    board.rotation.y = 0; // encara quem vem do spawn
    board.position.set((firstRackX + lastRackX) / 2, 2.15, -floorD / 2 + wallT / 2 + 0.06);
    board.userData = { tipo: 'kanban', cardRects: [], texW: W, texH: H };
    scene.add(board);
    kanbanBoardMesh = board;

    // Mesmas colunas/cores da guia Tela de separação (menu_produto.js)
    const COLS = [
      { key: 'Solicitado',          nome: 'Solicitado',          cor: '#3b82f6' },
      { key: 'Stund-by',            nome: 'Stund-by',            cor: '#ec4899' },
      { key: 'Em Separação',        nome: 'Em Separação',        cor: '#f59e0b' },
      { key: 'Separado',            nome: 'Separado',            cor: '#22c55e' },
      { key: 'Aguardando retirada', nome: 'Aguard. retirada',    cor: '#a78bfa' },
      { key: 'Concluído',           nome: 'Concluído',           cor: '#9ca3af' },
    ];

    function base(sub) {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `bold 52px ${KFONT}`;
      ctx.fillText('TELA DE SEPARAÇÃO', 32, 52);
      if (sub) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = `28px ${KFONT}`;
        ctx.fillText(sub, 32, 110);
      }
      board.userData.cardRects = [];
      tex.needsUpdate = true;
    }

    function fmtDataHora(d) {
      const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
      return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : '';
    }

    function pintar(colunas) {
      base('Mire num card e clique para abrir os itens · botão direito sai');
      const rects = [];
      const mTop = 140;
      const mSide = 24;
      const gap = 16;
      const colW = (W - mSide * 2 - gap * (COLS.length - 1)) / COLS.length;
      const colH = H - mTop - 24;

      COLS.forEach((col, ci) => {
        const cards = colunas[col.key] || [];
        const x = mSide + ci * (colW + gap);

        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.roundRect(x, mTop, colW, colH, 14);
        ctx.fill();

        ctx.fillStyle = col.cor;
        ctx.beginPath();
        ctx.roundRect(x, mTop, colW, 62, [14, 14, 0, 0]);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.font = `bold 26px ${KFONT}`;
        ctx.fillText(col.nome, x + 14, mTop + 31);
        ctx.textAlign = 'right';
        ctx.font = `bold 28px ${KFONT}`;
        ctx.fillText(String(cards.length), x + colW - 14, mTop + 31);

        const cardH = 128;
        const cardGap = 12;
        const areaY = mTop + 62 + 12;
        const areaH = colH - 62 - 24;
        const maxCards = Math.max(1, Math.floor((areaH + cardGap) / (cardH + cardGap)));
        const visiveis = cards.slice(0, maxCards);
        visiveis.forEach((card, i) => {
          const y = areaY + i * (cardH + cardGap);
          ctx.fillStyle = '#1a1a1a';
          ctx.strokeStyle = card.tem_urgente ? '#ef4444' : '#2a2a2a';
          ctx.lineWidth = card.tem_urgente ? 5 : 2;
          ctx.beginPath();
          ctx.roundRect(x + 10, y, colW - 20, cardH, 10);
          ctx.fill();
          ctx.stroke();

          ctx.textAlign = 'left';
          ctx.fillStyle = '#f59e0b';
          ctx.font = `bold 27px ${KFONT}`;
          ctx.fillText(String(card.n_solic), x + 24, y + 26);
          ctx.fillStyle = '#d1d5db';
          ctx.font = `21px ${KFONT}`;
          ctx.fillText(`De: ${String(card.nome_user || '').slice(0, 20)}`, x + 24, y + 56);
          ctx.fillStyle = '#6b7280';
          const dt = fmtDataHora(card.criado_em_min);
          ctx.fillText(
            `${card.total_itens} ite${Number(card.total_itens) === 1 ? 'm' : 'ns'}${dt ? ' · ' + dt : ''}`,
            x + 24, y + 84
          );
          const sepNome = String(card.usuario_separando || '').trim();
          if (sepNome && (col.key === 'Em Separação' || col.key === 'Separado')) {
            ctx.fillStyle = '#fbbf24';
            ctx.fillText(`Separando: ${sepNome.slice(0, 16)}`, x + 24, y + 110);
          }

          rects.push({
            x: x + 10, y, w: colW - 20, h: cardH,
            card: { n_solic: card.n_solic, colKey: col.key, colNome: col.nome, nome_user: card.nome_user, total_itens: card.total_itens },
          });
        });
        if (cards.length > maxCards) {
          ctx.fillStyle = '#94a3b8';
          ctx.textAlign = 'center';
          ctx.font = `bold 24px ${KFONT}`;
          ctx.fillText(`+${cards.length - maxCards} mais`, x + colW / 2, mTop + colH - 20);
        }
      });
      board.userData.cardRects = rects;
      tex.needsUpdate = true;
    }

    base('Carregando kanban…');
    fetch('/api/logistica/solicitacoes-kanban', { credentials: 'include' })
      .then((r) => r.json().then((j) => ({ status: r.status, j })))
      .then(({ status, j }) => {
        if (j && j.ok) pintar(j.colunas || {});
        else if (status === 401) base('Faça login na intranet para ver o kanban.');
        else base(String(j?.error || 'Sem dados.'));
      })
      .catch(() => base('Falha ao carregar o kanban.'));
  }
  addKanbanWallBoard();

  // ——— Quadro do RELATÓRIO GERENCIAL DE LOGÍSTICA (parede lateral, perto do spawn) ———
  // Mesmos dados da página "Relatório logística" (GET /api/sac/logistica/relatorio-gerencial).
  // As guias "Páginas do relatório" são clicáveis: mire na guia e clique para trocar de página.
  function addRelatorioWallBoard() {
    const KFONT = 'ui-sans-serif, system-ui, sans-serif';
    const W = 2048;
    const H = 1024;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 3.5),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
    );
    // Parede direita (+X), no vão livre entre a ponta da prateleira e o spawn
    board.rotation.y = -Math.PI / 2;
    board.position.set(floorW / 2 - wallT / 2 - 0.06, 2.15, RACK_LEN / 2 + 5.4);
    board.userData = { tipo: 'relatorio', tabRects: [], texW: W, texH: H, setPage: null, pagAtual: 0 };
    scene.add(board);
    relatorioBoardMesh = board;

    const PAGES = [
      'Dashboard Executivo',
      'Separação / Solicitações',
      'Transferências',
      'Ajustes de Estoque',
      'Recebimentos',
      'Envio de Mercadoria',
      'Estoque Mínimo',
      'Etiquetas / Endereço',
      'Evolução',
      'Plano de Ação',
      'Conclusão Executiva',
    ];
    const SIDE_W = 420;
    let dados = null;
    let pagAtual = 0;
    let msgStatus = 'Carregando relatório…';

    const nf = (v) => Number(v || 0).toLocaleString('pt-BR');

    function wrap(texto, maxChars) {
      const palavras = String(texto || '').split(/\s+/);
      const linhas = [];
      let atual = '';
      for (const p of palavras) {
        if ((atual + ' ' + p).trim().length > maxChars) {
          if (atual) linhas.push(atual);
          atual = p;
        } else {
          atual = (atual + ' ' + p).trim();
        }
      }
      if (atual) linhas.push(atual);
      return linhas;
    }

    // Gráfico de barras vertical (estilo da página 2D)
    function drawBars(titulo, arr, labelKey, valKey, x, y, w, h, cor) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 10);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#334155';
      ctx.textAlign = 'left';
      ctx.font = `bold 26px ${KFONT}`;
      ctx.fillText(titulo, x + 18, y + 30);

      const itens = (arr || []).slice(0, 6);
      if (!itens.length) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = `24px ${KFONT}`;
        ctx.fillText('Sem dados no período.', x + 18, y + h / 2);
        return;
      }
      const areaX = x + 30;
      const areaY = y + 60;
      const areaW = w - 60;
      const areaH = h - 130;
      const maxV = Math.max(...itens.map((i) => Number(i[valKey]) || 0), 1);
      const bw = Math.min(140, (areaW / itens.length) * 0.6);
      itens.forEach((it, i) => {
        const v = Number(it[valKey]) || 0;
        const bh = Math.max(4, (v / maxV) * areaH);
        const bx = areaX + (i + 0.5) * (areaW / itens.length) - bw / 2;
        const by = areaY + areaH - bh;
        ctx.fillStyle = cor;
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = '#334155';
        ctx.textAlign = 'center';
        ctx.font = `bold 22px ${KFONT}`;
        ctx.fillText(nf(v), bx + bw / 2, by - 14);
        ctx.fillStyle = '#64748b';
        ctx.font = `20px ${KFONT}`;
        ctx.fillText(String(it[labelKey] || '').slice(0, 16), bx + bw / 2, areaY + areaH + 26);
      });
    }

    function kpiCard(x, y, w, h, valor, label, cor) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 10);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = cor;
      ctx.fillRect(x, y, 8, h);
      ctx.fillStyle = '#0f172a';
      ctx.textAlign = 'left';
      ctx.font = `bold 44px ${KFONT}`;
      ctx.fillText(String(valor), x + 24, y + h / 2 - 12);
      ctx.fillStyle = '#64748b';
      ctx.font = `21px ${KFONT}`;
      wrap(label, 24).slice(0, 2).forEach((l, i) => {
        ctx.fillText(l, x + 24, y + h / 2 + 26 + i * 24);
      });
    }

    function listaTexto(titulo, linhas, x, y, w, h) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 10);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#334155';
      ctx.textAlign = 'left';
      ctx.font = `bold 26px ${KFONT}`;
      ctx.fillText(titulo, x + 18, y + 30);
      ctx.font = `22px ${KFONT}`;
      const maxLinhas = Math.floor((h - 70) / 32);
      linhas.slice(0, maxLinhas).forEach((l, i) => {
        ctx.fillStyle = i % 2 ? '#475569' : '#334155';
        ctx.fillText(String(l).slice(0, Math.floor((w - 40) / 11)), x + 18, y + 66 + i * 32);
      });
      if (!linhas.length) {
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('Sem dados no período.', x + 18, y + 66);
      }
    }

    function renderPagina(x0, y0, cw, chh) {
      const D = dados;
      const k = D.kpis || {};
      const meia = (cw - 20) / 2;
      switch (pagAtual) {
        case 0: { // Dashboard Executivo
          const cardW = (cw - 40) / 3;
          const cardH = (chh - 40) / 4;
          const kpis = [
            [nf(k.separacao_total), 'Itens de separação', '#3b82f6'],
            [nf(k.separacao_abertos), 'Separações abertas', '#f59e0b'],
            [nf(k.separacao_concluidos), 'Separações concluídas', '#22c55e'],
            [nf(k.separacao_urgentes), 'Itens urgentes', '#ef4444'],
            [nf(k.transferencias_pendentes), 'Transf. pendentes', '#a78bfa'],
            [nf(k.transferencias_executadas), 'Transf. executadas', '#22c55e'],
            [nf(k.ajustes_pendentes), 'Ajustes pendentes', '#f59e0b'],
            [nf(k.recebimentos_total), 'Recebimentos', '#3b82f6'],
            [nf(k.envios_total), 'Envios', '#06b6d4'],
            [nf(k.estoque_abaixo_minimo), 'SKUs abaixo do mínimo', '#ef4444'],
            [nf(k.etiquetas_pendentes), 'Etiquetas pendentes', '#f59e0b'],
            [nf(k.materiais_sem_endereco), 'Materiais sem endereço', '#ef4444'],
          ];
          kpis.forEach(([v, l, cor], i) => {
            const col = i % 3;
            const lin = Math.floor(i / 3);
            kpiCard(x0 + col * (cardW + 20), y0 + lin * (cardH + 12), cardW, cardH, v, l, cor);
          });
          break;
        }
        case 1: // Separação / Solicitações
          drawBars('Itens por Status', D.por_status_separacao, 'status', 'total', x0, y0, meia, chh, '#38bdf8');
          listaTexto('Top produtos solicitados',
            (D.top_produtos_separacao || []).map((r, i) => `${i + 1}. ${r.produto} — ${nf(r.total)}x (qtd ${nf(r.qtd_solicitada)})`),
            x0 + meia + 20, y0, meia, chh);
          break;
        case 2: // Transferências
          drawBars('Transferências por Status', D.por_status_transferencia, 'status', 'total', x0, y0, meia, chh, '#a78bfa');
          listaTexto('Principais rotas (Transferido)',
            (D.rotas_transferencia || []).map((r) => `${r.origem} → ${r.destino} — ${nf(r.total)}x`),
            x0 + meia + 20, y0, meia, chh);
          break;
        case 3: // Ajustes de Estoque
          drawBars('Ajustes por Status', D.por_status_ajuste, 'status', 'total', x0, y0, meia, chh, '#f59e0b');
          drawBars('Por Tipo de Operação', D.por_tipo_ajuste, 'tipo', 'total', x0 + meia + 20, y0, meia, chh, '#fb923c');
          break;
        case 4: // Recebimentos
          drawBars('Recebimentos por Etapa', D.por_etapa_recebimento, 'etapa', 'total', x0, y0, meia, chh, '#38bdf8');
          kpiCard(x0 + meia + 20, y0, meia, 150, nf(k.recebimentos_total), 'NF-e recebidas no período', '#3b82f6');
          kpiCard(x0 + meia + 20, y0 + 170, meia, 150, 'R$ ' + nf(k.recebimentos_valor), 'Valor total recebido', '#22c55e');
          break;
        case 5: // Envio de Mercadoria (igual à foto da tela 2D)
          drawBars('Envios por Status', D.por_status_envio, 'status', 'total', x0, y0, meia, chh, '#38bdf8');
          drawBars('Por Método de Envio', D.por_metodo_envio, 'metodo', 'total', x0 + meia + 20, y0, meia, chh, '#22d3ee');
          break;
        case 6: // Estoque Mínimo
          kpiCard(x0, y0, meia, 190, nf(k.estoque_abaixo_minimo), 'SKUs abaixo do estoque mínimo', '#ef4444');
          kpiCard(x0, y0 + 210, meia, 190, nf(k.estoque_deficit), 'Déficit total (unidades)', '#f59e0b');
          break;
        case 7: // Etiquetas / Endereço
          kpiCard(x0, y0, meia, 190, nf(k.etiquetas_pendentes), 'Etiquetas pendentes de impressão', '#f59e0b');
          kpiCard(x0, y0 + 210, meia, 190, nf(k.materiais_sem_endereco), 'Materiais sem endereço no porta-pallet', '#ef4444');
          break;
        case 8: { // Evolução
          const evolSem = D.evolucao_semanal || [];
          const evolMes = D.evolucao_mensal || [];
          if (evolSem.length) drawBars('Evolução semanal (operações)', evolSem, 'semana', 'total', x0, y0, cw, chh, '#818cf8');
          else drawBars('Evolução mensal (operações)', evolMes, 'label', 'total', x0, y0, cw, chh, '#818cf8');
          break;
        }
        case 9: { // Plano de Ação
          const plano = D.textos?.plano_acao || [];
          const linhas = [];
          plano.forEach((p, i) => {
            const prazo = p.prazo ? ` · prazo ${p.prazo}` : '';
            const resp = p.responsavel ? ` · ${p.responsavel}` : '';
            linhas.push(`${i + 1}. ${p.acao || '(sem ação)'}${resp}${prazo} [${p.prioridade || 'média'}]`);
            if (p.descricao) wrap(p.descricao, 88).slice(0, 2).forEach((l) => linhas.push('   ' + l));
          });
          listaTexto('Plano de Ação do mês', linhas, x0, y0, cw, chh);
          break;
        }
        case 10: { // Conclusão Executiva
          const t = D.textos || {};
          const alt = (chh - 24) / 3;
          listaTexto('Resumo', wrap(t.conclusao_resumo || '—', 100), x0, y0, cw, alt);
          listaTexto('Pontos críticos', wrap(t.conclusao_pontos_criticos || '—', 100), x0, y0 + alt + 12, cw, alt);
          listaTexto('Oportunidades', wrap(t.conclusao_oportunidades || '—', 100), x0, y0 + alt * 2 + 24, cw, alt);
          break;
        }
      }
    }

    function pintar() {
      // Página branca com cabeçalho azul (mesmo estilo do relatório 2D)
      ctx.fillStyle = '#eef2f7';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#1e2a4a';
      ctx.fillRect(0, 0, W, 96);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `bold 40px ${KFONT}`;
      ctx.fillText('RELATÓRIO GERENCIAL DE LOGÍSTICA', 32, 40);
      ctx.fillStyle = '#93c5fd';
      ctx.font = `26px ${KFONT}`;
      ctx.fillText(dados ? `Período: ${dados.periodo || ''} · mire numa guia e clique para trocar de página` : msgStatus, 32, 74);

      // Barra lateral com as PÁGINAS DO RELATÓRIO (clicáveis)
      ctx.fillStyle = '#16213e';
      ctx.fillRect(0, 96, SIDE_W, H - 96);
      const rects = [];
      const tabH = Math.floor((H - 96 - 20) / PAGES.length);
      PAGES.forEach((nome, i) => {
        const y = 96 + 10 + i * tabH;
        if (i === pagAtual) {
          ctx.fillStyle = '#1d4ed8';
          ctx.beginPath();
          ctx.roundRect(12, y + 4, SIDE_W - 24, tabH - 8, 10);
          ctx.fill();
        }
        ctx.fillStyle = i === pagAtual ? '#ffffff' : '#94a3b8';
        ctx.textAlign = 'left';
        ctx.font = `${i === pagAtual ? 'bold ' : ''}26px ${KFONT}`;
        ctx.fillText(`${i + 1}  ${nome}`, 32, y + tabH / 2);
        rects.push({ x: 0, y, w: SIDE_W, h: tabH, idx: i, nome });
      });
      board.userData.tabRects = rects;
      board.userData.pagAtual = pagAtual;

      // Conteúdo
      const x0 = SIDE_W + 30;
      const y0 = 130;
      const cw = W - x0 - 30;
      const chh = H - y0 - 30;
      if (dados) {
        renderPagina(x0, y0, cw, chh);
      } else {
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'left';
        ctx.font = `30px ${KFONT}`;
        ctx.fillText(msgStatus, x0 + 10, y0 + 40);
      }
      tex.needsUpdate = true;
    }

    board.userData.setPage = (idx) => {
      if (idx === pagAtual || idx < 0 || idx >= PAGES.length) return;
      pagAtual = idx;
      pintar();
    };

    pintar();
    fetch('/api/sac/logistica/relatorio-gerencial?modo=mes', { credentials: 'include' })
      .then((r) => r.json().then((j) => ({ status: r.status, j })))
      .then(({ status, j }) => {
        if (j && j.ok) { dados = j; }
        else if (status === 401) { msgStatus = 'Faça login na intranet para ver o relatório.'; }
        else { msgStatus = String(j?.error || 'Sem dados.'); }
        pintar();
      })
      .catch(() => { msgStatus = 'Falha ao carregar o relatório.'; pintar(); });
  }
  addRelatorioWallBoard();

  // Spawn na PONTA das prateleiras (lado dos banners), vendo todas as ruas:
  // rua 01 (parede) à DIREITA, rua 04 à ESQUERDA.
  function collidesAt(px, pz) {
    const r = PLAYER.radius;
    for (const c of colliders) {
      if (c.disabled) continue;
      if (px + r > c.minX && px - r < c.maxX && pz + r > c.minZ && pz - r < c.maxZ) return true;
    }
    return false;
  }

  let spawnX = (firstRackX + lastRackX) / 2;
  let spawnZ = RACK_LEN / 2 + 6.5; // bem afastado das prateleiras (visão geral)
  if (collidesAt(spawnX, spawnZ)) {
    spawnZ = RACK_LEN / 2 + 8;
  }

  controls.getObject().position.set(spawnX, PLAYER.eye, spawnZ);
  let eyeY = PLAYER.eye;
  // Olhar para as prateleiras (−Z) — parede/rua 01 fica à DIREITA da tela
  controls.getObject().rotation.y = 0;

  const startPad = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 28),
    new THREE.MeshBasicMaterial({ color: 0x58a6ff })
  );
  startPad.rotation.x = -Math.PI / 2;
  startPad.position.set(spawnX, 0.02, spawnZ);
  scene.add(startPad);

  // ——— Ocupação + balão ———
  const lookBalloon = document.getElementById('lookBalloon');
  const lookBalloonEnd = document.getElementById('lookBalloonEnd');
  const lookBalloonBody = document.getElementById('lookBalloonBody');
  const foraPanel = document.getElementById('foraPanel');
  if (foraPanel) foraPanel.hidden = true; // lista agora é desenhada no próprio banner 3D
  let lookAlvoAtual = null;
  let lookBannerAtual = null;
  let lookSlotAtual = null;

  function escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function applyOcupacaoToSlots() {
    for (const [end, rec] of slotRegistry) {
      const itens = ocupacao[end] || [];
      const ocupado = itens.some((i) => (Number(i.qtd) || 0) > 0);
      if (ocupado) {
        const mesh = ensureSlotMesh(rec);
        mesh.userData.ocupado = true;
        mesh.userData.complemento = complementoDosItens(itens);
        mesh.userData.itens = aggregateItens(itens); // 1 foto por produto
        mesh.userData.photoScroll = 0;
        setSlotSolid(mesh);
      } else {
        removeSlotMesh(rec);
      }
    }
    for (const mesh of overflowMeshes) {
      const { rua, lado } = mesh.userData;
      mesh.userData.fora = listForaDoMapa(rua, lado);
      mesh.userData.scroll = 0;
      paintOverflowBanner(mesh);
    }
    lookAlvoAtual = null;
    lookBannerAtual = null;
    lookSlotAtual = null;
  }

  async function carregarOcupacao() {
    try {
      const resp = await fetch('/api/etiquetas/ocupacao', { credentials: 'include' });
      const json = await resp.json().catch(() => ({}));
      if (json.ok && json.ocupacao) ocupacao = json.ocupacao;
      else ocupacao = {};
    } catch (e) {
      console.warn('[prateleiras-3d] ocupação:', e);
      ocupacao = {};
    }
    applyOcupacaoToSlots();
  }

  // Agrupa por produto: 1 grupo por código, com TODOS os IDs de etiqueta
  // (etiqueta.ETQ_recebimento.id) que estão neste endereço.
  function agruparProdutos(itens) {
    const grupos = new Map();
    for (const it of itens) {
      const k = String(it.codigo_produto || '?');
      if (!grupos.has(k)) {
        grupos.set(k, {
          codigo: it.codigo_produto,
          descricao: it.descricao || '',
          unidade: it.unidade || 'UN',
          foto_url: it.foto_url || null,
          qtdTotal: 0,
          ids: [],
          comps: [],
          itens: [],
        });
      }
      const g = grupos.get(k);
      g.qtdTotal += Number(it.qtd) || 0;
      const eid = it.etiqueta_id ?? it.id;
      if (eid != null && !g.ids.includes(eid)) g.ids.push(eid);
      if (!g.foto_url && it.foto_url) g.foto_url = it.foto_url;
      const c = String(it.complemento || '').trim();
      if (c && !g.comps.includes(c)) g.comps.push(c);
      g.itens.push(it);
    }
    return [...grupos.values()];
  }

  function htmlProdutos(itens) {
    if (!itens.length) {
      return '<div class="look-balloon-empty">Sem produto neste endereço.</div>';
    }
    return agruparProdutos(itens).map((g) => {
      const foto = g.foto_url
        ? `<img src="${escHtml(g.foto_url)}" alt="">`
        : '<div style="width:52px;height:52px;border-radius:6px;background:#21262d;flex-shrink:0;"></div>';
      const comp = g.comps.length
        ? `<div class="desc">Compl.: ${escHtml(g.comps.join(', '))}</div>`
        : '';
      const ids = g.ids.length
        ? `<div class="ids">IDs (${g.ids.length}): ${g.ids.map((v) => escHtml(v)).join(', ')}</div>`
        : '';
      return `<div class="look-balloon-row" data-cod="${escHtml(g.codigo)}">
        ${foto}
        <div class="look-balloon-info">
          <div class="cod">${escHtml(g.codigo)}</div>
          <div class="desc">${escHtml(g.descricao)}</div>
          ${comp}
          <div class="qtd">${escHtml(g.qtdTotal)} ${escHtml(g.unidade)} · ${g.ids.length} etiqueta${g.ids.length === 1 ? '' : 's'}</div>
          ${ids}
        </div>
      </div>`;
    }).join('');
  }

  // Detalhe de UM produto (modo fixado, após clicar num item)
  function htmlProdutoDetalhe(g) {
    const foto = g.foto_url
      ? `<img class="det-foto" src="${escHtml(g.foto_url)}" alt="">`
      : '';
    const fmtData = (d) => {
      if (!d) return '—';
      const s = String(d);
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
    };
    const linhas = g.itens.map((it) => {
      const eid = it.etiqueta_id ?? it.id;
      const comp = String(it.complemento || '').trim();
      return `<tr>
        <td class="det-id">${escHtml(eid ?? '—')}</td>
        <td>${escHtml(it.qtd)} ${escHtml(it.unidade || 'UN')}</td>
        <td>${escHtml(fmtData(it.data_emissao))}</td>
        <td>${escHtml(comp || '—')}</td>
      </tr>`;
    }).join('');
    return `
      <div class="look-balloon-detail">
        <div class="det-back">← Voltar à lista (ou botão direito p/ sair)</div>
        <div class="det-head">
          ${foto}
          <div>
            <div class="cod">${escHtml(g.codigo)}</div>
            <div class="det-desc">${escHtml(g.descricao)}</div>
            <div class="qtd">Total: ${escHtml(g.qtdTotal)} ${escHtml(g.unidade)} · ${g.ids.length} etiqueta${g.ids.length === 1 ? '' : 's'}</div>
          </div>
        </div>
        <table class="det-tab">
          <thead><tr><th>ID etiqueta</th><th>Qtd</th><th>Emissão</th><th>Compl.</th></tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>`;
  }

  function mostrarBalaoEndereco(endereco) {
    const key = `slot:${endereco}`;
    if (lookAlvoAtual === key) return;
    lookAlvoAtual = key;
    lookBalloonEnd.textContent = endereco;
    // Sem agregação: cada etiqueta (ID) aparece como uma linha, com seu ID
    lookBalloonBody.innerHTML = htmlProdutos(ocupacao[endereco] || []);
    lookBalloon.hidden = false;
  }

  function esconderBalao() {
    lookAlvoAtual = null;
    lookBalloon.hidden = true;
  }

  // ——— Kanban da parede: card sob a mira + painel de itens da SEP ———
  let lookKanbanCard = null; // card do kanban atualmente na mira
  let lookRelTab = null;     // guia do relatório atualmente na mira

  function tabRelatorioSobMira(mesh, uv) {
    if (!uv || !mesh.userData.tabRects?.length) return null;
    const cx = uv.x * mesh.userData.texW;
    const cy = (1 - uv.y) * mesh.userData.texH;
    for (const r of mesh.userData.tabRects) {
      if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) return r;
    }
    return null;
  }

  function mostrarBalaoRelHint(tab) {
    const key = `rel:${tab.idx}`;
    if (lookAlvoAtual === key) return;
    lookAlvoAtual = key;
    lookBalloonEnd.textContent = `Página ${tab.idx + 1}`;
    lookBalloonBody.innerHTML =
      `<div class="look-balloon-empty">${escHtml(tab.nome)} — clique para abrir esta página.</div>`;
    lookBalloon.hidden = false;
  }

  function cardKanbanSobMira(mesh, uv) {
    if (!uv || !mesh.userData.cardRects?.length) return null;
    const cx = uv.x * mesh.userData.texW;
    const cy = (1 - uv.y) * mesh.userData.texH;
    for (const r of mesh.userData.cardRects) {
      if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) return r.card;
    }
    return null;
  }

  function mostrarBalaoKanbanHint(card) {
    const key = `kanban:${card.n_solic}`;
    if (lookAlvoAtual === key) return;
    lookAlvoAtual = key;
    lookBalloonEnd.textContent = `${card.n_solic} — ${card.colNome}`;
    lookBalloonBody.innerHTML =
      `<div class="look-balloon-empty">De: ${escHtml(card.nome_user || '')} · ${escHtml(card.total_itens)} ite${Number(card.total_itens) === 1 ? 'm' : 'ns'}<br>Clique para abrir os itens (como na Tela de separação).</div>`;
    lookBalloon.hidden = false;
  }

  // Painel fixado com os ITENS da SEP — mesmo conteúdo do modal da tela 2D
  function htmlItensSep(itens) {
    if (!itens.length) return '<div class="look-balloon-empty">Nenhum item encontrado.</div>';
    const linhas = itens.map((it) => {
      const qtdSol = it.quantidade_solicitada ?? it.quantidade ?? '';
      const qtdSep = it.quantidade_separada ?? '';
      const ends = Array.isArray(it.endereco_pp)
        ? it.endereco_pp.map((e) => e && (e.endereco || e)).filter(Boolean).slice(0, 3).map((e) => escHtml(typeof e === 'string' ? e : e.endereco || '')).join('<br>')
        : '';
      const urg = it.urgente ? ' <span class="sep-urgente">URGENTE</span>' : '';
      return `<tr>
        <td class="det-id">${escHtml(it.codigo_produto || '')}</td>
        <td>${escHtml(String(it.descricao || '').slice(0, 46))}${urg}</td>
        <td>${escHtml(qtdSol)} ${escHtml(it.unidade || '')}</td>
        <td>${escHtml(qtdSep === null || qtdSep === '' ? '—' : qtdSep)}</td>
        <td>${escHtml(it.status || '')}</td>
        <td>${ends || '—'}</td>
      </tr>`;
    }).join('');
    return `
      <div class="look-balloon-detail">
        <div class="det-back">Botão direito p/ voltar ao 3D</div>
        <table class="det-tab">
          <thead><tr><th>Código</th><th>Descrição</th><th>Solicitada</th><th>Separada</th><th>Status</th><th>Endereço</th></tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>`;
  }

  function enterInspectKanban(card) {
    inspectMode = true;
    inspectEndereco = null;
    playing = false;
    lookBalloon.classList.add('is-locked');
    lookAlvoAtual = `kanban-fix:${card.n_solic}`;
    lookBalloonEnd.textContent = `${card.n_solic} — ${card.colNome} · De: ${card.nome_user || ''}`;
    lookBalloonBody.innerHTML = '<div class="look-balloon-empty">Carregando itens…</div>';
    lookBalloon.hidden = false;
    if (controls.isLocked) controls.unlock();
    fetch(`/api/logistica/kanban/itens?n_solic=${encodeURIComponent(card.n_solic)}&escopo=global`, { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => {
        if (!inspectMode) return;
        if (j && j.ok) lookBalloonBody.innerHTML = htmlItensSep(j.itens || []);
        else lookBalloonBody.innerHTML = `<div class="look-balloon-empty">${escHtml(j?.error || 'Erro ao buscar itens.')}</div>`;
      })
      .catch(() => {
        if (inspectMode) lookBalloonBody.innerHTML = '<div class="look-balloon-empty">Falha ao carregar os itens.</div>';
      });
  }

  // ——— Modo fixado: clique numa foto trava o painel p/ interagir ———
  // Rolar, clicar num produto p/ ver detalhes; botão DIREITO volta ao normal.
  let inspectMode = false;
  let inspectEndereco = null;

  function enterInspect(endereco) {
    inspectMode = true;
    inspectEndereco = endereco;
    playing = false; // congela movimento enquanto o painel está fixado
    lookBalloon.classList.add('is-locked');
    lookAlvoAtual = null; // força re-render
    mostrarBalaoEndereco(endereco);
    if (controls.isLocked) controls.unlock(); // libera o cursor do mouse
  }

  function exitInspect() {
    if (!inspectMode) return;
    inspectMode = false;
    inspectEndereco = null;
    lookBalloon.classList.remove('is-locked');
    esconderBalao();
    if (!isTouchUI) {
      try { controls.lock(); } catch (_) { playing = true; }
    } else {
      playing = true;
    }
  }

  // Clique num produto do painel fixado → só ele, com mais dados
  lookBalloonBody.addEventListener('click', (e) => {
    if (!inspectMode) return;
    const back = e.target.closest('.det-back');
    if (back) {
      if (!inspectEndereco) { exitInspect(); return; } // painel do kanban: volta ao 3D
      lookAlvoAtual = null;
      mostrarBalaoEndereco(inspectEndereco);
      return;
    }
    const row = e.target.closest('.look-balloon-row[data-cod]');
    if (!row) return;
    const cod = row.getAttribute('data-cod');
    const grupo = agruparProdutos(ocupacao[inspectEndereco] || [])
      .find((g) => String(g.codigo) === cod);
    if (grupo) lookBalloonBody.innerHTML = htmlProdutoDetalhe(grupo);
  });

  document.addEventListener('contextmenu', (e) => {
    if (inspectMode) {
      e.preventDefault();
      exitInspect();
    }
  });

  // ——— Lista "Fora do mapa" desenhada DIRETO no banner 3D ———
  const FONT = 'ui-sans-serif, system-ui, sans-serif';

  function ensureBannerCanvas(mesh) {
    if (mesh.userData.bannerCanvas) return mesh.userData;
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 1024;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    mesh.material = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    mesh.userData.bannerCanvas = c;
    mesh.userData.bannerTex = tex;
    return mesh.userData;
  }

  function paintOverflowBanner(mesh) {
    const { bannerCanvas: c, bannerTex: tex } = ensureBannerCanvas(mesh);
    const ctx = c.getContext('2d');
    const W = c.width;
    const H = c.height;

    ctx.fillStyle = '#1c1917';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, W - 6, H - 6);

    const { rua, fora = [] } = mesh.userData;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fbbf24';
    ctx.font = `bold 26px ${FONT}`;
    ctx.fillText('FORA DO MAPA', W / 2, 42);
    ctx.fillStyle = '#a8a29e';
    ctx.font = `14px ${FONT}`;
    ctx.fillText(`Rua ${String(rua).padStart(2, '0')} · ${fora.length} endereço(s)`, W / 2, 66);

    // Achata em linhas: endereço (verde, negrito) + produtos (branco)
    const lines = [];
    for (const row of fora) {
      lines.push({ t: row.endereco, bold: true });
      for (const it of row.itens || []) {
        lines.push({ t: `${it.codigo_produto} · ${it.qtd} ${it.unidade || 'UN'}`, bold: false });
      }
    }

    const topY = 96;
    const lineH = 24;
    const maxLines = Math.floor((H - topY - 34) / lineH);
    const maxScroll = Math.max(0, lines.length - maxLines);
    const start = Math.max(0, Math.min(Number(mesh.userData.scroll) || 0, maxScroll));
    mesh.userData.scroll = start;

    if (!lines.length) {
      ctx.fillStyle = '#a8a29e';
      ctx.font = `15px ${FONT}`;
      ctx.fillText('Nenhum endereço', W / 2, 140);
      ctx.fillText('fora do mapa.', W / 2, 162);
    } else {
      ctx.textAlign = 'left';
      let y = topY + lineH;
      for (const ln of lines.slice(start, start + maxLines)) {
        ctx.font = ln.bold ? `bold 18px ${FONT}` : `15px ${FONT}`;
        ctx.fillStyle = ln.bold ? '#4ade80' : '#e7e5e4';
        let t = ln.t;
        while (t.length > 2 && ctx.measureText(t).width > W - 26) t = t.slice(0, -1);
        ctx.fillText(t, 14, y);
        y += lineH;
      }
      ctx.textAlign = 'center';
      ctx.font = `bold 14px ${FONT}`;
      ctx.fillStyle = '#fbbf24';
      if (start > 0) ctx.fillText(`▲ ${start} acima`, W / 2, 88);
      if (start < maxScroll) {
        ctx.fillText(`▼ ${lines.length - start - maxLines} abaixo — roda do mouse`, W / 2, H - 14);
      }
    }
    tex.needsUpdate = true;
  }

  // Roda do mouse: rola o banner OU as fotos da posição que está na mira
  canvas.addEventListener('wheel', (e) => {
    if (!playing && !controls.isLocked) return;
    if (lookBannerAtual) {
      e.preventDefault();
      const m = lookBannerAtual;
      m.userData.scroll = (Number(m.userData.scroll) || 0) + (e.deltaY > 0 ? 3 : -3);
      paintOverflowBanner(m);
      return;
    }
    if (lookSlotAtual && lookSlotAtual.userData.hasLabelTex) {
      const ud = lookSlotAtual.userData;
      const { maxScroll } = slotGridInfo((ud.itens || []).length);
      if (maxScroll > 0) {
        e.preventDefault();
        ud.photoScroll = Math.max(0, Math.min((Number(ud.photoScroll) || 0) + (e.deltaY > 0 ? 1 : -1), maxScroll));
        paintSlotPhotos(lookSlotAtual);
      }
    }
  }, { passive: false });

  // Segurar o botão esquerdo + arrastar = rolagem (posição OU banner na mira)
  let slotDrag = null;    // mesh de posição sendo arrastada
  let bannerDrag = null;  // banner sendo arrastado
  let dragAcc = 0;
  let clickDownAt = 0;    // p/ distinguir CLIQUE (fixa painel) de ARRASTO (rolagem)
  let clickMoved = 0;
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (inspectMode) return; // painel fixado: cliques vão para o HTML
    if (!playing && !controls.isLocked) return;
    clickDownAt = performance.now();
    clickMoved = 0;
    if (lookSlotAtual && lookSlotAtual.userData.hasLabelTex) {
      const { maxScroll } = slotGridInfo((lookSlotAtual.userData.itens || []).length);
      if (maxScroll > 0) {
        slotDrag = lookSlotAtual;
        dragAcc = 0;
        controls.pointerSpeed = 0;
        return;
      }
    }
    if (lookBannerAtual) {
      bannerDrag = lookBannerAtual;
      dragAcc = 0;
      controls.pointerSpeed = 0;
    }
  });
  document.addEventListener('mousemove', (e) => {
    clickMoved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
    if (slotDrag) {
      dragAcc += e.movementY || 0;
      const passo = 28; // px por linha de fotos
      let mudou = false;
      const ud = slotDrag.userData;
      const { maxScroll } = slotGridInfo((ud.itens || []).length);
      while (dragAcc > passo) {
        ud.photoScroll = Math.min((Number(ud.photoScroll) || 0) + 1, maxScroll);
        dragAcc -= passo; mudou = true;
      }
      while (dragAcc < -passo) {
        ud.photoScroll = Math.max((Number(ud.photoScroll) || 0) - 1, 0);
        dragAcc += passo; mudou = true;
      }
      if (mudou) paintSlotPhotos(slotDrag);
      return;
    }
    if (bannerDrag) {
      dragAcc += e.movementY || 0;
      const passo = 16; // px por linha da lista do banner
      let mudou = false;
      while (dragAcc > passo) {
        bannerDrag.userData.scroll = (Number(bannerDrag.userData.scroll) || 0) + 1;
        dragAcc -= passo; mudou = true;
      }
      while (dragAcc < -passo) {
        bannerDrag.userData.scroll = (Number(bannerDrag.userData.scroll) || 0) - 1;
        dragAcc += passo; mudou = true;
      }
      if (mudou) paintOverflowBanner(bannerDrag);
    }
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    const cliqueRapido =
      !inspectMode &&
      clickDownAt > 0 &&
      performance.now() - clickDownAt < 400 &&
      clickMoved < 8;
    clickDownAt = 0;
    if (slotDrag || bannerDrag) {
      slotDrag = null;
      bannerDrag = null;
      controls.pointerSpeed = 1;
    }
    // Clique rápido (sem arrastar) → fixa o painel p/ interação
    if (cliqueRapido && (playing || controls.isLocked)) {
      if (lookSlotAtual) enterInspect(lookSlotAtual.userData.endereco);
      else if (lookKanbanCard) enterInspectKanban(lookKanbanCard);
      else if (lookRelTab && relatorioBoardMesh?.userData.setPage) {
        // Troca a página do relatório na hora, sem travar o painel
        relatorioBoardMesh.userData.setPage(lookRelTab.idx);
        lookAlvoAtual = null;
        esconderBalao();
      }
    }
  });
  controls.addEventListener('unlock', () => {
    slotDrag = null;
    bannerDrag = null;
    controls.pointerSpeed = 1;
  });

  const raycaster = new THREE.Raycaster();
  const centerNdc = new THREE.Vector2(0, 0);
  let lookAcc = 0;

  function raycastCenter() {
    raycaster.setFromCamera(centerNdc, camera);
    // Blocos pretos entram para BLOQUEAR a mira (não atravessar para o outro lado)
    const alvos = [...slotMeshes, ...overflowMeshes, ...slabMeshes];
    if (kanbanBoardMesh) alvos.push(kanbanBoardMesh);
    if (relatorioBoardMesh) alvos.push(relatorioBoardMesh);
    const hits = raycaster.intersectObjects(alvos, false);
    // Ignora o que estiver escondido (bloco "afastado" ao andar de ré)
    return hits.filter((h) => {
      let o = h.object;
      while (o) {
        if (o.visible === false) return false;
        o = o.parent;
      }
      return true;
    });
  }

  function updateLookTarget(dt) {
    if (inspectMode) return; // painel fixado: não re-mira nem esconde
    if (!playing && !controls.isLocked) {
      esconderBalao();
      lookBannerAtual = null;
      lookSlotAtual = null;
      return;
    }
    lookAcc += dt;
    if (lookAcc < 0.1) return;
    lookAcc = 0;
    if (slotDrag || bannerDrag) return; // segurando para rolar — mantém o alvo
    const hits = raycastCenter();
    if (!hits.length || hits[0].distance > 16) {
      esconderBalao();
      lookBannerAtual = null;
      lookSlotAtual = null;
      lookKanbanCard = null;
      lookRelTab = null;
      return;
    }
    const obj = hits[0].object;
    if (obj.userData.tipo === 'overflow') {
      // A lista já está desenhada no próprio banner — nada abre na tela
      lookBannerAtual = obj;
      lookSlotAtual = null;
      lookKanbanCard = null;
      lookRelTab = null;
      esconderBalao();
    } else if (obj.userData.tipo === 'slot') {
      lookBannerAtual = null;
      lookSlotAtual = obj;
      lookKanbanCard = null;
      lookRelTab = null;
      mostrarBalaoEndereco(obj.userData.endereco);
    } else if (obj.userData.tipo === 'kanban') {
      lookBannerAtual = null;
      lookSlotAtual = null;
      lookRelTab = null;
      lookKanbanCard = cardKanbanSobMira(obj, hits[0].uv);
      if (lookKanbanCard) mostrarBalaoKanbanHint(lookKanbanCard);
      else esconderBalao();
    } else if (obj.userData.tipo === 'relatorio') {
      lookBannerAtual = null;
      lookSlotAtual = null;
      lookKanbanCard = null;
      lookRelTab = tabRelatorioSobMira(obj, hits[0].uv);
      if (lookRelTab && lookRelTab.idx !== obj.userData.pagAtual) mostrarBalaoRelHint(lookRelTab);
      else esconderBalao();
    } else {
      // Bloco preto (fundo) — nada a mostrar
      lookBannerAtual = null;
      lookSlotAtual = null;
      lookKanbanCard = null;
      lookRelTab = null;
      esconderBalao();
    }
  }

  void carregarOcupacao();

  // ——— Movimento ———
  const onKey = (e, down) => {
    keys[e.code] = down;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'PageUp', 'PageDown'].includes(e.code)) {
      e.preventDefault();
    }
  };
  document.addEventListener('keydown', (e) => onKey(e, true));
  document.addEventListener('keyup', (e) => onKey(e, false));

  function collides(px, pz) {
    return collidesAt(px, pz);
  }

  function tryMove(dx, dz) {
    const pos = controls.getObject().position;
    const nx = pos.x + dx;
    const nz = pos.z + dz;
    if (!collides(nx, nz)) { pos.x = nx; pos.z = nz; return; }
    if (!collides(nx, pos.z)) pos.x = nx;
    else if (!collides(pos.x, nz)) pos.z = nz;
  }

  const clock = new THREE.Clock();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const _revDir = new THREE.Vector3();

  // Corredor em que o jogador está (ou null se fora das prateleiras)
  function currentAisleNum(px, pz) {
    if (pz > RACK_LEN / 2 + 0.5 || pz < -(RACK_LEN / 2 + 2 * BAY_W + 0.5)) return null;
    for (const n of [1, 2, 3, 4]) {
      if (aisles[n] != null && Math.abs(px - aisles[n]) <= AISLE_W / 2 + 0.15) return n;
    }
    return null;
  }

  /**
   * Andar de ré (S) dentro de um corredor: o BLOCO de prateleira atrás das
   * costas some e deixa de barrar — dá pra afastar sem limite. Ao soltar o S
   * ou sair de cima do bloco, ele volta ao normal.
   * blocks[0]=parede … blocks[4]=ponta. Corredor n fica entre blocks[n-1] (+X) e blocks[n] (−X).
   */
  function updateAisleReveal() {
    const pos = controls.getObject().position;
    const backing = keys.KeyS || keys.ArrowDown;
    const n = backing ? currentAisleNum(pos.x, pos.z) : null;
    let behind = null;
    if (n) {
      camera.getWorldDirection(_revDir);
      behind = _revDir.x > 0 ? blocks[n] : blocks[n - 1];
    }
    const r = PLAYER.radius;
    for (const b of blocks) {
      if (b === behind) {
        setBlockHidden(b, true);
      } else if (b.hidden) {
        const bb = blockBounds(b);
        const overlap =
          pos.x + r > bb.minX - 0.1 && pos.x - r < bb.maxX + 0.1 &&
          pos.z + r > bb.minZ && pos.z - r < bb.maxZ;
        if (!overlap) setBlockHidden(b, false);
      }
    }
  }

  function animate() {
    requestAnimationFrame(animate);
    if (ctxLost) return; // contexto perdido: não desenha até restaurar
    const dt = Math.min(clock.getDelta(), 0.05);

    if (playing || controls.isLocked) {
      const speed = (keys.ShiftLeft || keys.ShiftRight ? PLAYER.speed * 1.55 : PLAYER.speed) * dt;
      forward.set(0, 0, 0);
      right.set(0, 0, 0);
      if (keys.KeyW || keys.ArrowUp) forward.z -= 1;
      if (keys.KeyS || keys.ArrowDown) forward.z += 1;
      if (keys.KeyA || keys.ArrowLeft) right.x -= 1;
      if (keys.KeyD || keys.ArrowRight) right.x += 1;

      if (forward.z !== 0 || right.x !== 0) {
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        dir.y = 0;
        dir.normalize();
        const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
        let mx = 0;
        let mz = 0;
        if (forward.z !== 0) {
          mx += dir.x * (-forward.z) * speed;
          mz += dir.z * (-forward.z) * speed;
        }
        if (right.x !== 0) {
          mx += side.x * right.x * speed;
          mz += side.z * right.x * speed;
        }
        tryMove(mx, mz);
      }

      // Subir / descer câmera
      const v = PLAYER.vSpeed * dt;
      if (keys.Space || keys.KeyE || keys.PageUp) eyeY += v;
      if (keys.KeyC || keys.KeyQ || keys.PageDown || keys.ControlLeft || keys.ControlRight) eyeY -= v;
      eyeY = Math.max(PLAYER.eyeMin, Math.min(eyeMax, eyeY));
      controls.getObject().position.y = eyeY;
    }

    updateAisleReveal();
    updateLookTarget(dt);
    updateNearbySlotLabels(dt);
    appRenderer.render(scene, camera);
  }

  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    appRenderer.setSize(w, h);
  });

  // Handle de depuração (console/testes automatizados)
  window.__p3d = { scene, camera, blocks, aisles, slotRegistry };

  animate();
}
