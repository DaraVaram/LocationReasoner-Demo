# What's New in LocationReasoner — Feature & Demo Guide

Source material for a presentation on the additions made to the LocationReasoner
web application. Each section is written so it can map to a slide or slide group,
and every example prompt below was **verified live** against both running demos.

- **Boston** — 255 zones, 48 features (SafeGraph data) — `http://localhost:5003`
- **Abu Dhabi** — 471 zones, 27 features (OpenStreetMap data) — `http://localhost:5002`

---

## 1. Overview / TL;DR

We turned a **ground-truth evaluation tool** into an **interactive, stakeholder-ready
site-selection app**. Four user-facing features were added, plus the plumbing to run
it reliably on any machine with an OpenAI key.

| # | Feature | One-line pitch |
|---|---------|----------------|
| 1 | **Clickable zone info card** | Click any zone → its address, live weather, amenities, and *why it scored the way it did*. |
| 2 | **Prompt-driven context ranking** | State a priority in plain English ("I care about greenery") and the matched zones are re-ranked by it, with reasoning. |
| 3 | **Dark-mode map** | The theme toggle now switches the map tiles too — light for detail, dark for presenting. |
| 4 | **Consumer ⇄ ML views** | One toggle hides all the ground-truth / precision-recall internals for a clean stakeholder demo. |

**The core narrative for a PI:** the app no longer just *scores* zones against hard
constraints — it *reasons* about them the way a human analyst would (weighing greenery,
tourism access, accessibility), and presents that reasoning in a form a non-technical
stakeholder can read, while keeping the full ML evaluation one click away.

---

## 2. Feature 1 — Clickable Zone Info Card

**What it is.** Click **any** hexagonal zone on the map — whether it's a match, a
partial match, or just a greyed-out background zone — and a card opens with everything
a decision-maker would want to know about that location.

**What the card shows**
- **Address** — reverse-geocoded from the zone's centroid (e.g. *"Newbury Street, Boston"*; in Abu Dhabi, the Arabic street name).
- **Live temperature & humidity** + a short sky description (e.g. *18°C, 90% humidity, Overcast*).
- **Notable amenities** — the top amenity counts in that zone as chips.
- **Constraint breakdown** — ✓ / ✗ for each constraint in the current query, and the % match.
- **"Why this score"** — for zones that don't perfectly match, the LLM's plain-English explanation of *why* the zone scored the way it did.

**Use-cases**
- A planner spots a promising zone on the map and instantly sees what's actually there and what the weather is like on site.
- During a "no perfect match" search, the user clicks the closest candidates and reads the LLM's trade-off reasoning instead of staring at raw numbers.

**How to demo.** Run any query, then **click a colored zone** (and then a **grey** one) to show it works for every zone, always.

**Under the hood.** A new `POST /api/zone_info` endpoint + `src/enrich.py` module.
Addresses come from **OpenStreetMap Nominatim**, weather from **Open-Meteo** — both free,
keyless, cached in-process, and fail gracefully (the card still shows everything else if a
service is slow). Uses only the Python standard library — no new dependency.

---

## 3. Feature 2 — Prompt-Driven Context Ranking

**What it is.** The headline feature. You write your **priority / persona directly into
the prompt**, and after the app finds the zones that satisfy your hard constraints, it
**re-ranks those zones by your stated priority** — with a 0–100 score and 1–2 sentences of
reasoning per zone.

**How it works (3 steps)**
1. An LLM extracts the *priority dimension* from your prompt (e.g. `greenery`, `tourism access`, `accessibility`).
2. The usual pipeline finds the zones satisfying the hard filters.
3. A second LLM pass ranks those result zones by the priority, using the zones' real amenity data as evidence (parks, recreation, tourist landmarks, transit…) plus world knowledge — returning a score and reasoning for each.

**Why it matters (the pitch).** Two different professionals asking for "the same" zones
get **different rankings** aligned to what *they* care about. It bridges rigid constraint
satisfaction and the soft, human judgment that real site selection requires.

**Example — the same search, three different priorities (Abu Dhabi):**

