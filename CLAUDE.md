# Fallow Clock — project context

**NASA Space Apps 2026 · "Field Shift: Adapting Farms with NASA Data"**

This file is loaded automatically at the start of every session. Read it
before doing anything else; it is the memory that survives a compaction.
Keep it updated when something here stops being true.

---

## 1. Standing instructions from the user — do not violate these

| Rule | Detail |
|---|---|
| **Git identity** | Commit and push only as `bismahjavedhussain <bismahjavedhussain@gmail.com>`. **Never** use the Stanford address (`swaheed@stanford.edu`) anywhere — not in commits, files, or history. It has been scrubbed twice already. |
| **Never push the plan docs** | The three files in `project MD files/` stay untracked and local. Stated twice. They are deliberately excluded from every commit. |
| **Ask before pushing** | The user delegates git ("I don't know how to use github, you'll push for me"), but confirm before anything that reaches the remote or other people's branches. |
| **No skip buttons in the intro** | The opening sequence is deliberately unavoidable. The user overrode the "never trap a judge" advice twice. Do not re-add a skip. |
| **Sound is always on** | No "begin without sound" option. One Begin click only, because browsers require a user gesture before audio. |

---

## 2. What the project is

A corn–soybean field's year drawn as a 365-day ring: when the soil is bare,
when the erosive rain falls, and whether a cover crop can physically grow in
the gap between them.

**The finding (this is the pitch):** the thesis was "a field is bare half the
year, through winter." Real satellite data says otherwise. Last year's stubble
protects the ground all winter; the field goes bare in **spring**, 24 Mar to
14 Jun, carrying **34% of the year's erosive rain**, closing just as the 19 Jun
peak arrives. Same conclusion, stronger evidence.

**Second field, opposite answer.** Monona County is already conservation
tillage and the tool says *do nothing*. That contrast is the strongest thing
in the project — a tool that refuses to invent a recommendation.

---

## 3. The honesty rules — the spine of this project

These are not style preferences. Breaking any one of them is the fastest way
to lose the data award, and several have already been caught and fixed.

1. **Never claim a data source we do not use.** SMAP, GPM IMERG and PRISM are
   NOT used. Four stale SMAP labels were found and removed, including the
   TypeScript mirror that told users "soil moisture too low (SMAP, coarse)".
   `soil_moisture` is a Hargreaves-Samani bucket model on NASA POWER.
2. **`n_obs == 0` means UNKNOWN, never bare.** No erosion flecks, no dust, no
   bare-day count on a day no satellite saw. There are tests for this.
3. **Label observed vs modelled vs derived**, every time, on screen.
4. **No organic-matter accrual.** Asked for three times; there is no data for
   it and projecting soil carbon from a planting decision is unverifiable.
5. **Never hardcode a number the bundle carries.** Switching farms must
   rewrite every figure and every sentence. Tests assert this.
6. **Jensen's inequality applies twice.** Averaging cover then thresholding is
   not the same as thresholding then averaging. Erosivity goes through a
   convex `exp(-bx)` so the bias has a known sign; bare days go through a step
   function so it does **not**. Story reads 110 from the mean vs 104
   phase-averaged; Monona reads **0 from the mean vs 7 real bare days**.

---

## 4. Current state

```
branch:  ui-experiment   (local only, never pushed)
commit:  9f1b749  "Cinematic UI: entry, narrated descent, farmer brief, zero-scroll deck"
safety:  known-good-v1 tag -> 3058866   (restore point, pushed)
remote:  origin/main -> 4e6a64a  (Kaif's U2 shell, NOT yet merged)
tests:   133 backend (pytest) + 149 frontend (vitest), build clean
dev:     http://localhost:5173
```

There are uncommitted changes on top of `9f1b749` (phase toggle, data
receipts, skip-typing fix, scene restore). Commit them before anything risky.

### A second worktree exists

`D:\FallowClock-u2` is a git worktree on `origin/main` so Kaif's version can
run side by side (port 5180). Its `node_modules` is a junction to the main
one. Remove with `git worktree remove ../FallowClock-u2` when finished.

---

## 5. The two farms

| | Story County, IA | Monona County, IA (Loess Hills) |
|---|---|---|
| Size | 39.3 ha, 5 km NE of Ames | 14.9 ha |
| Tillage | reduced (17% residue) | conservation (43% residue) |
| Bare days | **104/yr** — 112 after soybean, 96 after corn | **7/yr** — 14 after corn, 0 after soybean |
| Biggest gap | 24 Mar – 14 Jun, 34% of annual erosive rain | 28 May – 3 Jun, 3% |
| Erosivity peak | 19 Jun (5 days AFTER the gap closes) | 12 May |
| Verdict | cereal rye, **−26.9%**, $62/ha | **nothing worth seeding** |

⚠ **Do not say "straight through the peak" for Story.** The 30-day peak window
centres 5 days *after* the gap ends. The code says "closing just as the peak
arrives" and there is a test enforcing it.

⚠ Story's bare-day count has a **40–203 sensitivity band** for a ±0.02 NDTI
endmember shift. Surface the range, never the bare 104.

---

## 6. Data sources — what is real

| Source | NASA? | Gives |
|---|---|---|
| **NASA POWER** | yes | rainfall, temperature, frost, GDD, soil water · 9,125 days (2000–2024) |
| **NASA Landsat 8/9** | yes | green cover, crop residue · 229 clear scenes |
| Sentinel-2 L2A | **ESA** | green cover, crop residue · 481 clear scenes |
| USDA CDL | no | which year was corn, which soybeans · 10 years |

NASA POWER + Landsat satisfy the challenge's NASA requirement. Sentinel-2 is
ESA and must always be labelled so.

