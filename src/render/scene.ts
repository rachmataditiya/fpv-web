import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Quality = 'low' | 'med' | 'high';

export interface SceneCtx {
  renderer: THREE.WebGLRenderer;   // WebGL renderer, appended to mount
  scene: THREE.Scene;              // the Three.js scene
  setQuality(q: Quality): void;    // adjust pixel ratio, fog, shadows, fine grid
  resize(): void;                  // fit renderer to current window size
}

// ---------------------------------------------------------------------------
// Constants (reusable, no re‑creation)
// ---------------------------------------------------------------------------

const HORIZON_COLOR  = new THREE.Color('#cfe8ff');
const ZENITH_COLOR   = new THREE.Color('#3a7bd5');
const FOG_COLOR      = HORIZON_COLOR;          // blends naturally with sky
const GROUND_COLOR   = new THREE.Color('#2e3b2e'); // dark green / grey
const GRID_100_COLOR  = 0x555555;              // faint grey
const GRID_10_COLOR   = 0x444444;              // even fainter

// ---------------------------------------------------------------------------
// Sky dome – large inverted sphere with procedural gradient
// ---------------------------------------------------------------------------

function createSky(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(2000, 64, 32);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      horizonColor: { value: HORIZON_COLOR },
      zenithColor:  { value: ZENITH_COLOR }
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPos;
      uniform vec3 horizonColor;
      uniform vec3 zenithColor;
      void main() {
        float t = clamp(vWorldPos.y / 2000.0, 0.0, 1.0);
        vec3 col = mix(horizonColor, zenithColor, t);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false   // sky always behind everything
    // ShaderMaterial does not apply scene fog → effectively fog:false
  });

  const skyMesh = new THREE.Mesh(geometry, material);
  skyMesh.name = 'sky';
  return skyMesh;
}

// ---------------------------------------------------------------------------
// Ground – large plane with a subtle dark material
// ---------------------------------------------------------------------------

function createGround(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(2000, 2000);
  const material = new THREE.MeshStandardMaterial({
    color: GROUND_COLOR,
    roughness: 0.9,
    metalness: 0.1,
    side: THREE.DoubleSide   // not strictly needed but harmless
  });
  const ground = new THREE.Mesh(geometry, material);
  ground.rotation.x = -Math.PI / 2; // lay flat on XZ
  ground.position.y = 0;
  ground.name = 'ground';
  return ground;
}

// ---------------------------------------------------------------------------
// Grids for speed perception
// ---------------------------------------------------------------------------

function createGrid(size: number, divisions: number, color: number): THREE.GridHelper {
  return new THREE.GridHelper(size, divisions, color, color);
}

// ---------------------------------------------------------------------------
// Lights – Hemisphere + Directional (shadows only on 'high')
// ---------------------------------------------------------------------------

function createLights(): { hemisphere: THREE.HemisphereLight; directional: THREE.DirectionalLight } {
  // Soft ambient-like fill
  const hemi = new THREE.HemisphereLight(
    0xcfe8ff,   // sky tint
    0x3a4a3a,   // ground tint
    0.9
  );

  // Main sun‑like directional light
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.name = 'sun';
  dir.position.set(100, 200, 50);

  // Shadow camera setup – covers the central part of the 2000×2000 ground
  dir.shadow.camera.left   = -1000;
  dir.shadow.camera.right  =  1000;
  dir.shadow.camera.top    =  1000;
  dir.shadow.camera.bottom = -1000;
  dir.shadow.camera.near   = 50;
  dir.shadow.camera.far    = 500;
  dir.shadow.mapSize.set(1024, 1024);
  // shadow casting/receiving is toggled by setQuality()

  hemi.name = 'hemi';
  return { hemisphere: hemi, directional: dir };
}

// ---------------------------------------------------------------------------
// createScene – assembles everything, returns compact context
// ---------------------------------------------------------------------------

export function createScene(mount: HTMLElement): SceneCtx {
  // ----- Scene --------------------------------------------------------------
  const scene = new THREE.Scene();
  const fog = new THREE.Fog(FOG_COLOR, 150, 900); // default 'med' distances
  scene.fog = fog;

  // ----- Sky (no fog, depthWrite false) -------------------------------------
  scene.add(createSky());

  // ----- Ground + grids -----------------------------------------------------
  const ground = createGround();
  scene.add(ground);

  const grid100 = createGrid(2000, 20, GRID_100_COLOR);   // 100 m divisions
  grid100.name = 'grid100';
  const grid10  = createGrid(2000, 200, GRID_10_COLOR);   // 10 m divisions
  grid10.name = 'grid10';
  // Lift the grids a hair above the ground plane — coplanar helpers z-fight.
  grid100.position.y = 0.02;
  grid10.position.y = 0.01;
  grid10.visible = true;  // visible at med/high; toggled by setQuality()
  scene.add(grid100);
  scene.add(grid10);

  // ----- Lights -------------------------------------------------------------
  const { hemisphere, directional } = createLights();
  scene.add(hemisphere);
  scene.add(directional);

  // ----- Renderer -----------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // No shadow map initially (only enabled on 'high')
  renderer.shadowMap.enabled = false;
  mount.appendChild(renderer.domElement);

  function setQuality(q: Quality): void {
    // 1. Pixel ratio
    switch (q) {
      case 'low':
        renderer.setPixelRatio(0.6);
        break;
      case 'med':
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
        break;
      case 'high':
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        break;
    }

    // 2. Fog distance
    switch (q) {
      case 'low':  fog.far = 500;  break;
      case 'med':  fog.far = 900;  break;
      case 'high': fog.far = 1400; break;
    }

    // 3. Fine grid (10 m)
    grid10.visible = q !== 'low';

    // 4. Shadows
    const shadowEnabled = q === 'high';
    renderer.shadowMap.enabled = shadowEnabled;
    directional.castShadow = shadowEnabled;
    ground.receiveShadow = shadowEnabled;
  }

  // Initial quality application
  setQuality('med');

  // ----- resize handler -----------------------------------------------------
  function resize(): void {
    renderer.setSize(window.innerWidth, window.innerHeight);
    // No camera to update – the caller manages its own camera(s)
  }

  return { renderer, scene, setQuality, resize };
}
