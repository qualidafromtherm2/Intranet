/**
 * Produção 3D — mesmo barracão do Explorar 3D, com esteira de produção.
 * Fotos das OPs em Producao.OP_producao. Navegação = PointerLock + WASD / touch.
 */
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { openProducao3dRiModal } from './ri-modal.js';

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
    'Faça assim:\n' +
    '1) Feche TODAS as janelas do Chrome\n' +
    '2) No terminal, rode:\n' +
    '   ./producao-3d/abrir-com-gpu.sh\n' +
    '3) Produção → Produção 3D → Entrar\n\n' +
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

const HALL_SIZE_MUL = 1.15;
const HALL_HEIGHT_MUL = 1.15;

const FLOOR_COL = 0xd0d5dc;
const WALL_COL = 0xf4f6f8;
const CEIL_COL = 0xffffff;
const STEEL = 0x6b7280;
const STEEL_DARK = 0x374151;
const ROLLER = 0x9ca3af;

const colliders = [];
const keys = Object.create(null);

let appRenderer = null;
let sceneBooted = false;
let enterPlayFn = null;
let waitSceneReadyFn = async () => {};

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

if (sessionStorage.getItem('prod3d_auto_boot') === '1') {
  sessionStorage.removeItem('prod3d_auto_boot');
  setTimeout(() => tryBootScene(), 50);
}

const btnOpenNewTab = document.getElementById('btnOpenNewTab');
if (btnOpenNewTab) {
  btnOpenNewTab.addEventListener('click', () => {
    const u = new URL('/producao-3d/', window.location.origin);
    window.open(u.toString(), '_blank', 'noopener');
  });
}

if (!probeWebGL()) {
  const hint = document.querySelector('.hint');
  if (hint) {
    hint.innerHTML = 'Neste PC ainda precisa abrir o Chrome pelo <strong>atalho WebGL</strong> (veja abaixo).';
    hint.style.color = '#fbbf24';
  }
  const gpuHelp = document.getElementById('gpuHelp');
  if (gpuHelp) gpuHelp.hidden = false;
}

