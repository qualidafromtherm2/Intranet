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
}

function showWebglError(detail) {
  const msg =
    'Não foi possível iniciar o 3D neste Chrome.\n\n' +
    'Neste PC o atalho do Chrome forçava a NVIDIA e isso desligava o WebGL.\n' +
    'Já foi corrigido no sistema — faça assim:\n\n' +
    '1) Feche TODAS as janelas do Chrome (e confira na bandeja se não ficou aberto)\n' +
    '2) Abra o Chrome de novo pelo ícone do menu/dock\n' +
    '3) Volte em Lista de produtos → Explorar 3D\n\n' +
    'Se ainda falhar, rode: ~/.local/bin/google-chrome-webgl\n\n' +
    'URL atual: ' + window.location.href +
    (detail ? '\n\nDetalhe: ' + detail : '');
  webglError.hidden = false;
  webglError.textContent = msg;
  btnEnter.disabled = true;
  btnEnter.textContent = '3D indisponível — feche e abra o Chrome de novo';
}

function createRenderer() {
  const attempts = [
    { canvas, antialias: true, powerPreference: 'high-performance' },
    { canvas, antialias: false, powerPreference: 'default', failIfMajorPerformanceCaveat: false },
    { canvas, antialias: false, powerPreference: 'low-power', failIfMajorPerformanceCaveat: false },
  ];
  let lastErr = null;
  for (const opts of attempts) {
    try {
      return new THREE.WebGLRenderer(opts);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('WebGL indisponível');
}

const PLAYER = {
  radius: 0.32,
  speed: 4.5,
  eye: 1.65,
};

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
const ORANGE_DARK = 0xea580c;
const WOOD = 0xc4a574;
const WOOD_DARK = 0x8b6914;
const FLOOR_COL = 0x2a3038;

const colliders = [];
const keys = Object.create(null);

let renderer = null;
try {
  renderer = createRenderer();
} catch (err) {
  console.error(err);
  showWebglError(err && err.message ? err.message : String(err));
}

if (renderer) boot(renderer);

function boot(renderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0c10);
  scene.fog = new THREE.Fog(0x0a0c10, 22, 70);

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
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
      return;
    }
    try {
      controls.lock();
    } catch (err) {
      console.error(err);
      showWebglError('Pointer Lock bloqueado: ' + (err.message || err));
    }
  }

  function exitPlay() {
    playing = false;
    touchPad.hidden = true;
    if (controls.isLocked) controls.unlock();
    blocker.hidden = false;
    hud.hidden = true;
  }

  btnEnter.addEventListener('click', enterPlay);
  btnExitTouch.addEventListener('click', (e) => {
    e.stopPropagation();
    exitPlay();
  });

  controls.addEventListener('lock', () => {
    playing = true;
    blocker.hidden = true;
    hud.hidden = false;
    touchPad.hidden = true;
  });
  controls.addEventListener('unlock', () => {
    if (!isTouchUI) {
      playing = false;
      blocker.hidden = false;
      hud.hidden = true;
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

  // ——— Materiais ———
  const orangeMat = new THREE.MeshStandardMaterial({
    color: ORANGE, metalness: 0.35, roughness: 0.45,
  });
  const orangeDarkMat = new THREE.MeshStandardMaterial({
    color: ORANGE_DARK, metalness: 0.4, roughness: 0.5,
  });
  const woodMat = new THREE.MeshStandardMaterial({
    color: WOOD, roughness: 0.85, metalness: 0.02,
  });
  const woodDarkMat = new THREE.MeshStandardMaterial({
    color: WOOD_DARK, roughness: 0.9, metalness: 0.02,
  });
  const floorMat = new THREE.MeshStandardMaterial({
    color: FLOOR_COL, roughness: 0.92, metalness: 0.05,
  });
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x1a1f26, roughness: 0.9,
  });
  const labelMats = {
    1: new THREE.MeshStandardMaterial({ color: 0x58a6ff, emissive: 0x1a3a5c, emissiveIntensity: 0.4 }),
    2: new THREE.MeshStandardMaterial({ color: 0x3fb950, emissive: 0x1a3d24, emissiveIntensity: 0.35 }),
    3: new THREE.MeshStandardMaterial({ color: 0xd2a8ff, emissive: 0x3d1a5c, emissiveIntensity: 0.35 }),
    4: new THREE.MeshStandardMaterial({ color: 0xffa657, emissive: 0x5c3a1a, emissiveIntensity: 0.35 }),
  };

  // ——— Luzes ———
  scene.add(new THREE.AmbientLight(0x9aa7b5, 0.45));
  scene.add(new THREE.HemisphereLight(0xdde6f0, 0x2a2218, 0.4));
  const sun = new THREE.DirectionalLight(0xfff2dd, 0.9);
  sun.position.set(8, 28, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 80;
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  scene.add(sun);

  function addCeilingLamp(x, z) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.06, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xfff4cc, emissive: 0xffe8a0, emissiveIntensity: 0.7 })
    );
    mesh.position.set(x, RACK_H + 1.1, z);
    scene.add(mesh);
    const pl = new THREE.PointLight(0xfff0c8, 0.5, 16, 2);
    pl.position.set(x, RACK_H + 0.9, z);
    scene.add(pl);
  }

  // ——— Chão / paredes ———
  const floorW = 48;
  const floorD = RACK_LEN + 16;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorW, floorD), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const wallH = RACK_H + 1.5;
  function addWall(cx, cz, sx, sz) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, wallH, sz), wallMat);
    mesh.position.set(cx, wallH / 2, cz);
    mesh.receiveShadow = true;
    scene.add(mesh);
    colliders.push({
      minX: cx - sx / 2, maxX: cx + sx / 2,
      minZ: cz - sz / 2, maxZ: cz + sz / 2,
    });
  }
  addWall(0, -floorD / 2, floorW, 0.4);
  addWall(0, floorD / 2, floorW, 0.4);
  addWall(-floorW / 2, 0, 0.4, floorD);
  addWall(floorW / 2, 0, 0.4, floorD);

  /**
   * Uma fileira de porta-pallet (vista da foto: estrutura laranja + caixas madeira).
   * Comprimento no eixo local Z; profundidade no X local; face “frente” = +X local.
   */
  function createPortaPalletRow() {
    const group = new THREE.Group();
    const halfL = RACK_LEN / 2;

    // Montantes (verticais) a cada bay
    for (let i = 0; i <= BAYS; i++) {
      const z = -halfL + i * BAY_W;
      for (const x of [-BAY_D / 2 + POST_W / 2, BAY_D / 2 - POST_W / 2]) {
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(POST_W, RACK_H, POST_W),
          orangeMat
        );
        post.position.set(x, RACK_H / 2, z);
        post.castShadow = true;
        group.add(post);
      }
      // Travessa diagonal no fundo (estilo X da foto lateral)
      if (i < BAYS) {
        for (let lv = 0; lv < LEVELS; lv++) {
          const y0 = lv * LEVEL_H + 0.15;
          const y1 = y0 + LEVEL_H - 0.1;
          const brace = new THREE.Mesh(
            new THREE.BoxGeometry(POST_W * 0.55, Math.hypot(LEVEL_H - 0.1, BAY_W * 0.85), POST_W * 0.55),
            orangeDarkMat
          );
          brace.position.set(-BAY_D / 2 + POST_W, (y0 + y1) / 2, z + BAY_W / 2);
          brace.rotation.x = Math.atan2(BAY_W * 0.85, LEVEL_H - 0.1) * (lv % 2 === 0 ? 1 : -1);
          group.add(brace);
        }
      }
    }

    // Vigas horizontais + pallet/caixa por nível e bay
    for (let lv = 0; lv < LEVELS; lv++) {
      const y = 0.2 + lv * LEVEL_H;
      for (let i = 0; i < BAYS; i++) {
        const z = -halfL + (i + 0.5) * BAY_W;

        // Vigas front/back
        for (const x of [-BAY_D / 2 + BEAM_D, BAY_D / 2 - BEAM_D]) {
          const beam = new THREE.Mesh(
            new THREE.BoxGeometry(BEAM_D, BEAM_H, BAY_W - POST_W * 0.3),
            orangeMat
          );
          beam.position.set(x, y, z);
          beam.castShadow = true;
          group.add(beam);
        }
        // Vigas laterais
        for (const zs of [-BAY_W / 2 + POST_W, BAY_W / 2 - POST_W]) {
          const side = new THREE.Mesh(
            new THREE.BoxGeometry(BAY_D - POST_W, BEAM_H, BEAM_D),
            orangeMat
          );
          side.position.set(0, y, z + zs);
          group.add(side);
        }

        // Pallet + caixa (placeholder)
        const pallet = new THREE.Mesh(
          new THREE.BoxGeometry(BAY_D * 0.82, 0.08, BAY_W * 0.78),
          woodDarkMat
        );
        pallet.position.set(0, y + BEAM_H / 2 + 0.04, z);
        pallet.castShadow = true;
        pallet.receiveShadow = true;
        group.add(pallet);

        const boxH = LEVEL_H * 0.55 + Math.random() * 0.12;
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(BAY_D * 0.72, boxH, BAY_W * 0.68),
          woodMat
        );
        box.position.set(0, y + BEAM_H / 2 + 0.08 + boxH / 2, z);
        box.castShadow = true;
        group.add(box);
      }
    }

    // Base tipo pallet sob a estrutura
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(BAY_D + 0.15, 0.1, RACK_LEN + 0.1),
      woodDarkMat
    );
    base.position.y = 0.05;
    base.receiveShadow = true;
    group.add(base);

    return group;
  }

  function addColliderAt(x, z, w, d) {
    colliders.push({
      minX: x - w / 2, maxX: x + w / 2,
      minZ: z - d / 2, maxZ: z + d / 2,
    });
  }

  function placeRow(x, faceSign, ruaNum) {
    const row = createPortaPalletRow();
    // faceSign +1 → frente olha +X; -1 → frente olha -X
    row.rotation.y = faceSign > 0 ? 0 : Math.PI;
    row.position.set(x, 0, 0);
    scene.add(row);
    addColliderAt(x, 0, BAY_D + 0.08, RACK_LEN + 0.1);

    // Placa da rua no chão do corredor (lado da face)
    const label = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.04, 0.9),
      labelMats[ruaNum] || labelMats[1]
    );
    label.position.set(x + faceSign * (BAY_D / 2 + 0.55), 0.03, -RACK_LEN / 2 + 0.6);
    scene.add(label);
  }

  /**
   * Layout (esquerda → direita, como na foto lateral):
   * R4D | aisle4 | R3E || R3D | aisle3 | R2E || R2D | aisle2 | R1E || R1D
   * || = costas coladas; aisle = corredor caminhável
   */
  const BACK_GAP = 0.25;
  const aisles = {}; // { 1: x, 2: x, ... }

  let x = -16;

  // R4-D
  placeRow(x, -1, 4);
  aisles[4] = x + BAY_D / 2 + AISLE_W / 2;
  x = aisles[4] + AISLE_W / 2 + BAY_D / 2;

  // R3-E || R3-D
  placeRow(x, +1, 3);
  x += BAY_D + BACK_GAP;
  placeRow(x, -1, 3);
  aisles[3] = x + BAY_D / 2 + AISLE_W / 2;
  x = aisles[3] + AISLE_W / 2 + BAY_D / 2;

  // R2-E || R2-D
  placeRow(x, +1, 2);
  x += BAY_D + BACK_GAP;
  placeRow(x, -1, 2);
  aisles[2] = x + BAY_D / 2 + AISLE_W / 2;
  x = aisles[2] + AISLE_W / 2 + BAY_D / 2;

  // R1-E || R1-D  (corredor da R1 = o mesmo aisle2, na frente do R1-E)
  aisles[1] = aisles[2];
  placeRow(x, +1, 1);
  x += BAY_D + BACK_GAP;
  placeRow(x, -1, 1);

  // Faixas amarelas nos corredores + lâmpadas
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf0c000, roughness: 0.8 });
  function addAisleDecor(ax) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.12, RACK_LEN - 1), stripeMat);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(ax, 0.015, 0);
    scene.add(stripe);
    for (let z = -RACK_LEN / 2 + 2; z < RACK_LEN / 2; z += 4.5) {
      addCeilingLamp(ax, z);
    }
  }
  // Evita desenhar a faixa duas vezes (aisle1 === aisle2)
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
  // Olhar ao longo do corredor (−Z)
  controls.getObject().rotation.y = 0;

  const startPad = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 28),
    new THREE.MeshStandardMaterial({ color: 0x58a6ff, roughness: 0.55 })
  );
  startPad.rotation.x = -Math.PI / 2;
  startPad.position.set(spawnX, 0.02, spawnZ);
  scene.add(startPad);

  // ——— Movimento ———
  const onKey = (e, down) => {
    keys[e.code] = down;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
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
      controls.getObject().position.y = PLAYER.eye;
    }

    renderer.render(scene, camera);
  }

  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  animate();
}
