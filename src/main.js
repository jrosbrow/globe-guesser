import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { feature, mesh } from "https://cdn.jsdelivr.net/npm/topojson-client@3/+esm";

const svg = d3.select("#globe");
const stage = document.querySelector(".stage");
const promptCityEl = document.getElementById("prompt-city");
const promptHintEl = document.getElementById("prompt-hint");
const resultEl = document.getElementById("result");
const resultScoreEl = document.getElementById("result-score");
const resultDistanceEl = document.getElementById("result-distance");
const resultTargetEl = document.getElementById("result-target");
const newRoundBtn = document.getElementById("new-round");
const nextRoundBtn = document.getElementById("next-round");
const difficultyEl = document.getElementById("difficulty");

const projection = d3.geoOrthographic().clipAngle(90).precision(0.5);
const path = d3.geoPath(projection);

const layers = {
  sphere: svg.append("path").attr("class", "sphere"),
  graticule: svg.append("path").attr("class", "graticule"),
  land: svg.append("path").attr("class", "land"),
  overlay: svg.append("g").attr("class", "overlay"),
};

const graticule = d3.geoGraticule10();

let world = null;
let cities = [];
let target = null;
let guess = null;
let locked = false;
let width = 0;
let height = 0;

function size() {
  const rect = stage.getBoundingClientRect();
  width = rect.width;
  height = rect.height;
  const radius = Math.min(width, height) * 0.45;
  projection
    .translate([width / 2, height / 2])
    .scale(radius);
  svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
  redraw();
}

function redraw() {
  if (!world) return;
  layers.sphere.attr("d", path({ type: "Sphere" }));
  layers.graticule.attr("d", path(graticule));
  layers.land.attr("d", path(world.land));
  drawOverlay();
}

function drawOverlay() {
  const g = layers.overlay;
  g.selectAll("*").remove();
  if (!locked) return;

  const targetVisible = isVisible(target.lon, target.lat);
  const guessVisible = isVisible(guess.lon, guess.lat);

  if (targetVisible && guessVisible) {
    const arc = {
      type: "LineString",
      coordinates: [
        [guess.lon, guess.lat],
        [target.lon, target.lat],
      ],
    };
    g.append("path").attr("class", "guess-line").attr("d", path(arc));
  }

  if (guessVisible) {
    const [gx, gy] = projection([guess.lon, guess.lat]);
    g.append("circle")
      .attr("class", "pin guess")
      .attr("cx", gx)
      .attr("cy", gy)
      .attr("r", 7);
  }

  if (targetVisible) {
    const [tx, ty] = projection([target.lon, target.lat]);
    g.append("circle")
      .attr("class", "pin target")
      .attr("cx", tx)
      .attr("cy", ty)
      .attr("r", 8);
    const labelOnLeft = tx > width * 0.7;
    g.append("text")
      .attr("class", "pin-label")
      .attr("x", labelOnLeft ? tx - 10 : tx + 10)
      .attr("y", ty + 4)
      .attr("text-anchor", labelOnLeft ? "end" : "start")
      .text(target.name);
  }
}

function isVisible(lon, lat) {
  const r = projection.rotate();
  const center = [-r[0], -r[1]];
  const distance = d3.geoDistance([lon, lat], center);
  return distance < Math.PI / 2;
}

function pickCity() {
  const tier = difficultyEl.value;
  const pool =
    tier === "easy"
      ? cities.filter((c) => c.tier === "easy")
      : tier === "medium"
        ? cities.filter((c) => c.tier === "easy" || c.tier === "medium")
        : cities;
  return pool[Math.floor(Math.random() * pool.length)];
}

function newRound() {
  target = pickCity();
  guess = null;
  locked = false;
  promptCityEl.textContent = `${target.name}, ${target.country}`;
  promptHintEl.textContent = "click on the globe";
  resultEl.hidden = true;
  svg.classed("guessing", true);
  drawOverlay();
}

// Score: 100 at 0 km, decays exponentially. ~75 at 250km, ~50 at 700km, ~25 at 1700km, ~5 at 4000km, ~1 at 6000km.
function scoreFor(distanceKm) {
  const s = 100 * Math.exp(-distanceKm / 1500);
  return Math.max(1, Math.round(s));
}

function distanceKm(a, b) {
  // d3.geoDistance returns radians; multiply by Earth's radius in km.
  return d3.geoDistance([a.lon, a.lat], [b.lon, b.lat]) * 6371;
}

function handleGuess(lonlat) {
  if (locked || !target) return;
  guess = { lon: lonlat[0], lat: lonlat[1] };
  locked = true;
  svg.classed("guessing", false);
  const km = distanceKm(guess, target);
  const score = scoreFor(km);
  resultScoreEl.textContent = score;
  resultDistanceEl.textContent = `${formatKm(km)} km`;
  resultTargetEl.textContent = `${target.name}, ${target.country}`;
  resultEl.hidden = false;
  resultScoreEl.style.color = scoreColor(score);
  rotateToFitBoth();
}

