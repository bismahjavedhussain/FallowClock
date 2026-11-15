# Fallow Clock

**Find the hole in your year.**

A corn–soybean field's year drawn as a 365-day ring: when the soil is bare,
when the erosive rain falls, and whether a cover crop can physically grow in
the gap between them.

**Live demo → <https://fallow-clock.vercel.app/>**

NASA Space Apps 2026 · [Field Shift: Adapting Farms with NASA Data](https://www.spaceappschallenge.org/2026/challenges/adapting-farms-with-nasa-data/)

---

## The finding

The assumption going in was that a Midwest field sits bare through winter.
Twenty-five years of NASA data says otherwise: last year's stubble protects
the ground all winter, and the field goes bare in **spring** — 24 Mar to
14 Jun on the Story County field, carrying **34% of the year's erosive rain**
and closing just as the 19 June erosivity peak arrives.

Cereal rye closes 41 of those bare days for $62/ha.

Switch to the second field and the answer reverses. Monona County is already
under conservation tillage, has 7 bare days a year, and the tool recommends
planting **nothing**. Every figure on screen is read from the field's data
bundle, so changing field rewrites all of them.

---

## Quick start

The data bundles are committed, so the frontend runs on its own. You do not
need Python to see the project.

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

That is the whole setup for the UI.

---

## Requirements

| | Version | Needed for |
|---|---|---|
| **Node.js** | 18+ (20+ recommended) | the frontend — this is all you need to run the app |
| **Python** | 3.10+ (developed on 3.14) | only to regenerate bundles or run the backend tests |

### Frontend dependencies

Installed by `npm install`; nothing global is required.

React 18, Vite 5, TypeScript, Zustand (state), three + @types/three (the 3D
ring), d3-shape, framer-motion, Tailwind. Vitest for tests.

### Backend dependencies

```bash
cd backend
pip install -r requirements.txt
```

- **pydantic** — the bundle contract, with `extra="forbid"`
- **numpy**, **scipy** — climatology, trends, the gap maths
- **Pillow** — only used by the `fetch_*_image.py` scripts that make the
  intro chips
- **fastapi**, **uvicorn** — only for the optional local API below
- **pytest** — tests

HTTP goes through the standard library (`urllib`, wrapped by
`fallowclock/cache.py`), so there is no `requests` dependency.

---

## Running the whole pipeline

Only needed if you are changing the model or adding a field. It fetches from
NASA POWER and Microsoft Planetary Computer, and caches responses under
`backend/cache/`.

```bash
cd backend
pip install -r requirements.txt

python scripts/export_schema.py    # schema.py  -> frontend/src/types/bundle.schema.json
python scripts/gen_vectors.py      # shared Python/TypeScript test vectors
python scripts/make_fixture.py     # -> frontend/public/bundles/farm_synthetic.json
python scripts/build_bundle.py     # -> frontend/public/bundles/farm_*.json  (hits the network)

cd ../frontend
npm run gen:types                  # JSON Schema -> src/types/bundle.ts
```

`npm run refresh:contract` does the export and the type generation in one go.

**If you change `schema.py`, you must re-run the export and `gen:types`.** The
TypeScript build then fails immediately on a renamed field instead of the UI
silently rendering `undefined`.

### Optional local API

`backend/api/main.py` is a FastAPI app that can build a bundle for an
arbitrary polygon. **The deployed site does not use it** — the frontend only
ever fetches the static JSON in `public/bundles/`.

```bash
cd backend
uvicorn api.main:app --reload      # http://127.0.0.1:8000/docs
```

---

## Tests

```bash
cd backend  && python -m pytest -q     # 159 tests
cd frontend && npm test -- --run       # 207 tests
cd frontend && npm run build           # must stay clean
```

`cropfit.py` is mirrored in `frontend/src/lib/cropFit.ts`, and both are run
against the same generated vectors — change one and the other's tests fail.
That drift guard is the reason the client-side crop fitting can be trusted.

Worth checking by hand before you trust a change: `prefers-reduced-motion`,
keyboard-only navigation, 390 px width, switching between the two fields, and
loading the deployed site with Wi-Fi off (nothing should be calling out).

---

## Layout

```
backend/
  fallowclock/
    schema.py      the contract — Pydantic, extra="forbid", exports to JSON Schema
    gaps.py        wrap-aware gap detection, phase-averaged bare days
    cropfit.py     species fitting (mirrored in frontend/src/lib/cropFit.ts)
    weather.py     NASA POWER: rainfall, temperature, frost, GDD
    erosivity.py   per-day rainfall erosivity
    soilwater.py   modelled soil moisture (Hargreaves-Samani bucket)
    trends.py      Theil-Sen slope + Mann-Kendall significance
    imagery.py     Landsat/Sentinel-2 NDVI + NDTI via STAC
    cdl.py         USDA Cropland Data Layer — which year was corn
    bundle.py      assembles it all into one farm_*.json
  scripts/         bundle builders and one-off fetchers
  tests/
frontend/
  public/bundles/  the committed farm_*.json the app reads
  src/
    App.tsx        the shell and stage machine
    components/    SatelliteIntro, FarmerIntro, SlideDeck, YearRing, soil/…
    lib/           acts, intro, cropFit, sound, speech, proposal, seasons
    types/         bundle.schema.json + generated bundle.ts
```

The only interface between backend and frontend is `bundle.json`.

---

## Data sources

| Source | NASA? | Provides |
|---|---|---|
| **NASA POWER** | yes | rainfall, temperature, frost, GDD, soil water · 9,125 days (2000–2024) |
| **NASA Landsat 8/9** | yes | green cover, crop residue · 229 clear scenes |
| Sentinel-2 L2A | **ESA** | green cover, crop residue · 481 clear scenes |
| USDA CDL | no | crop rotation history · 10 years |

NASA POWER and Landsat satisfy the challenge's NASA requirement. Sentinel-2
is ESA and is labelled as such everywhere it appears.

**Layer provenance**, shown on screen for every layer: residue is *observed*
(NDTI) · soil moisture and the water line are *modelled* (bucket balance) ·
root depth is *derived* from green cover · erosivity is *computed* from daily
rainfall and is not a true EI30.

SMAP, GPM IMERG and PRISM are **not** used. Soil moisture is a
Hargreaves-Samani bucket model on NASA POWER — `soilwater.py` explains why
SMAP was rejected (9–11 km pixels, one of which covers roughly 1,500 fields
this size).

---

## Deployment

Vercel, from `main`, with **Root Directory set to `frontend`**. Vite is
auto-detected; no environment variables are needed. Every push to `main`
redeploys.

The build output is a static site — there is no server, no database, and the
backend is not deployed.

---

## Two things that will bite you

**The year is a circle.** Gaps wrap through 31 December. Every function in
`gaps.py` is wrap-aware and tested for it; anything you add must be too.

**Don't average cover across rotation phases.** `exp(−bx)` is convex, so
running the C-factor on mean cover understates erosion (Jensen's inequality),
and bare days go through a step function, so averaging there has no
predictable sign at all. Story County reads 110 bare days off the mean curve
versus 104 phase-averaged; Monona reads **0 off the mean versus 7 real ones**.
Use the phase-averaged helpers.

---

Team and per-person setup: [TEAM.md](TEAM.md).
