from django.http import JsonResponse
from rest_framework.response import Response
from rest_framework.views import APIView

_items = {}
_sequence = 0


def reset_items():
    global _sequence
    _items.clear()
    _sequence = 0


def health(request):
    if request.method != "GET":
        return JsonResponse({"error": "method not allowed"}, status=405)
    return JsonResponse({"status": "ok"})


class ItemList(APIView):
    def get(self, request):
        return Response(list(_items.values()))

    def post(self, request):
        global _sequence
        payload = request.data if isinstance(request.data, dict) else {}
        name = payload.get("name")
        if not isinstance(name, type(u"")) or not name.strip():
            return Response({"error": "name is required"}, status=400)
        _sequence += 1
        item = {"id": _sequence, "name": name.strip(), "description": payload.get("description", "")}
        _items[item["id"]] = item
        return Response(item, status=201)


class ItemDetail(APIView):
    def get(self, request, item_id):
        item_id = int(item_id)
        item = _items.get(item_id)
        if item is None:
            return Response({"error": "not found"}, status=404)
        return Response(item)


class ItemMutation(APIView):
    def post(self, request, action):
        payload = request.data if isinstance(request.data, dict) else {}
        item_id = payload.get("id")
        if isinstance(item_id, bool) or not isinstance(item_id, int) or item_id <= 0:
            return Response({"error": "id must be a positive integer"}, status=400)
        if item_id not in _items:
            return Response({"error": "not found"}, status=404)
        if action == "delete":
            del _items[item_id]
            return Response({"id": item_id, "deleted": True})
        if action != "update":
            return Response({"error": "not found"}, status=404)
        name = payload.get("name")
        if not isinstance(name, type(u"")) or not name.strip():
            return Response({"error": "name is required"}, status=400)
        item = {"id": item_id, "name": name.strip(), "description": payload.get("description", "")}
        _items[item_id] = item
        return Response(item)
