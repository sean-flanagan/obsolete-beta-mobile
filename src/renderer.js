import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { PALETTES } from "./levels.js";
import { getInteractionCueStyle } from "./interaction-cue-style.js";

const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 540;
const WORLD_SCALE = 34;
const ATMOSPHERE_PARTICLE_COUNT = 52;

const color = (value) => new THREE.Color(value);

export class ObsoleteRenderer {
  constructor({ mount }) {
    this.mount = mount;
    this.world = { width: VIEW_WIDTH, height: VIEW_HEIGHT };
    this.loader = new GLTFLoader();
    this.assetManifest = null;
    this.assetModels = new Map();
    this.scene = new THREE.Scene();
    this.scene.background = color(PALETTES.yard.skyTop);
    this.scene.fog = new THREE.Fog(PALETTES.yard.skyBottom, 18, 62);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.mount.appendChild(this.renderer.domElement);

    this.camera = new THREE.OrthographicCamera(-14, 14, 8, -8, 0.1, 200);
    this.camera.position.set(0, 18, 16);
    this.camera.lookAt(0, 0, 0);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.rayIntersection = new THREE.Vector3();

    this.worldRoot = new THREE.Group();
    this.fxRoot = new THREE.Group();
    this.scene.add(this.worldRoot, this.fxRoot);

    this.setupLights();
    this.setupAtmosphere();
    this.setupDynamicObjects();
    this.loadStarterAssets();
    this.handleResize();
    this.markDirty();
  }

  async loadStarterAssets() {
    try {
      const response = await fetch("/obsolete-assets.json");
      if (!response.ok) {
        return;
      }

      this.assetManifest = await response.json();
      const entries = Object.entries(this.assetManifest.props || {});
      await Promise.all(
        entries.map(async ([key, path]) => {
          const gltf = await this.loader.loadAsync(path);
          this.assetModels.set(key, gltf.scene);
        })
      );
      this.markDirty();
    } catch {
      // Fallback to primitive props when starter assets are unavailable.
    }
  }

  setupLights() {
    this.ambientLight = new THREE.HemisphereLight("#ffcf9a", "#1b2730", 1.05);
    this.sunLight = new THREE.DirectionalLight("#ffd89a", 1.55);
    this.sunLight.position.set(14, 24, 9);
    this.fillLight = new THREE.DirectionalLight("#7db8ff", 0.45);
    this.fillLight.position.set(-15, 11, 10);
    this.rimLight = new THREE.DirectionalLight("#7cffdf", 1.05);
    this.rimLight.position.set(-10, 10, -14);
    this.heroLight = new THREE.PointLight("#8effd3", 1.4, 14, 2);
    this.heroLight.position.set(0, 2.2, 0);
    this.scene.add(this.ambientLight, this.sunLight, this.fillLight, this.rimLight, this.heroLight);
  }

