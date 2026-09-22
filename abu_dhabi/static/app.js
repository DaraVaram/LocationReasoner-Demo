/* ============================================================
   Site Selection Demo - frontend logic
   ============================================================ */

const API = `${window.location.origin}/api`;

// Map + layers
let map, allZonesLayer, filterLayer, tileLayer = null;
let compLayers = { tp: null, fp: null, fn: null };
let gradientLayer = null;
let matchLayer = null;
let contextLayer = null;
let selectedLayer = null;
let zonesGeoJSON = null;

// State
let isRunning = false;
let currentRankMode = "formula";
let lastGtRanked = [];
let lastLlmOrderedIds = [];
let lastSpearman = null;
let lastExplanations = {};
let lastPerfectCount = 0;
let currentView = "consumer";     // "consumer" | "ml"
let lastEvalData = null;
let selectedZoneId = null;
let zoneCoords = {};              // zone_id -> {lat, lng}
let zoneInfoCache = {};           // zone_id -> /api/zone_info payload

const OBS_PREVIEW_LEN = 500;

const TILE_LIGHT = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const TILE_DARK = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const MAP_CENTER = [24.4539, 54.3773];
const MAP_ZOOM = 11;

// ============================================================
// MAP
// ============================================================
function initMap() {
  map = L.map("map").setView(MAP_CENTER, MAP_ZOOM);
  map.zoomControl.setPosition("topright"); // clear the top-left zone-info card
  applyMapTheme();
}

function applyMapTheme() {
  if (!map) return;
  const dark = document.body.dataset.theme === "dark";
  if (tileLayer) map.removeLayer(tileLayer);
  tileLayer = L.tileLayer(dark ? TILE_DARK : TILE_LIGHT, {
    attribution: "Tiles &copy; Esri",
    maxZoom: 19,
    maxNativeZoom: 16,
  }).addTo(map);
}

async function loadZones() {
  try {
    const r = await fetch(`${API}/zones`);
    zonesGeoJSON = await r.json();
    zoneCoords = {};
    zonesGeoJSON.features.forEach(f => {
      const p = f.properties || {};
      if (p.center_lat != null && p.center_lng != null) {
        zoneCoords[String(p.zone_id)] = { lat: +p.center_lat, lng: +p.center_lng };
      }
    });
    allZonesLayer = L.geoJSON(zonesGeoJSON, {
      style: { fillColor: "#8a94a6", fillOpacity: 0.08, color: "#8a94a6", weight: 0.5 },
      onEachFeature: (feature, layer) => {
        layer.on("click", () => openZoneInfo(String(feature.properties.zone_id)));
      },
    }).addTo(map);
    showToast("Zones loaded — click any zone for details");
  } catch (err) {
    console.error(err);
    showToast("Error loading zones", true);
  }
}

// Bind an "open info" click to every feature in a result overlay so clicks on
// top layers resolve to the same zone-info card as the base layer.
function bindInfoClicks(geoLayer) {
  geoLayer.eachLayer(l => {
    if (l.feature) l.on("click", () => openZoneInfo(String(l.feature.properties.zone_id)));
  });
}

// ============================================================
// UI HELPERS
// ============================================================
function showToast(msg, isError = false) {
  const el = document.getElementById("status-toast");
  el.textContent = msg;
  el.style.borderColor = isError ? "rgba(224, 82, 82, 0.6)" : "rgba(29, 154, 108, 0.6)";
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2500);
}

function setStepStatus(stepKey, status, meta) {
  const el = document.querySelector(`[data-step="${stepKey}"]`);
  if (!el) return;
  el.classList.remove("pending", "running", "success", "error");
  el.classList.add(status);
  const metaEl = el.querySelector(".step-meta");
  if (metaEl) metaEl.textContent = meta || "";
}

function resetSteps() {
  setStepStatus("data", "pending", "Pending");
  setStepStatus("spec", "pending", "Pending");
  setStepStatus("run", "pending", "Pending");
}

function appendMessage(role, text) {
  const log = document.getElementById("chat-log");
  const item = document.createElement("div");
  item.className = `chat-bubble ${role}`;
  item.innerHTML = `
    <div class="chat-role">${role === "user" ? "User" : "System"}</div>
    <div>${escapeHtml(text)}</div>
  `;
  log.appendChild(item);
  log.scrollTop = log.scrollHeight;
}

function renderSpec(spec, validation) {
  const pre = document.getElementById("spec-json");
  pre.textContent = spec ? JSON.stringify(spec, null, 2) : "No spec generated.";

  const status = document.getElementById("spec-status");
  status.textContent = validation?.ok ? "Verified" : "Needs attention";
  status.className = `pill ${validation?.ok ? "pill-success" : "pill-danger"}`;

  const issues = document.getElementById("spec-issues");
  issues.innerHTML = "";
  if (!validation) return;

  if (validation.errors?.length) {
    validation.errors.forEach(err => {
      const item = document.createElement("div");
      item.className = "issue";
      item.textContent = err;
      issues.appendChild(item);
    });
  }

  if (validation.warnings?.length) {
    validation.warnings.forEach(warn => {
      const item = document.createElement("div");
      item.className = "issue warning";
      item.textContent = warn;
      issues.appendChild(item);
    });
  }

  if (!validation.errors?.length && !validation.warnings?.length) {
    const item = document.createElement("div");
    item.className = "issue warning";
    item.textContent = "Spec validated with no issues.";
    issues.appendChild(item);
  }
}

