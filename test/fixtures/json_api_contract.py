"""Run against a generated framework app with SG_CONTRACT_FRAMEWORK set."""

import os

framework = os.environ["SG_CONTRACT_FRAMEWORK"]
if framework == "fastapi":
    from fastapi.testclient import TestClient
    from app.main import app
    from app.items import reset_items

    client = TestClient(app)
elif framework == "flask":
    from app import app, reset_items

    client = app.test_client()
else:
    os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings"
    import django

    django.setup()
    from rest_framework.test import APIClient
    from items.views import reset_items

    client = APIClient()


def payload(response):
    assert "application/json" in response.headers["content-type"]
    return response.get_json() if framework == "flask" else response.json()


def post(path, body):
    if framework == "django":
        return client.post(path, body, format="json")
    return client.post(path, json=body)


def test_json_crud_contract():
    reset_items()
    created = post("/api/items", {"name": "contract"})
    assert created.status_code == 201
    item_id = payload(created)["id"]
    updated = post("/api/items/update", {"id": item_id, "name": "updated"})
    assert updated.status_code == 200
    assert payload(updated)["name"] == "updated"
    assert payload(client.get("/api/items/" + str(item_id)))["name"] == "updated"
    queried_mutation = client.get("/api/items/delete")
    assert queried_mutation.status_code >= 400
    payload(queried_mutation)
    assert client.get("/api/items/" + str(item_id)).status_code == 200
    for invalid in [{}, {"id": 0}, {"id": "1"}, {"id": True}]:
        response = post("/api/items/delete", invalid)
        assert response.status_code >= 400
        payload(response)
    deleted = post("/api/items/delete", {"id": item_id})
    assert deleted.status_code == 200
    assert payload(deleted) == {"id": item_id, "deleted": True}
    missing = client.get("/api/items/" + str(item_id))
    assert missing.status_code == 404
    payload(missing)
