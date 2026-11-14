"""Export the pydantic contract as JSON Schema for the frontend.

    python scripts/export_schema.py

Writes frontend/src/types/bundle.schema.json. The frontend then runs
`npm run gen:types` to turn that into bundle.ts.

This is the join that makes the contract machine-checked on both sides: a
backend field rename breaks the TypeScript build immediately, instead of
surfacing as an empty ring at hour 40.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fallowclock.schema import export_json_schema  # noqa: E402

if __name__ == "__main__":
    target = (
        Path(__file__).resolve().parents[2]
        / "frontend"
        / "src"
        / "types"
        / "bundle.schema.json"
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    schema = export_json_schema()
    schema["title"] = "Bundle"
    target.write_text(json.dumps(schema, indent=2), encoding="utf-8")
    print(f"wrote {target}")
    print(f"  {len(schema.get('$defs', {}))} models, "
          f"{len(schema['properties'])} top-level fields")
