# -*- coding: utf-8 -*-
import json
from flask import Flask, Response, request

app = Flask(__name__)
_items = {}
_sequence = 0


def reset_items():
    global _sequence
    _items.clear()
    _sequence = 0


def reply(payload, status=200):
    return Response(json.dumps(payload), status=status, mimetype="application/json")


def json_body():
    payload = request.get_json(silent=True)
    return payload if isinstance(payload, dict) else {}


@app.errorhandler(400)
@app.errorhandler(404)
@app.errorhandler(405)
@app.errorhandler(415)
@app.errorhandler(500)
def http_error(error):
    return reply({"error": error.name}, error.code)


@app.route("/health", methods=["GET"])
def health():
    return reply({"status": "ok"})


@app.route("/api/items", methods=["GET", "POST"])
def items():
    global _sequence
    if request.method == "GET":
        return reply(list(_items.values()))
    payload = json_body()
    name = payload.get("name")
    if not isinstance(name, type("")) or not name.strip():
        return reply({"error": "name is required"}, 400)
    _sequence += 1
    item = {
        "id": _sequence,
        "name": name.strip(),
        "description": payload.get("description", ""),
    }
    _items[item["id"]] = item
    return reply(item, 201)


@app.route("/api/items/<int:item_id>", methods=["GET"])
def one(item_id):
    if item_id not in _items:
        return reply({"error": "not found"}, 404)
    return reply(_items[item_id])


@app.route("/api/items/update", methods=["POST"])
@app.route("/api/items/delete", methods=["POST"])
def mutate():
    payload = json_body()
    item_id = payload.get("id")
    if isinstance(item_id, bool) or not isinstance(item_id, int) or item_id <= 0:
        return reply({"error": "id must be a positive integer"}, 400)
    if item_id not in _items:
        return reply({"error": "not found"}, 404)
    if request.path.endswith("/delete"):
        del _items[item_id]
        return reply({"id": item_id, "deleted": True})
    name = payload.get("name")
    if not isinstance(name, type("")) or not name.strip():
        return reply({"error": "name is required"}, 400)
    item = {
        "id": item_id,
        "name": name.strip(),
        "description": payload.get("description", ""),
    }
    _items[item_id] = item
    return reply(item)


if __name__ == "__main__":
    app.run(port=8000)
