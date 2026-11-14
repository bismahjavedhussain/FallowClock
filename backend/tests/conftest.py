"""Make `import fallowclock` work no matter which directory pytest is run
from. Someone will run `pytest` from the repo root at 3am and conclude the
whole suite is broken; this is three lines to prevent that."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
