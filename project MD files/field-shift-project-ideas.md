# Field Shift 2026 — Five Project Directions

Five candidate builds for [Field Shift: Adapting Farms with NASA Data](https://www.spaceappschallenge.org/2026/challenges/adapting-farms-with-nasa-data/). Each is deliberately aimed at a different award category, so picking one is a strategy choice, not just a feature choice.

All five assume the same spine: a global engine that works anywhere from NASA/ESA data alone, demoed on one named farm in one named place. All five compare three rotation strategies, including the farmer's current one.

---

## 1. CORE MEMORY
### *What the land remembers*

**Overview.** The hero visual is a soil cross-section — side-on, not a map. You scrub a 20-year timeline and watch the root zone breathe: moisture pulsing in and out, the organic matter layer thickening or thinning, topsoil shaved away by individual storm events, root depth changing with each crop. Then the view splits into three parallel cores — the current rotation beside two alternatives — and runs forward ten years under identical weather.

**Data.** SMAP (root-zone soil moisture) · SoilGrids / SSURGO (texture, organic matter, water-holding capacity) · SRTM (slope → erosion risk) · GPM IMERG (rainfall erosivity) · ECOSTRESS + OpenET (evapotranspiration demand) · Landsat / Sentinel-2 NDVI (canopy vs bare soil) · NASA POWER (growing degree days, frost dates).

**Execution.** Draw a field polygon, harmonize every source onto one ~250 m analysis grid. A defensible soil-state model underneath: water balance, RUSLE-style erosion, organic matter accrual from residue and root inputs, driven by observed weather with crop coefficients from a lookup table. Render the profile in SVG or Canvas with layered textures.

**Why it wins.** Every other team will ship a choropleth map. Nobody shows soil from the side. It makes an invisible, decade-slow process legible in about three seconds — which is exactly what a judge scanning fifty projects responds to.

**Creative angle.** The cores read almost geologically, like tree rings. Let people drag down through the profile to dig. A low pulse of sound on each rain event. The three cores diverging over time is the entire argument of the project, told without a single sentence.

---

## 2. FALLOW CLOCK
### *Find the hole in your year*

**Overview.** A radial year-ring: 365 days around a circle, green where canopy covers the soil, brown where it's bare — reconstructed from satellite history, not assumed. Over the bare arcs sit the dangerous things: rainfall erosivity spikes, heat-stress days, frost windows. The risky gaps light up. Then candidate cover crops snap into those gaps like puzzle pieces, each sized by its real growing window.

**Data.** Landsat + Sentinel-2 + MODIS NDVI time series (bare-soil detection) · GPM IMERG (erosivity by day of year) · NASA POWER / PRISM (degree days, frost, heat stress) · SMAP (moisture at the planting window) · Cropland Data Layer (what's actually grown there now).

**Execution.** Stack several years of NDVI, take a per-day-of-year median canopy cover, classify bare vs covered. Join erosivity and heat on day-of-year. Crop fitting becomes a small constraint solve: can crop X germinate, grow and terminate inside this gap on the available thermal and moisture budget?

**Why it wins.** The brief explicitly asks you to highlight when fields are typically bare — and most teams will skim past it. This answers it head-on, and the ring is legible instantly. A judge understands the problem before you finish your first sentence.

**Creative angle.** Rotation planning becomes a calendar puzzle instead of a spreadsheet. Drag crops into the year and watch the ring close. The satisfaction of filling the gap is the product.

---

## 3. GREENBRIDGE
### *Break the chain*

**Overview.** The "green bridge" is the continuity of living host plants that lets pests and pathogens survive between seasons — and breaking it is the oldest reason farmers rotate at all. Visual: a chain of seasons stretching across years, each link a crop. Pest pressure glows brighter along runs of repeated hosts. Insert a non-host crop and the link snaps; the glow drops away.

**Data.** NASA POWER (degree-day accumulation for pest generations, overwintering survival) · Landsat / Sentinel-2 NDVI (green-bridge continuity — is anything living out there between cash crops?) · SMAP + ECOSTRESS (moisture and humidity favouring fungal pathogens) · Cropland Data Layer (host-crop density in neighbouring fields) · GLDAS / ERA5 (soil temperature for overwintering).

**Execution.** A degree-day phenology model per pest, a host / non-host matrix, and a pressure index that climbs with consecutive host seasons and falls with breaks. Calibrate against published degree-day thresholds, and be loud about where the model is guessing.

**Why it wins.** This models a real biological mechanism rather than correlating NDVI with vibes — which is how the science award is actually won. In six years of global winners only one project has gone near pest modelling from Earth observation data. The lane is effectively empty.

**Creative angle.** The snapping chain is genuinely satisfying to trigger. The surprise is the neighbourhood effect: your rotation is only as good as the green bridge around you. Showing a farmer that their neighbour's field is their problem too is the kind of insight people repeat afterwards.

---

## 4. DRAWDOWN
### *The account nobody is balancing*

**Overview.** A bank statement for water. Deposits: rainfall, irrigation. Withdrawals: evapotranspiration, runoff. And the balance — the aquifer underneath, falling year on year. Three rotations become three columns in the ledger, each with a running balance and a projected date the account empties.

**Data.** GRACE / GRACE-FO (long-term terrestrial water storage trend) · GPM IMERG (precipitation input) · ECOSTRESS + OpenET (field-scale evapotranspiration) · SMAP (soil water store) · NASA POWER (reference ET) · SRTM (runoff routing) · USGS NWIS (groundwater and streamflow for validation).

**Execution.** A field-scale water balance, with GRACE supplying the regional long-term context that explains why a locally fine season still belongs to a regionally bad decade. Rank rotations by water debt per unit of value produced.

**Why it wins.** GRACE is on the official resource list and will be badly under-used, because at ~300 km resolution it looks useless for a single field. Turning that limitation into the point — local decisions sitting inside a regional decline nobody can see from the ground — is the kind of move that reads as sophisticated rather than clever.

**Creative angle.** The overdraft framing. A rotation that *pays water back*. The moment the balance crosses into red, rendered like a bank alert. Hydrology lands with anyone when it's shaped like money.

---

## 5. SECOND OPINION
### *Three advisors who disagree*

**Overview.** A Hydrologist, a Soil Scientist and a Market Analyst each rank the same three rotations from their own data — and openly contradict each other. Every claim is a card you can flip: here is my evidence, here is my confidence, here is what I don't know, here is what to ask your local extension agent. The farmer sets the weights and makes the call.

**Data.** One shared stack, read three ways. Hydrologist: SMAP, ECOSTRESS, GPM, GRACE. Soil Scientist: SoilGrids, SRTM, Landsat residue cover. Market Analyst: USDA AMS Market News, NASS QuickStats, FAO GAEZ suitability.

**Execution.** One shared feature layer, three independent scoring functions, one disagreement view. Explanations are templated from the actual feature values rather than written by a language model, so every sentence traces back to a number. Confidence drops automatically wherever the input data is sparse or coarse.

**Why it wins.** The brief insists the tool support rather than replace farmer judgment, and asks for reasoning, evidence, gaps and risks behind every suggestion. Most teams will bury that in a paragraph at the bottom. This makes it the entire interface. Disagreement is honest, and honesty has historically scored well here.

**Creative angle.** Conflict as a feature, not a bug. Plus a low-bandwidth mode: the same three opinions delivered as three SMS messages, for farmers with no broadband at all.

---

## Where I'd lean

**Core Memory** as the shell, **Fallow Clock** as its second view, borrowing **Second Opinion**'s evidence cards for the explanation layer. That combination covers everything the brief asks for and gives us two visuals people will remember. Open to being argued out of it.

---

## Splitting the build across four

| Role | Owns |
|---|---|
| **Data & pipeline** | Area of interest → harmonized raster stack on one common grid. Caching. One clean JSON contract handed to the frontend. |
| **Model & analytics** | Soil / water / pest scoring, the three-rotation comparison, uncertainty flags. |
| **Hero visual** | The cross-section, ring or chain. Builds nothing else — this is the project's face. |
| **Narrative, UX & demo** | The named farmer and their place, plain-language science captions, the 30-second video, the pitch. |

Two rules worth agreeing up front: the pipeline freezes by hour 24, and we never hit a live NASA endpoint during the demo.
