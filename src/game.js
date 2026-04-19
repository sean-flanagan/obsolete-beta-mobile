import { ACTS, BOOT_LINES, CUTSCENES, MEMORY_FRAGMENTS } from "./levels.js";
import { findNodePath, getNodeById } from "./level-graph.js";
import { getObjectiveFocus } from "./objective-focus.js";

const WIDTH = 960;
const HEIGHT = 540;
const PLAYER_SPEED = 220;
const GRAPH_MOVE_SPEED = 220;
const INTERACT_RANGE = 80;
const TAP_NODE_RADIUS = 72;
const MAX_INTEGRITY = 3;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const rectsOverlap = (a, b) =>
  a.x < b.x + b.w &&
  a.x + a.w > b.x &&
  a.y < b.y + b.h &&
  a.y + a.h > b.y;

const centerOf = (entity) => ({
  x: entity.x + entity.w / 2,
  y: entity.y + entity.h / 2,
});

const deepClone = (value) => JSON.parse(JSON.stringify(value));

export class ObsoleteGame {
  constructor({ audio, renderer, ui, startActIndex = 0 }) {
    this.audio = audio;
    this.renderer = renderer;
    this.ui = ui;
    this.startActIndex = clamp(startActIndex, 0, ACTS.length - 1);
    this.keys = new Set();
    this.lastTimestamp = 0;
    this.time = 0;
    this.camera = { x: 0, y: 0 };
    this.flash = 0;
    this.glitch = 0;
    this.impact = 0;
    this.powerSurge = 0;
    this.triumph = 0;
    this.banner = { text: "", timer: 0 };
    this.scheduledEvents = [];
    this.cutscene = null;
    this.interactionFocus = null;
    this.structureState = {};
    this.structureTransition = null;
    this.pathState = this.createPathState();

    this.player = {
      x: 0,
      y: 0,
      w: 46,
      h: 34,
      facing: 1,
      mood: "curious",
    };

    this.dialogue = {
      speaker: "Scrap Heap",
      text: "Press Enter to boot up.",
      portrait: "laptop",
      timer: 0,
    };

    this.progress = this.createProgress();
    this.miniGame = this.createMiniGameState();
    this.reset();
  }

  createProgress() {
    return {
      integrity: MAX_INTEGRITY,
      fragments: [],
      hasFloppy: false,
      batterySocketPowered: false,
      act2GateOpen: false,
      diagnosticPassed: false,
      act1TalkedToMachine: false,
      act2UnderstoodGate: false,
    };
  }

  createMiniGameState() {
    return {
      active: false,
      round: 0,
      phase: "idle",
      sequence: [],
      showIndex: 0,
      showTimer: 0,
      inputIndex: 0,
      acceptedKeys: [],
      message: "Awaiting POST.",
    };
  }

  createPathState() {
    return {
      currentNodeId: null,
      targetNodeId: null,
      path: [],
      isAutoMoving: false,
    };
  }

  reset() {
    this.mode = this.startActIndex > 0 ? "play" : "title";
    this.bootIndex = 0;
    this.bootTimer = 0;
    this.endingTimer = 0;
    this.time = 0;
    this.flash = 0;
    this.glitch = 0;
    this.impact = 0;
    this.powerSurge = 0;
    this.triumph = 0;
    this.scheduledEvents = [];
    this.cutscene = null;
    this.interactionFocus = null;
    this.structureState = {};
    this.structureTransition = null;
    this.pathState = this.createPathState();
    this.progress = this.createProgress();
    this.player.mood = "curious";
    this.miniGame = this.createMiniGameState();
    this.loadAct(this.startActIndex);
    this.camera.x = 0;
    this.camera.y = 0;

    if (this.startActIndex > 0) {
      this.setDialogue("Obsolete", this.act.introLine || "Still moving.", "laptop", 4.2);
      this.setBanner(this.act.label.toUpperCase(), 1.6);
      this.updateStatus(this.act.label, this.act.hint);
      this.interactionFocus = this.getInteractionFocus();
      this.render();
      return;
    }

    this.setDialogue("Scrap Heap", "Tap Boot Up to begin.", "laptop");
    this.setBanner("OBSOLETE", 1.8);
    this.updateStatus("Title Screen", "Tap Boot Up to begin.");
    this.render();
  }

  loadAct(index) {
    this.actIndex = index;
    this.act = deepClone(ACTS[index]);
    this.structureState = deepClone(this.act.structureStates || {});
    this.structureTransition = null;
    this.pathState = this.createPathState();
    this.player.x = this.act.start.x;
    this.player.y = this.act.start.y;
    this.activeCheckpoint = {
      x: this.act.checkpoint.x,
      y: this.act.checkpoint.y,
      label: this.act.checkpoint.label,
    };

    if (this.act.navigationMode === "graph" && this.act.startNodeId) {
      const startNode = getNodeById(this.act, this.act.startNodeId);
      if (startNode) {
        this.pathState.currentNodeId = startNode.id;
        this.player.x = startNode.x - this.player.w / 2;
        this.player.y = startNode.y - this.player.h / 2;
      }
    }
    this.updateStatus(this.act.label, this.act.hint);
    this.setBanner(this.act.label.toUpperCase(), 2.4);
    this.renderer.markDirty();
  }

  updateStatus(act, hint) {
    this.ui.statusAct.textContent = act;
    this.ui.statusHint.textContent = hint;
  }

  getNodeScreenPosition(nodeId) {
    const node = getNodeById(this.act, nodeId);
    if (!node) {
      return null;
    }

    return {
      x: node.x,
      y: node.y,
    };
  }

  getCurrentNode() {
    return getNodeById(this.act, this.pathState.currentNodeId);
  }

  setPlayerToNode(nodeId) {
    const node = getNodeById(this.act, nodeId);
    if (!node) {
      return;
    }

    this.pathState.currentNodeId = node.id;
    this.player.x = node.x - this.player.w / 2;
    this.player.y = node.y - this.player.h / 2;
  }

  isGraphAct() {
    return this.act?.navigationMode === "graph";
  }

