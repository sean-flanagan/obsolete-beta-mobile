import { AudioSystem } from "./audio.js";
import { ObsoleteGame } from "./game.js";
import { getViewportProfile } from "./mobile-viewport.js";
import { ObsoleteRenderer } from "./renderer.js";

const sceneMount = document.getElementById("sceneMount");
const ui = {
  appShell: document.getElementById("appShell"),
  masthead: document.getElementById("masthead"),
  infoGrid: document.getElementById("infoGrid"),
  touchControls: document.getElementById("touchControls"),
  touchPad: document.getElementById("touchPad"),
  touchGestureHint: document.getElementById("touchGestureHint"),
  touchAct: document.getElementById("touchAct"),
  touchRestart: document.getElementById("touchRestart"),
  touchDirectionButtons: [...document.querySelectorAll("[data-touch-direction]")],
  statusAct: document.getElementById("statusAct"),
  statusHint: document.getElementById("statusHint"),
  memoryCount: document.getElementById("memoryCount"),
  batteryCells: [...document.querySelectorAll(".battery-meter__cell")],
  dialogueSpeaker: document.getElementById("dialogueSpeaker"),
  dialogueText: document.getElementById("dialogueText"),
  titleScreen: document.getElementById("titleScreen"),
  bootScreen: document.getElementById("bootScreen"),
  bootLines: document.getElementById("bootLines"),
  banner: document.getElementById("banner"),
  objectivePanel: document.getElementById("objectivePanel"),
  objectiveTitle: document.getElementById("objectiveTitle"),
  objectiveBody: document.getElementById("objectiveBody"),
  interactionPrompt: document.getElementById("interactionPrompt"),
  miniGamePanel: document.getElementById("miniGamePanel"),
  miniGameTitle: document.getElementById("miniGameTitle"),
  miniGameMessage: document.getElementById("miniGameMessage"),
  miniGameKeys: document.getElementById("miniGameKeys"),
  winScreen: document.getElementById("winScreen"),
  winSummary: document.getElementById("winSummary"),
  startButton: document.getElementById("startButton"),
  restartButton: document.getElementById("restartButton"),
};

const audio = new AudioSystem();
const renderer = new ObsoleteRenderer({ mount: sceneMount });

const urlParams = new URLSearchParams(window.location.search);
const forceMobile = urlParams.get("mobile") === "1";
const requestedAct = Number.parseInt(urlParams.get("act") || "", 10);
const startActIndex = Number.isInteger(requestedAct) && requestedAct >= 1 ? requestedAct - 1 : 0;

const game = new ObsoleteGame({ audio, renderer, ui, startActIndex });

function applyViewportProfile() {
  const profile = getViewportProfile({
    width: window.innerWidth,
    height: window.innerHeight,
    forceMobile,
  });

  document.body.dataset.viewport = profile.mode;
  document.body.dataset.orientation = profile.isPortrait ? "portrait" : "landscape";
  document.documentElement.style.setProperty("--scene-aspect-ratio", profile.sceneAspectRatio);
  ui.infoGrid.classList.toggle("is-hidden", !profile.showSecondaryInfo);
  ui.touchControls.classList.toggle("is-hidden", !profile.showTouchControls);
  ui.masthead.classList.toggle("is-hidden", !profile.showMasthead);
  ui.masthead.classList.toggle("masthead--compact", profile.compactTitle);
}

function bindDirectionButton(button) {
  const direction = button.dataset.touchDirection;
  const press = (event) => {
    event.preventDefault();
    game.setVirtualDirection(direction, true);
    button.classList.add("is-active");
  };
  const release = (event) => {
    event?.preventDefault?.();
    game.setVirtualDirection(direction, false);
    button.classList.remove("is-active");
  };

  button.addEventListener("pointerdown", press);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("pointerleave", release);
}

sceneMount.addEventListener("pointerdown", (event) => {
  const worldPoint = renderer.getWorldPointFromClient(event.clientX, event.clientY);
  if (worldPoint) {
    game.handleSceneTap(worldPoint);
  }
});

window.addEventListener("keydown", (event) => game.handleKeyDown(event));
window.addEventListener("keyup", (event) => game.handleKeyUp(event));
window.addEventListener("resize", () => {
  applyViewportProfile();
  renderer.handleResize();
});

ui.startButton.addEventListener("click", () => game.beginBoot());
ui.restartButton.addEventListener("click", () => game.reset());
ui.touchAct.addEventListener("click", () => game.triggerPrimaryAction());
ui.touchRestart.addEventListener("click", () => game.reset());
ui.touchDirectionButtons.forEach(bindDirectionButton);

window.render_game_to_text = () => game.renderGameToText();
window.advanceTime = (ms) => game.advanceTime(ms);
window.tapSceneWorld = (x, y) => game.handleSceneTap({ x, y });

applyViewportProfile();
game.start();