function resetResults() {
  renderSteps("gt-steps", []);
  renderSteps("llm-steps", []);
  renderSteps("compare-steps", []);
  document.getElementById("m-precision").textContent = "-";
  document.getElementById("m-recall").textContent = "-";
  document.getElementById("m-f1").textContent = "-";
  document.getElementById("llm-panel-title").textContent = "LLM output";
  document.getElementById("generated-code").textContent = "";
  document.getElementById("code-section").style.display = "none";
  document.getElementById("agent-section").style.display = "none";
  clearAgentTrace();
  clearLayers();
  resetZoneRanking();
  resetContextRanking();
  closeZoneInfo();
  lastEvalData = null;
}

// ============================================================
// PIPELINE
// ============================================================
async function runPipeline() {
  if (isRunning) return;
  const prompt = document.getElementById("prompt-input").value.trim();
  if (!prompt) {
    showToast("Enter a prompt first", true);
    return;
  }

  isRunning = true;
  document.getElementById("btn-run").disabled = true;
  resetSteps();
  resetResults();

  appendMessage("user", prompt);

  try {
    setStepStatus("data", "running", "Checking data");
    const statusResp = await fetch(`${API}/status`);
    const statusData = await statusResp.json();

    if (!statusData.ok) {
      setStepStatus("data", "error", "Missing data");
      appendMessage("system", (statusData.errors || ["Data check failed"]).join("; "));
      showToast("Data check failed", true);
      return;
    }

    setStepStatus("data", "success", `${statusData.zones_count} zones`);
    appendMessage("system", `Data check passed. ${statusData.zones_count} zones loaded.`);

    setStepStatus("spec", "running", "Generating spec");
    const model = document.getElementById("model-select").value;
    const specResp = await fetch(`${API}/spec_from_nl`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nl_query: prompt, model }),
    });
    const specData = await specResp.json();

    if (specData.error) {
      setStepStatus("spec", "error", "Spec failed");
      appendMessage("system", specData.error);
      showToast("Spec generation failed", true);
      renderSpec(null, null);
      return;
    }

    renderSpec(specData.spec, specData.validation);

    if (!specData.validation?.ok) {
      setStepStatus("spec", "error", "Spec needs fixes");
      appendMessage("system", "Spec validation failed. Fix the prompt and retry.");
      showToast("Spec validation failed", true);
      return;
    }

    setStepStatus("spec", "success", "Spec verified");
    appendMessage("system", "Spec verified. Running evaluation.");

    setStepStatus("run", "running", "Evaluating");
    const strategy = document.getElementById("strategy-select").value;
    const evalResp = await fetch(`${API}/evaluate_prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nl_query: prompt,
        model,
        strategy,
        spec: specData.spec,
      }),
    });
    const evalData = await evalResp.json();

    if (evalData.error) {
      setStepStatus("run", "error", "Evaluation failed");
      appendMessage("system", evalData.error);
      showToast("Evaluation failed", true);
      return;
    }

    await applyResults(evalData, strategy);
    setStepStatus("run", "success", `F1 ${Math.round(evalData.comparison.f1 * 100)}%`);
    appendMessage("system", `Evaluation complete. F1 ${Math.round(evalData.comparison.f1 * 100)}%.`);
    showToast(evalData.gt_count > 0
      ? `${evalData.gt_count} matching zone${evalData.gt_count > 1 ? "s" : ""} found`
      : "No exact match — showing closest zones");

  } catch (err) {
    console.error(err);
    setStepStatus("run", "error", "Error");
    showToast("Pipeline failed", true);
  } finally {
    isRunning = false;
    document.getElementById("btn-run").disabled = false;
  }
}

async function applyResults(data, strategy) {
  lastEvalData = data;

  // ---- ML result panels (hidden by CSS in consumer view, but kept in sync) ----
  const llmTitles = {
    direct: "LLM output (direct)",
    react: "LLM output (react)",
    reflexion: "LLM output (reflexion)",
  };
  document.getElementById("llm-panel-title").textContent = llmTitles[strategy] || "LLM output";

  const cmp = data.comparison;
  renderSteps("compare-steps", [
    { description: "Ground truth zones", count: data.gt_count },
    { description: "LLM predicted zones", count: data.llm_count },
    { description: "True positives", count: cmp.tp_count },
    { description: "False positives", count: cmp.fp_count },
    { description: "False negatives", count: cmp.fn_count },
  ], 4);

  document.getElementById("m-precision").textContent = (cmp.precision * 100).toFixed(1) + "%";
  document.getElementById("m-recall").textContent = (cmp.recall * 100).toFixed(1) + "%";
  document.getElementById("m-f1").textContent = (cmp.f1 * 100).toFixed(1) + "%";

  if (data.strategy === "direct" && data.generated_code) {
    document.getElementById("generated-code").textContent = data.generated_code;
    document.getElementById("code-section").style.display = "flex";
  } else if (data.agent_trace) {
    renderAgentTrace(data.agent_trace, data.strategy);
    document.getElementById("agent-section").style.display = "flex";
  }

  // ---- Contextual (persona / priority) ranking — both views ----
  renderContextRanking(data);

  // ---- Zone ranking panel — only when NO perfect matches ----
  if (data.gt_count === 0 && data.ranked_zones && data.ranked_zones.length > 0) {
    renderZoneRanking(
      data.ranked_zones,
      data.llm_ranking || [],
      data.ranking_spearman != null ? data.ranking_spearman : null,
      data.llm_explanations || {},
      0
    );
  }

  applyViewVisibility();

  // ---- Map (view-aware) ----
  await renderMap(data, currentView === "ml");
}

// ============================================================
// VIEW-AWARE MAP RENDER
// ============================================================
async function renderMap(data, animate) {
  clearLayers();
  if (!data) return;

  if (currentView === "ml") {
    if (animate) {
      for (let i = 0; i < data.gt_steps.length; i++) {
        renderSteps("gt-steps", data.gt_steps, i);
        highlightZones(data.gt_steps[i].zones, "#227af6", 0.55);
        await sleep(600);
      }
      if (data.llm_steps && data.llm_steps.length) {
        for (let i = 0; i < data.llm_steps.length; i++) {
          renderSteps("llm-steps", data.llm_steps, i);
          highlightZones(data.llm_steps[i].zones, "#8556ff", 0.5);
          await sleep(600);
        }
      } else {
        renderSteps("llm-steps", [{ description: data.codegen_error || "No LLM output", count: 0 }], 0);
      }
    } else {
      renderSteps("gt-steps", data.gt_steps, data.gt_steps.length - 1);
      if (data.llm_steps && data.llm_steps.length) {
        renderSteps("llm-steps", data.llm_steps, data.llm_steps.length - 1);
      }
    }
    if (filterLayer) { map.removeLayer(filterLayer); filterLayer = null; }
    showComparison(data.comparison);
    if (data.gt_count === 0 && data.ranked_zones && data.ranked_zones.length > 0) {
      showGradientZones(data.ranked_zones);
    } else {
      setLegendMode("standard");
    }
  } else {
    // Consumer view — clean, single-story map.
    if (data.context_ranking && data.context_ranking.length > 0) {
      showContextGradient(data);
    } else if (data.gt_count > 0) {
      showMatchZones(data.gt_zones);
    } else if (data.ranked_zones && data.ranked_zones.length > 0) {
      showGradientZones(data.ranked_zones);
    } else {
      setLegendMode("standard");
    }
  }

  // Keep the user's selected-zone outline on top after a re-render.
  if (selectedZoneId) highlightSelectedZone(selectedZoneId);
}

// ============================================================
// MAP HELPERS
// ============================================================
function clearLayers() {
  if (filterLayer) { map.removeLayer(filterLayer); filterLayer = null; }
  if (gradientLayer) { map.removeLayer(gradientLayer); gradientLayer = null; }
  if (matchLayer) { map.removeLayer(matchLayer); matchLayer = null; }
  if (contextLayer) { map.removeLayer(contextLayer); contextLayer = null; }
  Object.keys(compLayers).forEach(key => {
    if (compLayers[key]) { map.removeLayer(compLayers[key]); compLayers[key] = null; }
  });
}

function highlightZones(ids, color, opacity) {
  if (!zonesGeoJSON) return;
  const s = new Set(ids.map(String));
  const feats = zonesGeoJSON.features.filter(f => s.has(String(f.properties.zone_id)));
  if (filterLayer) map.removeLayer(filterLayer);
  filterLayer = L.geoJSON({ type: "FeatureCollection", features: feats }, {
    style: { fillColor: color, fillOpacity: opacity, color, weight: 2 },
  }).addTo(map);
}

function showComparison(cmp) {
  const make = (ids, color, op) => {
    const s = new Set(ids.map(String));
    const feats = zonesGeoJSON.features.filter(f => s.has(String(f.properties.zone_id)));
    const layer = L.geoJSON({ type: "FeatureCollection", features: feats }, {
      style: { fillColor: color, fillOpacity: op, color, weight: 2 },
    });
    bindInfoClicks(layer);
    return layer;
  };
  if (cmp.fn.length) compLayers.fn = make(cmp.fn, "#264653", 0.6).addTo(map);
  if (cmp.fp.length) compLayers.fp = make(cmp.fp, "#e05252", 0.7).addTo(map);
  if (cmp.tp.length) compLayers.tp = make(cmp.tp, "#1d9a6c", 0.7).addTo(map);
}

function showMatchZones(ids) {
  if (!ids || !zonesGeoJSON) return;
  const s = new Set(ids.map(String));
  const feats = zonesGeoJSON.features.filter(f => s.has(String(f.properties.zone_id)));
  matchLayer = L.geoJSON({ type: "FeatureCollection", features: feats }, {
    style: { fillColor: "#1d9a6c", fillOpacity: 0.6, color: "#1d9a6c", weight: 1.5 },
    onEachFeature: (f, l) => l.on("click", () => openZoneInfo(String(f.properties.zone_id))),
  }).addTo(map);
  setLegendMode("match");
}

// ============================================================
// RENDERING
// ============================================================
function renderSteps(containerId, steps, active = -1) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = steps.map((s, i) => `
    <div class="step-item ${i === active ? "active" : ""}">
      <span>${escapeHtml(s.description || "")}</span>
      <span class="step-count">${s.count ?? "-"}</span>
    </div>
  `).join("");
}

function clearAgentTrace() {
  document.getElementById("agent-meta").textContent = "No trace available.";
  document.getElementById("agent-status").textContent = "Not run";
  document.getElementById("agent-status").className = "pill pill-muted";
  document.getElementById("agent-trace-steps").innerHTML = "";
  document.getElementById("reflections-list").innerHTML = "";
  document.getElementById("reflections-wrap").style.display = "none";
}

function escapeHtml(str) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(str ?? "").replace(/[&<>"']/g, m => map[m]);
}

function renderObservation(value, idx) {
  const txt = String(value ?? "");
  const short = txt.length > OBS_PREVIEW_LEN;
  const preview = escapeHtml(short ? txt.slice(0, OBS_PREVIEW_LEN) + "..." : txt);
  const full = escapeHtml(txt);
  const bodyId = `obs-body-${idx}`;
  const fullId = `obs-full-${idx}`;

  if (!short) {
    return `<div class="trace-observation">${full}</div>`;
  }

  return `
    <div class="trace-observation" id="${bodyId}">${preview}</div>
    <span class="trace-toggle" onclick="toggleObservation('${bodyId}', '${fullId}')" id="${fullId}">Show more</span>
    <input type="hidden" data-full="${full.replace(/"/g, "&quot;")}" data-short="${preview.replace(/"/g, "&quot;")}">
  `;
}

function toggleObservation(bodyId, toggleId) {
  const body = document.getElementById(bodyId);
  const toggle = document.getElementById(toggleId);
  if (!body || !toggle) return;
  const hidden = toggle.nextElementSibling;
  if (!hidden) return;

  const full = hidden.getAttribute("data-full") || "";
  const short = hidden.getAttribute("data-short") || "";
  const expanded = toggle.getAttribute("data-expanded") === "1";

  if (expanded) {
    body.innerHTML = short;
    toggle.textContent = "Show more";
    toggle.setAttribute("data-expanded", "0");
  } else {
    body.innerHTML = full;
    toggle.textContent = "Show less";
    toggle.setAttribute("data-expanded", "1");
  }
}

function renderAgentTrace(trace, strategy) {
  const steps = Array.isArray(trace.steps) ? trace.steps : [];
  const success = !!trace.success;
  const attempts = trace.num_attempts || 1;
  const meta = `${strategy.toUpperCase()} | Steps: ${trace.num_steps || steps.length} | Attempts: ${attempts}`;

  document.getElementById("agent-meta").textContent = meta;
  const badge = document.getElementById("agent-status");
  badge.textContent = success ? "Success" : "Failed";
  badge.className = success ? "pill pill-success" : "pill pill-danger";

  const reflections = Array.isArray(trace.reflections) ? trace.reflections : [];
  const reflectionsWrap = document.getElementById("reflections-wrap");
  const reflectionsList = document.getElementById("reflections-list");
  reflectionsList.innerHTML = "";

  if (strategy === "reflexion" && reflections.length > 0) {
    reflections.forEach((r, i) => {
      const item = document.createElement("div");
      item.className = "reflection-item";
      item.innerHTML = `<strong>Attempt ${i + 1} Reflection:</strong><br>${escapeHtml(r)}`;
      reflectionsList.appendChild(item);
    });
    reflectionsWrap.style.display = "flex";
  } else {
    reflectionsWrap.style.display = "none";
  }

  const container = document.getElementById("agent-trace-steps");
  if (steps.length === 0) {
    container.innerHTML = '<div class="step-item">No tool trace returned.</div>';
    return;
  }

  container.innerHTML = steps.map((s, i) => `
    <details class="trace-step" ${i < 2 ? "open" : ""}>
      <summary>Step ${s.step || i + 1}</summary>
      <div class="trace-step-body">
        <div class="trace-thought">${escapeHtml(s.thought || "")}</div>
        <div class="trace-action">${escapeHtml(s.action || "(final answer / no action)")}</div>
        ${renderObservation(s.observation || "", i)}
      </div>
    </details>
  `).join("");
}

// ============================================================
// RANKING (formula / LLM partial-match)
// ============================================================
function getScoreColor(score) {
  if (score >= 1.0) return "#1d9a6c";
  if (score >= 0.75) return "#4ecb9e";
  if (score >= 0.50) return "#f4b06b";
  if (score >= 0.25) return "#f4a259";
  if (score > 0)    return "#f0a3a3";
  return "#e05252";
}

function showGradientZones(rankedZones) {
  if (!zonesGeoJSON) return;

  const scoreMap = {};
  rankedZones.forEach(z => { scoreMap[String(z.zone_id)] = z; });

  const scored = zonesGeoJSON.features.filter(f => scoreMap[String(f.properties.zone_id)]);

  gradientLayer = L.geoJSON({ type: "FeatureCollection", features: scored }, {
    style: (feature) => {
      const z = scoreMap[String(feature.properties.zone_id)];
      const color = getScoreColor(z ? z.score : 0);
      return { fillColor: color, fillOpacity: 0.72, color, weight: 1.5 };
    },
    onEachFeature: (feature, layer) => {
      layer.on("click", () => openZoneInfo(String(feature.properties.zone_id)));
    },
  }).addTo(map);

  setLegendMode("ranked");
}

function flattenBreakdown(node) {
  if (!node) return [];
  if (!node.children || node.children.length === 0) return [node];
  return node.children.flatMap(flattenBreakdown);
}

// ============================================================
// UNIFIED ZONE RANKING
// ============================================================
function setRankMode(mode) {
  currentRankMode = mode;
  document.getElementById("btn-mode-formula").classList.toggle("active", mode === "formula");
  document.getElementById("btn-mode-llm").classList.toggle("active", mode === "llm");
  renderZoneRankList();
}

function renderZoneRanking(gtRanked, llmOrderedIds, spearmanRho, explanations, perfectCount) {
  lastGtRanked = gtRanked;
  lastLlmOrderedIds = llmOrderedIds || [];
  lastSpearman = spearmanRho;
  lastExplanations = explanations || {};
  lastPerfectCount = perfectCount || 0;

  const section = document.getElementById("zone-rank-section");
  section.style.display = "flex";

  const subtitle = document.getElementById("zr-subtitle");
  const banner = document.getElementById("no-gt-banner");
  if (lastPerfectCount > 0) {
    subtitle.textContent = `${lastPerfectCount} perfect match${lastPerfectCount > 1 ? "es" : ""} — showing ranked zones`;
    banner.style.display = "none";
  } else {
    subtitle.textContent = "No exact matches — showing closest partial matches";
    banner.style.display = "flex";
  }

  const llmBtn = document.getElementById("btn-mode-llm");
  const hasLlm = lastLlmOrderedIds.length > 0;
  llmBtn.style.display = hasLlm ? "" : "none";
  if (!hasLlm && currentRankMode === "llm") {
    currentRankMode = "formula";
    document.getElementById("btn-mode-formula").classList.add("active");
    llmBtn.classList.remove("active");
  }

  const badge = document.getElementById("spearman-badge");
  if (spearmanRho != null) {
    const rho = spearmanRho;
    badge.textContent = `ρ = ${rho.toFixed(2)}`;
    badge.className = "pill " + (rho >= 0.6 ? "pill-success" : rho >= 0.2 ? "pill-warning" : "pill-danger");
    badge.title = rho >= 0.6 ? "LLM agrees with formula" : rho >= 0.2 ? "LLM partially agrees" : rho >= -0.2 ? "LLM ranks differently" : "LLM strongly disagrees";
    badge.style.display = "";
  } else {
    badge.style.display = "none";
  }

  renderZoneRankList();
}

function renderZoneRankList() {
  const list = document.getElementById("zone-rank-list");

  const gtRankMap = {};
  lastGtRanked.forEach((z, i) => { gtRankMap[z.zone_id] = i + 1; });
  const llmRankMap = {};
  lastLlmOrderedIds.forEach((id, i) => { llmRankMap[id] = i + 1; });

  let ordered;
  if (currentRankMode === "llm" && lastLlmOrderedIds.length > 0) {
    ordered = lastLlmOrderedIds.map(id => lastGtRanked.find(z => z.zone_id === id)).filter(Boolean);
  } else {
    ordered = lastGtRanked;
  }

  list.innerHTML = ordered.map((z, i) => {
    const myRank = i + 1;
    const gtRank = gtRankMap[z.zone_id];
    const llmRank = llmRankMap[z.zone_id];
    const otherRank = currentRankMode === "formula" ? llmRank : gtRank;
    const otherLabel = currentRankMode === "formula" ? "LLM" : "Formula";

    const diff = otherRank != null ? otherRank - myRank : null;
    const absDiff = diff != null ? Math.abs(diff) : null;
    const moveCls = absDiff == null ? "" : absDiff === 0 ? "zr-move-eq" : diff > 0 ? "zr-move-dn" : "zr-move-up";
    const moveText = absDiff == null ? "" : absDiff === 0 ? "=" : diff > 0 ? `↓${absDiff}` : `↑${absDiff}`;

    const pct = Math.round(z.score * 100);
    const color = getScoreColor(z.score);
    const explanation = lastExplanations[z.zone_id] || "";
    const leaves = flattenBreakdown(z.breakdown);
    const constraintRows = leaves.map(leaf => {
      const icon = leaf.satisfied ? "✓" : "✗";
      const cls = leaf.satisfied ? "detail-ok" : "detail-fail";
      return `<div class="detail-row ${cls}">${icon} ${escapeHtml(leaf.label)}</div>`;
    }).join("");

    const otherBadge = otherRank != null
      ? `<span class="zr-other ml-only ${moveCls}">${otherLabel} #${otherRank}${moveText ? " " + moveText : ""}</span>`
      : `<span class="zr-other ml-only zr-move-eq">${otherLabel} –</span>`;

    const detailContent = currentRankMode === "llm" && explanation
      ? `<div class="zr-explanation">"${escapeHtml(explanation)}"</div><div class="zr-constraints">${constraintRows}</div>`
      : `<div class="zr-constraints">${constraintRows}</div>`;

    return `
      <div class="zr-item" data-zone-id="${escapeHtml(z.zone_id)}"
           onclick="toggleZrItem(this, '${escapeHtml(z.zone_id)}')"
           title="Click to expand · double-click to fly to zone">
        <div class="zr-main${currentRankMode === "llm" ? " zr-main-llm" : ""}">
          <div class="zr-rank" style="color:${color}">#${myRank}</div>
          <div class="zr-info">
            <div class="zr-zone-id">${escapeHtml(z.zone_id.slice(0, 15))}</div>
            <div class="zr-meta">${z.satisfied_count}/${z.total_constraints} met</div>
          </div>
          ${currentRankMode === "formula" ? `
          <div class="zr-bar-wrap">
            <div class="zr-pct" style="color:${color}">${pct}%</div>
            <div class="zr-bar"><div class="zr-bar-fill" style="width:${pct}%;background:${color}"></div></div>
          </div>` : ""}
          ${otherBadge}
        </div>
        <div class="zr-details">${detailContent}</div>
      </div>`;
  }).join("");
}

