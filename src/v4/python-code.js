function lines(...rows) {
  return rows.join('\n') + '\n';
}

function depsOf(side) {
  const deps = side.dependencies || {};
  const ids = [...(deps.required || []), ...(deps.optional || [])];
  const items = Array.isArray(deps.items) ? deps.items : [];
  return ids
    .map((id) => items.find((item) => item.id === id))
    .filter((item) => item && item.kind !== 'file');
}

function hasDep(side, id) {
  const deps = side.dependencies || {};
  return [...(deps.required || []), ...(deps.optional || [])].includes(id);
}

function requirementsText(side) {
  const rows = depsOf(side)
    .map((item) => item.install || '')
    .filter(Boolean);
  return [...new Set(rows)].join('\n') + '\n';
}

function pyVersion(side) {
  return String(side.pythonVersion || side.runtimeVersion || '3.12');
}

function pyproject(side) {
  const deps = depsOf(side)
    .map((item) => item.install || '')
    .filter(Boolean);
  return lines(
    '[project]',
    'name = "' + (side.id || 'api') + '"',
    'version = "0.1.0"',
    'requires-python = ">=' + pyVersion(side) + '"',
    'dependencies = [',
    ...deps.map((item) => '  "' + item + '",'),
    ']',
    '',
    '[tool.poetry]',
    'package-mode = false',
    '',
  );
}

function isPy2(side) {
  return pyVersion(side) === '2.7';
}

function baseFiles(side, extra) {
  const files = {
    'requirements.txt': requirementsText(side),
    '.python-version': pyVersion(side) + '\n',
    '.gitignore': lines(
      '__pycache__/',
      '.venv/',
      '*.pyc',
      '.pytest_cache/',
      '.ruff_cache/',
      'db.sqlite3',
    ),
    'README.md':
      '# ' + (side.id || 'api') + '\n\nSpecGate ' + (side.framework || 'python') + ' MVP\n',
    ...extra,
  };
  if (!isPy2(side)) {
    files['ruff.toml'] = lines(
      'line-length = 100',
      'target-version = "py' + pyVersion(side).replace('.', '') + '"',
    );
  }
  if (!isPy2(side) && side.packageManager && side.packageManager !== 'pip') {
    files['pyproject.toml'] = pyproject(side);
  }
  if (hasDep(side, 'docker')) {
    const cmd =
      side.framework === 'fastapi'
        ? 'CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]'
        : side.framework === 'django'
          ? 'CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]'
          : 'CMD ["python", "app.py"]';
    files.Dockerfile = lines(
      'FROM python:' + pyVersion(side) + '-slim',
      'WORKDIR /app',
      'COPY requirements.txt .',
      'RUN pip install --no-cache-dir -r requirements.txt',
      'COPY . .',
      'EXPOSE 8000',
      cmd,
    );
  }
  return files;
}

