import * as THREE        from 'three';
import Stats             from 'three/examples/jsm/libs/stats.module.js';
import { GUI }           from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Water }         from 'three/examples/jsm/objects/Water.js';
import { Sky }           from 'three/examples/jsm/objects/Sky.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

let camera, scene, renderer, controls, water, sky, sun, mesh, stats;
let pmremGenerator, sceneEnv, renderTarget;
const params = { elevation: 2, azimuth: 180 };

// Clock for water animation
const clock = new THREE.Clock();

const canvas = document.querySelector('canvas.threejs');
init();

function init() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); // Draws into your chosen <canvas>, with smooth edges.
  renderer.setPixelRatio(window.devicePixelRatio); // Renders at full resolution on any screen density.
  renderer.setSize(window.innerWidth, window.innerHeight); // Fills the browser window.
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // Applies a filmic tone-mapping curve for more cinematic color.
  renderer.toneMappingExposure = 0.5; // Uses an exposure factor to control overall scene brightness.
  // Vibrant colors
  renderer.outputEncoding = THREE.sRGBEncoding;

  // Scene & camera
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, innerWidth/innerHeight, 1, 20000);
  camera.position.set(280,280,575);

  // Sun vector
  sun = new THREE.Vector3();

  // Water
  const waterNormals = new THREE.TextureLoader().load(
    'textures/waternormals.jpg', // Load the texture
    tex => { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; } // Tile the texture the map endlessly across the the plane so that it won't stretch.
  );
  water = new Water(
    new THREE.PlaneGeometry(10000,10000), 
    { // Normal map plus parameters controlling wave distortion, coloration, and how the sun lights the surface.
      waterNormals,
      sunDirection: sun,
      sunColor: 0xffffff,
      waterColor: 0x001e0f,
      distortionScale: 3.7,
      size: 1
    }
  );
  water.rotation.x = -Math.PI/2; // Make it a horizontal sea surface
  scene.add(water);

  // Sky is a half-sphere with a shader that simulates the sky and sun
  sky = new Sky();
  sky.scale.setScalar(10000);
  scene.add(sky);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 2); // Increase intensity
  directionalLight.position.set(-2, 5, 50); // Angle it from the side
  scene.add(directionalLight);
  const su = sky.material.uniforms;
  su.turbidity.value = 2; // Controls how “dirty” or hazy the atmosphere is. Higher turbidity → more light scattering by particles → more orange/red at sunrise/sunset.
  su.rayleigh.value = 2; // Higher Rayleigh → stronger scattering of short (blue) wavelengths → deeper blue sky.
  su.mieCoefficient.value = 0.0005; // Mie scattering coefficient, which controls how much light is scattered by larger particles (like dust or water droplets). Higher values → more scattering → more white in the sky.
  su.mieDirectionalG.value = 0.95; // Controls the anisotropy of Mie scattering. Higher values → more forward scattering → more white in the sky.

  // PMREM for env lighting + background
  pmremGenerator = new THREE.PMREMGenerator(renderer);
  sceneEnv = new THREE.Scene();

  // Initial sun + env map
  updateSun();
  // Load island model
  const loader = new GLTFLoader();
  loader.load(
    '../public/models/island.glb',
    (gltf) => {
      console.log('Island loaded:', gltf.scene);
      const island = gltf.scene;
      island.traverse((child) => {
        if (child.isMesh) {
          child.material = new THREE.MeshStandardMaterial({
            color: 0xfce28a,
            roughness: 1,
            metalness: 0,
            flatShading: true,
          });
          child.castShadow = true;
          child.receiveShadow = true;
          child.material.side = THREE.DoubleSide;
        }
      });
      island.scale.set(10, 10, 10); // Adjust based on Blender scale
      island.position.set(0, -5, 0); // The y-value determines the height at which the island floats above the water
      island.rotation.x = Math.PI;
      scene.add(island);
    },
    undefined,
    (error) => {
      console.error('Failed to load island model:', error);
    }
  );

  // Controls, stats, GUI, resize…
  controls = new OrbitControls(camera, renderer.domElement); // Attaches mouse (or touch) handlers to your canvas so dragging or scrolling moves the camera around its “target” point.
  controls.maxPolarAngle = Math.PI * 0.495; // Preventing the camera from flipping all the way under or showing the “underside” of your scene.
  controls.target.set(0,10,0);
  controls.minDistance = 40;
  controls.maxDistance = 2000;
  controls.update();

  stats = new Stats();
  document.body.appendChild(stats.dom);

  const gui = new GUI();
  const skyF = gui.addFolder('Sky');
  skyF.add(params,'elevation', 0,90, 0.1).onChange(updateSun);
  skyF.add(params,'azimuth', -180, 180, 0.1).onChange(updateSun);
  skyF.open();
  const waterF = gui.addFolder('Water');
  waterF.add(water.material.uniforms.distortionScale,'value', 0,8, 0.1).name('distortionScale');
  waterF.add(water.material.uniforms.size,'value', 0.1, 10, 0.1).name('size');
  waterF.open();

  window.addEventListener('resize', onWindowResize);

  // Start loop
  animate();
}

function updateSun() {
  const phi = THREE.MathUtils.degToRad(90 - params.elevation); // Convert elevation to radians, 90° is the zenith
  const theta = THREE.MathUtils.degToRad(params.azimuth); // Convert azimuth to radians, 0° is North, 90° is East, etc.
  sun.setFromSphericalCoords(1, phi, theta);

  // Sky shader
  sky.material.uniforms.sunPosition.value.copy(sun);
  // Water shader
  water.material.uniforms.sunDirection.value.copy(sun).normalize();

  // Build PMREM + apply as environment AND background
  if (renderTarget) renderTarget.dispose();
  const envScene = new THREE.Scene();
  const skyClone = sky.clone();
  skyClone.material = sky.material;
  envScene.add( skyClone );
  renderTarget = pmremGenerator.fromScene( envScene );
  scene.environment = renderTarget.texture;
}

function onWindowResize() {
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
}

function animate() {
  const t = clock.getElapsedTime();

  // Animate the water
  water.material.uniforms.time.value = t;
  controls.update();
  renderer.render(scene,camera);
  stats.update();

  requestAnimationFrame(animate);
}