  setupAtmosphere() {
    this.atmosphereSpriteTexture = this.createSoftParticleTexture();

    this.floorGlow = new THREE.Mesh(
      new THREE.CircleGeometry(6, 40),
      new THREE.MeshBasicMaterial({
        color: "#ffb768",
        transparent: true,
        opacity: 0.14,
      })
    );
    this.floorGlow.rotation.x = -Math.PI / 2;
    this.floorGlow.position.set(0, 0.02, 0);
    this.fxRoot.add(this.floorGlow);

    this.heroLightGlow = new THREE.Mesh(
      new THREE.CircleGeometry(2.8, 40),
      new THREE.MeshBasicMaterial({
        color: "#8effd3",
        transparent: true,
        opacity: 0.08,
      })
    );
    this.heroLightGlow.rotation.x = -Math.PI / 2;
    this.heroLightGlow.position.set(0, 0.03, 0);
    this.fxRoot.add(this.heroLightGlow);

    this.sunHalo = new THREE.Mesh(
      new THREE.CircleGeometry(10, 48),
      new THREE.MeshBasicMaterial({
        color: "#ffd493",
        transparent: true,
        opacity: 0.08,
      })
    );
    this.sunHalo.position.set(0, 9, -24);
    this.fxRoot.add(this.sunHalo);

    this.dustField = new THREE.Group();
    this.dustMotes = [];
    for (let i = 0; i < 30; i += 1) {
      const mote = new THREE.Mesh(
        new THREE.SphereGeometry(0.035 + (i % 3) * 0.014, 6, 6),
        new THREE.MeshBasicMaterial({
          color: i % 4 === 0 ? "#ffd9a6" : "#baf7e4",
          transparent: true,
          opacity: 0.08 + (i % 5) * 0.012,
        })
      );
      mote.userData = {
        baseX: (i % 6) * 2.2 - 5.2,
        baseY: 0.8 + (i % 5) * 0.52,
        baseZ: -Math.floor(i / 6) * 1.7 + 1.2,
        drift: 0.25 + (i % 4) * 0.06,
        phase: i * 0.73,
      };
      this.dustField.add(mote);
      this.dustMotes.push(mote);
    }
    this.fxRoot.add(this.dustField);

    this.sparkField = new THREE.Group();
    this.atmosphereSparks = [];
    for (let i = 0; i < 3; i += 1) {
      const spark = new THREE.Mesh(
        new THREE.SphereGeometry(0.11, 8, 8),
        new THREE.MeshBasicMaterial({
          color: i === 0 ? "#ffd37d" : "#8effd3",
          transparent: true,
          opacity: 0.18,
        })
      );
      spark.userData = {
        baseX: -2.8 + i * 3.6,
        baseY: 1.4 + i * 0.35,
        baseZ: -2.3 - i * 0.8,
        phase: i * 1.37,
      };
      this.sparkField.add(spark);
      this.atmosphereSparks.push(spark);
    }
    this.fxRoot.add(this.sparkField);

    this.atmosphereBillboards = new THREE.Group();
    this.billboardMotes = [];
    for (let i = 0; i < ATMOSPHERE_PARTICLE_COUNT; i += 1) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.atmosphereSpriteTexture,
          color: i % 5 === 0 ? "#ffd8a4" : i % 2 === 0 ? "#8effd3" : "#c4fff0",
          transparent: true,
          opacity: 0.12,
          depthWrite: false,
        })
      );
      sprite.userData = {
        layer: i % 3,
        baseX: (i % 9) * 1.7 - 6.8,
        baseY: 0.7 + (i % 6) * 0.55,
        baseZ: -Math.floor(i / 9) * 1.9 + 2.4,
        phase: i * 0.63,
        drift: 0.18 + (i % 4) * 0.05,
        sway: 0.18 + (i % 5) * 0.05,
        scale: 0.3 + (i % 4) * 0.08,
      };
      sprite.scale.setScalar(sprite.userData.scale);
      this.atmosphereBillboards.add(sprite);
      this.billboardMotes.push(sprite);
    }
    this.fxRoot.add(this.atmosphereBillboards);
  }

  createSoftParticleTexture() {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 3, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.32, "rgba(255,255,255,0.88)");
    gradient.addColorStop(0.72, "rgba(255,255,255,0.2)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  setupDynamicObjects() {
    this.dynamic = {
      player: this.createLaptop("player"),
      playerShadow: this.createPlayerShadow(),
      interactionRing: this.createInteractionRing(),
      battery: this.createBattery(),
      socket: this.createSocket(),
      gateConsole: this.createConsole("DISK"),
      finalConsole: this.createConsole("POST"),
      exitArch: this.createExitArch(),
      checkpoint: this.createCheckpointBeacon(),
      sparks: [],
      gates: [],
      hazards: [],
      items: [],
      fragments: [],
      npcs: [],
      solids: [],
      decor: [],
      conveyors: [],
      endingScrap: [],
      graphNodes: [],
      graphEdges: [],
      graphInteractors: [],
      graphStructures: [],
    };

    this.scene.add(this.dynamic.player.group);
    this.scene.add(this.dynamic.playerShadow, this.dynamic.interactionRing);
    this.scene.add(
      this.dynamic.battery,
      this.dynamic.socket,
      this.dynamic.gateConsole,
      this.dynamic.finalConsole,
      this.dynamic.exitArch,
      this.dynamic.checkpoint
    );
  }

  markDirty() {
    this.needsWorldRebuild = true;
  }

  handleResize() {
    const width = this.mount.clientWidth || VIEW_WIDTH;
    const height = this.mount.clientHeight || VIEW_HEIGHT;
    this.renderer.setSize(width, height, false);

    const aspect = width / height;
    const viewSize = aspect < 0.75 ? 18 : 12;
    this.camera.left = -viewSize * aspect;
    this.camera.right = viewSize * aspect;
    this.camera.top = viewSize;
    this.camera.bottom = -viewSize;
    this.camera.updateProjectionMatrix();
  }

  getWorldPointFromClient(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return null;
    }

    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, this.rayIntersection)) {
      return null;
    }

    return {
      x: this.toGameX(this.rayIntersection.x),
      y: this.toGameY(this.rayIntersection.z),
    };
  }

  sync(game) {
    const worldKey = `${game.mode}:${game.mode === "ending" || game.mode === "win" ? "escape" : game.act.id}`;
    if (this.needsWorldRebuild || worldKey !== this.currentWorldKey) {
      this.rebuildWorld(game);
      this.currentWorldKey = worldKey;
      this.needsWorldRebuild = false;
    }

    this.applyPalette(game);
    this.updateCamera(game);
    this.updateDynamicObjects(game);
    this.renderer.render(this.scene, this.camera);
  }

  rebuildWorld(game) {
    this.clearGroup(this.worldRoot);

    this.dynamic.gates = [];
    this.dynamic.hazards = [];
    this.dynamic.items = [];
    this.dynamic.fragments = [];
    this.dynamic.npcs = [];
    this.dynamic.solids = [];
    this.dynamic.decor = [];
    this.dynamic.conveyors = [];
    this.dynamic.endingScrap = [];
    this.dynamic.graphNodes = [];
    this.dynamic.graphEdges = [];
    this.dynamic.graphInteractors = [];
    this.dynamic.graphStructures = [];

    if (game.mode === "ending" || game.mode === "win") {
      this.buildEndingWorld();
      return;
    }

    this.buildActWorld(game);
  }

  buildActWorld(game) {
    this.world = { ...game.act.world };

    if (game.act.navigationMode === "graph") {
      this.buildGraphWorld(game);
      return;
    }

    const palette = PALETTES.yard;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(
        game.act.world.width / WORLD_SCALE,
        game.act.world.height / WORLD_SCALE
      ),
      new THREE.MeshStandardMaterial({
        color: palette.metalDark,
        roughness: 0.95,
        metalness: 0.1,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = false;
    this.worldRoot.add(floor);

    const grid = new THREE.GridHelper(
      game.act.world.width / WORLD_SCALE,
      Math.round(game.act.world.width / 120),
      color("#4b3335"),
      color("#231a1e")
    );
    grid.position.y = 0.03;
    this.worldRoot.add(grid);

    for (const solid of game.act.solids) {
      const mesh = this.createScrapBlock(solid);
      this.dynamic.solids.push(mesh);
      this.worldRoot.add(mesh);
    }

    for (const decor of game.act.decor || []) {
      const mesh = this.createDecorMesh(decor);
      if (!mesh) continue;
      this.dynamic.decor.push(mesh);
      this.worldRoot.add(mesh);
    }

    for (const belt of game.act.conveyors || []) {
      const mesh = this.createConveyor(belt);
      this.dynamic.conveyors.push({ source: belt, mesh });
      this.worldRoot.add(mesh);
    }

    for (const npc of game.act.npcs || []) {
      const model = this.createNpc(npc);
      this.dynamic.npcs.push({ source: npc, model });
      this.worldRoot.add(model.group);
    }

    for (const gate of game.act.gates || []) {
      const mesh = this.createGate(gate);
      this.dynamic.gates.push({ source: gate, mesh });
      this.worldRoot.add(mesh);
    }

    for (const hazard of game.act.hazards || []) {
      const crusher = this.createCrusher(hazard);
      this.dynamic.hazards.push({ source: hazard, mesh: crusher });
      this.worldRoot.add(crusher);
    }

    for (const item of game.act.items || []) {
      const mesh = this.createPickup(item.kind || "pickup");
      this.dynamic.items.push({ source: item, mesh });
      this.worldRoot.add(mesh);
    }

    for (const fragment of game.act.fragments || []) {
      const mesh = this.createFragment();
      this.dynamic.fragments.push({ source: fragment, mesh });
      this.worldRoot.add(mesh);
    }

    if (game.act.socket) {
      this.worldRoot.add(this.dynamic.socket);
    }
    if (game.act.battery) {
      this.worldRoot.add(this.dynamic.battery);
    }
    if (game.act.gateConsole) {
      this.worldRoot.add(this.dynamic.gateConsole);
    }
    if (game.act.console) {
      this.worldRoot.add(this.dynamic.finalConsole);
    }
    this.worldRoot.add(this.dynamic.exitArch, this.dynamic.checkpoint);
  }

  buildGraphWorld(game) {
    const palette = PALETTES.yard;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(game.act.world.width / WORLD_SCALE, game.act.world.height / WORLD_SCALE),
      new THREE.MeshStandardMaterial({
        color: "#212830",
        roughness: 0.96,
        metalness: 0.08,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    this.worldRoot.add(floor);

    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(6.6, 7.4, 1.2, 8),
      new THREE.MeshStandardMaterial({ color: "#2e3943", roughness: 0.88, metalness: 0.14 })
    );
    plinth.position.set(this.toWorldX(490), -0.56, this.toWorldZ(760));
    this.worldRoot.add(plinth);

    const shrineBase = new THREE.Mesh(
      new THREE.CylinderGeometry(1.55, 1.9, 0.5, 8),
      new THREE.MeshStandardMaterial({ color: "#3f4d59", roughness: 0.86, metalness: 0.16 })
    );
    shrineBase.position.set(this.toWorldX(490), 0.25, this.toWorldZ(260));
    this.worldRoot.add(shrineBase);

    const nodeMaterial = new THREE.MeshBasicMaterial({ color: palette.screen, transparent: true, opacity: 0.9 });
    for (const node of game.act.nodes || []) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(node.kind === "goal" ? 0.42 : 0.28, node.kind === "goal" ? 0.72 : 0.5, 32),
        nodeMaterial.clone()
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(this.toWorldX(node.x), 0.08, this.toWorldZ(node.y));
      ring.userData.nodeId = node.id;
      this.worldRoot.add(ring);
      this.dynamic.graphNodes.push(ring);
    }

    for (const edge of game.act.edges || []) {
      const fromNode = (game.act.nodes || []).find((node) => node.id === edge.from);
      const toNode = (game.act.nodes || []).find((node) => node.id === edge.to);
      if (!fromNode || !toNode) {
        continue;
      }
      const dx = toNode.x - fromNode.x;
      const dy = toNode.y - fromNode.y;
      const length = Math.hypot(dx, dy) / WORLD_SCALE;
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.06, Math.max(0.24, length)),
        new THREE.MeshBasicMaterial({ color: "#32404b", transparent: true, opacity: 0.7 })
      );
      strip.position.set(this.toWorldX((fromNode.x + toNode.x) / 2), 0.05, this.toWorldZ((fromNode.y + toNode.y) / 2));
      strip.rotation.y = Math.atan2(dx, dy);
      strip.userData = { edge };
      this.worldRoot.add(strip);
      this.dynamic.graphEdges.push(strip);
    }

    for (const interactor of game.act.interactors || []) {
      const pedestal = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.42, 0.34, 18),
        new THREE.MeshStandardMaterial({ color: "#ffb768", roughness: 0.46, metalness: 0.2 })
      );
      pedestal.position.set(this.toWorldX(interactor.x), 0.28, this.toWorldZ(interactor.y));
      pedestal.userData = { interactorId: interactor.id };
      this.worldRoot.add(pedestal);
      this.dynamic.graphInteractors.push(pedestal);
    }

    for (const structure of game.act.structures || []) {
      if (structure.type !== "rotating-bridge") {
        continue;
      }
      const group = new THREE.Group();
      const bridge = new THREE.Mesh(
        new THREE.BoxGeometry(0.48, 0.18, (structure.span || 220) / WORLD_SCALE),
        new THREE.MeshStandardMaterial({ color: "#d9d8cf", roughness: 0.72, metalness: 0.2 })
      );
      bridge.position.y = structure.baseHeight || 1.2;
      const spine = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.16, 1.6, 20),
        new THREE.MeshStandardMaterial({ color: "#5e7283", roughness: 0.58, metalness: 0.22 })
      );
      spine.position.y = 0.8;
      group.add(bridge, spine);
      group.position.set(this.toWorldX(structure.x), 0, this.toWorldZ(structure.y));
      group.userData = { structureId: structure.id, bridge };
      this.worldRoot.add(group);
      this.dynamic.graphStructures.push(group);
    }

    for (const npc of game.act.npcs || []) {
      const model = this.createNpc(npc);
      this.worldRoot.add(model.group);
      this.dynamic.npcs.push({ model, source: npc });
    }
  }

  buildEndingWorld() {
    this.world = { width: 2400, height: 920 };
    const skyPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 40),
      new THREE.MeshBasicMaterial({ color: "#4f6d8a" })
    );
    skyPlane.position.set(0, 12, -20);
    this.worldRoot.add(skyPlane);

    const sunrise = new THREE.Mesh(
      new THREE.CircleGeometry(5, 40),
      new THREE.MeshBasicMaterial({
        color: "#ffd493",
        transparent: true,
        opacity: 0.75,
      })
    );
    sunrise.position.set(14, 10, -18);
    this.worldRoot.add(sunrise);

    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 18),
      new THREE.MeshStandardMaterial({ color: "#4a4848", roughness: 1 })
    );
    road.rotation.x = -Math.PI / 2;
    this.worldRoot.add(road);

    for (let i = 0; i < 30; i += 1) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.04, 0.3),
        new THREE.MeshBasicMaterial({ color: "#f6d48c" })
      );
      stripe.position.set(-35 + i * 2.4, 0.03, 0);
      this.worldRoot.add(stripe);
      this.dynamic.endingScrap.push(stripe);
    }

    for (let i = 0; i < 18; i += 1) {
      const chunk = new THREE.Mesh(
        new THREE.BoxGeometry(1.2 + (i % 3) * 0.4, 0.6 + (i % 4) * 0.3, 0.9 + (i % 2) * 0.4),
        new THREE.MeshStandardMaterial({
          color: i % 2 ? "#6b5347" : "#3d3334",
          roughness: 1,
        })
      );
      chunk.position.set(-25 + i * 2.8, 0.3, -4.8 - (i % 3) * 1.2);
      this.worldRoot.add(chunk);
      this.dynamic.endingScrap.push(chunk);
    }
  }

  updateCamera(game) {
    const palette = game.mode === "ending" || game.mode === "win" ? PALETTES.dawn : PALETTES.yard;
    const playerX = this.toWorldX(game.player.x + game.player.w / 2);
    const playerZ = this.toWorldZ(game.player.y + game.player.h / 2);
    const titleMode = game.mode === "title";
    const bootMode = game.mode === "boot";
    const graphMode = game.act?.navigationMode === "graph" && !titleMode && !bootMode;
    const targetX = titleMode ? playerX + 3.4 : this.toWorldX(game.camera.x + VIEW_WIDTH / 2);
    const targetZ = titleMode ? playerZ - 0.6 : this.toWorldZ(game.camera.y + VIEW_HEIGHT / 2);
    const y = game.mode === "ending" || game.mode === "win" ? 17 : titleMode ? 15.6 : bootMode ? 16.2 : graphMode ? 19.5 : 18;
    const cameraOffsetX = titleMode ? -6.2 : bootMode ? -5.1 : graphMode ? -3.1 : -4;
    const cameraOffsetZ = titleMode ? 11.4 : bootMode ? 11.9 : graphMode ? 11.6 : 13;
    const bootSwayX = bootMode ? Math.sin(game.time * 8.5) * (0.12 + game.powerSurge * 0.18) : 0;
    const bootSwayZ = bootMode ? Math.cos(game.time * 6.2) * 0.16 : 0;
    this.camera.position.set(targetX + cameraOffsetX + bootSwayX, y, targetZ + cameraOffsetZ + bootSwayZ);
    this.camera.lookAt(targetX, titleMode ? 0.75 : bootMode ? 0.42 : graphMode ? 0.62 : 0, targetZ);
    this.floorGlow.material.color.set(palette.lamp);
    this.floorGlow.position.set(titleMode ? playerX + 0.25 : targetX, 0.02, titleMode ? playerZ : targetZ);
    this.sunHalo.material.color.set(palette.lamp);
    this.sunHalo.position.set(targetX + (titleMode ? 9.4 : 11), game.mode === "ending" || game.mode === "win" ? 10.5 : titleMode ? 8.2 : 8.8, targetZ - (titleMode ? 18.5 : 21));
  }

  updateDynamicObjects(game) {
    const pulse = 0.5 + (Math.sin(game.time * 4.4) + 1) * 0.5;
    const playerX = this.toWorldX(game.player.x + game.player.w / 2);
    const playerZ = this.toWorldZ(game.player.y + game.player.h / 2);
    const titleMode = game.mode === "title";
    const bootMode = game.mode === "boot";

    if (game.act?.navigationMode === "graph") {
      this.dynamic.graphNodes.forEach((ring) => {
        const node = (game.act.nodes || []).find((entry) => entry.id === ring.userData.nodeId);
        const active = game.pathState.currentNodeId === node?.id || game.pathState.targetNodeId === node?.id;
        ring.material.color.set(node?.kind === "goal" ? "#fff0b8" : active ? "#bafff0" : "#8effd3");
        ring.material.opacity = node?.kind === "goal" ? 0.95 : active ? 0.92 : 0.55;
        const scale = node?.kind === "goal" ? 1.06 + pulse * 0.08 : active ? 1.08 : 1;
        ring.scale.setScalar(scale);
      });

      this.dynamic.graphEdges.forEach((strip) => {
        const edge = strip.userData.edge;
        const enabled = !edge.requiresState || Object.entries(edge.requiresState).every(([key, value]) => game.structureState[key] === value);
        strip.material.color.set(enabled ? "#d4fff3" : "#32404b");
        strip.material.opacity = enabled ? 0.88 : 0.2;
      });

      this.dynamic.graphInteractors.forEach((pedestal) => {
        pedestal.material.emissive = pedestal.material.emissive || new THREE.Color("#000000");
        pedestal.material.emissive.set("#ffb768");
        pedestal.material.emissiveIntensity = 0.2 + pulse * 0.22;
        pedestal.scale.setScalar(game.interactionFocus?.type === "interactor" ? 1.08 : 1);
      });

      this.dynamic.graphStructures.forEach((group) => {
        group.rotation.y = game.getStructureAngle(group.userData.structureId);
      });
    }

    this.heroLight.position.set(playerX + (titleMode ? 0.15 : 0.3), game.mode === "ending" || game.mode === "win" ? 2.6 : titleMode ? 2.75 : 2.2, playerZ + (titleMode ? -0.05 : 0.15));
    this.heroLightGlow.position.set(playerX + (titleMode ? 0.05 : 0.15), 0.03, playerZ + (titleMode ? -0.04 : 0.05));
    this.heroLight.intensity =
      bootMode
        ? 2.35 + pulse * 0.75
        : titleMode
          ? 2.1 + pulse * 0.42
          : game.mode === "ending" || game.mode === "win"
            ? 1.15 + pulse * 0.18
            : 1.35 + pulse * 0.22;
    this.heroLight.intensity += game.powerSurge * 0.55 + game.triumph * 0.22;
    this.heroLight.distance = game.mode === "ending" || game.mode === "win" ? 12 : titleMode ? 16 : bootMode ? 18 : 14;
    this.heroLightGlow.material.opacity =
      bootMode
        ? 0.22 + pulse * 0.12
        : titleMode
          ? 0.2 + pulse * 0.07
          : game.mode === "ending" || game.mode === "win"
            ? 0.1 + pulse * 0.03
            : 0.12 + pulse * 0.04;
    this.sunHalo.material.opacity =
      (game.mode === "ending" || game.mode === "win" ? 0.12 : titleMode ? 0.13 : bootMode ? 0.16 : 0.08) +
      pulse * (titleMode ? 0.035 : bootMode ? 0.06 : 0.015);
    this.floorGlow.material.opacity =
      (game.mode === "ending" || game.mode === "win" ? 0.16 : titleMode ? 0.22 : bootMode ? 0.3 : 0.18) +
      Math.sin(game.time * 1.8) * (bootMode ? 0.05 : 0.015);
    this.dustField.position.set(playerX + (titleMode ? 0.8 : 0), 0, playerZ + (titleMode ? -0.3 : 0));
    this.dustMotes.forEach((mote, index) => {
      const { baseX, baseY, baseZ, drift, phase } = mote.userData;
      mote.position.set(
        baseX + Math.sin(game.time * drift + phase) * 0.55,
        baseY + Math.sin(game.time * (0.5 + drift) + phase) * 0.22,
        baseZ + Math.cos(game.time * (0.38 + drift) + phase) * 0.35
      );
      mote.material.opacity = (titleMode ? 0.12 : 0.08) + (Math.sin(game.time * 0.9 + index) + 1) * 0.025;
      mote.scale.setScalar(titleMode ? 1.2 : 1);
    });
    this.sparkField.position.set(playerX + (titleMode ? 1.5 : 0), 0, playerZ + (titleMode ? -0.5 : 0));
    this.atmosphereSparks.forEach((spark, index) => {
      const flicker = Math.max(0, Math.sin(game.time * (3.8 + index) + spark.userData.phase));
      spark.position.set(
        spark.userData.baseX,
        spark.userData.baseY + flicker * 0.2,
        spark.userData.baseZ
      );
      spark.material.opacity = 0.05 + flicker * (titleMode ? 0.28 : 0.2);
      spark.scale.setScalar(0.8 + flicker * 0.9);
    });
    this.atmosphereBillboards.position.set(playerX + (titleMode ? 0.7 : 0), 0, playerZ + (titleMode ? -0.2 : 0));
    this.billboardMotes.forEach((sprite, index) => {
      const { layer, baseX, baseY, baseZ, phase, drift, sway, scale } = sprite.userData;
      const layerBoost = titleMode ? 1.28 : game.mode === "ending" || game.mode === "win" ? 0.9 : 1;
      const bob = Math.sin(game.time * (0.62 + drift) + phase) * (0.16 + layer * 0.04);
      const swayX = Math.cos(game.time * (0.4 + sway) + phase) * (0.28 + layer * 0.06);
      const swayZ = Math.sin(game.time * (0.28 + drift) + phase) * (0.18 + layer * 0.05);
      sprite.position.set(baseX + swayX, baseY + bob, baseZ + swayZ);
      sprite.material.opacity =
        (titleMode ? 0.09 : game.mode === "ending" || game.mode === "win" ? 0.06 : 0.05) +
        (Math.sin(game.time * (0.9 + drift) + index * 0.17) + 1) * (titleMode ? 0.055 : 0.035);
      sprite.scale.setScalar((scale + pulse * 0.04 * (layer + 1)) * layerBoost);
    });
    if (this.dynamic.gateConsole.userData.screenGlow) {
      const consolePulse = 0.09 + Math.max(0, Math.sin(game.time * 3.4)) * 0.12;
      this.dynamic.gateConsole.userData.screenGlow.material.opacity = consolePulse;
      this.dynamic.gateConsole.userData.led.material.color.set(Math.sin(game.time * 3.4) > 0 ? "#ffd37d" : "#6f5f36");
    }
    if (this.dynamic.finalConsole.userData.screenGlow) {
      const finalPulse = 0.08 + Math.max(0, Math.sin(game.time * 2.8 + 0.7)) * 0.14;
      this.dynamic.finalConsole.userData.screenGlow.material.opacity = finalPulse;
      this.dynamic.finalConsole.userData.led.material.color.set(Math.sin(game.time * 2.8 + 0.7) > 0 ? "#8effd3" : "#23433b");
    }
    this.dynamic.decor.forEach((mesh) => {
      if (mesh.userData?.effectType !== "spark") return;
      const flicker = Math.max(0, Math.sin(game.time * 5.6 + mesh.userData.phase));
      mesh.material.opacity = 0.18 + flicker * 0.75;
      mesh.scale.setScalar(0.9 + flicker * 0.7);
    });
    if (this.dynamic.player.powerLed?.material) {
      this.dynamic.player.powerLed.material.color.set(
        game.mode === "boot"
          ? Math.sin(game.time * 8) > 0 ? "#d8fff3" : "#5aa690"
          : titleMode
            ? Math.sin(game.time * 3.6) > 0 ? "#d8fff3" : "#7de8ca"
            : "#8effd3"
      );
    }
    if (this.dynamic.player.screenGlow?.material) {
      this.dynamic.player.screenGlow.material.opacity += game.mode === "boot" ? Math.max(0, Math.sin(game.time * 8)) * 0.08 : 0;
    }
    if (game.mode === "ending" || game.mode === "win") {
      this.updateLaptop(this.dynamic.player, game.player, game.player.mood, true);
      this.dynamic.player.group.scale.setScalar(1.08);
      this.dynamic.playerShadow.position.set(playerX, 0.04, playerZ);
      this.dynamic.playerShadow.scale.set(1.15, 1, 1.15);
      this.dynamic.playerShadow.material.opacity = 0.24 + pulse * 0.08;
      this.dynamic.interactionRing.visible = false;
      return;
    }

    this.updateLaptop(this.dynamic.player, game.player, titleMode ? "heroic" : game.player.mood);
    this.dynamic.player.group.scale.setScalar(titleMode ? 1.6 : 1);
    this.dynamic.player.group.position.y = titleMode ? 0.08 : 0;
    this.dynamic.playerShadow.position.set(playerX + (titleMode ? -0.08 : 0), 0.04, playerZ + (titleMode ? -0.03 : 0));
    this.dynamic.playerShadow.scale.set(titleMode ? 1.95 : 1.3, 1, titleMode ? 1.72 : 1.22);
    this.dynamic.playerShadow.material.opacity = titleMode ? 0.34 + pulse * 0.1 : 0.26 + pulse * 0.08;

    if (game.interactionFocus) {
      const focus = game.interactionFocus;
      this.dynamic.interactionRing.visible = true;
      this.dynamic.interactionRing.position.set(
        this.toWorldX(focus.x + focus.w / 2),
        0.06,
        this.toWorldZ(focus.y + focus.h / 2)
      );
      const scaleX = Math.max(0.85, focus.w / WORLD_SCALE);
      const scaleZ = Math.max(0.85, focus.h / WORLD_SCALE);
      const ring = this.dynamic.interactionRing.userData.ring;
      const glow = this.dynamic.interactionRing.userData.glow;
      const beacon = this.dynamic.interactionRing.userData.beacon;
      const beaconCross = this.dynamic.interactionRing.userData.beaconCross;
      const topHalo = this.dynamic.interactionRing.userData.topHalo;
      const cap = this.dynamic.interactionRing.userData.cap;
      const tone = focus.tone || "talk";
      const highlightStyle = focus.highlightStyle || "ring";
      const cueStyle = getInteractionCueStyle({ tone, highlightStyle, pulse });

      this.dynamic.interactionRing.scale.set(scaleX, 1, scaleZ);
      if (ring) {
        ring.material.color.set(cueStyle.palette.ring);
        ring.material.opacity = cueStyle.ringOpacity;
      }
      if (glow) {
        glow.material.color.set(cueStyle.palette.ring);
        glow.material.opacity = cueStyle.glowOpacity;
        glow.scale.setScalar(cueStyle.glowScale);
      }
      if (beacon) {
        beacon.material.color.set(cueStyle.palette.ring);
        beacon.material.opacity = cueStyle.beaconOpacity;
        beacon.scale.set(cueStyle.beaconScale.x, cueStyle.beaconScale.y, 1);
      }
      if (beaconCross) {
        beaconCross.material.color.set(cueStyle.palette.ring);
        beaconCross.material.opacity = cueStyle.beaconOpacity * 0.9;
        beaconCross.scale.set(cueStyle.beaconScale.x, cueStyle.beaconScale.y, 1);
      }
      if (topHalo) {
        topHalo.material.color.set(cueStyle.palette.accent);
        topHalo.material.opacity = Math.min(1, cueStyle.capOpacity * 0.7);
        topHalo.scale.setScalar(0.95 + cueStyle.capScale * 0.3);
      }
      if (cap) {
        cap.material.color.set(cueStyle.palette.accent);
        cap.material.opacity = cueStyle.capOpacity;
        cap.scale.setScalar(cueStyle.capScale);
      }
    } else {
      this.dynamic.interactionRing.visible = false;
    }

    if (game.act.socket) {
      this.positionBox(this.dynamic.socket, game.act.socket, 0.4);
      this.dynamic.socket.visible = true;
      this.dynamic.socket.material.color.set(
        game.progress.batterySocketPowered ? "#63ffd1" : "#203138"
      );
      this.dynamic.socket.material.emissive?.set?.(game.progress.batterySocketPowered ? "#2ee2b3" : "#0f1518");
      this.dynamic.socket.material.emissiveIntensity = game.progress.batterySocketPowered ? 0.48 + pulse * 0.16 : 0.08 + pulse * 0.12;
    } else {
      this.dynamic.socket.visible = false;
    }

    if (game.act.battery) {
      this.positionBox(this.dynamic.battery, game.act.battery, 0.34 + Math.sin(game.time * 3.8) * 0.04);
      this.dynamic.battery.visible = !game.progress.batterySocketPowered || game.mode === "play";
      this.dynamic.battery.material.color.set(
        game.progress.batterySocketPowered ? "#72ffd7" : "#ff8c62"
      );
      this.dynamic.battery.material.emissive?.set?.(game.progress.batterySocketPowered ? "#2ccfb0" : "#7a2a12");
      this.dynamic.battery.material.emissiveIntensity = game.progress.batterySocketPowered ? 0.42 : 0.18 + pulse * 0.14;
      this.dynamic.battery.rotation.y = Math.sin(game.time * 2.2) * 0.2;
    } else {
      this.dynamic.battery.visible = false;
    }

    if (game.act.gateConsole) {
      this.positionBox(this.dynamic.gateConsole, game.act.gateConsole, 0.9);
      this.dynamic.gateConsole.visible = true;
      if (this.dynamic.gateConsole.userData.screen) {
        this.dynamic.gateConsole.userData.screen.material.color.set(game.progress.hasFloppy ? "#c9fff1" : "#9afce3");
      }
    } else {
      this.dynamic.gateConsole.visible = false;
    }

    if (game.act.console) {
      this.positionBox(this.dynamic.finalConsole, game.act.console, 0.9);
      this.dynamic.finalConsole.visible = true;
      if (this.dynamic.finalConsole.userData.screen) {
        this.dynamic.finalConsole.userData.screen.material.color.set(game.progress.diagnosticPassed ? "#d8fff3" : "#9afce3");
      }
    } else {
      this.dynamic.finalConsole.visible = false;
    }

    this.dynamic.gates.forEach(({ source, mesh }) => {
      mesh.visible = !game.progress[source.opensWith];
      this.positionBox(mesh, source, 2.2);
      if (mesh.material) {
        mesh.material.emissiveIntensity = 0.12 + pulse * 0.1;
      }
      if (mesh.userData?.beacon) {
        mesh.userData.beacon.material.opacity = 0.18 + pulse * 0.18;
      }
    });

    this.dynamic.hazards.forEach(({ source, mesh }) => {
      const rect = {
        x: source.x,
        y: source.y + (source.currentOffset || 0),
        w: source.w,
        h: source.h,
      };
      this.positionBox(mesh, rect, 2.4);
      if (mesh.userData?.arm?.material) {
        mesh.userData.arm.material.emissiveIntensity = 0.16 + pulse * 0.22;
      }
      if (mesh.userData?.warning) {
        mesh.userData.warning.material.opacity = 0.16 + pulse * 0.24;
      }
    });

    this.dynamic.items.forEach(({ source, mesh }) => {
      mesh.visible = !source.collected;
      mesh.position.set(this.toWorldX(source.x + source.w / 2), 0.8, this.toWorldZ(source.y + source.h / 2));
      mesh.rotation.y = game.time * 2;
      if (mesh.userData?.halo) {
        mesh.userData.halo.material.opacity = 0.16 + pulse * 0.22;
        mesh.userData.halo.scale.setScalar(0.95 + pulse * 0.2);
      }
      if (mesh.userData?.core?.material) {
        mesh.userData.core.material.emissiveIntensity = 0.18 + pulse * 0.2;
      }
    });

    this.dynamic.fragments.forEach(({ source, mesh }) => {
      mesh.visible = !source.collected;
      mesh.position.set(this.toWorldX(source.x), 0.95 + Math.sin(game.time * 4 + source.x) * 0.12, this.toWorldZ(source.y));
      mesh.rotation.y = game.time * 1.5;
      if (mesh.userData?.halo) {
        mesh.userData.halo.material.opacity = 0.14 + pulse * 0.22;
        mesh.userData.halo.scale.setScalar(0.9 + pulse * 0.25);
      }
      if (mesh.userData?.shard?.material) {
        mesh.userData.shard.material.emissiveIntensity = 0.3 + pulse * 0.24;
      }
    });

    this.dynamic.npcs.forEach(({ source, model }) => {
      this.updateLaptop(model, source, source.portrait === "modem" ? "wise" : "curious");
      model.group.position.y = 0.25;
    });

    this.dynamic.conveyors.forEach(({ source, mesh }) => {
      this.positionBox(mesh, source, 0.1);
      const stripes = mesh.userData.stripes || [];
      stripes.forEach((stripe, index) => {
        stripe.position.x = -source.w / WORLD_SCALE / 2 + ((index * 1.4 + game.time * 3.6) % 8);
      });
    });

    const exit = game.act.exitZone;
    if (exit) {
      this.dynamic.exitArch.visible = !exit.requires || game.progress[exit.requires];
      this.positionBox(this.dynamic.exitArch, exit, 1.8);
      if (this.dynamic.exitArch.userData?.beacon) {
        this.dynamic.exitArch.userData.beacon.material.opacity = 0.18 + pulse * 0.2;
        this.dynamic.exitArch.userData.beacon.scale.setScalar(0.95 + pulse * 0.16);
      }
    } else {
      this.dynamic.exitArch.visible = false;
    }

    this.dynamic.checkpoint.visible = true;
    this.dynamic.checkpoint.position.set(
      this.toWorldX(game.activeCheckpoint.x),
      0.14,
      this.toWorldZ(game.activeCheckpoint.y)
    );
    this.dynamic.checkpoint.rotation.y = game.time;
    this.dynamic.checkpoint.material.opacity = 0.34 + Math.sin(game.time * 4) * 0.12;
    this.dynamic.checkpoint.scale.setScalar(1 + pulse * 0.18);

    this.renderer.domElement.style.filter = `saturate(${game.mode === "boot" ? 1.15 : 1 + game.powerSurge * 0.28}) brightness(${1 + game.flash * 0.18 + game.triumph * 0.08}) contrast(${1 + game.impact * 0.08})`;
    const shakeX = Math.sin(game.time * 60) * game.glitch * 2 + Math.sin(game.time * 90) * game.impact * 6;
    const shakeY = Math.cos(game.time * 70) * game.impact * 2.5;
    this.mount.style.transform = game.glitch > 0 || game.impact > 0 ? `translate(${shakeX}px, ${shakeY}px)` : "";
  }

  applyPalette(game) {
    const endingMode = game.mode === "ending" || game.mode === "win";
    const graphMode = game.act?.navigationMode === "graph" && !endingMode;
    const palette = endingMode
      ? PALETTES.dawn
      : graphMode
        ? {
            skyTop: "#5c6f8f",
            skyBottom: "#d9c9b0",
            lamp: "#ffe7bf",
            accent: "#b8fff1",
          }
        : PALETTES.yard;
    this.scene.background = color(palette.skyTop);
    this.scene.fog.color.set(palette.skyBottom);
    this.scene.fog.near = endingMode ? 20 : graphMode ? 16 : 14;
    this.scene.fog.far = endingMode ? 72 : graphMode ? 64 : 54;
    this.ambientLight.color.set(palette.lamp);
    this.ambientLight.groundColor.set(endingMode ? "#38444c" : graphMode ? "#4b5360" : "#182226");
    this.ambientLight.intensity = endingMode ? 1.2 : graphMode ? 1.28 : 1.05;
    this.sunLight.color.set(palette.lamp);
    this.sunLight.intensity = endingMode ? 1.35 : graphMode ? 1.12 : 1.55;
    this.fillLight.color.set(endingMode ? "#bfd7ff" : graphMode ? "#f1d9ff" : "#7db8ff");
    this.fillLight.intensity = endingMode ? 0.3 : graphMode ? 0.5 : 0.45;
    this.rimLight.color.set(palette.accent);
    this.rimLight.intensity = endingMode ? 0.75 : graphMode ? 1.18 : 1.05;
    this.heroLight.color.set(palette.accent);
    this.floorGlow.material.opacity = endingMode ? 0.16 : graphMode ? 0.22 : 0.18;
    this.heroLightGlow.material.color.set(palette.accent);
    this.sunHalo.material.opacity = endingMode ? 0.12 : graphMode ? 0.12 : 0.08;
  }

  clearGroup(group) {
    while (group.children.length) {
      group.remove(group.children[0]);
    }
  }

  createScrapBlock(rect) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(rect.w / WORLD_SCALE, 1.3, rect.h / WORLD_SCALE),
      new THREE.MeshStandardMaterial({
        color: "#44525c",
        roughness: 0.92,
        metalness: 0.18,
      })
    );
    this.positionBox(mesh, rect, 1.3);
    return mesh;
  }

  createDecorMesh(decor) {
    if (decor.starterProp) {
      const assetMesh = this.createStarterProp(decor);
      if (assetMesh) {
        return assetMesh;
      }
    }

    if (decor.type === "pile") {
      const group = new THREE.Group();
      for (let i = 0; i < 5; i += 1) {
        const piece = new THREE.Mesh(
          new THREE.BoxGeometry(0.9 + i * 0.12, 0.45 + i * 0.1, 0.9),
          new THREE.MeshStandardMaterial({
            color: i % 2 ? "#6a4c4f" : "#4f3c40",
            roughness: 1,
          })
        );
        piece.position.set(i * 0.32 - 0.8, piece.geometry.parameters.height / 2, (i % 2) * 0.22 - 0.12);
        piece.rotation.y = i * 0.5;
        group.add(piece);
      }
      return this.placeFreeform(group, decor);
    }

    if (decor.type === "crate") {
      return this.placeFreeform(
        new THREE.Mesh(
          new THREE.BoxGeometry(decor.w / WORLD_SCALE, 0.9, decor.h / WORLD_SCALE),
          new THREE.MeshStandardMaterial({ color: "#715c44", roughness: 1 })
        ),
        decor,
        0.45
      );
    }

    if (decor.type === "pipe") {
      return this.placeFreeform(
        new THREE.Mesh(
          new THREE.CylinderGeometry(0.2, 0.2, decor.w / WORLD_SCALE, 12),
          new THREE.MeshStandardMaterial({ color: "#6e7378", roughness: 0.75, metalness: 0.35 })
        ),
        decor,
        0.35,
        (mesh) => {
          mesh.rotation.z = Math.PI / 2;
        }
      );
    }

    if (decor.type === "spark") {
      const light = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 8, 8),
        new THREE.MeshBasicMaterial({ color: "#ffd37d" })
      );
      light.userData.effectType = "spark";
      light.userData.phase = (decor.x + decor.y) * 0.01;
      return this.placeFreeform(light, { ...decor, w: 10, h: 10 }, 1.6);
    }

    if (decor.type === "scatter_scrap") {
      return this.createScatterCluster(decor);
    }

    return null;
  }

  createScatterCluster(decor) {
    const group = new THREE.Group();
    const count = decor.count || 12;
    const width = Math.max(0.6, (decor.w || 80) / WORLD_SCALE);
    const depth = Math.max(0.6, (decor.h || 60) / WORLD_SCALE);
    const colors = decor.colors || ["#58646d", "#445057", "#715c44", "#6e7378"];

    for (let i = 0; i < count; i += 1) {
      const variant = i % 3;
      let piece;
      if (variant === 0) {
        piece = new THREE.Mesh(
          new THREE.BoxGeometry(0.16 + (i % 4) * 0.05, 0.05 + (i % 3) * 0.02, 0.12 + (i % 5) * 0.03),
          new THREE.MeshStandardMaterial({
            color: colors[i % colors.length],
            roughness: 0.95,
            metalness: 0.08,
          })
        );
      } else if (variant === 1) {
        piece = new THREE.Mesh(
          new THREE.CylinderGeometry(0.03, 0.03, 0.16 + (i % 4) * 0.05, 8),
          new THREE.MeshStandardMaterial({
            color: colors[(i + 1) % colors.length],
            roughness: 0.76,
            metalness: 0.3,
          })
        );
        piece.rotation.z = Math.PI / 2 + i * 0.3;
      } else {
        piece = new THREE.Mesh(
          new THREE.BoxGeometry(0.1 + (i % 3) * 0.05, 0.02 + (i % 2) * 0.015, 0.18 + (i % 4) * 0.04),
          new THREE.MeshStandardMaterial({
            color: colors[(i + 2) % colors.length],
            roughness: 0.88,
            metalness: 0.16,
          })
        );
        piece.rotation.x = (i % 2) * 0.3;
      }

      const t = i / Math.max(1, count - 1);
      piece.position.set(
        (t - 0.5) * width + Math.sin(i * 12.45) * width * 0.18,
        0.02 + (i % 4) * 0.015,
        Math.cos(i * 8.13) * depth * 0.32
      );
      piece.rotation.y += i * 0.61;
      group.add(piece);
    }

    return this.placeFreeform(group, decor, decor.height ?? 0.08);
  }

  createStarterProp(decor) {
    const template = this.assetModels.get(decor.starterProp);
    if (!template) {
      return null;
    }

    const group = template.clone(true);
    group.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = false;
        node.receiveShadow = false;
      }
    });

    const scale = decor.propScale || 1;
    group.scale.setScalar(scale);
    group.rotation.y = decor.propRotationY || 0;
    const baseHeight = decor.propHeight ?? 0;
    group.position.set(
      this.toWorldX(decor.x + (decor.w || 0) / 2),
      baseHeight,
      this.toWorldZ(decor.y + (decor.h || 0) / 2)
    );
    return group;
  }

  placeFreeform(mesh, decor, height = 0.3, customizer) {
    mesh.position.set(
      this.toWorldX(decor.x + (decor.w || 0) / 2),
      height,
      this.toWorldZ(decor.y + (decor.h || 0) / 2)
    );
    if (customizer) customizer(mesh);
    return mesh;
  }

  createConveyor(rect) {
    const group = new THREE.Group();
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(rect.w / WORLD_SCALE, 0.16, rect.h / WORLD_SCALE),
      new THREE.MeshStandardMaterial({ color: "#293239", roughness: 0.82, metalness: 0.2 })
    );
    group.add(base);

    const stripes = [];
    for (let i = 0; i < 6; i += 1) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.02, 0.08),
        new THREE.MeshBasicMaterial({ color: "#7af1c8" })
      );
      stripe.position.y = 0.1;
      stripe.position.z = 0.12;
      group.add(stripe);
      stripes.push(stripe);
    }
    group.userData.stripes = stripes;
    this.positionBox(group, rect, 0.08);
    return group;
  }

  createCrusher(rect) {
    const group = new THREE.Group();
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(rect.w / WORLD_SCALE, 2.2, rect.h / WORLD_SCALE),
      new THREE.MeshStandardMaterial({
        color: "#ff7c55",
        roughness: 0.65,
        metalness: 0.15,
        emissive: "#6a2014",
        emissiveIntensity: 0.18,
      })
    );
    const warning = new THREE.Mesh(
      new THREE.PlaneGeometry(rect.w / WORLD_SCALE * 0.92, 0.22),
      new THREE.MeshBasicMaterial({
        color: "#ffd37d",
        transparent: true,
        opacity: 0.22,
      })
    );
    warning.position.set(0, 0.5, rect.h / WORLD_SCALE / 2 + 0.02);
    const piston = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 4.5, 0.22),
      new THREE.MeshStandardMaterial({ color: "#8f959b", roughness: 0.6, metalness: 0.5 })
    );
    piston.position.y = 1.2;
    group.add(arm, warning, piston);
    group.userData.arm = arm;
    group.userData.warning = warning;
    this.positionBox(group, rect, 1.1);
    return group;
  }

  createGate(rect) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(rect.w / WORLD_SCALE, 2.4, rect.h / WORLD_SCALE),
      new THREE.MeshStandardMaterial({
        color: "#ef7c59",
        roughness: 0.8,
        metalness: 0.1,
        emissive: "#4e1915",
        emissiveIntensity: 0.16,
      })
    );
    const beacon = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(0.45, rect.w / WORLD_SCALE * 0.9), 0.22),
      new THREE.MeshBasicMaterial({
        color: "#ffd37d",
        transparent: true,
        opacity: 0.2,
      })
    );
    beacon.position.set(0, 1.45, rect.h / WORLD_SCALE / 2 + 0.03);
    mesh.add(beacon);
    mesh.userData.beacon = beacon;
    this.positionBox(mesh, rect, 1.2);
    return mesh;
  }

  createPickup(kind) {
    const colorValue = kind === "pickup" ? "#7e92ff" : "#8effd3";
    const group = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.14, 0.35),
      new THREE.MeshStandardMaterial({
        color: colorValue,
        roughness: 0.55,
        metalness: 0.4,
        emissive: colorValue,
        emissiveIntensity: 0.18,
      })
    );
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.24, 0.42, 28),
      new THREE.MeshBasicMaterial({
        color: colorValue,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
      })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -0.02;
    group.add(core, halo);
    group.userData.core = core;
    group.userData.halo = halo;
    return group;
  }

  createFragment() {
    const group = new THREE.Group();
    const shard = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.24, 0),
      new THREE.MeshStandardMaterial({
        color: "#ffd48a",
        roughness: 0.3,
        metalness: 0.3,
        emissive: "#ffd48a",
        emissiveIntensity: 0.35,
      })
    );
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.38, 26),
      new THREE.MeshBasicMaterial({
        color: "#ffd48a",
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
      })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -0.03;
    group.add(shard, halo);
    group.userData.shard = shard;
    group.userData.halo = halo;
    return group;
  }

  createBattery() {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.28, 0.6),
      new THREE.MeshStandardMaterial({
        color: "#ff8c62",
        roughness: 0.62,
        metalness: 0.2,
        emissive: "#7a2a12",
        emissiveIntensity: 0.18,
      })
    );
    return mesh;
  }

  createSocket() {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.22, 1.1),
      new THREE.MeshStandardMaterial({
        color: "#203138",
        roughness: 0.88,
        metalness: 0.18,
        emissive: "#0f1518",
        emissiveIntensity: 0.08,
      })
    );
    return mesh;
  }

  createConsole(label) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.65, 1.1),
      new THREE.MeshStandardMaterial({ color: "#4a5963", roughness: 0.7, metalness: 0.24 })
    );
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8, 0.34),
      new THREE.MeshBasicMaterial({ color: "#9afce3" })
    );
    screen.position.set(0, 0.15, 0.57);
    const screenGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.92, 0.42),
      new THREE.MeshBasicMaterial({
        color: "#8effd3",
        transparent: true,
        opacity: 0.12,
      })
    );
    screenGlow.position.set(0, 0.15, 0.55);
    const glyph = new THREE.Mesh(
      new THREE.PlaneGeometry(0.4, 0.1),
      new THREE.MeshBasicMaterial({ color: "#0e1618" })
    );
    glyph.position.set(0, -0.1, 0.57);
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 10, 10),
      new THREE.MeshBasicMaterial({ color: "#ffd37d" })
    );
    led.position.set(0.43, 0.26, 0.45);
    group.add(body, screenGlow, screen, glyph, led);
    group.userData.label = label;
    group.userData.screen = screen;
    group.userData.screenGlow = screenGlow;
    group.userData.led = led;
    return group;
  }

  createExitArch() {
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({
      color: "#8effd3",
      transparent: true,
      opacity: 0.7,
    });
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.24, 2.1, 0.24), material);
    const right = new THREE.Mesh(new THREE.BoxGeometry(0.24, 2.1, 0.24), material);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.24, 0.24), material);
    const beacon = new THREE.Mesh(
      new THREE.RingGeometry(0.78, 1.08, 28),
      new THREE.MeshBasicMaterial({
        color: "#8effd3",
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
      })
    );
    left.position.x = -0.45;
    right.position.x = 0.45;
    top.position.y = 0.95;
    beacon.rotation.x = -Math.PI / 2;
    beacon.position.set(0, 0.06, 0);
    group.add(left, right, top, beacon);
    group.userData.beacon = beacon;
    return group;
  }

  createCheckpointBeacon() {
    const beacon = new THREE.Mesh(
      new THREE.RingGeometry(0.25, 0.48, 24),
      new THREE.MeshBasicMaterial({
        color: "#ffd37d",
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
      })
    );
    beacon.userData.baseOpacity = 0.35;
    return beacon;
  }

  createPlayerShadow() {
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.68, 28),
      new THREE.MeshBasicMaterial({
        color: "#10191d",
        transparent: true,
        opacity: 0.3,
      })
    );
    shadow.rotation.x = -Math.PI / 2;
    return shadow;
  }

  createInteractionRing() {
    const group = new THREE.Group();

    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(1.28, 40),
      new THREE.MeshBasicMaterial({
        color: "#8effd3",
        transparent: true,
        opacity: 0.14,
        side: THREE.DoubleSide,
      })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.018;

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.98, 32),
      new THREE.MeshBasicMaterial({
        color: "#8effd3",
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.035;

    const beacon = new THREE.Mesh(
      new THREE.PlaneGeometry(0.44, 2.05),
      new THREE.MeshBasicMaterial({
        color: "#8effd3",
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
      })
    );
    beacon.position.set(0, 1.28, 0);

    const beaconCross = beacon.clone();
    beaconCross.rotation.y = Math.PI / 2;

    const topHalo = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.34, 24),
      new THREE.MeshBasicMaterial({
        color: "#dffef0",
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
      })
    );
    topHalo.position.set(0, 2.02, 0);
    topHalo.rotation.x = -Math.PI / 2;

    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 12, 12),
      new THREE.MeshBasicMaterial({
        color: "#ffd37d",
        transparent: true,
        opacity: 0.85,
      })
    );
    cap.position.set(0, 2.18, 0);

    group.add(glow, ring, beacon, beaconCross, topHalo, cap);
    group.userData.glow = glow;
    group.userData.ring = ring;
    group.userData.beacon = beacon;
    group.userData.beaconCross = beaconCross;
    group.userData.topHalo = topHalo;
    group.userData.cap = cap;
    return group;
  }

  createLaptop(kind) {
    const group = new THREE.Group();
    const isPlayer = kind === "player";
    const shellColor = isPlayer ? "#c8d1cb" : "#7a8792";
    const shellAccent = isPlayer ? "#e7d9b1" : "#8d98a1";
    const lidColor = isPlayer ? "#60737d" : "#505d67";
    const screenColor = isPlayer ? "#b9fff0" : "#c6ffe7";

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(1.18, 0.26, 0.82),
      new THREE.MeshStandardMaterial({
        color: shellColor,
        roughness: 0.5,
        metalness: 0.18,
        emissive: isPlayer ? "#182226" : "#0b0f11",
        emissiveIntensity: isPlayer ? 0.2 : 0.05,
      })
    );
    base.position.y = 0.18;

    const keyboardPlate = new THREE.Mesh(
      new THREE.BoxGeometry(1.02, 0.035, 0.58),
      new THREE.MeshStandardMaterial({
        color: isPlayer ? "#9ca7ac" : "#7f8a93",
        roughness: 0.86,
        metalness: 0.08,
      })
    );
    keyboardPlate.position.set(0, 0.33, 0.02);

    const lid = new THREE.Mesh(
      new THREE.BoxGeometry(0.94, 0.7, 0.12),
      new THREE.MeshStandardMaterial({
        color: lidColor,
        roughness: 0.58,
        metalness: 0.16,
      })
    );
    lid.position.set(0.02, 0.6, -0.25);
    lid.rotation.x = -0.92;
    lid.rotation.z = isPlayer ? 0.045 : 0;

    const screenBezel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.74, 0.44),
      new THREE.MeshStandardMaterial({
        color: isPlayer ? "#172227" : "#192126",
        roughness: 0.9,
        metalness: 0.04,
      })
    );
    screenBezel.position.set(0.02, 0.61, -0.182);
    screenBezel.rotation.x = -0.92;
    screenBezel.rotation.z = lid.rotation.z;

    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.34),
      new THREE.MeshBasicMaterial({ color: screenColor })
    );
    screen.position.set(0.02, 0.61, -0.172);
    screen.rotation.x = -0.92;
    screen.rotation.z = lid.rotation.z;

    const screenGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 0.4),
      new THREE.MeshBasicMaterial({
        color: isPlayer ? "#8effd3" : "#d5ffe8",
        transparent: true,
        opacity: isPlayer ? 0.14 : 0.07,
      })
    );
    screenGlow.position.set(0.02, 0.61, -0.19);
    screenGlow.rotation.x = -0.92;
    screenGlow.rotation.z = lid.rotation.z;

    const hingeLeft = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.12, 0.12),
      new THREE.MeshStandardMaterial({ color: lidColor, roughness: 0.65, metalness: 0.18 })
    );
    const hingeRight = hingeLeft.clone();
    hingeLeft.position.set(-0.28, 0.31, -0.27);
    hingeRight.position.set(0.28, 0.31, -0.27);

    const powerLed = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 12, 12),
      new THREE.MeshBasicMaterial({
        color: isPlayer ? "#8effd3" : "#ffd37d",
      })
    );
    powerLed.position.set(0.44, 0.29, 0.34);

    const badge = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2, 0.09),
      new THREE.MeshBasicMaterial({ color: shellAccent })
    );
    badge.position.set(-0.33, 0.315, 0.29);
    badge.rotation.x = -Math.PI / 2;
    badge.rotation.z = isPlayer ? -0.18 : 0;

    const chippedCorner = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.04, 0.12),
      new THREE.MeshStandardMaterial({
        color: isPlayer ? "#88949a" : "#6f7a82",
        roughness: 0.78,
        metalness: 0.1,
      })
    );
    chippedCorner.position.set(0.47, 0.315, -0.27);
    chippedCorner.rotation.z = 0.48;

    const leftEye = new THREE.Mesh(
      new THREE.PlaneGeometry(0.08, 0.08),
      new THREE.MeshBasicMaterial({ color: "#122628" })
    );
    const rightEye = leftEye.clone();
    const mouth = new THREE.Mesh(
      new THREE.PlaneGeometry(0.18, 0.03),
      new THREE.MeshBasicMaterial({ color: "#122628" })
    );
    leftEye.position.set(-0.1, 0.615, -0.165);
    rightEye.position.set(0.14, 0.615, -0.165);
    mouth.position.set(0.02, 0.535, -0.16);
    leftEye.rotation.x = rightEye.rotation.x = mouth.rotation.x = -0.92;
    leftEye.rotation.z = rightEye.rotation.z = mouth.rotation.z = lid.rotation.z;

    const antennaGlow = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.3, 24),
      new THREE.MeshBasicMaterial({
        color: isPlayer ? "#8effd3" : "#ffd37d",
        transparent: true,
        opacity: isPlayer ? 0.32 : 0.14,
        side: THREE.DoubleSide,
      })
    );
    antennaGlow.rotation.x = -Math.PI / 2;
    antennaGlow.position.set(0, 0.04, 0.02);

    group.add(
      base,
      keyboardPlate,
      lid,
      screenBezel,
      screen,
      screenGlow,
      hingeLeft,
      hingeRight,
      powerLed,
      badge,
      chippedCorner,
      leftEye,
      rightEye,
      mouth,
      antennaGlow
    );
    group.userData = {
      leftEye,
      rightEye,
      mouth,
      base,
      lid,
      screen,
      screenGlow,
      antennaGlow,
      powerLed,
      badge,
      chippedCorner,
    };
    return {
      group,
      leftEye,
      rightEye,
      mouth,
      base,
      lid,
      screen,
      screenGlow,
      antennaGlow,
      powerLed,
      badge,
      chippedCorner,
    };
  }

  createNpc(npc) {
    if (npc.portrait === "modem") {
      const group = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.24, 0.58),
        new THREE.MeshStandardMaterial({ color: "#6c7f8b", roughness: 0.65, metalness: 0.22 })
      );
      body.position.y = 0.14;
      group.add(body);

      for (let i = 0; i < 3; i += 1) {
        const light = new THREE.Mesh(
          new THREE.SphereGeometry(0.05, 8, 8),
          new THREE.MeshBasicMaterial({ color: i === 0 ? "#ffd37d" : "#8effd3" })
        );
        light.position.set(-0.18 + i * 0.18, 0.31, 0.2);
        group.add(light);
      }

      group.position.set(this.toWorldX(npc.x + npc.w / 2), 0.2, this.toWorldZ(npc.y + npc.h / 2));
      return { group };
    }

    if (npc.portrait === "printer") {
      const group = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.7, 0.9),
        new THREE.MeshStandardMaterial({ color: "#d4d7db", roughness: 0.9, metalness: 0.08 })
      );
      body.position.y = 0.35;
      const tray = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.08, 0.54),
        new THREE.MeshStandardMaterial({ color: "#f2ede3", roughness: 1 })
      );
      tray.position.set(0, 0.78, -0.1);
      group.add(body, tray);
      group.position.set(this.toWorldX(npc.x + npc.w / 2), 0, this.toWorldZ(npc.y + npc.h / 2));
      return { group };
    }

    if (npc.portrait === "phone") {
      const group = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.9, 0.22),
        new THREE.MeshStandardMaterial({ color: "#58607a", roughness: 0.7 })
      );
      body.position.y = 0.45;
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(0.18, 0.18),
        new THREE.MeshBasicMaterial({ color: "#cfffe5" })
      );
      screen.position.set(0, 0.65, 0.12);
      group.add(body, screen);
      group.position.set(this.toWorldX(npc.x + npc.w / 2), 0, this.toWorldZ(npc.y + npc.h / 2));
      return { group };
    }

    if (npc.portrait === "pet") {
      const group = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(0.42, 18, 14),
        new THREE.MeshStandardMaterial({ color: "#9870ad", roughness: 0.85 })
      );
      body.position.y = 0.42;
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(0.32, 0.24),
        new THREE.MeshBasicMaterial({ color: "#def6ff" })
      );
      screen.position.set(0, 0.46, 0.3);
      group.add(body, screen);
      group.position.set(this.toWorldX(npc.x + npc.w / 2), 0, this.toWorldZ(npc.y + npc.h / 2));
      return { group };
    }

    return this.createLaptop("npc");
  }

  updateLaptop(model, source, mood, noTilt = false) {
    const x = this.toWorldX(source.x + source.w / 2);
    const z = this.toWorldZ(source.y + source.h / 2);
    const heroic = mood === "heroic";
    const determined = mood === "determined";
    model.group.position.set(x, 0, z);
    model.group.rotation.y = noTilt ? 0 : source.facing === -1 ? Math.PI * 0.08 : -Math.PI * 0.08;
    model.group.rotation.z = noTilt ? 0 : heroic ? 0.03 : determined ? 0.015 : 0;

    if (model.screen) {
      model.screen.material.color.set(heroic ? "#e4fff6" : determined ? "#c8fff1" : "#a8ffea");
    }
    if (model.screenGlow?.material) {
      model.screenGlow.material.opacity = heroic ? 0.24 : determined ? 0.19 : 0.13;
      model.screenGlow.material.color.set(heroic ? "#b8fff0" : "#8effd3");
    }
    if (model.base?.material) {
      model.base.material.emissiveIntensity = heroic ? 0.34 : determined ? 0.28 : 0.2;
      model.base.material.color.set(heroic ? "#d3dbd5" : determined ? "#c8d1cb" : "#bcc5c8");
    }
    if (model.lid?.material) {
      model.lid.material.color.set(heroic ? "#738892" : determined ? "#657a83" : "#5d7079");
    }
    if (model.antennaGlow?.material) {
      model.antennaGlow.material.opacity = heroic ? 0.52 : determined ? 0.42 : 0.28;
      model.antennaGlow.scale.setScalar(heroic ? 1.14 : determined ? 1.08 : 1);
    }
    if (model.powerLed?.material) {
      model.powerLed.material.color.set(heroic ? "#d8fff3" : determined ? "#8effd3" : "#7de8ca");
      model.powerLed.scale.setScalar(heroic ? 1.3 : determined ? 1.15 : 1);
    }
    if (model.badge) {
      model.badge.visible = true;
    }
    if (model.chippedCorner) {
      model.chippedCorner.rotation.y = heroic ? 0.2 : 0;
    }

    if (!model.leftEye) {
      return;
    }

    const eyeScaleY = determined || heroic ? 0.45 : 1;
    model.leftEye.scale.y = eyeScaleY;
    model.rightEye.scale.y = eyeScaleY;
    model.mouth.scale.x = heroic ? 1.4 : determined ? 1.2 : 1;
    model.mouth.position.y = mood === "curious" ? 0.535 : 0.5;
  }

  positionBox(object, rect, height = 0.3) {
    object.position.set(
      this.toWorldX(rect.x + rect.w / 2),
      height,
      this.toWorldZ(rect.y + rect.h / 2)
    );
  }

  toWorldX(x) {
    return (x - this.world.width / 2) / WORLD_SCALE;
  }

  toWorldZ(y) {
    return (y - this.world.height / 2) / WORLD_SCALE;
  }

  toGameX(worldX) {
    return worldX * WORLD_SCALE + this.world.width / 2;
  }

  toGameY(worldZ) {
    return worldZ * WORLD_SCALE + this.world.height / 2;
  }
}