function toggleZrItem(el, zoneId) {
  const wasExpanded = el.classList.contains("expanded");
  document.querySelectorAll(".zr-item.expanded").forEach(x => x.classList.remove("expanded"));
  if (!wasExpanded) el.classList.add("expanded");
}

function flyToZone(zoneId) {
  const layer = findZoneLayer(zoneId);
  if (layer && layer.getBounds) {
    map.fitBounds(layer.getBounds(), { maxZoom: 14 });
  }
  openZoneInfo(zoneId);
}

function findZoneLayer(zoneId) {
  for (const gl of [contextLayer, gradientLayer, matchLayer, allZonesLayer]) {
    if (!gl) continue;
    const found = gl.getLayers().find(l => l.feature && String(l.feature.properties.zone_id) === String(zoneId));
    if (found) return found;
  }
  return null;
}

function resetZoneRanking() {
  document.getElementById("zone-rank-section").style.display = "none";
  document.getElementById("zone-rank-list").innerHTML = "";
  document.getElementById("no-gt-banner").style.display = "none";
  document.getElementById("spearman-badge").style.display = "none";
  lastGtRanked = [];
  lastLlmOrderedIds = [];
  lastSpearman = null;
  lastExplanations = {};
  lastPerfectCount = 0;
  currentRankMode = "formula";
  document.getElementById("btn-mode-formula").classList.add("active");
  document.getElementById("btn-mode-llm").classList.remove("active");
}