| Persona in the prompt | What gets prioritized | Evidence the LLM uses |
|-----------------------|----------------------|------------------------|
| *"…I care about greenery"* | zones with parks / open space | `cnt_parks`, recreation |
| *"…I care about tourism access"* | near landmarks, malls, hotels | `cnt_tourist_landmarks`, `dist_to_tourist_landmarks_m` |
| *"…accessibility for public transport users"* | transit-rich zones | bus stops / stations, parking |

**Verified example (Abu Dhabi):**
> *"I am an urban designer that cares for areas with greenery. Find me zones within 800 meters of a mall, with at least 2 pharmacies."*
- → 21 zones match the hard filters, then ranked by **greenery**; top zone scored **100/100** with reasoning *"Contains 10 parks, indicating significant greenery."*

**Under the hood.** `_extract_context()` in `app.py` + `contextual_rank_zones()` in
`src/ranking.py`. New response fields: `context`, `context_ranking`, `context_scores`,
`context_explanations`. Runs whether or not there is a perfect match (it ranks the perfect
matches, or the closest partial matches if none).

---

## 4. Feature 3 — Dark-Mode Map

**What it is.** The existing "Toggle theme" button now also swaps the **map tiles**
between a light and a dark basemap (previously only the side panels changed).

**Use-case.** Light mode reads better for detailed inspection; dark mode looks sharp on a
projector / in a darkened room during a talk.

**How to demo.** Click **Toggle theme** — the whole map flips.

**Note (nice technical detail for the talk).** Fixing this surfaced and resolved a classic
Leaflet stacking-context bug: map overlay panes were painting over the info card. Giving the
map its own stacking context fixed it cleanly.

---

## 5. Feature 4 — Consumer ⇄ ML Views

**What it is.** A toggle (top-left) between two audiences:
- **Consumer** (default): a clean front-end — prompt, the ranked results with reasoning, the map, and zone info. All the evaluation machinery is hidden.
- **ML**: reveals the full research view — ground-truth vs LLM comparison, precision / recall / F1, the generated code, agent traces, and the formula-vs-LLM ranking with Spearman correlation.

**Why it matters (the pitch).** One app serves **two audiences**: a stakeholder sees a
polished product; a researcher sees the rigorous evaluation. You can switch mid-demo to show
"and here's the ground-truth validation behind it."

**How to demo.** Start in **Consumer**, run a query, then flip to **ML** to reveal
precision/recall and the generated code.

---

## 6. Supporting changes (worth one slide)

- **Runs on OpenAI by default.** The demos were adapted to use `gpt-4o` (the app shipped wired for DeepSeek). A DeepSeek key remains optional.
- **Reliability fixes.** Windows UTF-8 output fix (a non-ASCII `print` was silently killing the LLM re-ranking), the Leaflet z-index fix, and small security-hardening from an automated review (escaping user-facing values, defensive null-guards).
- **Ready to ship.** Added a full setup `README.md`, a pinned `requirements.txt` (verified to install clean), and a `.gitignore`. Published to GitHub: **https://github.com/DaraVaram/LocationReasoner-Demo**.

---

## 7. Verified demo prompts (copy-paste)

All ten were run live end-to-end; results are example outputs (the LLM generates the spec,
so exact counts can vary slightly between runs).

### 🟩 Abu Dhabi (`http://localhost:5002`) — richer amenity data

| Prompt | Shows off | Example result |
|--------|-----------|----------------|
| *I am an urban designer that cares for areas with greenery. Find me zones within 800 meters of a mall, with at least 2 pharmacies.* | Context: **greenery** | 21 matches → top **100/100** ("10 parks") |
| *As a tourism consultant I care about tourism access. Find zones within 1500m of a tourist landmark, with at least 1 mall and at least 2 restaurants.* | Context: **tourism** | 19 matches → top **85/100** |
| *I prioritize accessibility for public transport users. Find zones with at least 2 pharmacies and at least 1 supermarket.* | Context: **accessibility** | 38 matches → top **90** ("11 bus stops, a bus station") |
| *Find zones with at least 5 malls within 200 meters, at least 5 parks, and no coffee shops.* | **No match → ranking + "why this score"** | 0 perfect → 30 ranked; click a zone for its reasoning |
| *Find zones with at least 3 restaurants and at least 1 mosque.* | **Click-to-info** | 47 matches → click any → Arabic address, ~37°C |