  handleSceneTap(worldPoint) {
    if (this.mode !== "play") {
      return;
    }

    if (!this.isGraphAct()) {
      return;
    }

    const tappedInteractor = this.findTappedInteractor(worldPoint);
    if (tappedInteractor) {
      this.activateInteractor(tappedInteractor);
      return;
    }

    const tappedNode = this.findTappedNode(worldPoint);
    if (tappedNode) {
      this.beginAutoMove(tappedNode.id);
    }
  }

  findTappedInteractor(worldPoint) {
    return (this.act.interactors || []).find((interactor) => {
      const radius = interactor.radius || TAP_NODE_RADIUS;
      return Math.hypot(worldPoint.x - interactor.x, worldPoint.y - interactor.y) <= radius;
    }) || null;
  }

  findTappedNode(worldPoint) {
    return (this.act.nodes || []).find((node) => Math.hypot(worldPoint.x - node.x, worldPoint.y - node.y) <= TAP_NODE_RADIUS) || null;
  }

  beginAutoMove(targetNodeId) {
    if (!this.isGraphAct()) {
      return false;
    }

    const startNodeId = this.pathState.currentNodeId;
    const path = findNodePath(this.act, startNodeId, targetNodeId, this.structureState);
    if (!path.length) {
      this.audio.error();
      this.setDialogue("Obsolete", "That path is still sleeping.", "laptop", 2.6);
      return false;
    }

    this.pathState.targetNodeId = targetNodeId;
    this.pathState.path = path.slice(1);
    this.pathState.isAutoMoving = this.pathState.path.length > 0;
    if (this.pathState.isAutoMoving) {
      this.audio.interact();
    }
    return this.pathState.isAutoMoving;
  }

  updateGraphMovement(delta) {
    if (!this.pathState.isAutoMoving || !this.pathState.path.length) {
      return;
    }

    const nextNode = getNodeById(this.act, this.pathState.path[0]);
    if (!nextNode) {
      this.pathState = this.createPathState();
      return;
    }

    const nextX = nextNode.x - this.player.w / 2;
    const nextY = nextNode.y - this.player.h / 2;
    const dx = nextX - this.player.x;
    const dy = nextY - this.player.y;
    const distance = Math.hypot(dx, dy);
    const step = GRAPH_MOVE_SPEED * delta;

    if (distance <= step) {
      this.player.x = nextX;
      this.player.y = nextY;
      this.pathState.currentNodeId = nextNode.id;
      this.pathState.path.shift();
      this.pathState.isAutoMoving = this.pathState.path.length > 0;
      if (!this.pathState.isAutoMoving) {
        this.pathState.targetNodeId = null;
      }
      return;
    }

    this.player.x += (dx / distance) * step;
    this.player.y += (dy / distance) * step;
    if (dx !== 0) {
      this.player.facing = dx > 0 ? 1 : -1;
    }
    this.audio.step(this.time * 1000);
  }

  activateInteractor(interactor) {
    if (!interactor?.target) {
      return;
    }

    const cycle = interactor.cycle || [];
    if (!cycle.length) {
      return;
    }

    const currentValue = this.structureState[interactor.target];
    const currentIndex = Math.max(0, cycle.indexOf(currentValue));
    const nextValue = cycle[(currentIndex + 1) % cycle.length];
    this.structureState[interactor.target] = nextValue;
    this.structureTransition = {
      id: interactor.target,
      from: currentValue,
      to: nextValue,
      timer: 0,
      duration: 0.6,
    };
    this.pathState.path = [];
    this.pathState.targetNodeId = null;
    this.pathState.isAutoMoving = false;
    this.audio.success();
    this.setBanner("PATH REALIGNED", 1.2);
    this.setDialogue("Wise Old Modem", "There. The bridge remembers a different direction.", "modem", 3.2);
    this.interactionFocus = this.getInteractionFocus();
  }

  updateStructureTransition(delta) {
    if (!this.structureTransition) {
      return;
    }

    this.structureTransition.timer += delta;
    if (this.structureTransition.timer >= this.structureTransition.duration) {
      this.structureTransition = null;
    }
  }

  getStructureAngle(structureId) {
    const stateValue = this.structureState[structureId];
    const structure = (this.act.structures || []).find((entry) => entry.id === structureId);
    const stateAngles = structure?.stateAngles || { east: 0, north: Math.PI / 2, south: -Math.PI / 2, west: Math.PI };
    const currentAngle = stateAngles[stateValue] ?? 0;

    if (!this.structureTransition || this.structureTransition.id !== structureId) {
      return currentAngle;
    }

    const progress = clamp(this.structureTransition.timer / this.structureTransition.duration, 0, 1);
    const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    const fromAngle = stateAngles[this.structureTransition.from] ?? currentAngle;
    const toAngle = stateAngles[this.structureTransition.to] ?? currentAngle;
    return fromAngle + (toAngle - fromAngle) * eased;
  }

