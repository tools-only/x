"""Allow-listed one-process bridge to JIT DeepPlanning Shopping tools."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from .shopping_e2e import SHOPPING_BRIDGE_TOOLS


def main() -> int:
    payload = json.loads(sys.stdin.read())
    tool_name = payload.get("tool")
    if tool_name not in SHOPPING_BRIDGE_TOOLS:
        raise ValueError(f"unsupported shopping tool: {tool_name}")
    db_dir = Path(str(payload.get("db_dir", ""))).resolve()
    cart_path = Path(str(payload.get("cart_path", ""))).resolve()
    if not db_dir.is_dir() or cart_path.parent == Path(cart_path.anchor):
        raise ValueError("invalid shopping database or cart path")
    from scripts.tools.deepplanning_shopping import create_shopping_tools

    existing_cart = None
    if cart_path.is_file():
        try:
            existing_cart = json.loads(cart_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            existing_cart = None
    tools = create_shopping_tools(str(db_dir), cart_path=str(cart_path))
    # JIT's factory resets the cart for benchmark rollouts.  The Pi bridge is
    # a continuation surface, so restore the task-local cart between one-call
    # processes; the runner created it before the first action.
    if isinstance(existing_cart, dict):
        cart_path.write_text(json.dumps(existing_cart, ensure_ascii=False, indent=2), encoding="utf-8")
    arguments = payload.get("arguments") or {}
    if not isinstance(arguments, dict):
        raise TypeError("arguments must be an object")
    if tool_name == "shopping_batch_action":
        items = arguments.get("items")
        if not isinstance(items, list) or not 2 <= len(items) <= 16:
            raise ValueError("shopping_batch_action requires 2-16 items")
        results = []
        for item in items:
            if not isinstance(item, dict):
                raise TypeError("each shopping batch item must be an object")
            product_id = item.get("product_id")
            quantity = item.get("quantity")
            if not isinstance(product_id, str) or not product_id.strip():
                raise ValueError("each shopping batch item requires product_id")
            if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity < 1:
                raise ValueError("each shopping batch item requires a positive integer quantity")
            try:
                raw = str(tools["add_product_to_cart"].forward(
                    product_id=product_id, quantity=quantity,
                ))
                outcome = "success"
                try:
                    parsed = json.loads(raw)
                    if isinstance(parsed, dict) and str(parsed.get("error") or "").strip():
                        outcome = "semantic_error"
                except json.JSONDecodeError:
                    pass
                results.append({
                    "kind": "product",
                    "product_id": product_id,
                    "quantity": quantity,
                    "outcome": outcome,
                    "text": " ".join(raw.split())[:500],
                })
            except Exception as exc:
                results.append({
                    "kind": "product",
                    "product_id": product_id,
                    "quantity": quantity,
                    "outcome": "transport_error",
                    "text": str(exc)[:500],
                })
        result = json.dumps({
            "non_atomic": True,
            "bridge_processes": 1,
            "attempted": len(results),
            "completed": sum(item["outcome"] == "success" for item in results),
            "results": results,
        }, ensure_ascii=False)
    else:
        result = tools[tool_name].forward(**arguments)
    # Pi consumes UTF-8 JSON regardless of the Windows console code page.
    sys.stdout.buffer.write(str(result).encode("utf-8"))
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