// ============================================================
// CONTEXTUAL (persona / priority) RANKING
// ============================================================
function getContextColor(s) {
  if (s == null) return "#8a94a6";
  if (s >= 75) return "#1d9a6c";
  if (s >= 50) return "#4ecb9e";
  if (s >= 25) return "#f4b06b";
  return "#f0a3a3";
}

function renderContextRanking(data) {
  const section = document.getElementById("context-section");
  const ctx = data.context || {};
  const ranking = data.context_ranking || [];
  if (!ctx.priority || ranking.length === 0) {
    resetContextRanking();
    return;
  }
  section.style.display = "flex";
  document.getElementById("context-priority").textContent = ctx.priority;
  document.getElementById("context-pill").textContent = ctx.priority;
  document.getElementById("context-subtitle").textContent = ctx.persona
    ? `"${ctx.persona}"`
    : `Zones ranked by ${ctx.priority}`;

  const scores = data.context_scores || {};
  const expl = data.context_explanations || {};
  const list = document.getElementById("context-list");
  list.innerHTML = ranking.map((zid, i) => {
    const sc = scores[zid];
    const reason = expl[zid] || "";
    const color = getContextColor(sc);
    return `
      <div class="ctx-item" data-zone-id="${escapeHtml(zid)}" onclick="openZoneInfo('${escapeHtml(zid)}')"
           title="Click to see zone details">
        <div class="ctx-rank" style="color:${color}">#${i + 1}</div>
        <div class="ctx-body">
          <div class="ctx-top">
            <span class="ctx-zone">${escapeHtml(zid.slice(0, 14))}</span>
            ${sc != null ? `<span class="ctx-score" style="color:${color}">${sc}<span class="ctx-score-max">/100</span></span>` : ""}
          </div>
          ${sc != null ? `<div class="ctx-bar"><div class="ctx-bar-fill" style="width:${sc}%;background:${color}"></div></div>` : ""}
          <div class="ctx-reason">${escapeHtml(reason)}</div>
        </div>
      </div>`;
  }).join("");
}