// After a guess, rotate to a midpoint between guess and target so both pins are visible.
function rotateToFitBoth() {
  const mid = midpoint(guess, target);
  const start = projection.rotate();
  const end = [-mid.lon, -mid.lat, 0];
  const interp = d3.interpolate(start, end);
  const duration = 700;
  const t0 = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - t0) / duration);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    projection.rotate(interp(eased));
    redraw();
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function midpoint(a, b) {
  const toRad = Math.PI / 180;
  const φ1 = a.lat * toRad,
    φ2 = b.lat * toRad;
  const λ1 = a.lon * toRad,
    λ2 = b.lon * toRad;
  const Bx = Math.cos(φ2) * Math.cos(λ2 - λ1);
  const By = Math.cos(φ2) * Math.sin(λ2 - λ1);
  const φ3 = Math.atan2(
    Math.sin(φ1) + Math.sin(φ2),
    Math.sqrt((Math.cos(φ1) + Bx) ** 2 + By ** 2),
  );
  const λ3 = λ1 + Math.atan2(By, Math.cos(φ1) + Bx);
  return { lat: φ3 / toRad, lon: ((λ3 / toRad + 540) % 360) - 180 };
}

function scoreColor(score) {
  if (score >= 75) return "var(--accent)";
  if (score >= 40) return "var(--warn)";
  return "var(--bad)";
}

function formatKm(km) {
  if (km < 10) return km.toFixed(1);
  return Math.round(km).toLocaleString();
}

// --- Interactions: 1-finger drag (rotate), 2-finger pinch (zoom + pan), tap (guess), wheel (desktop zoom) ---

const svgEl = svg.node();
const activePointers = new Map();
let gestureStart = null;
let tapStart = null;
let movedSinceDown = false;

function clampScale(s) {
  const min = Math.min(width, height) * 0.25;
  const max = Math.min(width, height) * 2.5;
  return Math.max(min, Math.min(max, s));
}

function snapshotGesture() {
  const pts = [...activePointers.values()];
  gestureStart = {
    rotate: projection.rotate(),
    scale: projection.scale(),
  };
  if (pts.length === 1) {
    gestureStart.x = pts[0].x;
    gestureStart.y = pts[0].y;
  } else if (pts.length >= 2) {
    const [a, b] = pts;
    gestureStart.midX = (a.x + b.x) / 2;
    gestureStart.midY = (a.y + b.y) / 2;
    gestureStart.distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }
}

svgEl.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  try {
    svgEl.setPointerCapture(event.pointerId);
  } catch {
    // Some pointer types (or synthesized events) reject capture; safe to ignore.
  }
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (activePointers.size === 1) {
    tapStart = { x: event.clientX, y: event.clientY, time: performance.now() };
    movedSinceDown = false;
    svg.classed("dragging", true);
  }
  snapshotGesture();
});

svgEl.addEventListener("pointermove", (event) => {
  if (!activePointers.has(event.pointerId)) return;
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (!gestureStart) return;
  const pts = [...activePointers.values()];

  if (pts.length === 1) {
    const dx = pts[0].x - gestureStart.x;
    const dy = pts[0].y - gestureStart.y;
    if (Math.hypot(dx, dy) > 4) movedSinceDown = true;
    const k = 180 / gestureStart.scale;
    const [r0, r1, r2] = gestureStart.rotate;
    projection.rotate([r0 + dx * k, Math.max(-90, Math.min(90, r1 - dy * k)), r2]);
    redraw();
  } else if (pts.length >= 2) {
    movedSinceDown = true;
    const [a, b] = pts;
    const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const newScale = clampScale(gestureStart.scale * (distance / gestureStart.distance));
    projection.scale(newScale);
    const k = 180 / newScale;
    const dx = midX - gestureStart.midX;
    const dy = midY - gestureStart.midY;
    const [r0, r1, r2] = gestureStart.rotate;
    projection.rotate([r0 + dx * k, Math.max(-90, Math.min(90, r1 - dy * k)), r2]);
    redraw();
  }
});

function onPointerEnd(event) {
  if (!activePointers.has(event.pointerId)) return;
  activePointers.delete(event.pointerId);
  if (activePointers.size === 0) {
    svg.classed("dragging", false);
    if (tapStart && !movedSinceDown && performance.now() - tapStart.time < 500) {
      const rect = svgEl.getBoundingClientRect();
      const lonlat = projection.invert([event.clientX - rect.left, event.clientY - rect.top]);
      if (lonlat && isVisible(lonlat[0], lonlat[1])) handleGuess(lonlat);
    }
    tapStart = null;
    gestureStart = null;
  } else {
    snapshotGesture();
  }
}
svgEl.addEventListener("pointerup", onPointerEnd);
svgEl.addEventListener("pointercancel", onPointerEnd);

svgEl.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.001);
    projection.scale(clampScale(projection.scale() * factor));
    redraw();
  },
  { passive: false },
);

// --- Buttons ---

newRoundBtn.addEventListener("click", newRound);
nextRoundBtn.addEventListener("click", newRound);
difficultyEl.addEventListener("change", newRound);

window.addEventListener("resize", size);

// Tweak the hint text based on input modality.
const hintEl = document.getElementById("hint");
if (hintEl) {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  hintEl.textContent = coarse
    ? "Drag to rotate · pinch to zoom · tap to guess"
    : "Drag to rotate · scroll to zoom · click to guess";
}

// --- Boot ---

async function boot() {
  const [topo, cityList] = await Promise.all([
    fetch("./data/countries-110m.json").then((r) => r.json()),
    fetch("./data/cities.json").then((r) => r.json()),
  ]);
  world = {
    land: feature(topo, topo.objects.land),
    countries: mesh(topo, topo.objects.countries, (a, b) => a !== b),
  };
  cities = cityList;
  // Initial rotation: roughly center on Europe/Africa for an interesting view.
  projection.rotate([-10, -20, 0]);
  size();
  newRound();
}

boot().catch((err) => {
  console.error(err);
  promptCityEl.textContent = "Failed to load";
  promptHintEl.textContent = String(err.message || err);
});
