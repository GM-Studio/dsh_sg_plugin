import fs from 'node:fs';
const pythonTemplate = (name) =>
  fs
    .readFileSync(new URL('../../assets/scaffold/python/' + name, import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n');

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
    'app/items.py': pythonTemplate('fastapi-items.py'),
    'tests/test_items.py': lines(
      'from fastapi.testclient import TestClient',
      '',
      'from app.items import reset_items',
      'from app.main import app',
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
      '    assert client.post("/api/items/update", json={"id": item_id, "name": "updated"}).status_code == 200',
      '    assert client.post("/api/items/delete", json={"id": item_id}).status_code == 200',
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
      'app.py': pythonTemplate('flask-app.py'),
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
        '    assert client.post("/api/items/update", json={"id": item_id, "name": "updated"}).get_json()["name"] == "updated"',
        '    assert client.post("/api/items/delete", json={"id": item_id}).status_code == 200',
      ),
    });
  }
  return baseFiles(side, {
    'app.py': pythonTemplate('flask-app.py'),
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
      '    assert client.post("/api/items/update", json={"id": item_id, "name": "updated"}).get_json()["name"] == "updated"',
      '    assert client.post("/api/items/delete", json={"id": item_id}).status_code == 200',
    ),
  });
}

function django(side) {
  const legacy = isPy2(side);
  const urls = legacy
    ? [
        'from django.conf.urls import url',
        'from items.views import ItemDetail, ItemList, ItemMutation, health',
        '',
        'urlpatterns = [',
        '    url(r"^health$", health),',
        '    url(r"^api/items$", ItemList.as_view()),',
        '    url(r"^api/items/(?P<item_id>[0-9]+)$", ItemDetail.as_view()),',
        '    url(r"^api/items/(?P<action>update|delete)$", ItemMutation.as_view()),',
        ']',
      ]
    : [
        'from django.urls import path',
        'from items.views import ItemDetail, ItemList, ItemMutation, health',
        '',
        'urlpatterns = [',
        '    path("health", health),',
        '    path("api/items", ItemList.as_view()),',
        '    path("api/items/<int:item_id>", ItemDetail.as_view()),',
        '    path("api/items/<str:action>", ItemMutation.as_view()),',
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
      'REST_FRAMEWORK = {"UNAUTHENTICATED_USER": None, "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"], "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"]}',
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
    'items/views.py': pythonTemplate('django-views.py'),
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
      '    assert client.post("/api/items/update", {"id": item_id, "name": "updated"}, format="json").json()["name"] == "updated"',
      '    assert client.post("/api/items/delete", {"id": item_id}, format="json").status_code == 200',
    ),
  });
}

export function v4PythonFiles(side) {
  if (side.framework === 'flask') return flask(side);
  if (side.framework === 'django') return django(side);
  return fastapi(side);
}
