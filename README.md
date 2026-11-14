# Fallow Clock

**Find the hole in your year.**

> A corn–soybean field in Iowa is bare roughly half the year, that bare window
> overlaps the spring rainfall-erosivity peak, and we can show you which cover
> crops actually fit in the hole — using only satellite data.

NASA Space Apps 2026 · [Field Shift: Adapting Farms with NASA Data](https://www.spaceappschallenge.org/2026/challenges/adapting-farms-with-nasa-data/)

Every team member should be able to recite that sentence. Everything in the
repo is judged against it. Full build plan: `~/.claude/plans/i-wanna-first-build-snappy-beaver.md`

---

## Quick start

```bash
# Backend — contract, fixture, test vectors
cd backend
pip install -r requirements.txt
python scripts/make_fixture.py        # -> frontend/public/bundles/farm_synthetic.json
python scripts/export_schema.py       # -> frontend/src/types/bundle.schema.json
python scripts/gen_vectors.py         # -> shared Python/TS test vectors
python -m pytest tests/ -q

# Frontend
cd ../frontend
npm install
npm run gen:types                     # JSON Schema -> src/types/bundle.ts
npm run dev                           # http://localhost:5173
npm test                              # drift guard: TS must match Python
npm run build
```

**Before the hackathon starts** (plan bottleneck B1 — this is the single most
common way a weekend gets lost):

```bash
pip install earthengine-api
earthengine authenticate
python backend/scripts/verify_gee.py --project YOUR_GCP_PROJECT_ID
```

Noncommercial Earth Engine registration is **not instant**. Use an
institutional email. If this does not pass before hour 0, switch to the
Planetary Computer fallback and re-plan the backend split.

---

## What exists right now

| | Status |
|---|---|
| `backend/fallowclock/schema.py` | ✅ The contract. Pydantic, self-validating. |
| `backend/fallowclock/gaps.py` | ✅ Gap detection, RUSLE C-factor, erosivity. 37 tests. |
| `backend/fallowclock/cropfit.py` | ✅ Species fitting. Mirrored in TS. |
| `backend/data/species.csv` | ⚠️ **Starting table — every row needs a real citation.** |
| `backend/scripts/make_fixture.py` | ✅ Synthetic bundle, validates against the contract. |
| `backend/scripts/verify_gee.py` | ✅ Day-0 blocker check. |
| `frontend/src/components/YearRing.tsx` | 🟡 Ring renders; drag-to-fill not built. |
| `frontend/src/lib/cropFit.ts` | ✅ 44 tests against Python-generated vectors. |
| `frontend/src/App.tsx` | 🟡 Shell with real panels; U2 to design properly. |
| **Imagery pipeline (GEE)** | ❌ **Not built.** B1's job, the critical path. |
| **Weather pipeline (POWER/IMERG)** | ❌ **Not built.** B2's job. |
| **Live API** | ❌ Not built. H24–H34. |

---

## The contract

`backend/fallowclock/schema.py` is the only interface between the two pairs.

1. Every array in `climatology` has length **365**. No nulls — signal missing
   evidence with `n_obs_per_doy = 0` and let the UI gray it out.
2. **`soil_cover` is the only field the ring reads** for bare/covered.
   `green_cover` and `residue_cover` are evidence, not classifiers.
3. The UI builds against `farm_synthetic.json` and nothing else until H14.
   The backend therefore cannot block the UI.
4. Frozen at H24.

Change the schema → run `export_schema.py` then `npm run gen:types`. A backend
field rename breaks the TypeScript build immediately instead of at hour 40.

---

## The science, in four ideas

**1. Soil cover is green *or* residue.** NDVI alone confuses dead stubble with
bare dirt, but stubble protects soil. So `soil_cover = max(green, residue)`,
with residue from NDTI (SWIR1/SWIR2). Bare is `< 0.30` — the **USDA NRCS
conservation-tillage threshold**, a real citable number, not one we invented.

**2. Erosivity on the same axis.** GPM IMERG → per-DOY rainfall erosivity.
The ranking metric is `Σ R(doy) × C(doy)` where `C = exp(−b · cover%)` is the
RUSLE surface-cover subfactor. `b` is tunable in the UI with its citation.

**3. Nothing is simulated.** To show what cereal rye would do we don't model
it — we find corn/soy fields in the same county that show a winter green
signal (CDL doesn't label cover crops; the satellite does) and take their
median curve. *"We measured 187 fields that already do this"* beats any model
parameter. Where no observed curve exists we fall back to a thermal-time ramp
and the UI labels it **modelled**, never blurring the two.

**4. Fitting is filter-and-rank, not a solver.** 12 species × ~2 gaps is
microseconds, so it runs client-side and dragging feels instant.

---

## Gotchas that will bite you

- **The year is a circle.** The gap this project is about runs October →
  May, straight through 31 December. Every function in `gaps.py` is
  wrap-aware and tested for it. Anything you add must be too.
- **Don't average cover across rotation phases.** `exp(−bx)` is convex, so
  running the C-factor on mean cover *understates* erosion (Jensen's
  inequality). Use `phase_averaged_exposed_erosivity()`.
- **Cover crops are seeded before the gap opens** — interseeded into
  senescing corn, or drilled at harvest. Fitting only inside the bare window
  makes nearly every species infeasible, which is wrong.
- **Frost doesn't kill winter-hardy species.** Rye establishes, goes dormant,
  finishes in spring. Using first frost as its deadline makes the Midwest's
  most important cover crop look impossible.
- **NDTI is moisture-sensitive** — published work shows up to 60% of the
  R² lost. Mask pixels with >3 mm IMERG rain in the prior 2 days and pixels
  with NDVI > 0.3. IMERG both drives the risk layer *and* gates the residue
  layer: that's real data fusion, and it belongs in the pitch.
- **Don't use HLS or Harmony.** HLS via stackstac is ~10× slower than
  Sentinel-2 COGs, and these collections don't support Harmony spatial
  subsetting — meaning full granule downloads.
- **SMAP is 9–11 km.** One pixel covers ~1,500 fields this size. Regional
  flag only, never a field-scale claim.
- **IMERG V07 Final stops 2025-09-30** (V08 transition), ~3.5 month latency.
  Fine for climatology; never promise current-season rainfall.

---

## Team split

| | Owns |
|---|---|
| **B1 — Pixels** | GEE auth + cache wrapper, S2/Landsat NDVI + NDTI, cloud masking, per-DOY climatology, CDL rotation, **cover-crop field detection** |
| **B2 — Weather, Model & API** | NASA POWER, IMERG erosivity, rotation scoring, **species CSV**, bundle assembly, FastAPI |
| **U1 — The Ring** | `YearRing.tsx` and nothing else |
| **U2 — Shell, Evidence & Narrative** | App shell, comparison panel, evidence cards, uncertainty, deploy, video, pitch |

Boundaries: backend ↔ frontend is **only** `bundle.json`. U1 ↔ U2 is the
Zustand store.

---

## Kill list

Cut in this order if behind. Decided now, while calm:

1. Second demo farm → 2. Live API → 3. Year-scrub playback →
4. Species 12 → 6 → 5. Residue layer (**relabel to "green cover"** so we
don't overclaim) → 6. Third rotation

**Never cut:** the ring, confidence shading, the uncertainty section, the
named farmer.

---

## Verification

Scientific sanity — run before trusting any output:

- Corn–soy in Iowa: **160–210 bare days**. 300 or 40 means the classifier broke.
- Peak erosivity in **May–June**. January means a DOY off-by-one in the IMERG join.
- Detected rye curve greens up **Oct–Nov**, terminates **Apr–May**. Flat means
  the winter-NDVI threshold is wrong.
- `green_cover ≤ soil_cover` on every DOY, by construction — asserted in the schema.
- Spot-check three dates against EO Browser by eye. **Put one side-by-side in
  the pitch** — cheapest credibility you will ever buy.

Engineering:

```bash
cd backend  && python -m pytest tests/ -q     # 37 tests
cd frontend && npm test                        # 44 tests vs Python vectors
cd frontend && npm run build
```

Plus: ring at 60 fps under 4× CPU throttle · cold-load on a phone over
cellular · **airplane-mode test** (load the deployed demo with Wi-Fi off — if
it breaks, something is still calling out).