function fastapi(side) {
  return baseFiles(side, {
    'app/__init__.py': '',
    'app/main.py': lines(
      'from fastapi import FastAPI',
      '',
      'from app.items import router as items_router',
      '',
      'app = FastAPI(title="SpecGate MVP")',
      '',
      '',
      '@app.get("/health")',
      'def health():',
      '    return {"status": "ok"}',
      '',
      '',
      'app.include_router(items_router)',
    ),
    'app/items.py': lines(
      'from fastapi import APIRouter, HTTPException',
      'from pydantic import BaseModel, Field',
      '',
      'router = APIRouter(prefix="/api/items", tags=["items"])',
      '',
      '',
      'class ItemInput(BaseModel):',
      '    name: str = Field(min_length=1)',
      '    description: str = ""',
      '',
      '',
      'class Item(ItemInput):',
      '    id: int',
      '',
      '',
      '_items = {}',
      '_sequence = 0',
      '',
      '',
      'def reset_items():',
      '    global _sequence',
      '    _items.clear()',
      '    _sequence = 0',
      '',
      '',
      '@router.get("")',
      'def list_items():',
      '    return list(_items.values())',
      '',
      '',
      '@router.get("/{item_id}")',
      'def get_item(item_id: int):',
      '    item = _items.get(item_id)',
      '    if item is None:',
      '        raise HTTPException(status_code=404, detail="not found")',
      '    return item',
      '',
      '',
      '@router.post("", status_code=201)',
      'def create_item(payload: ItemInput):',
      '    global _sequence',
      '    _sequence += 1',
      '    item = Item(id=_sequence, name=payload.name.strip(), description=payload.description)',
      '    _items[item.id] = item',
      '    return item',
      '',
      '',
      '@router.put("/{item_id}")',
      'def update_item(item_id: int, payload: ItemInput):',
      '    if item_id not in _items:',
      '        raise HTTPException(status_code=404, detail="not found")',
      '    item = Item(id=item_id, name=payload.name.strip(), description=payload.description)',
      '    _items[item_id] = item',
      '    return item',
      '',
      '',
      '@router.delete("/{item_id}", status_code=204)',
      'def delete_item(item_id: int):',
      '    if item_id not in _items:',
      '        raise HTTPException(status_code=404, detail="not found")',
      '    del _items[item_id]',
    ),
    'tests/test_items.py': lines(
      'from fastapi.testclient import TestClient',
      '',
      'from app.main import app',
      'from app.items import reset_items',
      '',
      'client = TestClient(app)',
      '',
      '',
      'def test_health():',
      '    assert client.get("/health").json() == {"status": "ok"}',
      '',
      '',
      'def test_crud():',
      '    reset_items()',
      '    assert client.get("/api/items").json() == []',
      '    created = client.post("/api/items", json={"name": "demo"})',
      '    assert created.status_code == 201',
      '    item_id = created.json()["id"]',
      '    assert client.get("/api/items/" + str(item_id)).status_code == 200',
      '    assert client.put("/api/items/" + str(item_id), json={"name": "updated"}).status_code == 200',
      '    assert client.delete("/api/items/" + str(item_id)).status_code == 204',
      '    assert client.get("/api/items/" + str(item_id)).status_code == 404',
      '',
      '',
      'def test_validation():',
      '    reset_items()',
      '    assert client.post("/api/items", json={"name": ""}).status_code == 422',
    ),
  });
}

