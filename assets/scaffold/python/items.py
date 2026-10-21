import json
from urllib.parse import urlparse


class ItemStore:
    def __init__(self):
        self.clear()

    def clear(self):
        self.items = {}
        self.sequence = 0

    def list(self):
        return list(self.items.values())

    def get(self, item_id):
        return self.items.get(item_id)

    def create(self, name, description=""):
        self.sequence += 1
        item = {"id": self.sequence, "name": name, "description": description}
        self.items[item["id"]] = item
        return item

    def update(self, item_id, name, description=""):
        if item_id not in self.items:
            return None
        self.items[item_id] = {"id": item_id, "name": name, "description": description}
        return self.items[item_id]

    def delete(self, item_id):
        return self.items.pop(item_id, None) is not None


STORE = ItemStore()


def _send(handler, status, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json")
    handler.send_header("content-length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def handle_items(handler):
    parts = [part for part in urlparse(handler.path).path.split("/") if part]
    if len(parts) < 2 or parts[:2] != ["api", "items"]:
        return False
    if len(parts) > 3:
        _send(handler, 404, {"error": "not found"})
        return True
    action = parts[2] if len(parts) == 3 else None
    if handler.command == "GET":
        if action is None:
            _send(handler, 200, STORE.list())
        elif not action.isdigit() or int(action) <= 0:
            _send(handler, 400, {"error": "invalid id"})
        else:
            item = STORE.get(int(action))
            _send(handler, 200, item) if item else _send(
                handler, 404, {"error": "not found"}
            )
        return True
    if handler.command != "POST":
        _send(handler, 405, {"error": "use GET for queries and POST for mutations"})
        return True
    if (
        not handler.headers.get("content-type", "")
        .lower()
        .startswith("application/json")
    ):
        _send(handler, 415, {"error": "use application/json"})
        return True
    try:
        length = int(handler.headers.get("content-length", "0"))
        payload = json.loads(handler.rfile.read(length).decode("utf-8"))
    except (ValueError, UnicodeError):
        payload = None
    if not isinstance(payload, dict):
        _send(handler, 400, {"error": "invalid JSON object"})
        return True
    if action is not None and action not in ("update", "delete"):
        _send(handler, 404, {"error": "not found"})
        return True
    item_id = payload.get("id")
    if action is not None:
        if isinstance(item_id, bool) or not isinstance(item_id, int) or item_id <= 0:
            _send(handler, 400, {"error": "id must be a positive integer"})
            return True
        if STORE.get(item_id) is None:
            _send(handler, 404, {"error": "not found"})
            return True
    if action == "delete":
        STORE.delete(item_id)
        _send(handler, 200, {"id": item_id, "deleted": True})
        return True
    name = payload.get("name")
    if not isinstance(name, str) or not name.strip():
        _send(handler, 400, {"error": "name is required"})
        return True
    item = (
        STORE.update(item_id, name.strip(), payload.get("description", ""))
        if action
        else STORE.create(name.strip(), payload.get("description", ""))
    )
    _send(handler, 200 if action else 201, item)
    return True
