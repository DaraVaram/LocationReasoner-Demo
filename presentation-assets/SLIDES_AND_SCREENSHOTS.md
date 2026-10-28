# Presentation Assets — Diagrams, Screenshots & Slide Layout

Everything you need to assemble the deck. Narration/content lives in
[`../NEW_FEATURES.md`](../NEW_FEATURES.md); this file tells you **what image goes where**
and **exactly how to capture each screenshot**.

Both apps must be running (they are): **Abu Dhabi** `http://localhost:5002`,
**Boston** `http://localhost:5003`. The app opens in **dark theme + Consumer view** by default.

---

## Part A — Diagrams (ready to drop in, no work needed)

Four vector diagrams in this folder. SVG scales crisply at any size; if your tool won't
import SVG, open the file in a browser and export/print to PNG, or ask me for PNGs.

| File | Use on slide | What it shows |
|------|--------------|----------------|
| `diagram-1-pipeline.svg` | "How it works" | The 5-stage pipeline, new steps highlighted green |
| `diagram-2-context-ranking.svg` | Feature 2 (**hero**) | Same 5 zones, 3 priorities, 3 different rankings |
| `diagram-3-two-audiences.svg` | Feature 4 | Consumer vs ML — what each view shows |
| `diagram-4-zone-info-card.svg` | Feature 1 | The info card's 5 fields and their data sources |

---

## Part B — Screenshot shot-list (≈ 5 minutes total)

Take these in your own browser. Capture the **browser content area** (crop out bookmarks/URL
bar). A 16:10 window (~1600×1000) frames the side panel + map nicely. Two prompt runs on Abu
Dhabi cover shots 1–5.

> Tip: to capture just the window on Windows, use **Win + Shift + S** (Snipping Tool) and drag
> the region, or **Alt + PrtScn** for the active window.

### Run 1 — Abu Dhabi, greenery (covers shots 1–4)
1. Open `http://localhost:5002`. Leave it in **Consumer** view (default).
2. Paste into the prompt box:
   > *I am an urban designer that cares for areas with greenery. Find me zones within 800 meters of a mall, with at least 2 pharmacies.*
3. Click **Run pipeline**, wait ~15–20 s until the **"Ranked by greenery"** panel and the green-shaded zones appear.

| # | Filename | How to capture | Shows |
|---|----------|----------------|-------|
| **1** | `01-context-ranking.png` | Screenshot the whole window now (dark map + "Ranked by greenery" list with scores/reasoning). | **Feature 2 hero** |
| **2** | `02-zone-info-card.png` | Click the **#1 zone** in the ranking list (or click its hex on the map) → the info card opens top-left. Screenshot. | **Feature 1** |
| **3** | `03-light-map.png` | Close the card (**×**). Click **Toggle theme** (top-right) → map + UI switch to light. Screenshot. Pair it with #1 as a dark/light "before-after". | **Feature 3 (dark map)** |
| **4** | `04-ml-view.png` | Click **ML** (top-left toggle). The Results panel (Ground truth / LLM / Precision-Recall-F1) and Generated code appear on the left — scroll the left panel if needed. Screenshot. | **Feature 4** |

### Run 2 — Abu Dhabi, no exact match (shot 5)
5. Click **Clear**. Switch back to **Consumer** view. Paste:
   > *Find zones with at least 5 malls within 200 meters, at least 5 parks, and no coffee shops.*
6. **Run pipeline**, wait. You'll get a **"No exact match"** banner + a ranked partial-match list.
7. Click any ranked zone → the info card shows a **"Why this score"** explanation.

| # | Filename | How to capture | Shows |
|---|----------|----------------|-------|
| **5** | `05-no-match-why-score.png` | Screenshot with the info card open, showing the % match + **"Why this score"** text. | Ranking + LLM reasoning |

### Optional — Boston, for a second city (shot 6)
8. Open `http://localhost:5003`. Paste:
   > *I care about accessibility by public transit. Find zones with at least 3 restaurants and at least 1 grocery store.*
9. Run, wait, screenshot the **"Ranked by accessibility"** result (top zone cites "24 bus stops, …").

| # | Filename | Shows |
|---|----------|-------|
| **6** | `06-boston-accessibility.png` | Same feature, different city + dataset |

Save all PNGs into this `presentation-assets/` folder alongside the diagrams.

---

## Part C — Suggested slide-by-slide layout

A tight ~10-slide deck. Pull the words from `NEW_FEATURES.md` (section numbers noted).

| Slide | Title | Visual | Talking points (source) |
|-------|-------|--------|--------------------------|
| 1 | **LocationReasoner — What's New** | app name / your title | one-line: "from scoring zones to *reasoning* about them" (§1) |
| 2 | The pipeline | `diagram-1-pipeline.svg` | where the new steps fit; NL → ranked, explained zones (§9) |
| 3 | **Feature 1 — Click any zone** | `diagram-4` + screenshot **#2** | address, live weather, breakdown, why-score; any zone, always (§2) |
| 4 | **Feature 2 — Context ranking** | `diagram-2` (**hero**) | state a priority → zones re-ranked with reasoning (§3) |
| 5 | See it live | screenshots **#1** + **#5** | greenery ranking; no-match → "why this score" (§3, §7) |
| 6 | **Feature 3 — Dark-mode map** | screenshots **#1 (dark)** + **#3 (light)** | one toggle, whole map switches; great for a projector (§4) |
| 7 | **Feature 4 — Two audiences** | `diagram-3` + screenshot **#4** | Consumer for stakeholders, ML for researchers, one toggle (§5) |
| 8 | Under the hood | (bullets) | new endpoint + `enrich.py`; Nominatim + Open-Meteo; OpenAI-first; reliability & security fixes (§6, §9) |
| 9 | Try it yourself | (prompt table) | the verified prompts, both cities; the Boston "no mall" caveat (§7) |
| 10 | Wrap-up | repo link | `github.com/DaraVaram/LocationReasoner-Demo`; "same product & its validation, one app" |

**Optional live-demo interlude** (after slide 7) — the 6-step flow in `NEW_FEATURES.md` §8.

---

### Quick checklist before you present
- [ ] Both servers running (`localhost:5002` and `:5003`) with `OPENAI_API_KEY` set.
- [ ] Internet on (address + weather in the info card).
- [ ] 6 screenshots captured into this folder.
- [ ] Decide light vs dark for the room — dark map (default) looks sharp on a projector.