function flask(side) {
  if (isPy2(side)) {
    return baseFiles(side, {
      'app.py': lines(
        '# -*- coding: utf-8 -*-',
        'import json',
        'from flask import Flask, Response, request',
        '',
        'app = Flask(__name__)',
        '_items = {}',
        '_sequence = 0',
        '',
        '',
        'def reset_items():',
        '    global _sequence',
        '    _items.clear()',
        '    _sequence = 0',
        '',
        '',
        'def reply(payload, status=200):',
        '    return Response(json.dumps(payload), status=status, mimetype="application/json")',
        '',
        '',
        '@app.route("/health")',
        'def health():',
        '    return reply({"status": "ok"})',
        '',
        '',
        '@app.route("/api/items", methods=["GET", "POST"])',
        'def items():',
        '    global _sequence',
        '    if request.method == "GET":',
        '        return reply(list(_items.values()))',
        '    payload = request.get_json(silent=True) or {}',
        '    name = str(payload.get("name", "")).strip()',
        '    if not name:',
        '        return reply({"error": "name is required"}, 400)',
        '    _sequence += 1',
        '    item = {"id": _sequence, "name": name, "description": payload.get("description", "")}',
        '    _items[item["id"]] = item',
        '    return reply(item, 201)',
        '',
        '',
        '@app.route("/api/items/<int:item_id>", methods=["GET", "PUT", "DELETE"])',
        'def one(item_id):',
        '    if item_id not in _items:',
        '        return reply({"error": "not found"}, 404)',
        '    if request.method == "GET":',
        '        return reply(_items[item_id])',
        '    if request.method == "DELETE":',
        '        del _items[item_id]',
        '        return Response(status=204)',
        '    payload = request.get_json(silent=True) or {}',
        '    name = str(payload.get("name", "")).strip()',
        '    if not name:',
        '        return reply({"error": "name is required"}, 400)',
        '    item = {"id": item_id, "name": name, "description": payload.get("description", "")}',
        '    _items[item_id] = item',
        '    return reply(item)',
        '',
        '',
        'if __name__ == "__main__":',
        '    app.run(port=8000)',
      ),
      'tests/test_items.py': lines(
        'from app import app, reset_items',
        '',
        '',
        'def test_health():',
        '    assert app.test_client().get("/health").get_json() == {"status": "ok"}',
        '',
        '',
        'def test_crud():',
        '    reset_items()',
        '    client = app.test_client()',
        '    created = client.post("/api/items", json={"name": "demo"})',
        '    assert created.status_code == 201',
        '    item_id = created.get_json()["id"]',
        '    assert client.get("/api/items/" + str(item_id)).status_code == 200',
        '    assert client.delete("/api/items/" + str(item_id)).status_code == 204',
      ),
    });
  }
  return baseFiles(side, {
    'app.py': lines(
      'from flask import Flask, jsonify, request',
      '',
      'app = Flask(__name__)',
      '_items = {}',
      '_sequence = 0',
      '',
      '',
      'def reset_items():',
      '    global _sequence',
      '    _items.clear()',
      '    _sequence = 0',
      '',
      '',
      '@app.get("/health")',
      'def health():',
      '    return jsonify({"status": "ok"})',
      '',
      '',
      '@app.get("/api/items")',
      'def list_items():',
      '    return jsonify(list(_items.values()))',
      '',
      '',
      '@app.post("/api/items")',
      'def create_item():',
      '    global _sequence',
      '    payload = request.get_json(silent=True) or {}',
      '    name = str(payload.get("name", "")).strip()',
      '    if not name:',
      '        return jsonify({"error": "name is required"}), 400',
      '    _sequence += 1',
      '    item = {"id": _sequence, "name": name, "description": payload.get("description", "")}',
      '    _items[item["id"]] = item',
      '    return jsonify(item), 201',
      '',
      '',
      '@app.get("/api/items/<int:item_id>")',
      'def get_item(item_id):',
      '    item = _items.get(item_id)',
      '    if item is None:',
      '        return jsonify({"error": "not found"}), 404',
      '    return jsonify(item)',
      '',
      '',
      '@app.put("/api/items/<int:item_id>")',
      'def update_item(item_id):',
      '    if item_id not in _items:',
      '        return jsonify({"error": "not found"}), 404',
      '    payload = request.get_json(silent=True) or {}',
      '    name = str(payload.get("name", "")).strip()',
      '    if not name:',
      '        return jsonify({"error": "name is required"}), 400',
      '    item = {"id": item_id, "name": name, "description": payload.get("description", "")}',
      '    _items[item_id] = item',
      '    return jsonify(item)',
      '',
      '',
      '@app.delete("/api/items/<int:item_id>")',
      'def delete_item(item_id):',
      '    if item_id not in _items:',
      '        return jsonify({"error": "not found"}), 404',
      '    del _items[item_id]',
      '    return "", 204',
      '',
      '',
      'if __name__ == "__main__":',
      '    app.run(port=8000)',
    ),
    'tests/test_items.py': lines(
      'from app import app, reset_items',
      '',
      '',
      'def test_health():',
      '    assert app.test_client().get("/health").get_json() == {"status": "ok"}',
      '',
      '',
      'def test_crud():',
      '    reset_items()',
      '    client = app.test_client()',
      '    created = client.post("/api/items", json={"name": "demo"})',
      '    assert created.status_code == 201',
      '    item_id = created.get_json()["id"]',
      '    assert client.get("/api/items/" + str(item_id)).status_code == 200',
      '    assert client.delete("/api/items/" + str(item_id)).status_code == 204',
    ),
  });
}

