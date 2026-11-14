# Prior NASA Space Apps Global Winners Relevant to "Field Shift: Adapting Farms with NASA Data" (2026)

Research compiled 2026-11-14. Every link below was fetched and returned HTTP 200.

**Target challenge:** [Field Shift: Adapting Farms with NASA Data (2026)](https://www.spaceappschallenge.org/2026/challenges/adapting-farms-with-nasa-data/)

---

## How to read this

Space Apps awards exactly **10 Global Winners per year**, one per award category, chosen from ~10,000–11,500 project submissions. So in any given year only one or two winners come from an agriculture challenge. This file collects every global winner from 2020–2025 whose project is agriculture-adjacent, grouped by how closely it maps onto Field Shift.

**Tier 1** = same challenge lineage (an actual NASA agriculture challenge).
**Tier 2** = different challenge, but the method is what Field Shift is asking for (Earth-observation → decision support for land/water managers).
**Tier 3** = worth a look for approach, framing, or presentation craft.

---

## Tier 1 — Direct lineage: agriculture challenges

Field Shift is the third year of an agriculture thread. Its two predecessors:

- 2024: [Leveraging Earth Observation Data for Informed Agricultural Decision-Making](https://www.spaceappschallenge.org/nasa-space-apps-2024/challenges/leveraging-earth-observation-data-for-informed-agricultural-decision-making/)
- 2025: [NASA Farm Navigators: Using NASA Data Exploration in Agriculture](https://www.spaceappschallenge.org/2025/challenges/nasa-farm-navigators-using-nasa-data-exploration-in-agriculture/)

### 🏆 GaamaRamma — "Waterwise" (2024, Best Use of Data)

- **Project page:** https://www.spaceappschallenge.org/nasa-space-apps-2024/find-a-team/gaamaramma/?tab=project
- **Challenge:** Leveraging Earth Observation Data for Informed Agricultural Decision-Making
- **Country:** Universal Event, United States
- **Team:** Aakash H., Arun G., Arthur A., Gabriel A., May K.

A tool to help farmers efficiently manage water availability in the face of drought, pests, and disease. In the team's own words: "our world is riddled with several environmental issues such as flooding, droughts, and forest fires that increase water scarcity. This is an issue that severely impacts farmers so our goal was to tackle this by developing WaterWise, a product that assists in efficiently managing water for their farm."

> **Why it matters for Field Shift:** this is the closest precedent that exists — same data, same user, and it took the *data* award rather than a storytelling one. Note the scope discipline: one decision (water management), done well.

### 🏆 NVS-knot — "2plant | ! 2plant" (2024, Galactic Impact)

- **Project page:** https://www.spaceappschallenge.org/nasa-space-apps-2024/find-a-team/nvs-knot/?tab=project
- **Challenge:** Leveraging Earth Observation Data for Informed Agricultural Decision-Making
- **Country:** Kyiv, Ukraine
- **Team:** Oksana M., Oleksandra M., Prokipchyn Y., Val K.

Assessed planting conditions using **surface soil moisture from SMAP** and **evapotranspiration from OpenET**, then built an app that lets farmers manage planting risk.

> **Why it matters for Field Shift:** the exact dataset pairing the 2026 brief recommends (SMAP + ET), aimed at a single binary farmer decision — plant or don't. The "2plant | ! 2plant" framing is a good lesson in scoping an EO pipeline down to one actionable output.

### 🏆 Zumorroda-X — "Henry's Farm Adventures" (2025, Art & Technology)

- **Project page:** https://www.spaceappschallenge.org/2025/find-a-team/zumorroda-x/?tab=project
- **Live demo:** https://henrysfarmadventures.vercel.app/
- **Video:** https://drive.google.com/file/d/1P-sOTecG2uO2eLu3UabS0PXWLYUKaF4p/view?usp=sharing
- **Code:** https://github.com/esralsayed/test_farmy
- **Challenge:** NASA Farm Navigators: Using NASA Data Exploration in Agriculture
- **Country:** Egypt
- **Team:** Alaa A., Esraa A., Malak S., Mennatulla E.

A game, not a dashboard. Players follow Henry, a struggling farmer, on a journey around the world guided by real NASA satellite data, meeting farmers on the frontlines of climate change — Bilal in Pakistan during the 2022 floods, Ramesh in India during heatwaves. Mini-games turn each climate stress into a hands-on mission.

Data they cited: NASA Earth Observatory, NASA Harvest (GLAM), Extreme Heat Data Pathfinder, Floods Data Pathfinder (IMERG), Agriculture and Water Management Pathfinder, U.S. Drought Monitor.

> **Why it matters for Field Shift:** proof that the agriculture challenge can be won without building an analytics tool at all. It won Art & Technology — the judges rewarded making the data *felt*. Field Shift explicitly calls for farmer-centered design and interpretability, so this is a live option.

---

## Tier 2 — Same method, different subject

These are Earth-observation decision-support tools for land and water. Structurally they're what Field Shift asks for.

### 🏆 Project L.L.O.C.U.S.T. (2020, Galactic Impact) — **strongest methodological template**

- **Project page:** https://2020.spaceappschallenge.org/challenges/inform/automated-detection-hazards/teams/project-llocust-1/project
- **Challenge:** Automated Detection of Hazards
- **Country:** Universal Event

Locust Location, Obliteration, and Coordination Using Satellites and Tidings. An ML model trained on wind, humidity, surface temperature and vegetation index from **SMAP** and **Terra (MODIS, ASTER)**, producing a heat map of locust infestation risk plus a wind-driven forecast of where a swarm travels next — rendered as an interactive multi-layer Leaflet map with population density and farmland overlays.

Stack: Python data pipeline (Pandas, rasterio) pulling from NASA Worldview; scikit-learn Random Forest + SVC; Leaflet.js, Leaflet.Heat, a modified leaflet-velocity for wind. Training labels came from the FAO Locust Hub, with randomly sampled negative locations.

> **Why it matters for Field Shift:** this is almost a blueprint. Same satellites, same "harmonize several EO sources into one risk surface, then put it on a map a non-technical person can read" shape. Read their write-up in full — they're unusually candid about the hard parts (12+ hours fighting Worldview exports, GeoTIFF wrangling, and a Random Forest hitting a suspicious 100% test accuracy on ~200 samples, which they flag themselves). The 2026 brief's emphasis on explaining uncertainty and information gaps is exactly that failure mode.

### 🏆 QUEÑARIS (2025, Local Impact)

- **Project page:** https://www.spaceappschallenge.org/2025/find-a-team/watana-project/?tab=project
- **Live demo:** https://quenaris.vercel.app
- **Video:** https://youtu.be/QvbLhHqKULc
- **Challenge:** BloomWatch: An Earth Observation Application for Global Flowering Phenology
- **Country:** Peru

A decision-support system for large-scale reforestation of queñua forests, addressing water scarcity in Arequipa. Combines drone orthomosaics, NASA LP DAAC satellite data (NDVI, EVI, NDMI), native microorganisms, and an AI model that identifies optimal planting areas, then monitors phenology and ecosystem health over time.

> **Why it matters for Field Shift:** the clearest example of fusing coarse satellite data with fine local ground data to drive a planting decision — which is precisely the data-harmonization problem Field Shift names. Also note how hard they tie the work to a named local stakeholder problem (spring flow dropping from 14 L/s to 0) rather than a generic one.

### 🏆 Ani's Cuff — "de Bugger" (2021, Best Use of Science)

- **Project page:** https://2021.spaceappschallenge.org/challenges/statements/seeing-the-unseeable-viewing-bugs-from-space/teams/anis-cuff/project
- **Live demo:** https://debugger.vercel.app/
- **Video:** https://www.youtube.com/watch?v=gePuvUXV4iU
- **Challenge:** Seeing the Unseeable – Viewing Bugs from Space
- **Country:** Taipei, Taiwan

A U-Net CNN that infers insect biodistribution across time, space and species from four Earth observations (elevation, precipitation, land cover, vegetation) plus a "bio-vector" preserving cross-species relationships. Built to serve regions that *lack* local occurrence data, using Taiwan's eDNA records as a proxy.

> **Why it matters for Field Shift:** Field Shift asks about rotations that "interrupt pest cycles." This is the only winner that models insects from EO data. The transfer-learning framing — train where you have ground truth, predict where you don't — maps directly onto the brief's concern about information gaps.

### 🏆 Landslide Detection Squad (2021, Local Impact)

- **Project page:** https://2021.spaceappschallenge.org/challenges/statements/identifying-risk-with-science-communities/teams/landslide-detection-squad/project
- **Code:** https://github.com/rociopey/landslidedetectionsquad
- **Video:** https://youtu.be/gvxFAl7jtqc
- **Challenge:** Identifying Risk with Science + Communities
- **Country:** Perth, Australia

Detects canopy movement on forested slopes as a landslide precursor, using high-resolution imagery and deep-learning tree detection, feeding dynamic risk maps and alerts for government agencies. Their write-up explicitly covers the effect on farmers: blocked land access for years, destroyed seed and food stocks, lost livestock and standing crops.

> **Why it matters for Field Shift:** terrain-driven risk mapping — the SRTM/slope/erosion half of the 2026 brief — and a clean example of going from a detection model to an alerting system with a named institutional user.

### 🏆 Twisters — "SkySense" (2025, Best Use of Technology)

- **Project page:** https://www.spaceappschallenge.org/2025/find-a-team/twisters/?tab=project
- **Challenge:** Will It Rain on My Parade?
- **Country:** Mexico

A pipeline that blends multiple NASA Earth observation sources, cleans them, and converts them into clear probability metrics — rain, wind, temperature, humidity, visibility — with real-time risk assessments and recommended time windows.

> **Why it matters for Field Shift:** the best recent example of turning messy multi-source EO data into *probabilities a layperson can act on*. The 2026 brief wants rotation strategies compared with evidence and risk stated; this is the presentation pattern.

### 🏆 AsturExplorers — "Landsat Connect" (2024, Best Mission Concept)

- **Project page:** https://www.spaceappschallenge.org/nasa-space-apps-2024/find-a-team/asturexplorers/?tab=project
- **Challenge:** Landsat Reflectance Data: On the Fly and at Your Fingertips
- **Country:** Gijón, Spain

Web app to track Landsat satellites and access surface reflectance data, with overpass notifications for a target location.

> **Why it matters for Field Shift:** Landsat is on the 2026 resource list. This shows an award can go to solving *data access* elegantly rather than modeling.

---

## Tier 3 — Adjacent, useful for framing

| Team | Year / Award | Challenge | Link |
|---|---|---|---|
| Team I.O. — G.R.O.W. | 2024, Local Impact | Community Mapping — bridging GIS data and plain-language communication for non-technical users | [project](https://www.spaceappschallenge.org/nasa-space-apps-2024/find-a-team/team-io/?tab=project) |
| TeamVoyagers | 2023, Best Storytelling | Everything Starts with Water — interactive game on the water cycle and climate impact on freshwater | [project](https://www.spaceappschallenge.org/2023/find-a-team/team-voyagers/?tab=project) |
| $quality_over_quantity | 2023, Local Impact | Explore a Biodiversity Hotspot with Imaging Spectroscopy — prioritizing areas for protection | [project](https://www.spaceappschallenge.org/2023/find-a-team/quality_over_quantity/?tab=project) |
| 4 Seeds — "Infinipod" | 2021, Galactic Impact | Have Seeds Will Travel — aeroponic grow pod, 98% water saving, with a data app for cultivation methods | [project](https://2021.spaceappschallenge.org/challenges/statements/have-seeds-will-travel/teams/4-seeds/project) |
| Monsoon Overflow | 2020, Best Use of Data | Flood-related challenge, India | [project](https://2020.spaceappschallenge.org/challenges/confront/flood-ideas/teams/monsoon-overflow) |

---

## Official winner indexes, by year

| Year | Global Winners page | NASA announcement |
|---|---|---|
| 2025 | [Meet the 2025 Global Winners](https://www.spaceappschallenge.org/2025/meet-the-2025-global-winners/) · [awards](https://www.spaceappschallenge.org/2025/awards/global-winners/) | [nasa.gov](https://www.nasa.gov/learning-resources/stem-engagement-at-nasa/nasa-announces-2025-international-space-apps-challenge-global-winners/) |
| 2024 | [awards](https://www.spaceappschallenge.org/nasa-space-apps-2024/awards/global-winners/) | [nasa.gov](https://www.nasa.gov/learning-resources/stem-engagement-at-nasa/nasa-international-space-apps-challenge-announces-2024-global-winners/) |
| 2023 | [awards](https://www.spaceappschallenge.org/2023/awards/global-winners/) | [science.nasa.gov](https://science.nasa.gov/directorates/smd/2023-nasa-international-space-apps-challenge-announces-10-global-winners/) |
| 2022 | [2022 Global Winners blog](https://www.spaceappschallenge.org/blog/2022-global-winners/) | [earthdata.nasa.gov](https://www.earthdata.nasa.gov/news/2022-space-apps-challenge-winners) |
| 2021 | [Meet the 2021 Global Winners](https://www.spaceappschallenge.org/blog/meet-the-2021-global-winners/) · [2021 archive](https://2021.spaceappschallenge.org/awards/) | [earthdata.nasa.gov](https://www.earthdata.nasa.gov/news/nasa-announces-2021-international-space-apps-challenge-global-award-winners) |
| 2020 | [2020 archive](https://2020.spaceappschallenge.org/awards/) | [earthdata.nasa.gov](https://www.earthdata.nasa.gov/news/2020-space-apss-challenge-winners) |

Note: **2022 had no agriculture-related global winner.** That year's ten went to solar storms, wildfire smoke chemistry, Mars habitats (×2), moonquakes (×2), stellar variability, STEAM outreach, ISS tracking, and a space-weather IoT device.

Coverage gap: 2019 and earlier aren't included — those award pages are no longer served on the current site or the year archives, and the award-category structure was different before 2020.

---

## What actually wins — patterns across these projects

1. **One decision, named precisely.** "2plant | ! 2plant." "Will it rain on my parade?" "Where will the swarm fly next?" None of the winners built a general-purpose Earth data browser. Field Shift invites you to compare ≥3 rotation strategies — treat that as the one decision.

2. **A named user in a named place.** QUEÑARIS cited Arequipa's spring flow collapsing from 14 L/s to zero. L.L.O.C.U.S.T. cited $8.5bn of East African damage and 20 million people food-insecure. Zumorroda-X named Bilal in Pakistan and Ramesh in India. Generic "farmers worldwide" framing does not appear in this list.

3. **Data fusion is the technical centerpiece.** Every Tier-1/Tier-2 winner combined at least two sources at different resolutions — SMAP + OpenET, MODIS + SMAP + FAO ground truth, drone + LP DAAC. The 2026 brief calls this out directly (harmonizing to a common analysis grid), so it's being explicitly judged.

4. **There is always a working artifact.** Vercel deployments, a GitHub repo, a demo video. Several of the live links above still resolve years later.

5. **Honesty about limits is rewarded, not penalized.** L.L.O.C.U.S.T. flagged its own implausible 100% accuracy and its unfinished economic-cost feature, and still took Galactic Impact. Field Shift asks explicitly for "where information gaps exist" and "risks that would need local review" — that section is scored, so write it properly rather than hedging.

6. **Ten award categories means ten different ways to win.** An illustrated farming game (Art & Technology) and a SMAP/ET planting-risk model (Galactic Impact) both won from agriculture challenges. Pick the category your team's actual strengths fit, and build for that.