function boot(renderer) {
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

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
    clearTimeout(ctxReloadTimer);
    ctxReloadTimer = setTimeout(() => {
      const n = Number(sessionStorage.getItem('prod3d_ctx_reloads') || '0');
      if (n < 2) {
        sessionStorage.setItem('prod3d_ctx_reloads', String(n + 1));
        sessionStorage.setItem('prod3d_auto_boot', '1');
        window.location.reload();
      } else {
        recoveryOverlay(false);
        showWebglError('O WebGL caiu várias vezes. Abra o Chrome pelo atalho WebGL.');
      }
    }, 6000);
  }, false);

  canvas.addEventListener('webglcontextrestored', () => {
    clearTimeout(ctxReloadTimer);
    ctxLost = false;
    recoveryOverlay(false);
  }, false);

  setTimeout(() => {
    if (!ctxLost) sessionStorage.removeItem('prod3d_ctx_reloads');
  }, 60000);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe8eef4);

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 120);

  const controls = new PointerLockControls(camera, document.body);
  camera.rotation.order = 'YXZ';
  const touchPad = document.getElementById('touchPad');

  const forceTouch = new URLSearchParams(location.search).has('touch');
  const isTouchUI =
    forceTouch ||
    window.matchMedia('(pointer: coarse)').matches ||
    (navigator.maxTouchPoints > 1 && window.matchMedia('(hover: none)').matches);

  if (isTouchUI) document.body.classList.add('is-touch');

  let playing = false;
  let awaitingAssets = false;
  const enterLoadingEl = document.getElementById('enterLoading');
  const enterLoadingSub = enterLoadingEl?.querySelector('.enter-loading-sub');
  const imgCache = new Map();
  const loadGate = { ops: false };
  let warmFrames = 0;
  const readyWaiters = [];
  let usuarioLiberado = false;

  function atualizarTextoSpinner() {
    if (!enterLoadingSub) return;
    if (!loadGate.ops) {
      enterLoadingSub.textContent = 'Carregando OPs da produção…';
    } else {
      enterLoadingSub.textContent = 'Finalizando a cena…';
    }
  }

  function cenasProntas() {
    return loadGate.ops && warmFrames >= 2;
  }

  function syncHudJogo() {
    const ativo = !!(playing || controls.isLocked) && !awaitingAssets;
    const ch = document.getElementById('crosshair');
    if (ch) ch.hidden = !ativo;
    if (ativo) {
      blocker.hidden = true;
      hud.hidden = false;
      if (enterLoadingEl) {
        enterLoadingEl.hidden = true;
        enterLoadingEl.style.display = 'none';
      }
    }
  }

  function notifySceneReady() {
    atualizarTextoSpinner();
    if (!cenasProntas()) return;
    while (readyWaiters.length) {
      try { readyWaiters.shift()(); } catch (_) {}
    }
  }

  waitSceneReadyFn = () => new Promise((resolve) => {
    if (cenasProntas()) { resolve(); return; }
    readyWaiters.push(resolve);
  });

  let ignoreUnlockUntil = 0;
  let inspectMode = false;
  let inspectMesh = null;
  let riModalAberto = false;

  function liberarControlesAposCarga() {
    awaitingAssets = false;
    usuarioLiberado = true;
    ignoreUnlockUntil = Date.now() + 800;
    if (enterLoadingEl) {
      enterLoadingEl.hidden = true;
      enterLoadingEl.style.display = 'none';
    }
    playing = true;
    blocker.hidden = true;
    hud.hidden = false;
    touchPad.hidden = !isTouchUI;
    syncHudJogo();
    if (!isTouchUI && !controls.isLocked) {
      try { controls.lock(); } catch (_) { /* clique */ }
    }
    btnEnter.textContent = 'Toque / clique para entrar';
  }

  async function enterPlay() {
    if (btnEnter.disabled) return;

    if (!awaitingAssets && usuarioLiberado) {
      playing = true;
      ignoreUnlockUntil = Date.now() + 800;
      syncHudJogo();
      if (isTouchUI) {
        touchPad.hidden = false;
        return;
      }
      try { controls.lock(); } catch (err) {
        showWebglError('Pointer Lock bloqueado: ' + (err.message || err));
      }
      return;
    }

    awaitingAssets = true;
    playing = false;
    if (enterLoadingEl) {
      enterLoadingEl.hidden = false;
      enterLoadingEl.style.display = '';
    }
    blocker.hidden = true;
    const ch0 = document.getElementById('crosshair');
    if (ch0) ch0.hidden = true;
    atualizarTextoSpinner();

    if (!isTouchUI) {
      try { controls.lock(); } catch (_) {}
    }

    try {
      await Promise.race([
        Promise.all([waitSceneReadyFn(), new Promise((r) => setTimeout(r, 400))]),
        new Promise((r) => setTimeout(r, 15000)),
      ]);
    } catch (_) { /* segue */ }

    loadGate.ops = true;
    liberarControlesAposCarga();
  }
  enterPlayFn = enterPlay;

  function exitPlay() {
    playing = false;
    awaitingAssets = false;
    inspectMode = false;
    inspectMesh = null;
    riModalAberto = false;
    if (enterLoadingEl) enterLoadingEl.hidden = true;
    touchPad.hidden = true;
    document.getElementById('crosshair').hidden = true;
    const lb = document.getElementById('lookBalloon');
    if (lb) {
      lb.hidden = true;
      lb.classList.remove('is-locked');
    }
    if (controls.isLocked) controls.unlock();
    blocker.hidden = false;
    hud.hidden = true;
  }

  controls.addEventListener('lock', () => {
    blocker.hidden = true;
    if (enterLoadingEl) {
      enterLoadingEl.hidden = true;
      enterLoadingEl.style.display = 'none';
    }
    if (awaitingAssets) {
      playing = false;
      hud.hidden = true;
      touchPad.hidden = true;
      const ch = document.getElementById('crosshair');
      if (ch) ch.hidden = true;
      return;
    }
    playing = true;
    syncHudJogo();
  });

  controls.addEventListener('unlock', () => {
    if (awaitingAssets) {
      playing = false;
      return;
    }
    // Painel da placa fixado OU modal RI: mantém a cena (mouse livre)
    if (inspectMode || riModalAberto) {
      playing = true;
      blocker.hidden = true;
      hud.hidden = false;
      const ch = document.getElementById('crosshair');
      if (ch) ch.hidden = true;
      if (inspectMode && lookBalloon) {
        lookBalloon.hidden = false;
        lookBalloon.classList.add('is-locked');
      }
      return;
    }
    if (Date.now() < ignoreUnlockUntil) {
      playing = true;
      syncHudJogo();
      if (!isTouchUI) {
        try { controls.lock(); } catch (_) {}
      }
      return;
    }
    if (!isTouchUI) {
      playing = false;
      blocker.hidden = false;
      hud.hidden = true;
      const ch = document.getElementById('crosshair');
      if (ch) ch.hidden = true;
      document.getElementById('lookBalloon').hidden = true;
      btnEnter.textContent = 'Toque / clique para entrar';
    }
  });

  // ——— Touch: olhar + joystick ———
  const LOOK_SENS = 0.0045;
  const PI_2 = Math.PI / 2;
  let lookPointerId = null;
  let lookLastX = 0;
  let lookLastY = 0;
  const joyMove = { x: 0, y: 0, active: false };

  function applyLookDelta(dx, dy) {
    const obj = controls.getObject();
    obj.rotation.order = 'YXZ';
    obj.rotation.y -= dx * LOOK_SENS;
    obj.rotation.x -= dy * LOOK_SENS;
    obj.rotation.z = 0;
    obj.rotation.x = Math.max(-PI_2 + 0.05, Math.min(PI_2 - 0.05, obj.rotation.x));
  }

  function onLookStart(e) {
    if (inspectMode || riModalAberto) return;
    if (!playing || controls.isLocked) return;
    if (e.target.closest && (
      e.target.closest('#joyMove') ||
      e.target.closest('.touch-vert-btns') ||
      e.target.closest('.touch-left-stack') ||
      e.target.closest('.touch-action-btns')
    )) return;
    if (e.clientX < window.innerWidth * 0.42) return;
    lookPointerId = e.pointerId;
    lookLastX = e.clientX;
    lookLastY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  }
  function onLookMove(e) {
    if (!playing || controls.isLocked) return;
    if (lookPointerId !== e.pointerId) return;
    const dx = e.clientX - lookLastX;
    const dy = e.clientY - lookLastY;
    lookLastX = e.clientX;
    lookLastY = e.clientY;
    applyLookDelta(dx, dy);
  }
  function onLookEnd(e) {
    if (lookPointerId !== e.pointerId) return;
    lookPointerId = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  }
  canvas.addEventListener('pointerdown', onLookStart);
  canvas.addEventListener('pointermove', onLookMove);
  canvas.addEventListener('pointerup', onLookEnd);
  canvas.addEventListener('pointercancel', onLookEnd);

  const joyMoveEl = document.getElementById('joyMove');
  const joyMoveStick = document.getElementById('joyMoveStick');
  let joyPointerId = null;
  const JOY_MAX = 48;

  function setJoyVisual(nx, ny) {
    if (!joyMoveStick) return;
    joyMoveStick.style.transform = `translate(${nx * JOY_MAX}px, ${ny * JOY_MAX}px)`;
  }
  function joyFromEvent(e) {
    const rect = joyMoveEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = (e.clientX - cx) / JOY_MAX;
    let dy = (e.clientY - cy) / JOY_MAX;
    const len = Math.hypot(dx, dy) || 1;
    if (len > 1) { dx /= len; dy /= len; }
    joyMove.x = dx;
    joyMove.y = dy;
    joyMove.active = true;
    setJoyVisual(dx, dy);
  }
  if (joyMoveEl) {
    joyMoveEl.addEventListener('pointerdown', (e) => {
      joyPointerId = e.pointerId;
      try { joyMoveEl.setPointerCapture(e.pointerId); } catch (_) {}
      joyFromEvent(e);
    });
    joyMoveEl.addEventListener('pointermove', (e) => {
      if (joyPointerId !== e.pointerId) return;
      joyFromEvent(e);
    });
    const endJoy = (e) => {
      if (joyPointerId !== e.pointerId) return;
      joyPointerId = null;
      joyMove.x = 0;
      joyMove.y = 0;
      joyMove.active = false;
      setJoyVisual(0, 0);
    };
    joyMoveEl.addEventListener('pointerup', endJoy);
    joyMoveEl.addEventListener('pointercancel', endJoy);
  }

  document.querySelectorAll('.wasd-btn').forEach((btn) => {
    const code = btn.getAttribute('data-key');
    if (!code) return;
    const setDown = (down, ev) => {
      if (ev) { ev.preventDefault(); ev.stopPropagation(); }
      keys[code] = down;
      btn.classList.toggle('is-down', down);
    };
    btn.addEventListener('pointerdown', (e) => {
      try { btn.setPointerCapture(e.pointerId); } catch (_) {}
      setDown(true, e);
    });
    btn.addEventListener('pointerup', (e) => setDown(false, e));
    btn.addEventListener('pointercancel', (e) => setDown(false, e));
    btn.addEventListener('lostpointercapture', () => setDown(false));
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && inspectMode) {
      e.preventDefault();
      exitInspect();
      return;
    }
    if (e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT')) return;
    keys[e.code] = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT')) return;
    keys[e.code] = false;
  });

  // ——— Materiais ———
  const floorMat = new THREE.MeshBasicMaterial({ color: FLOOR_COL });
  const wallMat = new THREE.MeshBasicMaterial({ color: WALL_COL });
  const ceilMat = new THREE.MeshBasicMaterial({ color: CEIL_COL });
  const steelMat = new THREE.MeshBasicMaterial({ color: STEEL });
  const steelDarkMat = new THREE.MeshBasicMaterial({ color: STEEL_DARK });
  const rollerMat = new THREE.MeshBasicMaterial({ color: ROLLER });

  scene.add(new THREE.AmbientLight(0xffffff, 1.2));

  // ——— Barracão ———
  const floorW = 28 * HALL_SIZE_MUL;
  const floorD = 36 * HALL_SIZE_MUL;
  const wallT = 0.4;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorW, floorD), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.userData.tipo = 'chao';
  scene.add(floor);

  const wallH = 6.5 * HALL_HEIGHT_MUL;
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

  // Faixas no chão (linha de produção)
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
  const STRIPE_X = 4.2;
  for (const x of [-STRIPE_X, STRIPE_X]) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.12, floorD * 0.7), stripeMat);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(x, 0.015, 0);
    scene.add(stripe);
  }

  // Placa "LINHA DE PRODUÇÃO" no chão (texto inteiro, sem corte)
  {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 160;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f97316';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 64px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const txt = 'LINHA DE PRODUÇÃO';
    // Ajusta fonte se ainda ficar apertado
    let fontSize = 64;
    while (fontSize > 36 && ctx.measureText(txt).width > c.width - 48) {
      fontSize -= 2;
      ctx.font = `bold ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
    }
    ctx.fillText(txt, c.width / 2, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(9.5, 1.5),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    );
    label.rotation.x = -Math.PI / 2;
    label.position.set(0, 0.02, floorD / 2 - 4);
    scene.add(label);
  }

  // ——— Esteira com roletes (principal + 2 ramais) ———
  // Layout:
  //   ========================  (principal ao longo de Z)
  //        |            |       (ramais em X)
  //        |            |
  const BELT_LEN = floorD * 0.72;
  const BELT_W = 1.8;
  const BELT_Y = 0.85;
  const ROLLER_R = 0.07;
  const ROLLER_GAP = 0.28;
  const LEG_H = BELT_Y - ROLLER_R;
  const BRANCH_LEN = 6.4; // ramais (dobrado)

  const beltGroup = new THREE.Group();
  scene.add(beltGroup);
  const rollers = [];

  /**
   * Cria um trecho de esteira só com estrutura + roletes (sem tapa preta / sem guia laranja).
   * axis: 'z' = comprimento em Z; 'x' = comprimento em X.
   * cx,cz = centro do trecho no chão.
   * nome = rótulo no chão ao lado da esteira.
   */
  function createBeltSegment({ axis, length, cx, cz, nome, labelSide }) {
    const group = new THREE.Group();
    group.position.set(cx, 0, cz);
    group.userData.nome = nome || '';
    const alongX = axis === 'x';

    // Trilhos laterais (aço escuro)
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(
          alongX ? length + 0.4 : 0.08,
          0.18,
          alongX ? 0.08 : length + 0.4
        ),
        steelDarkMat
      );
      if (alongX) {
        rail.position.set(0, BELT_Y + 0.12, side * (BELT_W / 2 + 0.06));
      } else {
        rail.position.set(side * (BELT_W / 2 + 0.06), BELT_Y + 0.12, 0);
      }
      group.add(rail);

      const nLegs = Math.max(4, Math.round(length / 3.2));
      for (let i = 0; i < nLegs; i++) {
        const t = -length / 2 + (i / Math.max(1, nLegs - 1)) * length;
        const leg = new THREE.Mesh(
          new THREE.BoxGeometry(0.1, LEG_H + 0.2, 0.1),
          steelMat
        );
        if (alongX) {
          leg.position.set(t, (LEG_H + 0.2) / 2, side * (BELT_W / 2 + 0.05));
        } else {
          leg.position.set(side * (BELT_W / 2 + 0.05), (LEG_H + 0.2) / 2, t);
        }
        group.add(leg);
      }
    }

    // Travessas
    const nCross = Math.max(4, Math.round(length / 3.2));
    for (let i = 0; i < nCross; i++) {
      const t = -length / 2 + (i / Math.max(1, nCross - 1)) * length;
      const cross = new THREE.Mesh(
        new THREE.BoxGeometry(
          alongX ? 0.08 : BELT_W + 0.2,
          0.06,
          alongX ? BELT_W + 0.2 : 0.08
        ),
        steelMat
      );
      if (alongX) cross.position.set(t, 0.25, 0);
      else cross.position.set(0, 0.25, t);
      group.add(cross);
    }

    // Roletes (visíveis — sem placa preta por cima)
    const rollerGeo = new THREE.CylinderGeometry(ROLLER_R, ROLLER_R, BELT_W - 0.08, 12);
    if (alongX) rollerGeo.rotateX(Math.PI / 2);
    else rollerGeo.rotateZ(Math.PI / 2);
    const nRollers = Math.max(1, Math.floor(length / ROLLER_GAP));
    for (let i = 0; i < nRollers; i++) {
      const t = -length / 2 + ROLLER_GAP * 0.5 + i * ROLLER_GAP;
      if (t > length / 2) break;
      const roller = new THREE.Mesh(rollerGeo, rollerMat);
      if (alongX) roller.position.set(t, BELT_Y - ROLLER_R * 0.15, 0);
      else roller.position.set(0, BELT_Y - ROLLER_R * 0.15, t);
      roller.userData.spinAxis = alongX ? 'z' : 'x';
      group.add(roller);
      rollers.push(roller);
    }

    // Tambores nas pontas
    const drumGeo = new THREE.CylinderGeometry(0.14, 0.14, BELT_W + 0.15, 16);
    if (alongX) drumGeo.rotateX(Math.PI / 2);
    else drumGeo.rotateZ(Math.PI / 2);
    for (const tip of [-length / 2 - 0.15, length / 2 + 0.15]) {
      const drum = new THREE.Mesh(drumGeo, steelDarkMat);
      if (alongX) drum.position.set(tip, BELT_Y - 0.02, 0);
      else drum.position.set(0, BELT_Y - 0.02, tip);
      group.add(drum);
    }

    // Colisão
    const halfW = BELT_W / 2 + 0.25;
    const halfL = length / 2 + 0.5;
    if (alongX) {
      colliders.push({
        minX: cx - halfL, maxX: cx + halfL,
        minZ: cz - halfW, maxZ: cz + halfW,
      });
    } else {
      colliders.push({
        minX: cx - halfW, maxX: cx + halfW,
        minZ: cz - halfL, maxZ: cz + halfL,
      });
    }

    // Placa com o nome da esteira (chão, ao lado)
    if (nome) {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 128;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(0, 0, 512, 128);
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, 504, 120);
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 56px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(nome).toUpperCase(), 256, 64);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const planeW = Math.min(3.2, Math.max(1.8, length * 0.35));
      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(planeW, 0.8),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide })
      );
      label.rotation.x = -Math.PI / 2;
      const side = labelSide === 'left' ? -1 : 1;
      if (alongX) {
        label.position.set(0, 0.03, side * (BELT_W / 2 + 1.1));
      } else {
        label.position.set(side * (BELT_W / 2 + 1.1), 0.03, 0);
      }
      group.add(label);
    }

    beltGroup.add(group);
    return group;
  }

  // Layout tipo "F" + Programado no início do hermético (−Z):
  //      eletrica              hermetica              programado
  // |---------|--------------------------------|------|
  // |espera   |teste
  // |         |
  // Divisor elétrica|hermético = entrada TESTE
  // Divisor hermético|programado = um pouco antes do hermético
  const branchCenterX = BELT_W / 2 + BRANCH_LEN / 2;
  const BRANCH_GAP = 3.6;
  const PROG_LEN = 7.5; // trecho Programado (cabe várias placas)
  const zPonta = BELT_LEN / 2 - 0.9;
  const zEspera = zPonta;
  const zTeste = zPonta - BRANCH_GAP;

  const zEleIni = zTeste;
  const zEleFim = BELT_LEN / 2;
  const lenEle = Math.max(2, zEleFim - zEleIni);
  const czEle = (zEleIni + zEleFim) / 2;

  const zProgIni = -BELT_LEN / 2;
  const zProgFim = zProgIni + PROG_LEN;
  const lenProg = PROG_LEN;
  const czProg = (zProgIni + zProgFim) / 2;

  const zHermIni = zProgFim;
  const zHermFim = zTeste;
  const lenHerm = Math.max(2, zHermFim - zHermIni);
  const czHerm = (zHermIni + zHermFim) / 2;

  // aliases legados
  const zAntesFaixa = zEspera;
  const zFinal = zTeste;

  createBeltSegment({
    axis: 'z', length: lenProg, cx: 0, cz: czProg,
    nome: 'Programado', labelSide: 'left',
  });
  createBeltSegment({
    axis: 'z', length: lenHerm, cx: 0, cz: czHerm,
    nome: 'Hermético', labelSide: 'left',
  });
  createBeltSegment({
    axis: 'z', length: lenEle, cx: 0, cz: czEle,
    nome: 'Elétrica', labelSide: 'left',
  });

  createBeltSegment({
    axis: 'x', length: BRANCH_LEN, cx: branchCenterX, cz: zEspera,
    nome: 'Espera', labelSide: 'right',
  });
  createBeltSegment({
    axis: 'x', length: BRANCH_LEN, cx: branchCenterX, cz: zTeste,
    nome: 'Teste', labelSide: 'right',
  });

  // ——— Fotos das OPs na esteira ———
  const productMeshes = [];
  const productCards = []; // só os cards (billboard)
  const riBalloonLayer = document.getElementById('riBalloons');
  const riAnchors = []; // { el, mesh }
  const _riProj = new THREE.Vector3();
  const CARD_W = 0.62;
  const CARD_H = 0.78;
  const CARD_GAP = 1.2;

  function fotoProxyUrl(url) {
    return `/api/prateleiras3d/foto?url=${encodeURIComponent(url)}`;
  }

  const FOTO_MAX_INFLIGHT = 4;
  let fotoInflight = 0;
  const fotoQueue = [];

  function pumpFotoQueue() {
    while (fotoInflight < FOTO_MAX_INFLIGHT && fotoQueue.length) {
      const job = fotoQueue.shift();
      if (!job || !job.rec.loading || job.rec._started) continue;
      startFotoDownload(job.url, job.rec);
    }
  }

  function startFotoDownload(url, rec) {
    rec._started = true;
    fotoInflight += 1;
    const finalizar = (ok) => {
      if (!rec.loading) return;
      clearTimeout(rec._timer);
      rec.ok = !!ok;
      rec.loading = false;
      if (!ok) rec.failedAt = Date.now();
      fotoInflight = Math.max(0, fotoInflight - 1);
      const cbs = rec.cbs.splice(0);
      cbs.forEach((cb) => { try { cb(); } catch (_) {} });
      pumpFotoQueue();
    };
    rec._timer = setTimeout(() => finalizar(false), 12000);
    // Sem crossOrigin: proxy é same-origin; com anonymous + sem CORS a foto falhava
    rec.img.onload = () => finalizar(true);
    rec.img.onerror = () => finalizar(false);
    const src = (url.startsWith('/') || url.includes('/api/prateleiras3d/foto'))
      ? url
      : fotoProxyUrl(url);
    rec.img.src = src;
  }

  function loadFoto(url, onReady) {
    if (!url) { try { onReady(); } catch (_) {} return null; }
    let rec = imgCache.get(url);
    if (rec) {
      if (!rec.loading && !rec.ok && (Date.now() - (rec.failedAt || 0)) > 8000) {
        imgCache.delete(url);
        rec = null;
      } else {
        if (!rec.loading) onReady();
        else rec.cbs.push(onReady);
        return rec;
      }
    }
    rec = { img: new Image(), ok: false, loading: true, cbs: [onReady], _started: false };
    imgCache.set(url, rec);
    fotoQueue.push({ url, rec });
    pumpFotoQueue();
    return rec;
  }

  function escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function paintProductCard(mesh) {
    const ud = mesh.userData;
    if (!ud.canvas) return;
    const c = ud.canvas;
    const ctx = c.getContext('2d');
    const W = c.width;
    const H = c.height;
    const ops = Array.isArray(ud.ops) && ud.ops.length ? ud.ops : (ud.op ? [ud.op] : []);
    const op0 = ops[0] || {};

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 5;
    ctx.strokeRect(2, 2, W - 4, H - 4);

    const fotoH = H * 0.72;
    const n = ops.length;

    if (n <= 1) {
      const url = op0.foto_url;
      const rec = url ? imgCache.get(url) : null;
      if (url && rec && rec.ok) {
        const iw = rec.img.naturalWidth || 1;
        const ih = rec.img.naturalHeight || 1;
        const s = Math.max((W - 10) / iw, (fotoH - 8) / ih);
        const dw = iw * s;
        const dh = ih * s;
        ctx.save();
        ctx.beginPath();
        ctx.rect(5, 5, W - 10, fotoH - 6);
        ctx.clip();
        ctx.drawImage(rec.img, (W - dw) / 2, 5 + (fotoH - 6 - dh) / 2, dw, dh);
        ctx.restore();
      } else {
        ctx.fillStyle = '#f3f4f6';
        ctx.fillRect(5, 5, W - 10, fotoH - 6);
        ctx.fillStyle = '#6b7280';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 28px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText(String(op0.codigo || '—').slice(0, 14), W / 2, fotoH / 2);
        if (url && (!rec || rec.loading)) {
          loadFoto(url, () => paintProductCard(mesh));
        }
      }
    } else {
      // Grade agrupada (várias OPs na mesma placa)
      const cols = n <= 4 ? 2 : 3;
      const rows = Math.ceil(n / cols);
      const pad = 6;
      const cellW = (W - pad * 2) / cols;
      const cellH = (fotoH - pad) / rows;
      for (let i = 0; i < n; i++) {
        const op = ops[i];
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = pad + col * cellW;
        const y = pad + row * cellH;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 1, y + 1, cellW - 2, cellH - 2);
        ctx.clip();
        const url = op.foto_url;
        const rec = url ? imgCache.get(url) : null;
        if (url && rec && rec.ok) {
          const iw = rec.img.naturalWidth || 1;
          const ih = rec.img.naturalHeight || 1;
          const s = Math.max((cellW - 2) / iw, (cellH - 2) / ih);
          const dw = iw * s;
          const dh = ih * s;
          ctx.drawImage(rec.img, x + 1 + (cellW - 2 - dw) / 2, y + 1 + (cellH - 2 - dh) / 2, dw, dh);
        } else {
          ctx.fillStyle = '#e5e7eb';
          ctx.fillRect(x + 1, y + 1, cellW - 2, cellH - 2);
          ctx.fillStyle = '#374151';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = `bold ${Math.max(9, Math.floor(cellH * 0.18))}px ui-sans-serif, system-ui, sans-serif`;
          ctx.fillText(String(op.codigo || '—').slice(0, 10), x + cellW / 2, y + cellH / 2);
          if (url && (!rec || rec.loading)) {
            loadFoto(url, () => paintProductCard(mesh));
          }
        }
        ctx.restore();
        ctx.strokeStyle = '#d1d5db';
        ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);
      }
    }

    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, fotoH, W, H - fotoH);
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 18px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (n > 1) {
      ctx.fillText(`${n} OPs`, W / 2, fotoH + (H - fotoH) * 0.35);
      ctx.fillStyle = '#e5e7eb';
      ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(String(op0.codigo || '').slice(0, 16) + (n > 1 ? '…' : ''), W / 2, fotoH + (H - fotoH) * 0.72);
    } else {
      ctx.fillText(String(op0.n_op || 'OP').slice(0, 16), W / 2, fotoH + (H - fotoH) * 0.35);
      ctx.fillStyle = '#e5e7eb';
      ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(String(op0.codigo || '').slice(0, 18), W / 2, fotoH + (H - fotoH) * 0.72);
    }

    ud.tex.needsUpdate = true;
  }

  function clearRiBalloons() {
    for (const a of riAnchors) a.el?.remove();
    riAnchors.length = 0;
    if (riBalloonLayer) riBalloonLayer.innerHTML = '';
  }

  function clearProductMeshes() {
    clearRiBalloons();
    for (const m of productMeshes) {
      m.parent?.remove(m);
      if (m.material?.map) m.material.map.dispose();
      m.material?.dispose?.();
      m.geometry?.dispose?.();
    }
    productMeshes.length = 0;
    productCards.length = 0;
  }

  /** Marca OPs iguais às do kanban RI — Registro de inspeção. */
  function aplicarRiPendentes(itens, pendentes) {
    const ids = new Set();
    const nOps = new Set();
    for (const p of pendentes || []) {
      const id = Number(p.op_producao_id || 0);
      if (id > 0) ids.add(id);
      const n = String(p.numero_op || '').trim();
      if (n) nOps.add(n);
    }
    for (const it of itens || []) {
      const id = Number(it.id || 0);
      const n = String(it.n_op || '').trim();
      it.ri_pendente = (id > 0 && ids.has(id)) || (n && nOps.has(n));
    }
  }

  function attachRiBalloon(mesh, ops) {
    if (!riBalloonLayer || !mesh) return;
    const pending = (ops || []).filter((o) => o && o.ri_pendente);
    if (!pending.length) return;
    const el = document.createElement('div');
    el.className = 'ri-world-balloon';
    el.hidden = true;
    if (pending.length > 1) {
      el.innerHTML = `<strong>RI</strong><span>${pending.length} OPs</span>`;
    } else {
      const op = pending[0];
      el.innerHTML = `<strong>RI</strong><span>${escHtml(op.n_op || op.codigo || 'Registrar')}</span>`;
    }
    el.title = pending.length > 1
      ? `${pending.length} OPs aguardando RI`
      : `Aguardando RI — OP ${pending[0].n_op || '—'}`;
    riBalloonLayer.appendChild(el);
    riAnchors.push({ el, mesh });
  }

  /** Atualiza só o balão RI de uma placa (sem recarregar a cena). */
  function refreshRiBalloonForMesh(mesh) {
    if (!mesh) return;
    for (let i = riAnchors.length - 1; i >= 0; i--) {
      if (riAnchors[i].mesh === mesh) {
        riAnchors[i].el?.remove();
        riAnchors.splice(i, 1);
      }
    }
    attachRiBalloon(mesh, mesh.userData?.ops || []);
  }

  /**
   * Após Registrar RI: limpa flag só da OP mexida (sem GET cena-3d / pendentes).
   */
  function marcarRiLiberadaNaCena(opRef) {
    const id = Number(opRef?.id || opRef?.op_producao_id || 0) || 0;
    const n = String(opRef?.n_op || opRef?.numero_op || '').trim();
    if (!id && !n) return;
    for (const mesh of productCards) {
      const ops = mesh.userData?.ops || [];
      let changed = false;
      for (const op of ops) {
        const match = (id > 0 && Number(op.id) === id)
          || (n && String(op.n_op || '').trim() === n);
        if (match && op.ri_pendente) {
          op.ri_pendente = false;
          changed = true;
        }
      }
      if (changed) refreshRiBalloonForMesh(mesh);
    }
    if (inspectMode && inspectMesh) renderInspectBalloon();
  }

  function updateRiBalloons() {
    if (!riAnchors.length) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const a of riAnchors) {
      const mesh = a.mesh;
      if (!mesh || !a.el) continue;
      mesh.getWorldPosition(_riProj);
      const ch = mesh.geometry?.parameters?.height || CARD_H;
      _riProj.y += ch * 0.5 + 0.28;
      _riProj.project(camera);
      const behind = _riProj.z > 1;
      const x = (_riProj.x * 0.5 + 0.5) * w;
      const y = (-_riProj.y * 0.5 + 0.5) * h;
      if (behind || x < -60 || x > w + 60 || y < -60 || y > h + 60) {
        a.el.hidden = true;
      } else {
        a.el.hidden = false;
        a.el.style.left = `${Math.round(x)}px`;
        a.el.style.top = `${Math.round(y)}px`;
      }
    }
  }

  /** Status do kanban → esteira 3D */
  function statusToPosto(status) {
    const raw = String(status ?? '').trim();
    // vazio / null / só espaços → Programado
    if (!raw) return 'programado';
    const s = raw
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    // não confundir "a produzir" legado com hermético
    if (s === 'a produzir' || s === 'programado') return 'programado';
    if (s.includes('hermetic')) return 'hermetico';
    if (s.includes('eletric')) return 'eletrica';
    if (s === 'teste' || s.startsWith('teste')) return 'teste';
    if (s === 'espera' || s.includes('espera')) return 'espera';
    // Inspeção final e outros → espera (fila pós-teste), se fizer sentido; senão programado
    if (s.includes('inspec')) return 'espera';
    return 'programado';
  }

  /** Divide itens em N grupos o mais iguais possível. */
  function chunkEvenly(items, nGroups) {
    const groups = Array.from({ length: nGroups }, () => []);
    const n = items.length;
    if (nGroups <= 0) return groups;
    const base = Math.floor(n / nGroups);
    let resto = n % nGroups;
    let idx = 0;
    for (let g = 0; g < nGroups; g++) {
      const take = base + (resto > 0 ? 1 : 0);
      if (resto > 0) resto -= 1;
      groups[g] = items.slice(idx, idx + take);
      idx += take;
    }
    return groups.filter((g) => g.length > 0);
  }

  /** Empacota OPs do posto: se não cabem 1 a 1, agrupa várias por placa. */
  function packPosto(posto, items) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return [];

    let usable;
    let alongX = false;
    let zIni = 0;
    let zFim = 0;
    let zFixed = 0;
    let xCenter = 0;

    if (posto === 'programado' || posto === 'hermetico' || posto === 'eletrica') {
      zIni = posto === 'programado' ? zProgIni : posto === 'hermetico' ? zHermIni : zEleIni;
      zFim = posto === 'programado' ? zProgFim : posto === 'hermetico' ? zHermFim : zEleFim;
      const len = Math.max(0.5, zFim - zIni);
      usable = Math.max(0.8, len - 0.6);
    } else {
      alongX = true;
      zFixed = posto === 'teste' ? zTeste : zEspera;
      xCenter = branchCenterX;
      usable = Math.max(0.8, BRANCH_LEN - 0.6);
    }

    const minGap = 0.45;
    const maxSlots = Math.max(1, Math.floor(usable / minGap));
    const nSlots = Math.min(list.length, maxSlots);
    const groups = chunkEvenly(list, nSlots);
    const gap = usable / Math.max(1, groups.length);
    const scale = Math.max(0.45, Math.min(1, gap / CARD_GAP));

    const out = [];
    if (alongX) {
      const span = (groups.length - 1) * gap;
      const x0 = xCenter - span / 2;
      groups.forEach((ops, i) => {
        out.push({
          x: x0 + i * gap,
          z: zFixed,
          posto,
          ops,
          scale,
        });
      });
    } else {
      const mid = (zIni + zFim) / 2;
      const span = (groups.length - 1) * gap;
      const z0 = mid - span / 2;
      groups.forEach((ops, i) => {
        out.push({
          x: 0,
          z: z0 + i * gap,
          posto,
          ops,
          scale,
        });
      });
    }
    return out;
  }

  /** Posiciona OPs conforme Kanban_programacao.status (sempre inclui todas). */
  function slotPositionsByStatus(itens) {
    const buckets = {
      programado: [], hermetico: [], eletrica: [], teste: [], espera: [],
    };
    for (const op of itens || []) {
      const posto = statusToPosto(op.status);
      (buckets[posto] || buckets.programado).push(op);
    }
    const pairs = [];
    for (const posto of ['programado', 'hermetico', 'eletrica', 'teste', 'espera']) {
      for (const slot of packPosto(posto, buckets[posto])) {
        pairs.push(slot);
      }
    }
    return pairs;
  }

  async function resolveFotoUrl(op) {
    if (op?.foto_url && /^https?:\/\//i.test(op.foto_url)) return op.foto_url;
    const codigo = String(op?.codigo || '').trim();
    const codigoProduto = op?.codigo_produto != null ? String(op.codigo_produto).trim() : '';
    for (const key of [codigo, codigoProduto].filter(Boolean)) {
      try {
        const r = await fetch(`/api/produtos/imagem/${encodeURIComponent(key)}`, {
          credentials: 'include',
        });
        const j = await r.json().catch(() => ({}));
        if (j?.url_imagem) return j.url_imagem;
      } catch (_) { /* tenta próximo */ }
    }
    return null;
  }

  function placeOpsOnBelt(itens) {
    clearProductMeshes();
    const list = Array.isArray(itens) ? itens : [];
    if (!list.length) {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 128;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#374151';
      ctx.fillRect(0, 0, 256, 128);
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 22px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Nenhuma OP', 128, 50);
      ctx.fillStyle = '#d1d5db';
      ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText('em OP_producao', 128, 82);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1.4, 0.7),
        new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
      );
      mesh.position.set(0, BELT_Y + 0.55, czProg);
      mesh.userData.tipo = 'info';
      beltGroup.add(mesh);
      productMeshes.push(mesh);
      productCards.push(mesh);
      return;
    }

    const slots = slotPositionsByStatus(list);

    slots.forEach((slot) => {
      const ops = slot.ops || [];
      const scale = Number(slot.scale) || 1;
      const cw = CARD_W * scale;
      const ch = CARD_H * scale;
      const c = document.createElement('canvas');
      c.width = ops.length > 1 ? 320 : 256;
      c.height = ops.length > 1 ? 360 : 320;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        side: THREE.DoubleSide,
        transparent: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(cw, ch), mat);
      mesh.position.set(slot.x, BELT_Y + ch / 2 + 0.12, slot.z);
      mesh.userData = {
        tipo: 'op',
        op: ops[0],
        ops,
        posto: slot.posto || '',
        canvas: c,
        tex,
      };

      const stand = new THREE.Mesh(
        new THREE.BoxGeometry(0.14 * scale, 0.04, 0.14 * scale),
        steelDarkMat
      );
      stand.position.set(slot.x, BELT_Y + 0.02, slot.z);
      beltGroup.add(stand);
      productMeshes.push(stand);

      beltGroup.add(mesh);
      productMeshes.push(mesh);
      productCards.push(mesh);
      paintProductCard(mesh);
      attachRiBalloon(mesh, ops);

      void (async () => {
        for (const op of ops) {
          const url = await resolveFotoUrl(op);
          if (url) op.foto_url = url;
        }
        mesh.userData.ops = ops;
        mesh.userData.op = ops[0];
        paintProductCard(mesh);
        for (const op of ops) {
          if (op.foto_url) loadFoto(op.foto_url, () => paintProductCard(mesh));
        }
      })();
    });
  }

  async function carregarOps({ silent = false } = {}) {
    const btnRefresh = document.getElementById('btnRefreshOps');
    if (btnRefresh) {
      btnRefresh.disabled = true;
      btnRefresh.textContent = '↻ Atualizando…';
    }
    try {
      if (!silent && enterLoadingSub) enterLoadingSub.textContent = 'Carregando OPs da produção…';
      const [cenaResp, riResp] = await Promise.all([
        fetch('/api/producao/cena-3d', { credentials: 'include' }),
        fetch('/api/qualidade/ri-check/pendentes', { credentials: 'include' }),
      ]);
      const json = await cenaResp.json().catch(() => ({}));
      const riJson = await riResp.json().catch(() => ({}));
      const itens = json.ok && Array.isArray(json.itens) ? json.itens : [];
      const pendentes = riJson.ok && Array.isArray(riJson.pendentes) ? riJson.pendentes : [];
      aplicarRiPendentes(itens, pendentes);
      placeOpsOnBelt(itens);
      if (inspectMode && inspectMesh) renderInspectBalloon();
    } catch (e) {
      console.warn('[producao-3d] OPs:', e);
      if (!silent) placeOpsOnBelt([]);
    } finally {
      if (btnRefresh) {
        btnRefresh.disabled = false;
        btnRefresh.textContent = '↻ Atualizar';
      }
    }
    loadGate.ops = true;
    notifySceneReady();
  }

  // ——— Spawn / movimento ———
  function collidesAt(px, pz) {
    const r = PLAYER.radius;
    for (const c of colliders) {
      if (px + r > c.minX && px - r < c.maxX && pz + r > c.minZ && pz - r < c.maxZ) return true;
    }
    return false;
  }

  function tryMove(mx, mz) {
    const pos = controls.getObject().position;
    const nx = pos.x + mx;
    const nz = pos.z + mz;
    if (!collidesAt(nx, pos.z)) pos.x = nx;
    if (!collidesAt(pos.x, nz)) pos.z = nz;
    // Limites do barracão
    const limX = floorW / 2 - 0.8;
    const limZ = floorD / 2 - 0.8;
    pos.x = Math.max(-limX, Math.min(limX, pos.x));
    pos.z = Math.max(-limZ, Math.min(limZ, pos.z));
  }

  let spawnX = 5.5;
  let spawnZ = BELT_LEN / 2 + 2;
  if (collidesAt(spawnX, spawnZ)) spawnZ = floorD / 2 - 3;
  controls.getObject().position.set(spawnX, PLAYER.eye, spawnZ);
  let eyeY = PLAYER.eye;
  // Olhar para a esteira (−X)
  controls.getObject().rotation.y = Math.PI / 2;

  const startPad = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 28),
    new THREE.MeshBasicMaterial({ color: 0xf97316 })
  );
  startPad.rotation.x = -Math.PI / 2;
  startPad.position.set(spawnX, 0.02, spawnZ);
  scene.add(startPad);

  // ——— Mira / balão ———
  const lookBalloon = document.getElementById('lookBalloon');
  const lookBalloonEnd = document.getElementById('lookBalloonEnd');
  const lookBalloonBody = document.getElementById('lookBalloonBody');
  const raycaster = new THREE.Raycaster();
  const centerNDC = new THREE.Vector2(0, 0);
  let lookOpAtual = null;

  const RI_CHECK_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M9.55 18.2 3.8 12.45l1.9-1.9 3.85 3.85 8.75-8.75 1.9 1.9z"/></svg>`;

  function htmlOp(op, posto, { withRiBtn = false } = {}) {
    const foto = op.foto_url
      ? `<img src="${escHtml(op.foto_url)}" alt="">`
      : '<div style="width:52px;height:52px;border-radius:6px;background:#21262d;flex-shrink:0;"></div>';
    const postoLbl = {
      programado: 'Programado',
      hermetico: 'Hermético',
      eletrica: 'Elétrica',
      teste: 'Teste',
      espera: 'Espera',
    }[posto] || posto || '';
    const riBtn = withRiBtn
      ? `<button type="button" class="look-ri-btn" data-op-id="${escHtml(String(op.id || ''))}" title="RI — Registro de inspeção" aria-label="Abrir RI">${RI_CHECK_SVG}</button>`
      : '';
    return `<div class="look-balloon-row" data-op-id="${escHtml(String(op.id || ''))}">
      ${foto}
      <div class="look-balloon-info">
        <div class="cod">${escHtml(op.n_op || '—')}</div>
        <div class="desc"><strong>${escHtml(op.codigo || '')}</strong></div>
        <div class="desc">${escHtml(op.descricao || '')}</div>
        ${postoLbl ? `<div class="ids">Esteira: ${escHtml(postoLbl)}</div>` : ''}
        <div class="ids">Status: ${escHtml(op.status || '—')}</div>
        ${op.ri_pendente ? '<div class="ids" style="color:#fda4af;font-weight:700;">Aguardando RI</div>' : ''}
      </div>
      ${riBtn}
    </div>`;
  }

  function renderInspectBalloon() {
    if (!inspectMesh) return;
    const ops = inspectMesh.userData.ops || [inspectMesh.userData.op];
    const posto = inspectMesh.userData.posto || '';
    const first = ops[0] || {};
    lookBalloonEnd.innerHTML = `<span class="look-balloon-end-label">${escHtml(ops.length > 1 ? `${ops.length} OPs` : (first.n_op || 'OP'))}</span>
      <button type="button" class="look-balloon-close" title="Fechar e voltar ao explorador" aria-label="Fechar">&times;</button>`;
    lookBalloonBody.innerHTML = ops.map((op) => htmlOp(op, posto, { withRiBtn: true })).join('')
      + '<div class="look-balloon-hint">✓ = abrir RI · ✕ / Esc = voltar ao explorador</div>';
    lookBalloon.hidden = false;
    lookBalloon.classList.add('is-locked');
  }

  function enterInspect(mesh) {
    if (!mesh || mesh.userData?.tipo !== 'op') return;
    inspectMode = true;
    inspectMesh = mesh;
    lookOpAtual = mesh;
    renderInspectBalloon();
    // Impede o unlock de “pausar” o jogo; libera o mouse p/ clicar no ✓
    ignoreUnlockUntil = Date.now() + 2000;
    playing = true;
    blocker.hidden = true;
    hud.hidden = false;
    const ch = document.getElementById('crosshair');
    if (ch) ch.hidden = true;
    if (controls.isLocked) {
      try { controls.unlock(); } catch (_) { /* ok */ }
    }
    // Garante estado após o evento unlock
    requestAnimationFrame(() => {
      if (!inspectMode) return;
      playing = true;
      blocker.hidden = true;
      hud.hidden = false;
      lookBalloon.hidden = false;
      lookBalloon.classList.add('is-locked');
      renderInspectBalloon();
    });
  }

  function exitInspect({ relock = true } = {}) {
    if (!inspectMode) return;
    inspectMode = false;
    inspectMesh = null;
    lookBalloon.classList.remove('is-locked');
    if (!lookOpAtual) lookBalloon.hidden = true;
    if (relock && !isTouchUI && !riModalAberto) {
      ignoreUnlockUntil = Date.now() + 600;
      playing = true;
      try { controls.lock(); } catch (_) { /* clique */ }
    }
  }

  function abrirRiDaOp(opId) {
    if (!inspectMesh) return;
    const ops = inspectMesh.userData.ops || [inspectMesh.userData.op];
    const op = ops.find((o) => String(o.id) === String(opId)) || ops[0];
    if (!op) return;
    const posto = inspectMesh.userData.posto || '';
    riModalAberto = true;
    openProducao3dRiModal(op, {
      posto,
      onRegistered: () => {
        // Só a OP liberada — sem recarregar a esteira inteira
        marcarRiLiberadaNaCena(op);
      },
      onDone: () => {
        riModalAberto = false;
        if (inspectMode) renderInspectBalloon();
        else if (!isTouchUI) {
          ignoreUnlockUntil = Date.now() + 600;
          try { controls.lock(); } catch (_) {}
        }
      },
    });
  }

  lookBalloon.addEventListener('click', (e) => {
    const closeBtn = e.target.closest?.('.look-balloon-close');
    if (closeBtn && inspectMode) {
      e.preventDefault();
      e.stopPropagation();
      exitInspect({ relock: true });
      return;
    }
    const btn = e.target.closest?.('.look-ri-btn');
    if (!btn || !inspectMode) return;
    e.preventDefault();
    e.stopPropagation();
    abrirRiDaOp(btn.getAttribute('data-op-id'));
  });

  function updateLookTarget() {
    if (inspectMode || riModalAberto) return;
    if (!playing && !controls.isLocked) {
      lookBalloon.hidden = true;
      return;
    }
    raycaster.setFromCamera(centerNDC, camera);
    // Só as placas (não o pedestal) — mira mais confiável
    const hits = raycaster.intersectObjects(productCards, false);
    const hit = hits[0];
    if (hit && hit.object.userData?.tipo === 'op') {
      const ops = hit.object.userData.ops || [hit.object.userData.op];
      lookOpAtual = hit.object;
      lookBalloon.hidden = false;
      lookBalloon.classList.remove('is-locked');
      const first = ops[0] || {};
      lookBalloonEnd.textContent = ops.length > 1
        ? `${ops.length} OPs`
        : (first.n_op || 'OP');
      lookBalloonBody.innerHTML = ops.map((op) => htmlOp(op, hit.object.userData.posto)).join('');
    } else {
      lookOpAtual = null;
      lookBalloon.hidden = true;
    }
  }

  // Clique rápido (com mira no produto) → fixa balão + ícone RI
  // Com Pointer Lock o evento precisa ser no document (igual Explorar 3D).
  let lastFloorTap = 0;
  let clickDownAt = 0;
  let clickMoved = 0;

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (inspectMode || riModalAberto) return;
    if (!playing && !controls.isLocked) return;
    if (e.target?.closest?.(
      '.look-balloon, .p3d-modal-overlay, #blocker, .touch-pad, .hud, button, a, input, textarea'
    )) return;
    clickDownAt = performance.now();
    clickMoved = 0;
  });

  document.addEventListener('mousemove', (e) => {
    if (clickDownAt > 0) {
      clickMoved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
    }
  });

  document.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    const cliqueRapido =
      !inspectMode &&
      !riModalAberto &&
      clickDownAt > 0 &&
      performance.now() - clickDownAt < 450 &&
      clickMoved < 12;
    clickDownAt = 0;
    if (!cliqueRapido) return;
    if (!playing && !controls.isLocked) return;

    // Preferência: produto já na mira (updateLookTarget)
    let mesh = lookOpAtual;
    if (!mesh || mesh.userData?.tipo !== 'op') {
      raycaster.setFromCamera(centerNDC, camera);
      const prodHits = raycaster.intersectObjects(productCards, false);
      mesh = prodHits[0]?.object || null;
    }
    if (mesh && mesh.userData?.tipo === 'op') {
      enterInspect(mesh);
      lastFloorTap = 0;
      return;
    }

    // Duplo clique no chão → teleporte
    raycaster.setFromCamera(centerNDC, camera);
    const hits = raycaster.intersectObject(floor);
    if (!hits.length) return;
    const now = Date.now();
    if (now - lastFloorTap < 400) {
      const p = hits[0].point;
      if (!collidesAt(p.x, p.z)) {
        controls.getObject().position.x = p.x;
        controls.getObject().position.z = p.z;
      }
      lastFloorTap = 0;
    } else {
      lastFloorTap = now;
    }
  });

  const btnTouchClick = document.getElementById('btnTouchClick');
  const btnTouchBack = document.getElementById('btnTouchBack');
  btnTouchClick?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (riModalAberto) return;
    if (inspectMode) return;
    if (lookOpAtual) enterInspect(lookOpAtual);
  });
  btnTouchBack?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (riModalAberto) return;
    if (inspectMode) exitInspect({ relock: false });
  });

  // ——— Loop ———
  const clock = new THREE.Clock();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  let beltAnim = 0;

  function animate() {
    requestAnimationFrame(animate);
    if (ctxLost) return;
    const dt = Math.min(clock.getDelta(), 0.05);

    if (!awaitingAssets && (playing || controls.isLocked) && !inspectMode) {
      const ch = document.getElementById('crosshair');
      if (ch && ch.hidden) ch.hidden = false;
      if (blocker && !blocker.hidden && controls.isLocked) blocker.hidden = true;
    }

    if ((playing || controls.isLocked) && !inspectMode && !riModalAberto) {
      const speed = (keys.ShiftLeft || keys.ShiftRight ? PLAYER.speed * 1.55 : PLAYER.speed) * dt;
      forward.set(0, 0, 0);
      right.set(0, 0, 0);
      if (keys.KeyW || keys.ArrowUp) forward.z -= 1;
      if (keys.KeyS || keys.ArrowDown) forward.z += 1;
      if (keys.KeyA || keys.ArrowLeft) right.x -= 1;
      if (keys.KeyD || keys.ArrowRight) right.x += 1;

      if (forward.z !== 0 || right.x !== 0 || (joyMove.active && (joyMove.x || joyMove.y))) {
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
        if (joyMove.active && (joyMove.x || joyMove.y)) {
          const jy = -joyMove.y;
          const jx = joyMove.x;
          mx += (dir.x * jy + side.x * jx) * speed;
          mz += (dir.z * jy + side.z * jx) * speed;
        }
        tryMove(mx, mz);
      }

      const v = PLAYER.vSpeed * dt;
      if (keys.Space || keys.KeyE || keys.PageUp) eyeY += v;
      if (keys.KeyC || keys.KeyQ || keys.PageDown || keys.ControlLeft || keys.ControlRight) eyeY -= v;
      eyeY = Math.max(PLAYER.eyeMin, Math.min(eyeMax, eyeY));
      controls.getObject().position.y = eyeY;
    }

    // Roletes girando (efeito esteira)
    beltAnim += dt * 2.2;
    for (const r of rollers) {
      if (r.userData.spinAxis === 'z') r.rotation.z = beltAnim;
      else r.rotation.x = beltAnim;
    }

    // Cards sempre olham para a câmera (foto visível)
    const camPos = controls.getObject().position;
    for (const card of productCards) {
      card.lookAt(camPos.x, card.position.y, camPos.z);
    }

    updateLookTarget();
    updateRiBalloons();
    appRenderer.render(scene, camera);
    if (warmFrames < 4) {
      warmFrames += 1;
      notifySceneReady();
    }
  }

  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    appRenderer.setSize(w, h);
  });

  window.__prod3d = { scene, camera, productMeshes, carregarOps, marcarRiLiberadaNaCena };
  void carregarOps();

  const btnRefreshOps = document.getElementById('btnRefreshOps');
  if (btnRefreshOps) {
    btnRefreshOps.hidden = false;
    btnRefreshOps.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      void carregarOps({ silent: true });
    });
  }

  animate();
}