function resetContextRanking() {
  const section = document.getElementById("context-section");
  if (section) section.style.display = "none";
  const list = document.getElementById("context-list");
  if (list) list.innerHTML = "";
}

function showContextGradient(data) {
  if (!zonesGeoJSON) return;
  const ranking = data.context_ranking || [];
  const scores = data.context_scores || {};
  const idset = new Set(ranking.map(String));
  const feats = zonesGeoJSON.features.filter(f => idset.has(String(f.properties.zone_id)));
  contextLayer = L.geoJSON({ type: "FeatureCollection", features: feats }, {
    style: (f) => {
      const s = scores[String(f.properties.zone_id)];
      const c = getContextColor(s);
      return { fillColor: c, fillOpacity: 0.72, color: c, weight: 1.5 };
    },
    onEachFeature: (f, l) => l.on("click", () => openZoneInfo(String(f.properties.zone_id))),
  }).addTo(map);
  setLegendMode("context");
}

// ============================================================
// ZONE INFO CARD (click any zone)
// ============================================================
async function openZoneInfo(zoneId) {
  zoneId = String(zoneId);
  selectedZoneId = zoneId;
  const card = document.getElementById("zone-info-card");
  card.style.display = "block";
  document.getElementById("zic-title").textContent = "Zone " + zoneId.slice(0, 16);

  highlightSelectedZone(zoneId);
  fillZoneEvalInfo(zoneId);

  const addrEl = document.getElementById("zic-address");
  if (zoneInfoCache[zoneId]) {
    renderZoneInfoBasics(zoneInfoCache[zoneId]);
  } else {
    addrEl.textContent = "Locating…";
    document.getElementById("zic-weather").innerHTML = "";
    document.getElementById("zic-highlights").innerHTML = "";
    try {
      const r = await fetch(`${API}/zone_info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zone_id: zoneId }),
      });
      const info = await r.json();
      if (info.error) throw new Error(info.error);
      zoneInfoCache[zoneId] = info;
      if (selectedZoneId === zoneId) renderZoneInfoBasics(info);
    } catch (e) {
      if (selectedZoneId === zoneId) addrEl.textContent = "Location details unavailable";
    }
  }
}

function renderZoneInfoBasics(info) {
  document.getElementById("zic-address").textContent = info.address || "Address unavailable";

  const wxEl = document.getElementById("zic-weather");
  const w = info.weather;
  if (w && w.temp_c != null) {
    wxEl.innerHTML = `
      <span class="zic-temp">${Math.round(w.temp_c)}°C <span class="zic-temp-f">/ ${Math.round(w.temp_f)}°F</span></span>
      <span class="zic-wx-meta">${escapeHtml(w.label || "")}${w.humidity != null ? ` · ${w.humidity}% humidity` : ""}</span>`;
  } else {
    wxEl.innerHTML = `<span class="zic-wx-meta">Weather unavailable</span>`;
  }

  const hlEl = document.getElementById("zic-highlights");
  const hls = info.highlights || [];
  hlEl.innerHTML = hls.length
    ? `<div class="zic-section-label">Notable amenities</div><div class="zic-chips">` +
      hls.map(h => `<span class="zic-chip">${escapeHtml(h.label)} · ${escapeHtml(h.value)}</span>`).join("") + `</div>`
    : "";
}

function fillZoneEvalInfo(zoneId) {
  const scoreEl = document.getElementById("zic-score");
  const ctxEl = document.getElementById("zic-context");
  const consEl = document.getElementById("zic-constraints");
  scoreEl.innerHTML = "";
  ctxEl.innerHTML = "";
  consEl.innerHTML = "";
  const data = lastEvalData;
  if (!data) return;

  // Contextual priority score + reasoning
  const cscore = (data.context_scores || {})[zoneId];
  const creason = (data.context_explanations || {})[zoneId];
  const priority = (data.context || {}).priority;
  if (priority && cscore != null) {
    const color = getContextColor(cscore);
    ctxEl.innerHTML = `
      <div class="zic-section-label">${escapeHtml(priority)} <span style="color:${color};font-weight:700">${cscore}/100</span></div>
      ${creason ? `<div class="zic-context-reason">${escapeHtml(creason)}</div>` : ""}`;
  }

  // Constraint satisfaction (perfect match or partial-match breakdown)
  const isPerfect = (data.gt_zones || []).map(String).includes(zoneId);
  const ranked = (data.ranked_zones || []).find(z => String(z.zone_id) === zoneId);
  if (isPerfect) {
    scoreEl.innerHTML = `<div class="zic-match-badge zic-match-ok">✓ Meets all constraints</div>`;
  } else if (ranked) {
    const pct = Math.round(ranked.score * 100);
    const color = getScoreColor(ranked.score);
    scoreEl.innerHTML = `<div class="zic-match-badge" style="color:${color};border-color:${color}">${pct}% constraint match · ${ranked.satisfied_count}/${ranked.total_constraints} met</div>`;
    const leaves = flattenBreakdown(ranked.breakdown);
    consEl.innerHTML = leaves.map(leaf => {
      const icon = leaf.satisfied ? "✓" : "✗";
      const cls = leaf.satisfied ? "detail-ok" : "detail-fail";
      return `<div class="detail-row ${cls}">${icon} ${escapeHtml(leaf.label)}</div>`;
    }).join("");
  }

  // For the no-perfect-match case, show the LLM's explanation of why this zone
  // scored the way it did (from the partial-match LLM ranking), in either view.
  const llmReason = (data.llm_explanations || {})[zoneId];
  if (llmReason && !creason) {
    ctxEl.innerHTML = `<div class="zic-section-label">Why this score</div><div class="zic-context-reason">${escapeHtml(llmReason)}</div>`;
  }
}

function highlightSelectedZone(zoneId) {
  if (selectedLayer) { map.removeLayer(selectedLayer); selectedLayer = null; }
  if (!zonesGeoJSON) return;
  const feat = zonesGeoJSON.features.find(f => String(f.properties.zone_id) === String(zoneId));
  if (!feat) return;
  selectedLayer = L.geoJSON(feat, {
    style: { fill: false, color: "#4f8cff", weight: 3, dashArray: "5 3" },
    interactive: false,
  }).addTo(map);
}

function closeZoneInfo() {
  selectedZoneId = null;
  const card = document.getElementById("zone-info-card");
  if (card) card.style.display = "none";
  if (selectedLayer) { map.removeLayer(selectedLayer); selectedLayer = null; }
}

// ============================================================
// LEGEND
// ============================================================
function setLegendMode(mode) {
  const show = (id, on) => {
    const el = document.getElementById(id);
    if (el) el.style.display = on ? "block" : "none";
  };
  show("legend-ranked", mode === "ranked");
  show("legend-context", mode === "context");
  show("legend-match", mode === "match");
}

// ============================================================
// VIEW (consumer / ML)
// ============================================================
function initView() {
  const stored = localStorage.getItem("view");
  currentView = stored === "ml" ? "ml" : "consumer";
  document.body.dataset.view = currentView;
  updateViewButtons();
}

function setView(view) {
  currentView = view === "ml" ? "ml" : "consumer";
  document.body.dataset.view = currentView;
  localStorage.setItem("view", currentView);
  updateViewButtons();
  applyViewVisibility();
  if (lastEvalData) renderMap(lastEvalData, false);
}

function updateViewButtons() {
  const c = document.getElementById("btn-view-consumer");
  const m = document.getElementById("btn-view-ml");
  if (c) c.classList.toggle("active", currentView === "consumer");
  if (m) m.classList.toggle("active", currentView === "ml");
}

// In consumer view, if the context ranking is present it is the primary result,
// so hide the (analytical) partial-match ranking panel to avoid duplication.
function applyViewVisibility() {
  const zoneRank = document.getElementById("zone-rank-section");
  const hasContext = lastEvalData && (lastEvalData.context_ranking || []).length > 0;
  const hasZoneRank = lastEvalData && lastEvalData.gt_count === 0 &&
    (lastEvalData.ranked_zones || []).length > 0;
  if (zoneRank) {
    if (!hasZoneRank) {
      zoneRank.style.display = "none";
    } else if (currentView === "consumer" && hasContext) {
      zoneRank.style.display = "none";
    } else {
      zoneRank.style.display = "flex";
    }
  }
}

// ============================================================
// THEME
// ============================================================
function initTheme() {
  const stored = localStorage.getItem("theme");
  const theme = stored || "dark";
  document.body.dataset.theme = theme;
}

function toggleTheme() {
  const next = document.body.dataset.theme === "dark" ? "light" : "dark";
  document.body.dataset.theme = next;
  localStorage.setItem("theme", next);
  applyMapTheme();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// EVENTS
// ============================================================
document.getElementById("btn-run").addEventListener("click", runPipeline);
document.getElementById("btn-clear").addEventListener("click", () => {
  document.getElementById("prompt-input").value = "";
  document.getElementById("chat-log").innerHTML = "";
  renderSpec(null, null);
  resetSteps();
  resetResults();
});

document.getElementById("theme-toggle").addEventListener("click", toggleTheme);
document.getElementById("btn-view-consumer").addEventListener("click", () => setView("consumer"));
document.getElementById("btn-view-ml").addEventListener("click", () => setView("ml"));
document.getElementById("zic-close").addEventListener("click", closeZoneInfo);

document.getElementById("zone-rank-list").addEventListener("dblclick", (e) => {
  const item = e.target.closest(".zr-item");
  if (item) flyToZone(item.dataset.zoneId);
});

document.getElementById("prompt-input").addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key === "Enter") {
    runPipeline();
  }
});

// ============================================================
// INIT
// ============================================================
async function init() {
  initTheme();
  initView();
  initMap();
  await loadZones();
  resetSteps();
}

init();
