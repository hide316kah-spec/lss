//--------------------------------------------------
// モード管理
//--------------------------------------------------
let mode = "day"; // "day" | "night" | "debug"

// DOM取得
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const roiBox = document.getElementById("roi");
const flash = document.getElementById("flash");
const shutter = document.getElementById("shutter");
const modeLabel = document.getElementById("modeLabel");

const debugPanel = document.getElementById("debugPanel");
const debugText = document.getElementById("debugText");

const modeSelect = document.getElementById("modeSelect");
const dayBtn = document.getElementById("dayBtn");
const nightBtn = document.getElementById("nightBtn");
const debugBtn = document.getElementById("debugBtn");

//--------------------------------------------------
// モード切替
//--------------------------------------------------
function setMode(m) {
  mode = m;

  if (mode === "day") modeLabel.textContent = "昼モード";
  if (mode === "night") modeLabel.textContent = "夜モード";
  if (mode === "debug") modeLabel.textContent = "調査モード";

  debugPanel.hidden = (mode !== "debug");
}

//--------------------------------------------------
// カメラ起動
//--------------------------------------------------
async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" } },
    audio