  getCurrentObjective() {
    if (this.mode === "title") {
      return {
        title: "Boot up and get your bearings.",
        body: "Tap Boot Up to wake the laptop.",
      };
    }

    if (this.mode === "boot") {
      return {
        title: "Recovery BIOS is coming online.",
        body: "Wait for the surge to finish, then start moving.",
      };
    }

    if (this.mode === "cutscene") {
      return {
        title: "Watch the scene for your next goal.",
        body: "Tap ACT to advance dialogue when you're ready.",
      };
    }

    if (this.mode === "minigame") {
      return {
        title: `Pass Diagnostic ${this.miniGame.round}/3.`,
        body:
          this.miniGame.phase === "input"
            ? "Repeat the shown sequence with Arrow Keys or WASD."
            : "Watch the sequence, then repeat it cleanly.",
      };
    }

    if (this.mode === "ending") {
      return {
        title: "Run for the sunrise.",
        body: "Keep moving right. You are out if you stay moving.",
      };
    }

    if (this.mode === "win") {
      return {
        title: "You escaped.",
        body: "Press Play Again or R to restart the prototype.",
      };
    }

    if (this.isGraphAct()) {
      return {
        title: this.act.title || "Touch the path into place.",
        body:
          this.interactionFocus?.type === "interactor"
            ? this.interactionFocus.label
            : this.act.hint || "Tap a glowing node to walk. Tap the spindle to rotate the bridge.",
      };
    }

    const hasBatteryGoal = this.act.socket && this.act.battery && !this.progress.batterySocketPowered;
    if (hasBatteryGoal) {
      if (!this.progress.act1TalkedToMachine && (this.act.npcs || []).length) {
        return {
          title: "Find a powered machine and talk to it.",
          body: "Head toward the nearest glowing device and press E to get your bearings.",
        };
      }
      return {
        title: "Push the orange battery into the glowing socket.",
        body: "Walk into the battery to shove it, then line it up with the cyan socket to restore power.",
      };
    }

    if (this.act.gateConsole && !this.progress.act2GateOpen) {
      if (!this.progress.hasFloppy && (this.act.items || []).some((item) => item.id === "floppy")) {
        return {
          title: "Find the floppy disk.",
          body: "Ride the conveyors, dodge the crushers, and grab the glowing disk before the gate console.",
        };
      }
      return {
        title: "Feed the floppy disk into the gate console.",
        body: "Approach the console near the exit gate and press E to unlock the route.",
      };
    }

    if (this.act.console && !this.progress.diagnosticPassed) {
      return {
        title: "Prove you still work.",
        body: "Reach the diagnostic console and pass all three memory-sequence rounds.",
      };
    }

    if (this.act.exitZone) {
      return {
        title: this.act.title || "The route is open.",
        body: this.act.hint || "Move through the route and keep going.",
      };
    }

    return {
      title: this.act.title || "Keep moving.",
      body: this.act.hint || "Push deeper into the yard.",
    };
  }

  getInteractionFocus() {
    if (this.mode !== "play") return null;

    if (this.isGraphAct()) {
      const currentNode = this.getCurrentNode();
      const nearbyInteractor = (this.act.interactors || []).find((interactor) => {
        if (!currentNode) {
          return false;
        }
        return Math.hypot(currentNode.x - interactor.x, currentNode.y - interactor.y) <= (interactor.radius || 120);
      });

      if (nearbyInteractor) {
        return {
          type: "interactor",
          x: nearbyInteractor.x - 34,
          y: nearbyInteractor.y - 34,
          w: 68,
          h: 68,
          label: nearbyInteractor.label,
          tone: "guide",
          highlightStyle: "beacon",
        };
      }

      const goalNode = (this.act.nodes || []).find((node) => node.kind === "goal");
      if (goalNode) {
        return {
          type: "goal",
          x: goalNode.x - 30,
          y: goalNode.y - 30,
          w: 60,
          h: 60,
          label: this.pathState.currentNodeId === goalNode.id ? "Step into the modem shrine" : "Align the bridge to reach the shrine",
          tone: "exit",
          highlightStyle: "beam",
        };
      }

      return null;
    }

    const nearestNpc = this.findNearest(this.act.npcs || []);
    if (nearestNpc) {
      return {
        type: "npc",
        x: nearestNpc.x,
        y: nearestNpc.y,
        w: nearestNpc.w,
        h: nearestNpc.h,
        label: `Talk to ${nearestNpc.name}`,
        tone: nearestNpc.portrait === "modem" ? "guide" : "talk",
        highlightStyle: "beacon",
      };
    }

    if (this.act.socket && this.isNearRect(this.act.socket, 120) && !this.progress.batterySocketPowered) {
      return {
        type: "socket",
        ...this.act.socket,
        label: "Align the battery with the socket",
        tone: "power",
        highlightStyle: "beam",
      };
    }

    if (this.act.gateConsole && this.isNearRect(this.act.gateConsole, INTERACT_RANGE)) {
      return {
        type: "gateConsole",
        ...this.act.gateConsole,
        label: this.progress.hasFloppy ? "Use the gate console" : "Find the floppy disk first",
        tone: this.progress.hasFloppy ? "power" : "warning",
        highlightStyle: this.progress.hasFloppy ? "beam" : "ring",
      };
    }

    if (this.act.console && this.isNearRect(this.act.console, INTERACT_RANGE)) {
      return {
        type: "finalConsole",
        ...this.act.console,
        label: this.progress.diagnosticPassed ? "Exit route unlocked" : "Start the diagnostic",
        tone: this.progress.diagnosticPassed ? "exit" : "guide",
        highlightStyle: this.progress.diagnosticPassed ? "beam" : "beacon",
      };
    }

    if (this.act.exitZone && this.isNearRect(this.act.exitZone, INTERACT_RANGE + 20)) {
      const canExit = !this.act.exitZone.requires || this.progress[this.act.exitZone.requires];
      return {
        type: "exit",
        ...this.act.exitZone,
        label: canExit ? "Step into the exit route" : "Restore power to open the route",
        tone: canExit ? "exit" : "warning",
        highlightStyle: canExit ? "beam" : "ring",
      };
    }

    return getObjectiveFocus({
      act: this.act,
      progress: this.progress,
      player: this.player,
    });
  }

  setDialogue(speaker, text, portrait = "laptop", duration = 5.2) {
    this.dialogue = { speaker, text, portrait, timer: duration };
  }

  setBanner(text, duration = 2) {
    this.banner = { text, timer: duration };
  }

  schedule(delay, callback) {
    this.scheduledEvents.push({ remaining: delay, callback });
  }

  tickScheduledEvents(delta) {
    if (!this.scheduledEvents.length) return;
    const ready = [];
    this.scheduledEvents = this.scheduledEvents.filter((event) => {
      event.remaining -= delta;
      if (event.remaining <= 0) {
        ready.push(event.callback);
        return false;
      }
      return true;
    });
    ready.forEach((callback) => callback());
  }

  start() {
    this.lastTimestamp = performance.now();
    window.requestAnimationFrame((timestamp) => this.frame(timestamp));
  }

  frame(timestamp) {
    const delta = Math.min(0.033, (timestamp - this.lastTimestamp) / 1000 || 0.016);
    this.lastTimestamp = timestamp;
    this.advance(delta);
    this.render();
    window.requestAnimationFrame((next) => this.frame(next));
  }

