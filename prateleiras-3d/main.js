/**
 * Porta-pallet 3D — cena isolada (Three.js).
 * Visual inspirado em img/armazem3d_side.png e img/estante_aisle.png
 * Pasta inteira removível sem afetar o restante da intranet.
 */
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const canvas = document.getElementById('c');
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
  const isContextBlock = /context loss|was blocked|WebGL context|creating WebGL/i.test(String(detail || ''));
  const embedHint = isEmbed
    ? '\n\nDica: no PC, use o botão "Abrir em nova aba" abaixo — costuma funcionar quando o iframe bloqueia.'
    : '';
  const msg = isContextBlock
    ? (
      'O Chrome bloqueou o 3D nesta página (WebGL).\n\n' +
      'Faça assim:\n' +
      '1) Feche TODAS as janelas do Chrome\n' +
      '2) Abra de novo (ícone ou ~/.local/bin/google-chrome-webgl)\n' +
      '3) Use "Abrir em nova aba" ou Explorar 3D → Entrar\n' +
      '4) Chrome → Configurações → Sistema → ligue "Aceleração de hardware"\n\n' +
      'URL: ' + window.location.href +
      embedHint +
      (detail ? '\n\nDetalhe: ' + detail : '')
    )
    : (
      'Não foi possível iniciar o 3D neste Chrome.\n\n' +
      '1) Feche TODAS as janelas do Chrome\n' +
      '2) Abra de novo pelo ícone ou ~/.local/bin/google-chrome-webgl\n' +
      '3) Tente "Abrir em nova aba"\n\n' +
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
  if (!document.getElementById('btnRetryWebgl')) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.id = 'btnRetryWebgl';
    retry.className = 'btn';
    retry.style.marginTop = '10px';
    retry.textContent = 'Já reiniciei o Chrome — tentar de novo';
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

function createRenderer() {
  const opts = {
    canvas,
    antialias: false,
    alpha: false,
    depth: true,
    stencil: false,
    failIfMajorPerformanceCaveat: false,
    powerPreference: 'low-power',
    preserveDrawingBuffer: false,
  };
  const attempts = [
    () => new THREE.WebGLRenderer(opts),
    () => {
      const gl = canvas.getContext('webgl', opts);
      if (!gl) throw new Error('webgl indisponível');
      return new THREE.WebGLRenderer({ canvas, context: gl, antialias: false, alpha: false });
    },
    () => {
      const gl = canvas.getContext('experimental-webgl', opts);
      if (!gl) throw new Error('experimental-webgl indisponível');
      return new THREE.WebGLRenderer({ canvas, context: gl, antialias: false, alpha: false });
    },
    () => {
      const gl = canvas.getContext('webgl2', opts);
      if (!gl) throw new Error('webgl2 indisponível');
      return new THREE.WebGLRenderer({ canvas, context: gl, antialias: false, alpha: false });
    },
  ];
  let lastErr = null;
  for (const fn of attempts) {
    try {
      return fn();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Error creating WebGL context.');
}

function probeWebGL() {
  const c = document.createElement('canvas');
  return !!(c.getContext('webgl', { failIfMajorPerformanceCaveat: false })
    || c.getContext('experimental-webgl', { failIfMajorPerformanceCaveat: false }));
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
    hint.textContent = 'WebGL desligado neste Chrome. Ative aceleração de hardware em Configurações → Sistema.';
    hint.style.color = '#f87171';
  }
}

function boot(renderer) {
  // pixelRatio 1 = bem mais leve (evita Chrome bloquear WebGL neste PC)
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    showWebglError('WebGL context lost (cena pesada / GPU). Feche o Chrome e abra de novo.');
  }, false);

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
  const labelMats = {
    1: new THREE.MeshBasicMaterial({ color: 0x58a6ff }),
    2: new THREE.MeshBasicMaterial({ color: 0x3fb950 }),
    3: new THREE.MeshBasicMaterial({ color: 0xd2a8ff }),
    4: new THREE.MeshBasicMaterial({ color: 0xffa657 }),
  };
  const slotPlateOccMat = new THREE.MeshBasicMaterial({ color: 0x14532d, side: THREE.DoubleSide });
  const PLATE_W = BAY_D * 0.68;
  const PLATE_H = LEVEL_H * 0.52;
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
  const texCache = new Map();
  let ocupacao = {}; // preenchido após carregar API

  function parseEnderecoParts(endereco) {
    const p = String(endereco || '').split('-');
    return {
      rua: p[0] || '—',
      nivel: p[1] || '—',
      edif: p[2] || '—',
      pos: p[3] || '—',
    };
  }

  function complementoDosItens(itens) {
    const comps = [];
    for (const it of itens || []) {
      const c = String(it.complemento || '').trim();
      if (c && !comps.includes(c)) comps.push(c);
    }
    return comps.join(', ');
  }

  /** Textura pequena (só usada perto da câmera — máx. 28 ativas). */
  function makeSlotTexture(endereco, ocupado, complemento) {
    const comp = String(complemento || '').trim();
    const key = `${endereco}|${ocupado ? '1' : '0'}|${comp}`;
    if (texCache.has(key)) return texCache.get(key);

    const W = 96;
    const H = 128;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = ocupado ? '#14532d' : '#4a3f34';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = ocupado ? '#22c55e' : '#8b7355';
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, W - 4, H - 4);

    const parts = parseEnderecoParts(endereco);
    const linhas = [
      `Rua: ${parts.rua}`,
      `Nivel: ${parts.nivel}`,
      `Edif.: ${parts.edif}`,
      `Pos.: ${parts.pos}`,
      `Compl.: ${comp || '—'}`,
    ];
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 11px ui-sans-serif, system-ui, sans-serif';
    linhas.forEach((line, i) => {
      let text = line;
      if (ctx.measureText(text).width > W - 10) {
        while (text.length > 3 && ctx.measureText(`${text}…`).width > W - 10) text = text.slice(0, -1);
        text = `${text}…`;
      }
      ctx.fillText(text, 6, 14 + i * 22);
    });

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    texCache.set(key, tex);
    return tex;
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

  const MAX_LABEL_TEX = 28;
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
    const old = mesh.material;
    if (old && old !== slotPlateOccMat) old.dispose();
    mesh.material = slotPlateOccMat;
    mesh.userData.hasLabelTex = false;
  }

  function setSlotLabeled(mesh) {
    if (mesh.userData.hasLabelTex) return;
    const end = mesh.userData.endereco;
    const ocupado = !!mesh.userData.ocupado;
    const comp = mesh.userData.complemento || '';
    const tex = makeSlotTexture(end, ocupado, comp);
    const old = mesh.material;
    if (old && old !== slotPlateOccMat) old.dispose();
    mesh.material = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    mesh.userData.hasLabelTex = true;
  }

  function updateNearbySlotLabels(dt) {
    labelTexAcc += dt;
    if (labelTexAcc < 0.45) return;
    labelTexAcc = 0;
    const cam = controls.getObject().position;
    const scored = [];
    for (const mesh of slotMeshes) {
      if (!mesh.visible) continue; // vazias não entram
      mesh.getWorldPosition(_wp);
      scored.push({ mesh, d: _wp.distanceTo(cam) });
    }
    scored.sort((a, b) => a.d - b.d);
    const keep = new Set();
    for (const row of scored) {
      if (row.d > 11) break;
      if (keep.size >= MAX_LABEL_TEX) break;
      keep.add(row.mesh);
    }
    for (const mesh of slotMeshes) {
      if (!mesh.visible) continue;
      if (keep.has(mesh)) setSlotLabeled(mesh);
      else if (mesh.userData.hasLabelTex) setSlotSolid(mesh);
    }
  }

  /**
   * Fileira porta-pallet com 2 posições por bay (001 e 002), como no grid 2D.
   * lado: 'E' | 'D'
   * faceSign: +1 (E) | -1 (D) — banner sempre no extremo −Z do mundo (visão inicial).
   */
  function createPortaPalletRow(rua, lado, faceSign) {
    const group = new THREE.Group();
    group.name = `R${rua}_${lado}`;
    const halfL = RACK_LEN / 2;

    for (let i = 0; i <= BAYS; i++) {
      const z = -halfL + i * BAY_W;
      for (const lx of [-BAY_D / 2 + POST_W / 2, BAY_D / 2 - POST_W / 2]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(POST_W, RACK_H, POST_W), orangeMat);
        post.position.set(lx, RACK_H / 2, z);
        group.add(post);
      }
    }

    for (let lv = 0; lv < LEVELS; lv++) {
      const y = 0.2 + lv * LEVEL_H;
      const nivel = lv + 1; // 1 embaixo … 6 em cima (igual Armazém 3D)
      for (let i = 0; i < BAYS; i++) {
        const zBay = -halfL + (i + 0.5) * BAY_W;
        const colNum = i + 1; // i=0 em −Z

        for (const lx of [-BAY_D / 2 + BEAM_D, BAY_D / 2 - BEAM_D]) {
          const beam = new THREE.Mesh(
            new THREE.BoxGeometry(BEAM_D, BEAM_H, BAY_W - POST_W * 0.3),
            orangeMat
          );
          beam.position.set(lx, y, zBay);
          group.add(beam);
        }

        // Duas posições no bay (como cards 001/002 no grid)
        // Ordem visual ao olhar a face: E → d(002), e(001); D → e(001), d(002)
        const slots = lado === 'E'
          ? [{ pos: '002', t: -0.22 }, { pos: '001', t: 0.22 }]
          : [{ pos: '001', t: -0.22 }, { pos: '002', t: 0.22 }];

        for (const slot of slots) {
          const endereco = buildEndereco(rua, nivel, colNum, lado, slot.pos);
          const z = zBay + slot.t * BAY_W;
          const py = y + BEAM_H / 2 + PLATE_H / 2 + 0.06;
          slotRegistry.set(endereco, {
            group,
            px: BAY_D / 2 - 0.03,
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

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(BAY_D + 0.15, 0.1, RACK_LEN + 0.1),
      woodDarkMat
    );
    base.position.y = 0.05;
    group.add(base);

    // Banner leve (1 textura compartilhada) — lista completa vai para painel HTML
    const bannerW = 1.2;
    const bannerH = RACK_H * 0.85;
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(bannerW, bannerH), sharedBannerMat);
    banner.rotation.y = Math.PI / 2;
    const zBanner = faceSign > 0
      ? -halfL - bannerW / 2 - 0.08
      : halfL + bannerW / 2 + 0.08;
    banner.position.set(BAY_D / 2 + 0.04, bannerH / 2 + 0.08, zBanner);
    banner.userData = { tipo: 'overflow', rua, lado, fora: [] };
    group.add(banner);
    overflowMeshes.push(banner);

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, bannerH + 0.06, bannerW + 0.06),
      orangeMat
    );
    frame.position.set(BAY_D / 2 + 0.01, bannerH / 2 + 0.08, zBanner);
    group.add(frame);

    return group;
  }

  function addColliderAt(x, z, w, d) {
    colliders.push({
      minX: x - w / 2, maxX: x + w / 2,
      minZ: z - d / 2, maxZ: z + d / 2,
    });
  }

  function placeRow(x, faceSign, ruaNum) {
    const lado = faceSign > 0 ? 'E' : 'D';
    const row = createPortaPalletRow(ruaNum, lado, faceSign);
    row.rotation.y = faceSign > 0 ? 0 : Math.PI;
    row.position.set(x, 0, 0);
    scene.add(row);
    addColliderAt(x, 0, BAY_D + 0.08, RACK_LEN + 0.1);

    const label = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.04, 0.9),
      labelMats[ruaNum] || labelMats[1]
    );
    label.position.set(x + faceSign * (BAY_D / 2 + 0.55), 0.03, -RACK_LEN / 2 + 0.6);
    scene.add(label);
  }

  /**
   * Layout ancorado na parede DIREITA:
   * … R1E || R1D | aisle | R2E || R2D | aisle | R3E || R3D | aisle | R4D | [parede]
   * Distâncias de corredor (AISLE_W) e costas (BACK_GAP) iguais às de antes.
   */
  const BACK_GAP = 0.25;
  const WALL_GAP = 0.08; // folga mínima parede ↔ costa do R4
  const aisles = {};

  // R4 (só um lado) encostado na parede direita; face olha para a esquerda (−X)
  let x = floorW / 2 - wallT / 2 - WALL_GAP - BAY_D / 2;
  placeRow(x, -1, 4);
  aisles[4] = x - BAY_D / 2 - AISLE_W / 2;
  x = aisles[4] - AISLE_W / 2 - BAY_D / 2;

  // R3-D (face −X, costas para o corredor R4) || R3-E (face +X, para o corredor R4)
  // Ordem da direita para a esquerda: primeiro a face que olha o aisle4 (R3-E com face +X)
  placeRow(x, +1, 3); // R3-E frente para o aisle4 (+X)
  x -= BAY_D + BACK_GAP;
  placeRow(x, -1, 3); // R3-D costas coladas
  aisles[3] = x - BAY_D / 2 - AISLE_W / 2;
  x = aisles[3] - AISLE_W / 2 - BAY_D / 2;

  // R2
  placeRow(x, +1, 2);
  x -= BAY_D + BACK_GAP;
  placeRow(x, -1, 2);
  aisles[2] = x - BAY_D / 2 - AISLE_W / 2;
  x = aisles[2] - AISLE_W / 2 - BAY_D / 2;

  // R1
  placeRow(x, +1, 1);
  x -= BAY_D + BACK_GAP;
  placeRow(x, -1, 1);
  aisles[1] = aisles[2];

  // Faixas amarelas nos corredores (sem lâmpadas — alívio de GPU)
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xf0c000 });
  function addAisleDecor(ax) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.12, RACK_LEN - 1), stripeMat);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(ax, 0.015, 0);
    scene.add(stripe);
  }
  [...new Set(Object.values(aisles))].forEach(addAisleDecor);

  // Spawn no MEIO do corredor (nunca dentro do porta-pallet)
  function collidesAt(px, pz) {
    const r = PLAYER.radius;
    for (const c of colliders) {
      if (px + r > c.minX && px - r < c.maxX && pz + r > c.minZ && pz - r < c.maxZ) return true;
    }
    return false;
  }

  let spawnX = aisles[2];
  let spawnZ = 0;
  if (collidesAt(spawnX, spawnZ)) {
    for (const ax of [aisles[3], aisles[4]]) {
      if (!collidesAt(ax, 0)) { spawnX = ax; spawnZ = 0; break; }
    }
  }
  if (collidesAt(spawnX, spawnZ)) {
    spawnX = aisles[2];
    spawnZ = RACK_LEN / 2 + 2.5;
  }

  controls.getObject().position.set(spawnX, PLAYER.eye, spawnZ);
  let eyeY = PLAYER.eye;
  // Olhar ao longo do corredor (−Z)
  controls.getObject().rotation.y = 0;

  const startPad = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 28),
    new THREE.MeshBasicMaterial({ color: 0x58a6ff })
  );
  startPad.rotation.x = -Math.PI / 2;
  startPad.position.set(spawnX, 0.02, spawnZ);
  scene.add(startPad);

  // ——— Ocupação + balão + painel HTML "Fora do mapa" ———
  const lookBalloon = document.getElementById('lookBalloon');
  const lookBalloonEnd = document.getElementById('lookBalloonEnd');
  const lookBalloonBody = document.getElementById('lookBalloonBody');
  const foraPanel = document.getElementById('foraPanel');
  const foraPanelSub = document.getElementById('foraPanelSub');
  const foraPanelList = document.getElementById('foraPanelList');
  let lookAlvoAtual = null;
  let foraPanelKey = null;

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
        mesh.userData.hasLabelTex = false;
        setSlotSolid(mesh);
      } else {
        removeSlotMesh(rec);
      }
    }
    for (const mesh of overflowMeshes) {
      const { rua, lado } = mesh.userData;
      mesh.userData.fora = listForaDoMapa(rua, lado);
    }
    lookAlvoAtual = null;
    foraPanelKey = null;
    if (foraPanel) foraPanel.hidden = true;
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

  function htmlProdutos(itens) {
    if (!itens.length) {
      return '<div class="look-balloon-empty">Sem produto neste endereço.</div>';
    }
    return itens.map((it) => {
      const foto = it.foto_url
        ? `<img src="${escHtml(it.foto_url)}" alt="">`
        : '<div style="width:36px;height:36px;border-radius:4px;background:#21262d;flex-shrink:0;"></div>';
      const comp = it.complemento
        ? `<div class="desc">Compl.: ${escHtml(it.complemento)}</div>`
        : '';
      return `<div class="look-balloon-row">
        ${foto}
        <div>
          <div class="cod">${escHtml(it.codigo_produto)}</div>
          <div class="desc">${escHtml(it.descricao || '')}</div>
          ${comp}
          <div class="qtd">${escHtml(it.qtd)} ${escHtml(it.unidade || 'UN')}</div>
        </div>
      </div>`;
    }).join('');
  }

  function mostrarBalaoEndereco(endereco) {
    const key = `slot:${endereco}`;
    if (lookAlvoAtual === key) return;
    lookAlvoAtual = key;
    lookBalloonEnd.textContent = endereco;
    lookBalloonBody.innerHTML = htmlProdutos(aggregateItens(ocupacao[endereco] || []));
    lookBalloon.hidden = false;
  }

  function mostrarBalaoProduto(endereco, item) {
    const key = `prod:${endereco}:${item.codigo_produto}`;
    if (lookAlvoAtual === key) return;
    lookAlvoAtual = key;
    lookBalloonEnd.textContent = `${endereco} · ${item.codigo_produto}`;
    lookBalloonBody.innerHTML = htmlProdutos([item]);
    lookBalloon.hidden = false;
  }

  function esconderBalao() {
    lookAlvoAtual = null;
    lookBalloon.hidden = true;
  }

  function mostrarForaPanel(mesh) {
    const { rua, lado, fora } = mesh.userData;
    const key = `${rua}:${lado}`;
    if (foraPanelKey === key) return;
    foraPanelKey = key;
    const ruaStr = String(rua).padStart(2, '0');
    const refMaior = lado === 'E' ? `${ruaStr}-xx-19` : `${ruaStr}-xx-20`;
    if (foraPanelSub) {
      foraPanelSub.textContent = `Ao lado de ${refMaior} · ${(fora || []).length} endereço(s)`;
    }
    if (!fora || !fora.length) {
      foraPanelList.innerHTML = '<div class="fora-empty">Nenhum endereço fora do mapa.</div>';
    } else {
      foraPanelList.innerHTML = fora.map((row) => {
        const prods = (row.itens || []).map((it) => `
          <button type="button" class="fora-prod" data-end="${escHtml(row.endereco)}" data-cod="${escHtml(it.codigo_produto)}">
            ${it.foto_url ? `<img src="${escHtml(it.foto_url)}" alt="">` : '<span class="fora-prod-ph"></span>'}
            <span class="fora-prod-meta">
              <span class="cod">${escHtml(it.codigo_produto)}</span>
              <span class="qtd">${escHtml(it.qtd)} ${escHtml(it.unidade || 'UN')}</span>
            </span>
          </button>`).join('');
        return `<div class="fora-item">
          <div class="fora-end">${escHtml(row.endereco)}</div>
          ${prods}
        </div>`;
      }).join('');
    }
    foraPanel.hidden = false;
  }

  function esconderForaPanel() {
    foraPanelKey = null;
    if (foraPanel) foraPanel.hidden = true;
  }

  if (foraPanelList) {
    foraPanelList.addEventListener('click', (e) => {
      const btn = e.target.closest('.fora-prod');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const end = btn.dataset.end;
      const cod = btn.dataset.cod;
      const row = (overflowMeshes.find((m) =>
        m.userData.fora?.some((f) => f.endereco === end)
      )?.userData.fora || []).find((f) => f.endereco === end);
      const item = (row?.itens || []).find((i) => String(i.codigo_produto) === cod);
      if (item) mostrarBalaoProduto(end, item);
    });
  }

  // Com pointer lock: rolar lista do painel com a roda do mouse / arrastar
  let foraDrag = false;
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (!playing && !controls.isLocked) return;
    if (!foraPanel || foraPanel.hidden) return;
    foraDrag = true;
    controls.pointerSpeed = 0;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    if (!foraDrag) return;
    foraDrag = false;
    controls.pointerSpeed = 1;
  });
  document.addEventListener('mousemove', (e) => {
    if (!foraDrag || !foraPanelList) return;
    foraPanelList.scrollTop += e.movementY || 0;
  });
  canvas.addEventListener('wheel', (e) => {
    if (!playing && !controls.isLocked) return;
    if (!foraPanel || foraPanel.hidden) return;
    e.preventDefault();
    foraPanelList.scrollTop += e.deltaY;
  }, { passive: false });
  controls.addEventListener('unlock', () => {
    foraDrag = false;
    controls.pointerSpeed = 1;
  });

  const raycaster = new THREE.Raycaster();
  const centerNdc = new THREE.Vector2(0, 0);
  let lookAcc = 0;

  function raycastCenter() {
    raycaster.setFromCamera(centerNdc, camera);
    return raycaster.intersectObjects([...slotMeshes, ...overflowMeshes], false);
  }

  function updateLookTarget(dt) {
    if (!playing && !controls.isLocked) {
      esconderBalao();
      esconderForaPanel();
      return;
    }
    lookAcc += dt;
    if (lookAcc < 0.1) return;
    lookAcc = 0;
    const hits = raycastCenter();
    if (!hits.length || hits[0].distance > 16) {
      esconderBalao();
      esconderForaPanel();
      return;
    }
    const obj = hits[0].object;
    if (obj.userData.tipo === 'overflow') {
      mostrarForaPanel(obj);
      // Mira vermelha sobre o código no painel HTML
      const el = document.elementFromPoint(
        Math.floor(window.innerWidth / 2),
        Math.floor(window.innerHeight / 2)
      );
      const btn = el && el.closest ? el.closest('.fora-prod') : null;
      if (btn) {
        const end = btn.dataset.end;
        const cod = btn.dataset.cod;
        const row = (obj.userData.fora || []).find((f) => f.endereco === end);
        const item = (row?.itens || []).find((i) => String(i.codigo_produto) === cod);
        if (item) mostrarBalaoProduto(end, item);
        else esconderBalao();
      } else {
        esconderBalao();
      }
    } else {
      esconderForaPanel();
      mostrarBalaoEndereco(obj.userData.endereco);
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

  function animate() {
    requestAnimationFrame(animate);
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

  animate();
}