### 🟦 Boston (`http://localhost:5003`)

> ⚠️ **Boston has no "mall" distance metric** (SafeGraph data). Use grocery / hospital /
> restaurant / museum / university for distance words. "Within N m of a mall" will fail there.

| Prompt | Shows off | Example result |
|--------|-----------|----------------|
| *I'm an urban designer who cares about greenery. Find zones within 600m of a grocery store with at least 3 bars.* | Context: **greenery** | 23 matches → top **82/100** (museums & recreation) |
| *As a tourism planner I care about tourism access. Find zones with at least 1 hotel, at least 1 museum, and at least 3 restaurants.* | Context: **tourism** | 48 matches → top **100/100** |
| *I care about accessibility by public transit. Find zones with at least 3 restaurants and at least 1 grocery store.* | Context: **accessibility** | 64 matches → top **100** ("24 bus stops, 35 transit systems, 22 subway entrances") |
| *Find zones with at least 15 health stores, at least 10 department stores, and population over 200000.* | **No match → ranking + "why this score"** | 0 perfect → 30 ranked + explanations |
| *Find zones with at least 5 restaurants and at least 2 bars.* | **Click-to-info** | 34 matches → click any → address + weather |

---

## 8. Suggested live demo flow (≈ 2–3 minutes)

1. **Start in Consumer view.** Run the Abu Dhabi **greenery** prompt. Narrate: *"It finds the zones that meet the hard constraints, then ranks them by what I actually care about — greenery — and explains itself."*
2. **Change the persona.** Re-run with *"tourism access"* (or *"accessibility"*) → point out the ranking **reorders** for the same kind of search.
3. **Click a top zone** → show the info card: real address, live weather, amenities, greenery score + reasoning. Then click a **grey** zone to show any zone is inspectable.
4. **Toggle theme** → dark map (looks great on the projector).
5. **Run the over-constrained prompt** ("no perfect match") → show the partial-match ranking; click a candidate for its **"why this score"** explanation.
6. **Flip to ML view** → reveal ground-truth vs LLM, precision / recall / F1, generated code. Close with: *"the polished product and its validation are the same app."*

---

## 9. Technical summary (for a backup / appendix slide)

**New backend**
- `POST /api/zone_info` — address + weather + amenities for a clicked zone.
- `src/enrich.py` — Nominatim (address) + Open-Meteo (weather), cached, stdlib-only, graceful fallback.
- `_extract_context()` + `contextual_rank_zones()` — persona extraction and priority-based LLM re-ranking.
- New `/api/evaluate_prompt` fields: `context`, `context_ranking`, `context_scores`, `context_explanations`.

**New frontend** (both cities, `static/app.js`, `index.html`, `styles.css`)
- Clickable zones on every layer → floating info card with async address/weather.
- Context-ranking panel; view-aware map rendering; light/dark tile swap; `data-view` consumer/ML toggle (`ml-only` CSS hides the research surfaces).

**Pipeline** (unchanged core, new steps in **bold**)
1. Natural language → JSON constraint spec (LLM) → validated.
2. Ground-truth evaluation (deterministic).
3. Partial-match scoring 0–100% + optional LLM re-ranking.
4. **Context extraction + priority-based re-ranking.**
5. **On click: reverse-geocode + fetch weather for the zone.**

**External dependencies (new).** Internet access for the info card only — Nominatim +
Open-Meteo, both free and keyless. Ranking / evaluation need only the OpenAI key.

**Known limitations to mention honestly**
- Boston's data has **no mall / department-store distance** column (only grocery, hospital, museum, restaurant, university). Abu Dhabi has malls, parks, and tourist landmarks — richer for this demo.
- Address & weather are best-effort external calls; if offline, the card degrades gracefully.
- "Greenery" on Boston is inferred from recreation/museum proxies; Abu Dhabi has an explicit `parks` count, so its greenery reasoning is more grounded.