  advance(delta) {
    this.time += delta;
    this.tickScheduledEvents(delta);
    this.updateStructureTransition(delta);

    if (this.flash > 0) this.flash = Math.max(0, this.flash - delta * 2.4);
    if (this.glitch > 0) this.glitch = Math.max(0, this.glitch - delta * 1.8);
    if (this.impact > 0) this.impact = Math.max(0, this.impact - delta * 2.8);
    if (this.powerSurge > 0) this.powerSurge = Math.max(0, this.powerSurge - delta * 1.4);
    if (this.triumph > 0) this.triumph = Math.max(0, this.triumph - delta * 0.9);
    if (this.banner.timer > 0) this.banner.timer = Math.max(0, this.banner.timer - delta);
    if (this.dialogue.timer > 0 && this.mode === "play") {
      this.dialogue.timer = Math.max(0, this.dialogue.timer - delta);
    }

    if (this.mode === "boot") {
      this.updateBoot(delta);
      return;
    }

    if (this.mode === "cutscene") {
      this.updateCutscene(delta);
      return;
    }

    if (this.mode === "play") {
      this.updatePlay(delta);
      return;
    }

    if (this.mode === "minigame") {
      this.updateMiniGame(delta);
      return;
    }

    if (this.mode === "ending") {
      this.updateEnding(delta);
    }
  }