**Layer provenance:** residue = observed (NDTI) · soil moisture and water line
= MODELLED (bucket balance) · root depth = DERIVED from green cover · erosivity
= computed from daily rainfall (not true EI30).

---

## 7. Architecture

### Backend (`backend/`, Python 3.14, owned by the user = "B2")
- `fallowclock/schema.py` — **the contract**. Pydantic, `extra="forbid"`.
  Exports to `bundle.schema.json` → `bundle.ts`.
- `gaps.py` — wrap-aware gap detection, phase-averaged bare days/erosivity.
- `cropfit.py` — species fitting. **Mirrored in `frontend/src/lib/cropFit.ts`**;
  shared test vectors guard the drift. Change one, change both.
- `weather.py` `erosivity.py` `soilwater.py` `rotations.py` `bundle.py`
- `imagery.py` `cdl.py` `stac_client.py` — B1's satellite pipeline.
- `scripts/build_bundle.py` — writes `frontend/public/bundles/farm_*.json`
- `scripts/fetch_field_image.py` — Sentinel-2 chips for the intro.

### Frontend (`frontend/`, React 18 + TS + Vite)
Experience order: **entry gate → satellite descent (narrated) → farmer brief
(typed) → 4-act zero-scroll deck**.

Key files: `App.tsx` (the shell, heavily rewritten), `SlideDeck.tsx`,
`SatelliteIntro.tsx`, `FarmerIntro.tsx`, `FarmerGuide.tsx`, `FarmerDiary.tsx`,
`soil/SoilCutaway.tsx` + `rootGeometry.ts`, `soil/SplitCore.tsx`,
`YearRing.tsx` (U1's), `PhaseToggle.tsx` (from Kaif), `FieldNotes.tsx`.
Libs: `acts.ts` `intro.ts` `guide.ts` `sound.ts` `speech.ts` `sources.ts`
`cropFit.ts` `proposal.ts` `atmosphere.ts` `seasons.ts`.

---

## 8. Traps that have already cost time

1. **Bash heredocs eat backslashes.** `\b` became a literal 0x08 byte and
   `\\n` became a real newline, silently breaking regexes and f-strings.
   **Write patch scripts with the Write tool and run them**, never inline
   heredocs when the content has backslashes or template literals.
2. **Slicing CSS by index.** Twice: once the indices inverted and duplicated a
   region, once the slice ran to EOF and deleted the entry gate styles.
   Always assert `end > start`, and audit selectors afterwards.
3. **Vite watcher EBUSY.** Took the dev server down three times when sprite
   folders were added or deleted. `vite.config.ts` now ignores
   `FarmerAnimations/`, `A_friendly_young_farmer*/`, `Idle/` and archives.
4. **Vite transform cache can serve an EMPTY stylesheet** after hours of HMR
   through big rewrites. Symptom: raw unstyled HTML. A browser refresh will
   NOT fix it. Kill node by port, `rm -rf node_modules/.vite`, restart with
   `--force`.
5. **`TaskStop` kills the npm wrapper, not the node child.** Kill dev servers
   by port with PowerShell `Get-NetTCPConnection`.
6. **Satellite scenes must be checked for coverage, not just cloud.** A scene
   "intersects" a bbox if it touches it; the least cloudy Monona candidate
   covered 48% and left the rest black. `read_block` returns a data mask as
   its last band — use it.
7. **Per-band percentile stretch destroys colour.** Stretching R, G and B to
   their own percentiles normalises away the ratios that *are* colour; June
   corn came out magenta. Use one shared scale.

---

## 9. Verify

```bash
cd backend  && python -m pytest -q          # 133
cd frontend && npm test -- --run            # 149
cd frontend && npm run build                # must stay clean
cd frontend && npm run dev                  # localhost:5173
cd frontend && npm run sync:sprites         # re-publish sprite drops
grep -rn "SMAP" backend/fallowclock frontend/src   # only the rejection rationale
```

By hand: `prefers-reduced-motion`, keyboard-only, 390 px wide, switch farms,
airplane mode.

---

## 10. The team

| | Who | Owns |
|---|---|---|
| B2 | **the user** (bismahjavedhussain) | backend model, contract, integration |
| B1 | M-Kaif-Malik | satellite imagery pipeline; also pushed the U2 shell |
| U1 | Saad Muhammad Khan | `YearRing.tsx`, `YearRing3D.tsx` |
| U2 | Sheikh Muneeb Ahmed | seasonal scene, audio atmosphere, time lever |

---

## 11. Outstanding

- **Merge Kaif's U2 shell** (`origin/main`, 4e6a64a). 4 files conflict —
  `App.tsx` severely, `FieldNotes.tsx` add/add, plus `index.css` and
  `CropPlanner.tsx`. **Do not run `git merge`.** Take his clean additions
  (`lib/bundle.ts`, `lib/metrics.ts` with `pyRound`, `ErrorBoundary.tsx`) and
  re-wire by hand. `PhaseToggle.tsx` is already taken.
- Name a real farmer — both bundles still say `TBD`.
- Decide on `ParallaxField.tsx`: built, tested, currently **unmounted** after
  the user reverted to the illustrated scene.
- The species table is unverified (`verified=false` on every row).
- `earthengine-api` is still in `requirements.txt` but GEE was dropped.

### ⚠ Remove before submission

`SatelliteIntro.tsx` has a **click-anywhere-to-skip** on the descent, added
purely so the 22-second opening need not be sat through on every reload
during development. It contradicts the standing "the intro is unavoidable"
rule in §1. Delete the `skip` callback and the `onClick` on the root
element — both are commented `TESTING`, and nothing else depends on them.
