# LocationReasoner Demos

Two interactive **site-selection** demos built on H3 hexagonal zones. Type a natural-language
request (e.g. *"Find zones within 800m of a mall with at least 2 pharmacies"*); the system turns
it into a JSON constraint spec, evaluates it against ground-truth zone data, ranks the zones when
nothing matches perfectly, and lets you **click any zone** to see its address, current weather,
and the reasoning behind its score.

| Demo | City | Zones | Features | Data source | Port |
|------|------|-------|----------|-------------|------|
| `boston/` | Boston, USA | 255 | 48 | SafeGraph | **5003** |
| `abu_dhabi/` | Abu Dhabi, UAE | 471 | 27 | OpenStreetMap | **5002** |

## Features

- **Natural-language → constraint spec** — an LLM converts your request into a validated JSON rule spec.
- **Ground-truth evaluation** — deterministic check of which zones satisfy every constraint.
- **Partial-match ranking** — when no zone matches perfectly, every zone is scored 0–100% with a formula, plus an optional **LLM re-ranking** that explains its trade-offs.
- **Click any zone for details** — a pop-up card shows the **address** (reverse-geocoded), **current temperature & humidity**, notable amenities, the per-constraint breakdown, and the LLM's *"why this score"* explanation.
- **Prompt-driven context ranking** — state a priority in your prompt (*"I care about greenery…"*, *"…tourism access"*, *"…accessibility"*) and the matched zones are re-ranked by that dimension with reasoning and 0–100 scores.
- **Dark / light map** — the theme toggle also switches the map tiles.
- **Consumer ⇄ ML views** — a toggle hides all the ground-truth / precision-recall / generated-code internals for a clean, presentation-ready front-end.

## Prerequisites

- **Python 3.10** (developed and pinned against 3.10.19).
- An **OpenAI API key** (the demos default to the `gpt-4o` model). A DeepSeek key is optional — see [Using DeepSeek](#optional-using-deepseek).
- **Internet access** — the zone info card fetches addresses (OpenStreetMap Nominatim) and weather (Open-Meteo). Both are free and keyless; if offline, the card simply shows the other details.

## Setup

Clone the repo, then create an environment and install the dependencies.

```bash
git clone <your-repo-url>
cd LocationReasoner
```

**Option A — conda (recommended):**
```bash
conda create -n site_selection python=3.10 -y
conda activate site_selection
pip install -r requirements.txt
```

**Option B — venv + pip:**
```bash
python -m venv .venv
# Windows:        .venv\Scripts\activate
# macOS / Linux:  source .venv/bin/activate
pip install -r requirements.txt
```

**Set your API key** (in the same terminal you'll run the app from):

```powershell
# Windows PowerShell
$env:OPENAI_API_KEY = "sk-..."
```
```cmd
:: Windows cmd
set OPENAI_API_KEY=sk-...
```
```bash
# macOS / Linux
export OPENAI_API_KEY="sk-..."
```

> To persist the key on Windows across sessions:
> `setx OPENAI_API_KEY "sk-..."` (then reopen the terminal).
> **Never commit your key** — it's read from the environment, and `.env` files are git-ignored.

## Running

Run each city from **inside its own folder** (the app serves its `static/` relative to the working directory).

**Boston** → http://localhost:5003
```bash
cd boston
python app.py
```

**Abu Dhabi** → http://localhost:5002
```bash
cd abu_dhabi
python app.py
```

Open the URL in your browser. To run both at once, use two terminals.

### Windows note

Enable UTF-8 output before launching (prevents a `charmap` error when the app prints non-ASCII text):
```powershell
conda activate site_selection
$env:PYTHONUTF8 = "1"
cd boston          # or: cd abu_dhabi
python app.py
```

## Try it — verified example prompts

Type these into the prompt box and click **Run pipeline**.

**Abu Dhabi** (richer amenity data — malls, parks, tourist landmarks):
- *I am an urban designer that cares for areas with greenery. Find me zones within 800 meters of a mall, with at least 2 pharmacies.*
- *As a tourism consultant I care about tourism access. Find zones within 1500m of a tourist landmark, with at least 1 mall and at least 2 restaurants.*
- *I prioritize accessibility for public transport users. Find zones with at least 2 pharmacies and at least 1 supermarket.*
- *Find zones with at least 5 malls within 200 meters, at least 5 parks, and no coffee shops.* (no exact match → ranked partial matches; click a zone to see *why*)

**Boston** (SafeGraph — has **no "mall" distance metric**; use grocery / hospital / restaurant / museum / university for distance words):
- *I'm an urban designer who cares about greenery. Find zones within 600m of a grocery store with at least 3 bars.*
- *As a tourism planner I care about tourism access. Find zones with at least 1 hotel, at least 1 museum, and at least 3 restaurants.*
- *I care about accessibility by public transit. Find zones with at least 3 restaurants and at least 1 grocery store.*
- *Find zones with at least 15 health stores, at least 10 department stores, and population over 200000.* (no exact match → ranking)

After any run, **click a zone on the map** to open its info card, use the **Consumer / ML** toggle (top-left), and the **Toggle theme** button for the dark map.

## How it works

1. **Spec generation** — your prompt → a JSON rule spec (`all_of` / `any_of` / `not` with leaf clauses like `{"metric": "cnt_bars", "op": ">=", "value": 3}`), then validated against the city's real columns.
2. **Ground-truth evaluation** — zones satisfying every constraint exactly.
3. **Ranking** — if nothing matches perfectly, all zones are scored 0–100% by partial satisfaction (formula), with optional LLM re-ranking.
4. **Context ranking** — if your prompt states a priority, the result zones are re-ranked by that dimension with LLM reasoning.
5. **Zone enrichment** — clicking a zone reverse-geocodes its centroid and fetches current weather on demand.

## Data & limitations

- **Boston has no mall/department-store *distance* column** (only grocery, hospitals, museums, restaurants, universities). "Within N metres of a mall" will fail validation there — that phrasing is Abu Dhabi-shaped.
- **Address & weather are best-effort** external calls; the card degrades gracefully if a service is slow or unreachable.
- Zone data is pre-computed in each `data/` folder — you don't need to regenerate anything to run the demos.

## Optional: using DeepSeek

If you set `DEEPSEEK_API_KEY` instead of (or in addition to) `OPENAI_API_KEY`, pick a `deepseek-chat` / `deepseek-reasoner` option in the model dropdown. With only an OpenAI key, keep the default `gpt-4o`.

## Publishing to your own GitHub

```bash
# from the repo root, on the branch you want to publish
git add .
git commit -m "Site-selection demos: zone info, context ranking, dark map, consumer/ML views"
git remote set-url origin https://github.com/<you>/<your-repo>.git   # or: git remote add origin ...
git push -u origin <branch>
```

`__pycache__/`, virtualenvs, and `.env` files are already git-ignored. Double-check no API key is hard-coded anywhere before pushing.

## Project layout

```
boston/  (and  abu_dhabi/)
├── app.py                # Flask server + API routes
├── data/                 # zones.geojson + zone_features.parquet (pre-computed)
├── src/
│   ├── rules_engine.py   # ground-truth constraint evaluation
│   ├── ranking.py        # partial-match scoring, LLM re-ranking, context ranking
│   ├── enrich.py         # address (Nominatim) + weather (Open-Meteo)
│   ├── codegen_executor.py, react_agent.py, reflexion_agent.py, agent_tools.py
│   └── ...
└── static/               # index.html, app.js, styles.css (the UI)
```