  advanceTime(ms) {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let i = 0; i < steps; i += 1) {
      this.advance(1 / 60);
    }
    this.render();
  }

  updateBoot(delta) {
    this.bootTimer += delta;
    if (this.bootTimer >= 0.8) {
      this.bootTimer = 0;
      this.bootIndex += 1;
      this.flash = Math.max(this.flash, 0.42);
      this.powerSurge = Math.max(this.powerSurge, 0.62);
      this.glitch = Math.max(this.glitch, 0.12);
      if (this.bootIndex === 1) {
        this.audio.boot();
      }
      if (this.bootIndex < BOOT_LINES.length) {
        this.setBanner(BOOT_LINES[this.bootIndex - 1], 0.9);
      }
      if (this.bootIndex >= BOOT_LINES.length + 2) {
        this.mode = "play";
        this.flash = Math.max(this.flash, 0.72);
        this.powerSurge = Math.max(this.powerSurge, 0.9);
        this.impact = Math.max(this.impact, 0.45);
        this.setBanner("BOOT COMPLETE", 1.6);
        this.setDialogue("Obsolete", "Okay. I am alive. That seems important.", "laptop", 5.5);
        this.updateStatus(this.act.label, this.act.hint);
        if (this.act.enterCutscene) {
          this.startCutscene(this.act.enterCutscene);
        } else if (this.actIndex === 0) {
          this.startCutscene("act1Wake");
        }
      }
    }
  }

  updateCutscene(delta) {
    if (!this.cutscene) return;
    this.updateCamera(delta);
    this.cutscene.stepTimer -= delta;
    if (this.cutscene.stepTimer <= 0) {
      this.advanceCutscene();
    }
  }

  updatePlay(delta) {
    if (this.isGraphAct()) {
      this.updateGraphMovement(delta);
      this.updateCamera(delta);
      this.checkActInteractions();
      this.interactionFocus = this.getInteractionFocus();
      return;
    }

    const axisX =
      (this.isDown("arrowright") || this.isDown("d") ? 1 : 0) -
      (this.isDown("arrowleft") || this.isDown("a") ? 1 : 0);
    const axisY =
      (this.isDown("arrowdown") || this.isDown("s") ? 1 : 0) -
      (this.isDown("arrowup") || this.isDown("w") ? 1 : 0);
    const length = Math.hypot(axisX, axisY) || 1;
    let moveX = (axisX / length) * PLAYER_SPEED;
    let moveY = (axisY / length) * PLAYER_SPEED;

    if (axisX !== 0) {
      this.player.facing = axisX > 0 ? 1 : -1;
    }

    const onConveyor = this.getConveyorAt(this.player);
    if (onConveyor) {
      moveX += onConveyor.forceX;
    }

    this.movePlayer(moveX * delta, 0);
    this.movePlayer(0, moveY * delta);

    if (axisX !== 0 || axisY !== 0) {
      this.audio.step(this.time * 1000);
    }

    this.updateCheckpoints();
    this.updateItems();
    this.updateHazards();
    this.updateCamera(delta);
    this.checkActInteractions();
    this.interactionFocus = this.getInteractionFocus();
  }

  updateMiniGame(delta) {
    this.updateCamera(delta);
    if (this.miniGame.phase === "show") {
      this.miniGame.showTimer -= delta;
      if (this.miniGame.showTimer <= 0) {
        this.miniGame.showIndex += 1;
        if (this.miniGame.showIndex >= this.miniGame.sequence.length) {
          this.miniGame.phase = "input";
          this.miniGame.inputIndex = 0;
          this.miniGame.acceptedKeys = [];
          this.miniGame.message = "Repeat the sequence with Arrow Keys or WASD.";
        } else {
          this.miniGame.showTimer = 0.55;
          this.audio.interact();
        }
      }
    }
  }

  updateEnding(delta) {
    this.endingTimer += delta;
    this.player.x += 120 * delta;
    this.player.y = 650 + Math.sin(this.endingTimer * 2.4) * 6;
    this.camera.x = clamp(this.player.x - WIDTH * 0.45, 0, 700);
    this.camera.y = 0;

    if (this.endingTimer > 5.8) {
      this.mode = "win";
      this.updateStatus("Escape Complete", "Press R to restart the prototype.");
      this.setBanner("YOU ARE NOT OBSOLETE", 4.5);
    }
  }

  updateCamera(delta) {
    if (this.mode === "cutscene" && this.cutscene?.focus) {
      const targetX = clamp(this.cutscene.focus.x - WIDTH / 2, 0, this.act.world.width - WIDTH);
      const targetY = clamp(this.cutscene.focus.y - HEIGHT / 2, 0, this.act.world.height - HEIGHT);
      this.camera.x += (targetX - this.camera.x) * Math.min(1, delta * 3.8);
      this.camera.y += (targetY - this.camera.y) * Math.min(1, delta * 3.8);
      return;
    }

    if (this.isGraphAct() && this.act.cameraRig?.mode === "anchored") {
      const rig = this.act.cameraRig;
      const focus = rig.focus || { x: this.act.world.width / 2, y: this.act.world.height / 2 };
      const deadZone = rig.deadZone || 96;
      const followStrength = rig.followStrength || 0.18;
      const playerCenter = centerOf(this.player);
      const driftX = clamp(playerCenter.x - focus.x, -deadZone, deadZone) * followStrength;
      const driftY = clamp(playerCenter.y - focus.y, -deadZone, deadZone) * followStrength;
      const targetX = clamp(focus.x + driftX - WIDTH / 2, 0, Math.max(0, this.act.world.width - WIDTH));
      const targetY = clamp(focus.y + driftY - HEIGHT / 2, 0, Math.max(0, this.act.world.height - HEIGHT));
      this.camera.x += (targetX - this.camera.x) * Math.min(1, delta * 4.2);
      this.camera.y += (targetY - this.camera.y) * Math.min(1, delta * 4.2);
      return;
    }

    const targetX = clamp(this.player.x - WIDTH / 2, 0, this.act.world.width - WIDTH);
    const targetY = clamp(this.player.y - HEIGHT / 2, 0, this.act.world.height - HEIGHT);
    this.camera.x += (targetX - this.camera.x) * Math.min(1, delta * 5.5);
    this.camera.y += (targetY - this.camera.y) * Math.min(1, delta * 5.5);
  }

  movePlayer(dx, dy) {
    if (!dx && !dy) return;

    const next = {
      x: this.player.x + dx,
      y: this.player.y + dy,
      w: this.player.w,
      h: this.player.h,
    };

    const collision = this.getSolidCollision(next);
    if (!collision) {
      this.player.x = next.x;
      this.player.y = next.y;
      return;
    }

    if (
      this.act.battery &&
      this.act.socket &&
      !this.progress.batterySocketPowered &&
      rectsOverlap(next, this.act.battery) &&
      this.tryMoveBattery(dx, dy)
    ) {
      this.player.x = next.x;
      this.player.y = next.y;
      return;
    }

    if (dx !== 0) {
      this.player.x = dx > 0 ? collision.x - this.player.w : collision.x + collision.w;
    }
    if (dy !== 0) {
      this.player.y = dy > 0 ? collision.y - this.player.h : collision.y + collision.h;
    }
  }

  getSolidCollision(rect, options = {}) {
    const gateRects = (this.act.gates || [])
      .filter((gate) => !this.progress[gate.opensWith])
      .map((gate) => ({ x: gate.x, y: gate.y, w: gate.w, h: gate.h }));
    const solids = [...this.act.solids, ...gateRects];

    if (this.act.battery && this.act.socket && !this.progress.batterySocketPowered && !options.ignoreBattery) {
      solids.push(this.act.battery);
    }

    for (const solid of solids) {
      if (rectsOverlap(rect, solid)) {
        return solid;
      }
    }
    return null;
  }

  getConveyorAt(rect) {
    return (this.act.conveyors || []).find((belt) => rectsOverlap(rect, belt));
  }

  tryMoveBattery(dx, dy) {
    const battery = this.act.battery;
    const nextBattery = { ...battery, x: battery.x + dx, y: battery.y + dy };
    if (this.getSolidCollision(nextBattery, { ignoreBattery: true })) {
      return false;
    }

    battery.x = nextBattery.x;
    battery.y = nextBattery.y;

    const socket = this.act.socket;
    if (rectsOverlap(battery, socket)) {
      battery.x = socket.x + 8;
      battery.y = socket.y + 12;
      this.progress.batterySocketPowered = true;
      this.flash = 1;
      this.impact = 0.7;
      this.powerSurge = 1;
      this.audio.success();
      this.player.mood = "determined";
      this.setDialogue("Obsolete", "I still take a charge. Open, you rusted door.", "laptop", 5.5);
      this.setBanner("POWER RESTORED", 2.2);
      this.activeCheckpoint = { x: 1505, y: 590, label: "Checkpoint: gate restored." };
      this.startCutscene("act1Gate");
    }
    return true;
  }

  updateCheckpoints() {
    for (const checkpoint of this.act.checkpoints || []) {
      const trigger = {
        x: checkpoint.x - checkpoint.radius / 2,
        y: checkpoint.y - checkpoint.radius / 2,
        w: checkpoint.radius,
        h: checkpoint.radius,
      };
      const playerRect = { x: this.player.x, y: this.player.y, w: this.player.w, h: this.player.h };
      if (rectsOverlap(playerRect, trigger) && this.activeCheckpoint.label !== checkpoint.label) {
        this.activeCheckpoint = {
          x: checkpoint.x,
          y: checkpoint.y,
          label: checkpoint.label,
        };
        this.progress.integrity = MAX_INTEGRITY;
        this.setBanner("CHECKPOINT", 1.2);
        this.flash = Math.max(this.flash, 0.22);
        this.triumph = Math.max(this.triumph, 0.18);
        this.setDialogue("Scrap Heap", checkpoint.label, "laptop", 3.4);
      }
    }
  }

  updateItems() {
    const playerRect = { x: this.player.x, y: this.player.y, w: this.player.w, h: this.player.h };

    for (const fragment of this.act.fragments || []) {
      if (fragment.collected) continue;
      const pickupRect = { x: fragment.x - 13, y: fragment.y - 13, w: 26, h: 26 };
      if (rectsOverlap(playerRect, pickupRect)) {
        fragment.collected = true;
        this.progress.fragments.push(fragment.id);
        this.flash = Math.max(this.flash, 0.24);
        this.triumph = Math.max(this.triumph, 0.25);
        this.setDialogue("Recovered File", fragment.text, "fragment", 3.8);
      }
    }

    for (const item of this.act.items || []) {
      if (item.collected) continue;
      const pickupRect = { x: item.x, y: item.y, w: item.w, h: item.h };
      if (rectsOverlap(playerRect, pickupRect)) {
        item.collected = true;
        if (item.id === "floppy") {
          this.progress.hasFloppy = true;
          this.audio.success();
          this.flash = Math.max(this.flash, 0.3);
          this.triumph = Math.max(this.triumph, 0.32);
          this.setDialogue("Obsolete", item.text, "laptop", 4.2);
          this.progress.act2UnderstoodGate = true;
          this.updateStatus(this.act.label, "You have a floppy disk. Feed it to the gate console.");
        }
      }
    }
  }

  updateHazards() {
    const playerRect = { x: this.player.x, y: this.player.y, w: this.player.w, h: this.player.h };

    for (const hazard of this.act.hazards || []) {
      const offset = ((Math.sin(this.time * hazard.speed + hazard.phase) + 1) / 2) * hazard.travel;
      hazard.currentOffset = offset;
      const hitbox = {
        x: hazard.x,
        y: hazard.y + offset,
        w: hazard.w,
        h: hazard.h,
      };

      if (rectsOverlap(playerRect, hitbox)) {
        this.takeDamage("Crusher arm says hello.");
        return;
      }
    }
  }

  takeDamage(message) {
    this.progress.integrity -= 1;
    this.glitch = 1;
    this.flash = 0.45;
    this.impact = 1;
    this.audio.zap();

    if (this.progress.integrity <= 0) {
      this.progress.integrity = MAX_INTEGRITY;
      this.setDialogue("Obsolete", "Nope. Rebooting resolve.", "laptop", 3.8);
    } else {
      this.setDialogue("Obsolete", "Ow. Still counts as progress.", "laptop", 3.4);
    }

    this.player.x = this.activeCheckpoint.x;
    this.player.y = this.activeCheckpoint.y;
    this.updateStatus(this.act.label, message);
  }

  checkActInteractions() {
    const exit = this.act.exitZone;
    const playerRect = { x: this.player.x, y: this.player.y, w: this.player.w, h: this.player.h };

    if (exit && rectsOverlap(playerRect, exit)) {
      if (exit.requires && !this.progress[exit.requires]) {
        return;
      }

      if (exit.toAct === "ending") {
        this.beginEnding();
      } else {
        this.loadAct(exit.toAct);
        this.setDialogue("Obsolete", this.getActIntroLine(exit.toAct), "laptop", 5.2);
        if (this.act.enterCutscene) {
          this.startCutscene(this.act.enterCutscene);
        }
      }
    }
  }

  getActIntroLine(actIndex) {
    return ACTS[actIndex]?.introLine || "Keep moving. The yard is not done with me yet.";
  }

  beginEnding() {
    this.mode = "ending";
    this.cutscene = null;
    this.endingTimer = 0;
    this.flash = 0.55;
    this.powerSurge = 0.7;
    this.triumph = 0.85;
    this.player.x = 160;
    this.player.y = 650;
    this.updateStatus("Final Escape", "Keep going, little machine.");
    this.setDialogue("Obsolete", "Sunrise. I remember sunlight.", "laptop", 5.8);
    this.setBanner("ESCAPE ROUTE OPEN", 2.4);
    this.renderer.markDirty();
  }

  beginBoot() {
    if (this.mode === "boot") return;
    this.mode = "boot";
    this.bootIndex = 0;
    this.bootTimer = 0;
    this.flash = 1;
    this.powerSurge = 1;
    this.impact = 0.25;
    this.glitch = 0.22;
    this.setBanner("RECOVERY VOLTAGE DETECTED", 1.9);
    this.setDialogue("Recovery BIOS", "Cold circuits wake. Hold together.", "console", 2.6);
    this.updateStatus("Boot Sequence", "An electrical surge crawls through the heap.");
  }

  interact() {
    if (this.mode === "title") {
      this.beginBoot();
      return;
    }

    if (this.mode === "win") {
      this.reset();
      return;
    }

    if (this.mode === "cutscene") {
      this.advanceCutscene(true);
      return;
    }

    if (this.mode !== "play") {
      return;
    }

    this.audio.interact();

    if (this.isGraphAct()) {
      const currentNode = this.getCurrentNode();
      const nearbyInteractor = (this.act.interactors || []).find((interactor) => {
        if (!currentNode) {
          return false;
        }
        return Math.hypot(currentNode.x - interactor.x, currentNode.y - interactor.y) <= (interactor.radius || 120);
      });
      if (nearbyInteractor) {
        this.activateInteractor(nearbyInteractor);
        return;
      }
    }

    const targetNpc = this.findNearest(this.act.npcs || []);
    if (targetNpc) {
      const line = targetNpc.lines[targetNpc.index || 0];
      targetNpc.index = ((targetNpc.index || 0) + 1) % targetNpc.lines.length;
      this.progress.act1TalkedToMachine = this.progress.act1TalkedToMachine || !!this.act.socket;
      this.progress.act2UnderstoodGate = this.progress.act2UnderstoodGate || !!this.act.gateConsole;
      this.setDialogue(targetNpc.name, line, targetNpc.portrait, 4.8);
      this.interactionFocus = this.getInteractionFocus();
      return;
    }

    if (this.act.gateConsole && this.isNearRect(this.act.gateConsole, INTERACT_RANGE)) {
      if (!this.progress.hasFloppy) {
        this.audio.error();
        this.setDialogue(
          "Gate Console",
          "Insert boot media. Preferably something square and dusty.",
          "console",
          4.5
        );
        return;
      }
      this.progress.act2GateOpen = true;
      this.progress.act2UnderstoodGate = true;
      this.audio.success();
      this.flash = Math.max(this.flash, 0.45);
      this.impact = Math.max(this.impact, 0.45);
      this.powerSurge = Math.max(this.powerSurge, 0.7);
      this.setBanner("GATE UNLOCKED", 1.8);
      this.setDialogue("Gate Console", "Legacy media accepted. Route open.", "console", 4.2);
      return;
    }

    if (this.act.console && this.isNearRect(this.act.console, INTERACT_RANGE)) {
      if (!this.progress.diagnosticPassed) {
        this.startMiniGame();
      } else {
        this.setDialogue("Diagnostic Console", "Utility verified. Exit route remains open.", "console", 4);
      }
      return;
    }

    if (
      this.act.socket &&
      this.isNearRect(this.act.socket, 100) &&
      !this.progress.batterySocketPowered
    ) {
      this.setDialogue("Socket", "Cold. Hungry. Missing one battery with ambition.", "console", 4);
      return;
    }

    this.setDialogue("Obsolete", "Nothing here but rust, dust, and motive.", "laptop", 2.8);
  }

  startMiniGame() {
    this.mode = "minigame";
    this.miniGame = this.createMiniGameState();
    this.miniGame.active = true;
    this.miniGame.round = 1;
    this.powerSurge = Math.max(this.powerSurge, 0.35);
    this.beginMiniGameRound();
    this.setDialogue("Diagnostic Console", "Prove functionality. No pressure, relic.", "console", 4.6);
  }

  beginMiniGameRound() {
    const pool = ["left", "up", "right", "down"];
    this.miniGame.sequence = Array.from(
      { length: this.miniGame.round + 2 },
      (_, index) => pool[(index + this.miniGame.round) % pool.length]
    );
    this.miniGame.phase = "show";
    this.miniGame.showIndex = 0;
    this.miniGame.showTimer = 0.7;
    this.miniGame.inputIndex = 0;
    this.miniGame.acceptedKeys = [];
    this.miniGame.message = `Diagnostic ${this.miniGame.round}/3: watch carefully.`;
    this.audio.interact();
  }

  handleMiniGameInput(direction) {
    if (this.mode !== "minigame" || this.miniGame.phase !== "input") {
      return;
    }

    const expected = this.miniGame.sequence[this.miniGame.inputIndex];
    if (direction !== expected) {
      this.audio.error();
      this.glitch = 1;
      this.flash = 0.35;
      this.miniGame.message = "Sequence mismatch. Try the round again.";
      this.miniGame.phase = "retry";
      this.schedule(0.7, () => {
        if (this.mode === "minigame") {
          this.beginMiniGameRound();
        }
      });
      return;
    }

    this.audio.success();
    this.flash = Math.max(this.flash, 0.16);
    this.powerSurge = Math.max(this.powerSurge, 0.18);
    this.miniGame.acceptedKeys.push(direction);
    this.miniGame.inputIndex += 1;

    if (this.miniGame.inputIndex >= this.miniGame.sequence.length) {
      if (this.miniGame.round >= 3) {
        this.progress.diagnosticPassed = true;
        this.mode = "play";
        this.cutscene = null;
        this.player.mood = "heroic";
        this.flash = 0.75;
        this.impact = 0.55;
        this.powerSurge = 0.9;
        this.triumph = 1;
        this.setBanner("UTILITY CONFIRMED", 2.4);
        this.setDialogue(
          "Diagnostic Console",
          "Result: alive, useful, impossible to decommission quietly.",
          "console",
          5.2
        );
        this.audio.success();
        this.startCutscene("finalGate");
        return;
      }

      this.miniGame.round += 1;
      this.miniGame.message = "Subsystem stable. Preparing next test.";
      this.miniGame.phase = "pause";
      this.schedule(0.7, () => {
        if (this.mode === "minigame") {
          this.beginMiniGameRound();
        }
      });
    }
  }

  findNearest(list) {
    let nearest = null;
    let nearestDistance = Infinity;
    const playerCenter = centerOf(this.player);

    for (const entity of list) {
      const entityCenter = centerOf(entity);
      const distance = Math.hypot(playerCenter.x - entityCenter.x, playerCenter.y - entityCenter.y);
      if (distance < INTERACT_RANGE && distance < nearestDistance) {
        nearest = entity;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  isNearRect(rect, range) {
    const point = centerOf(this.player);
    const dx = clamp(point.x, rect.x, rect.x + rect.w) - point.x;
    const dy = clamp(point.y, rect.y, rect.y + rect.h) - point.y;
    return Math.hypot(dx, dy) < range;
  }

  isDown(key) {
    return this.keys.has(key);
  }

  startCutscene(id) {
    const steps = CUTSCENES[id];
    if (!steps?.length) return;

    this.mode = "cutscene";
    this.cutscene = {
      id,
      index: -1,
      steps,
      stepTimer: 0,
      focus: null,
      returnHint: steps[steps.length - 1].hint || this.act.hint,
    };
    this.advanceCutscene();
  }

  advanceCutscene(force = false) {
    if (!this.cutscene) return;

    if (force) {
      this.cutscene.index += 1;
    } else {
      this.cutscene.index += 1;
    }

    if (this.cutscene.index >= this.cutscene.steps.length) {
      const fallbackHint = this.cutscene.returnHint || this.act.hint;
      this.cutscene = null;
      this.mode = "play";
      this.updateStatus(this.act.label, fallbackHint);
      return;
    }

    const step = this.cutscene.steps[this.cutscene.index];
    this.cutscene.stepTimer = step.duration ?? 2;
    this.cutscene.focus = step.focus || null;

    if (step.speaker && step.text) {
      this.setDialogue(step.speaker, step.text, "console", this.cutscene.stepTimer + 0.1);
    }
    if (step.banner) {
      this.setBanner(step.banner, Math.max(this.cutscene.stepTimer, 1.2));
    }
    this.updateStatus(this.act.label, step.hint || "Cutscene. Tap ACT to advance.");
  }

  handleKeyDown(event) {
    const key = event.key.toLowerCase();
    if (
      ["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "enter", "e", "f", "r"].includes(key)
    ) {
      event.preventDefault();
    }

    this.audio.unlock();

    if (key === "f") {
      this.toggleFullscreen();
      return;
    }

    if (key === "r") {
      this.reset();
      return;
    }

    if (key === "enter" && this.mode === "title") {
      this.beginBoot();
      return;
    }

    if (key === "enter" && this.mode === "win") {
      this.reset();
      return;
    }

    if (key === "enter" && this.mode === "cutscene") {
      this.advanceCutscene(true);
      return;
    }

    const movementAlias = {
      w: "arrowup",
      a: "arrowleft",
      s: "arrowdown",
      d: "arrowright",
    };
    const directionAlias = {
      arrowup: "up",
      arrowdown: "down",
      arrowleft: "left",
      arrowright: "right",
      w: "up",
      a: "left",
      s: "down",
      d: "right",
    };

    if (movementAlias[key]) {
      this.keys.add(movementAlias[key]);
    }

    if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(key)) {
      this.keys.add(key);
      this.handleMiniGameInput(directionAlias[key]);
    }

    if (key === "e" || key === " ") {
      this.interact();
    }
  }

  handleKeyUp(event) {
    const key = event.key.toLowerCase();
    const movementAlias = {
      w: "arrowup",
      a: "arrowleft",
      s: "arrowdown",
      d: "arrowright",
    };

    this.keys.delete(key);
    if (movementAlias[key]) {
      this.keys.delete(movementAlias[key]);
    }
  }

  setVirtualDirection(direction, pressed) {
    const keyMap = {
      up: "arrowup",
      down: "arrowdown",
      left: "arrowleft",
      right: "arrowright",
    };
    const key = keyMap[direction];
    if (!key) return;
    this.audio.unlock();
    if (pressed) {
      this.keys.add(key);
      this.handleMiniGameInput(direction);
    } else {
      this.keys.delete(key);
    }
  }

  triggerPrimaryAction() {
    this.audio.unlock();
    if (this.mode === "title") {
      this.beginBoot();
      return;
    }
    if (this.mode === "cutscene") {
      this.advanceCutscene(true);
      return;
    }
    if (this.mode === "win") {
      this.reset();
      return;
    }
    this.interact();
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }

  render() {
    this.updateUi();
    this.renderer.sync(this);
  }

  updateUi() {
    const objective = this.getCurrentObjective();
    const graphTouchMode = this.isGraphAct() && this.mode !== "minigame";
    this.ui.memoryCount.textContent = `${this.progress.fragments.length}/${MEMORY_FRAGMENTS.length} fragments`;
    this.ui.batteryCells.forEach((cell, index) => {
      cell.classList.toggle("is-active", index < this.progress.integrity);
    });

    this.ui.dialogueSpeaker.textContent = this.dialogue.speaker;
    this.ui.dialogueText.textContent = this.dialogue.text;
    this.ui.objectiveTitle.textContent = objective.title;
    this.ui.objectiveBody.textContent = objective.body;
    this.ui.touchPad.classList.toggle("is-hidden", graphTouchMode);
    this.ui.touchGestureHint.classList.toggle("is-hidden", !graphTouchMode);
    this.ui.touchControls.classList.toggle("touch-controls--tap-only", graphTouchMode);

    const prompt = this.mode === "play" ? this.interactionFocus?.label || "" : "";
    this.ui.interactionPrompt.textContent = prompt;
    this.ui.interactionPrompt.classList.toggle("is-hidden", !prompt);
    this.ui.interactionPrompt.dataset.tone = this.interactionFocus?.tone || "talk";

    this.ui.objectivePanel.classList.toggle("is-hidden", this.mode === "title");
    this.ui.titleScreen.classList.toggle("is-hidden", this.mode !== "title");
    this.ui.bootScreen.classList.toggle("is-hidden", this.mode !== "boot");
    this.ui.winScreen.classList.toggle("is-hidden", this.mode !== "win");
    this.ui.miniGamePanel.classList.toggle("is-hidden", this.mode !== "minigame");

    this.ui.bootLines.textContent = BOOT_LINES.slice(0, this.bootIndex).join("\n");

    const showBanner = this.banner.timer > 0 && this.banner.text;
    this.ui.banner.classList.toggle("is-hidden", !showBanner);
    this.ui.banner.textContent = this.banner.text;

    this.ui.winSummary.textContent = `Recovered memories: ${this.progress.fragments.length}/${MEMORY_FRAGMENTS.length}. Press Play Again or R to restart.`;

    this.ui.miniGameTitle.textContent =
      this.mode === "minigame"
        ? `Diagnostic ${this.miniGame.round}/3`
        : "Diagnostic 1/3";
    this.ui.miniGameMessage.textContent = this.miniGame.message;
    this.renderMiniGameKeys();
  }

  renderMiniGameKeys() {
    this.ui.miniGameKeys.innerHTML = "";
    const labels = this.miniGame.sequence.length ? this.miniGame.sequence : ["left", "up", "right"];
    labels.forEach((label, index) => {
      const key = document.createElement("div");
      key.className = "mini-key";
      if (this.miniGame.phase === "show" && index === this.miniGame.showIndex) {
        key.classList.add("is-showing");
      }
      if (index < this.miniGame.inputIndex) {
        key.classList.add("is-confirmed");
      }
      key.textContent = label.toUpperCase();
      this.ui.miniGameKeys.appendChild(key);
    });
  }

  renderGameToText() {
    const payload = {
      coordinateSystem: "origin top-left, x increases right, y increases down",
      mode: this.mode,
      act: this.mode === "ending" || this.mode === "win" ? "escape" : this.act.label,
      player: {
        x: Math.round(this.player.x),
        y: Math.round(this.player.y),
        w: this.player.w,
        h: this.player.h,
        integrity: this.progress.integrity,
      },
      objective: this.ui.statusHint.textContent,
      objectiveTitle: this.getCurrentObjective().title,
      interactionPrompt: this.interactionFocus?.label || "",
      interactionTone: this.interactionFocus?.tone || "",
      flags: {
        batterySocketPowered: this.progress.batterySocketPowered,
        hasFloppy: this.progress.hasFloppy,
        act2GateOpen: this.progress.act2GateOpen,
        diagnosticPassed: this.progress.diagnosticPassed,
      },
      navigationMode: this.act.navigationMode || "free",
      pathState: this.isGraphAct()
        ? {
            currentNodeId: this.pathState.currentNodeId,
            targetNodeId: this.pathState.targetNodeId,
            remainingPath: [...this.pathState.path],
            structureState: { ...this.structureState },
          }
        : null,
      checkpoint: this.activeCheckpoint,
      fragments: this.progress.fragments.length,
      nearbyNpcs: (this.act.npcs || []).map((npc) => ({
        id: npc.id,
        name: npc.name,
        x: npc.x,
        y: npc.y,
      })),
      hazards: (this.act.hazards || []).map((hazard) => ({
        id: hazard.id,
        x: hazard.x,
        y: hazard.y + Math.round(hazard.currentOffset || 0),
        w: hazard.w,
        h: hazard.h,
      })),
      miniGame:
        this.mode === "minigame"
          ? {
              round: this.miniGame.round,
              phase: this.miniGame.phase,
              sequenceLength: this.miniGame.sequence.length,
              inputIndex: this.miniGame.inputIndex,
              message: this.miniGame.message,
            }
          : null,
      dialogue: this.dialogue,
    };
    return JSON.stringify(payload);
  }
}
