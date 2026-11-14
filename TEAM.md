# Team setup — read this first

Four people, one repo, two folders. **Everyone clones the whole thing**, even
if you only touch half of it: the frontend reads files the backend generates,
and the test suite that keeps us honest spans both.

---

## 1. Get the code

```bash
git clone <REPO_URL>
cd NASASpaceApps
```

### If you are on the frontend (U1, U2)

You do **not** need Python. Everything the UI reads is committed:

- `frontend/public/bundles/farm_synthetic.json` — the fixture you build against
- `frontend/src/types/bundle.ts` — types generated from the backend contract
- `frontend/src/lib/__vectors__.json` — shared test vectors

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
npm test         # 44 tests
```

You should see the ring, three rotations, and a red SYNTHETIC banner. That
banner means the data is fake — it disappears when real bundles land at H14.

### If you are on the backend (B1, B2)

```bash
cd backend
pip install -r requirements.txt
python -m pytest -q                # 37 tests
python scripts/make_fixture.py     # regenerate the fixture
```

---

## 2. Branches

One branch per person. You own it; nobody else pushes to it.

| Branch | Who | Owns |
|---|---|---|
| `main` | everyone | Always working. Never commit directly. |
| `b1-pixels` | B1 | Satellite imagery pipeline |
| `b2-model` | B2 | Weather, scoring, species table, API |
| `u1-ring` | U1 | The ring, and nothing else |
| `u2-shell` | U2 | Shell, panels, evidence, deploy, video |

### The only four commands you need

```bash
git checkout b1-pixels            # your branch (once)

# ... do work ...

git add -A
git commit -m "what you did"
git push
```

### Getting other people's work

```bash
git checkout main && git pull     # get latest main
git checkout b1-pixels            # back to yours
git merge main                    # pull their work into yours
```

**Do this every few hours.** Merging often means small, easy conflicts.
Merging once at hour 40 means a crisis.

### Putting your work into main

```bash
git checkout main
git pull
git merge b1-pixels
git push
git checkout b1-pixels            # go back to your branch
```

Before you merge into `main`, your side's tests must pass:
`python -m pytest -q` (backend) or `npm test && npm run build` (frontend).

### If something goes wrong

Do not panic and do not `git reset --hard`. Your work is almost certainly
recoverable. Say what the error was in the group chat before typing anything
else.

---

## 3. Who owns which file

Conflicts happen when two people edit the same file. We have arranged it so
that almost never happens. Stay inside your column.

| B1 — Pixels | B2 — Weather/Model/API |
|---|---|
| `backend/fallowclock/imagery.py` *(new)* | `backend/fallowclock/weather.py` *(new)* |
| `backend/fallowclock/stac_client.py` *(new)* | `backend/fallowclock/erosivity.py` *(new)* |
| `backend/fallowclock/cache.py` *(new)* | `backend/fallowclock/rotations.py` *(new)* |
| `backend/fallowclock/cdl.py` *(new)* | `backend/fallowclock/bundle.py` *(new)* |
| | `backend/data/species.csv` |
| | `backend/api/main.py` *(new)* |

| U1 — Ring | U2 — Shell |
|---|---|
| `frontend/src/components/YearRing.tsx` | `frontend/src/App.tsx` |
| `frontend/src/components/RingLegend.tsx` *(new)* | `frontend/src/components/*` (everything else) |
| | `frontend/src/store.ts` |

### Shared files — speak up before you edit

- `backend/fallowclock/schema.py` — **the contract.** Changing it changes
  everyone's work. Announce it. After H24 it is frozen.
- `backend/fallowclock/cropfit.py` + `frontend/src/lib/cropFit.ts` — the same
  logic in two languages. **Change both, then run
  `python scripts/gen_vectors.py`.** The tests will tell you if they disagree.

---

## 4. The two rules that matter

**The UI builds against the fixture and nothing else until H14.** The backend
can be hours late and the frontend keeps moving. This is why nobody is ever
blocked.

**The pipeline freezes at H24.** Bundles become static committed files. After
that, no backend change touches the demo. If you are behind at H24, you are
not behind — you are at the version we ship.

---

## 5. What to read next

- `README.md` — the thesis, the science, and the gotchas that will bite you
- `backend/fallowclock/schema.py` — the contract, with the reasoning in comments
- `backend/fallowclock/gaps.py` — why the year is a circle and not a line