function django(side) {
  const legacy = isPy2(side);
  const urls = legacy
    ? [
        'from django.conf.urls import url',
        'from items.views import ItemDetail, ItemList, health',
        '',
        'urlpatterns = [',
        '    url(r"^health$", health),',
        '    url(r"^api/items$", ItemList.as_view()),',
        '    url(r"^api/items/(?P<item_id>[0-9]+)$", ItemDetail.as_view()),',
        ']',
      ]
    : [
        'from django.urls import path',
        'from items.views import ItemDetail, ItemList, health',
        '',
        'urlpatterns = [',
        '    path("health", health),',
        '    path("api/items", ItemList.as_view()),',
        '    path("api/items/<int:item_id>", ItemDetail.as_view()),',
        ']',
      ];
  const configUrls = legacy
    ? lines(
        'from django.conf.urls import include, url',
        '',
        'urlpatterns = [url(r"^", include("items.urls"))]',
      )
    : lines(
        'from django.conf.urls import include',
        'from django.urls import path',
        '',
        'urlpatterns = [path("", include("items.urls"))]',
      );
  return baseFiles(side, {
    'manage.py': lines(
      '#!/usr/bin/env python',
      'import os',
      'import sys',
      '',
      'if __name__ == "__main__":',
      '    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")',
      '    from django.core.management import execute_from_command_line',
      '    execute_from_command_line(sys.argv)',
    ),
    'config/__init__.py': '',
    'config/settings.py': lines(
      'import os',
      'BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))',
      'SECRET_KEY = "specgate-dev-only"',
      'DEBUG = True',
      'ALLOWED_HOSTS = ["*"]',
      'INSTALLED_APPS = ["django.contrib.contenttypes", "django.contrib.staticfiles", "rest_framework", "items"]',
      'MIDDLEWARE = []',
      'ROOT_URLCONF = "config.urls"',
      'DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": os.path.join(BASE_DIR, "db.sqlite3")}}',
      'REST_FRAMEWORK = {"UNAUTHENTICATED_USER": None}',
      'USE_TZ = True',
    ),
    'config/urls.py': configUrls,
    'config/wsgi.py': lines(
      'import os',
      'from django.core.wsgi import get_wsgi_application',
      'os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")',
      'application = get_wsgi_application()',
    ),
    'items/__init__.py': '',
    'items/apps.py': lines(
      'from django.apps import AppConfig',
      '',
      '',
      'class ItemsConfig(AppConfig):',
      '    name = "items"',
    ),
    'items/models.py': '',
    'items/views.py': lines(
      'from django.http import JsonResponse',
      'from django.views.decorators.csrf import csrf_exempt',
      'from rest_framework.response import Response',
      'from rest_framework.views import APIView',
      '',
      '_items = {}',
      '_sequence = 0',
      '',
      '',
      'def reset_items():',
      '    global _sequence',
      '    _items.clear()',
      '    _sequence = 0',
      '',
      '',
      '@csrf_exempt',
      'def health(request):',
      '    return JsonResponse({"status": "ok"})',
      '',
      '',
      'class ItemList(APIView):',
      '    def get(self, request):',
      '        return Response(list(_items.values()))',
      '',
      '    def post(self, request):',
      '        global _sequence',
      '        name = str(request.data.get("name", "")).strip()',
      '        if not name:',
      '            return Response({"error": "name is required"}, status=400)',
      '        _sequence += 1',
      '        item = {"id": _sequence, "name": name, "description": request.data.get("description", "")}',
      '        _items[item["id"]] = item',
      '        return Response(item, status=201)',
      '',
      '',
      'class ItemDetail(APIView):',
      '    def get(self, request, item_id):',
      '        item = _items.get(item_id)',
      '        if item is None:',
      '            return Response({"error": "not found"}, status=404)',
      '        return Response(item)',
      '',
      '    def put(self, request, item_id):',
      '        if item_id not in _items:',
      '            return Response({"error": "not found"}, status=404)',
      '        name = str(request.data.get("name", "")).strip()',
      '        if not name:',
      '            return Response({"error": "name is required"}, status=400)',
      '        item = {"id": item_id, "name": name, "description": request.data.get("description", "")}',
      '        _items[item_id] = item',
      '        return Response(item)',
      '',
      '    def delete(self, request, item_id):',
      '        if item_id not in _items:',
      '            return Response({"error": "not found"}, status=404)',
      '        del _items[item_id]',
      '        return Response(status=204)',
    ),
    'items/urls.py': lines(...urls),
    'pytest.ini': lines(
      '[pytest]',
      'DJANGO_SETTINGS_MODULE = config.settings',
      'python_files = tests.py test_*.py *_tests.py',
    ),
    'tests/test_items.py': lines(
      'from rest_framework.test import APIClient',
      'from items.views import reset_items',
      '',
      '',
      'def test_health():',
      '    assert APIClient().get("/health").status_code == 200',
      '',
      '',
      'def test_crud():',
      '    reset_items()',
      '    client = APIClient()',
      '    assert client.get("/api/items").json() == []',
      '    created = client.post("/api/items", {"name": "demo"}, format="json")',
      '    assert created.status_code == 201',
      '    item_id = created.json()["id"]',
      '    assert client.get("/api/items/" + str(item_id)).status_code == 200',
      '    assert client.delete("/api/items/" + str(item_id)).status_code == 204',
    ),
  });
}

export function v4PythonFiles(side) {
  if (side.framework === 'flask') return flask(side);
  if (side.framework === 'django') return django(side);
  return fastapi(side);
}
