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

function isTs(side) {
  return side.language !== 'javascript';
}

function packageJson(side) {
  const dependencies = {};
  const devDependencies = {};
  for (const item of depsOf(side)) {
    if (!item.name) continue;
    const dev =
      item.scope === 'devDependencies' ||
      item.scope === 'dev' ||
      item.category === 'test' ||
      item.category === 'quality' ||
      item.category === 'lint' ||
      item.category === 'format';
    (dev ? devDependencies : dependencies)[item.name] = item.version;
  }
  const nest = side.framework === 'nestjs';
  const ts = isTs(side);
  const scripts = nest
    ? {
        dev: 'nest start --watch',
        build: 'nest build',
        start: 'node dist/main.js',
        test: 'jest',
        lint: 'eslint .',
        format: 'prettier --write .',
      }
    : ts
      ? {
          dev: 'tsx watch src/server.ts',
          build: 'tsc -p tsconfig.json',
          start: 'node dist/server.js',
          test: 'vitest run',
          lint: 'eslint .',
          format: 'prettier --write .',
        }
      : {
          dev: 'node --watch src/server.js',
          build: 'node --check src/server.js',
          start: 'node src/server.js',
          test: 'vitest run',
          lint: 'eslint .',
          format: 'prettier --write .',
        };
  const pkg = {
    name: 'api',
    private: true,
    type: nest ? 'commonjs' : 'module',
    scripts,
    dependencies,
    devDependencies,
  };
  if (nest) {
    pkg.jest = {
      moduleFileExtensions: ['js', 'json', 'ts'],
      rootDir: '.',
      testRegex: '.*\\.spec\\.ts$',
      transform: { '^.+\\.(t|j)s$': 'ts-jest' },
      testEnvironment: 'node',
    };
  }
  return JSON.stringify(pkg, null, 2) + '\n';
}

function tsconfig(side) {
  if (side.framework === 'nestjs') {
    return (
      JSON.stringify(
        {
          compilerOptions: {
            module: 'commonjs',
            declaration: true,
            removeComments: true,
            emitDecoratorMetadata: true,
            experimentalDecorators: true,
            allowSyntheticDefaultImports: true,
            target: 'ES2021',
            sourceMap: true,
            outDir: './dist',
            baseUrl: './',
            incremental: true,
            skipLibCheck: true,
            strict: false,
            esModuleInterop: true,
          },
          include: ['src/**/*', 'test/**/*'],
        },
        null,
        2,
      ) + '\n'
    );
  }
  return (
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          outDir: 'dist',
          rootDir: '.',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          strict: false,
          skipLibCheck: true,
          types: ['node', 'vitest/globals'],
        },
        include: ['src/**/*.ts', 'test/**/*.ts'],
      },
      null,
      2,
    ) + '\n'
  );
}

function eslintConfig(side) {
  if (!isTs(side)) {
    return lines(
      'export default [',
      '  { ignores: ["node_modules/**", "dist/**", "coverage/**"] },',
      '  { rules: {} },',
      '];',
    );
  }
  return lines(
    'import tseslint from "typescript-eslint";',
    '',
    'export default [',
    '  { ignores: ["node_modules/**", "dist/**", "coverage/**"] },',
    '  { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser }, rules: {} },',
    '];',
  );
}

function baseFiles(side, extra = {}) {
  const files = {
    'package.json': packageJson(side),
    '.nvmrc': String(side.nodeVersion || side.runtimeVersion || '22') + '\n',
    '.gitignore': lines('node_modules/', 'dist/', 'coverage/', '.env'),
    'README.md':
      '# ' + (side.id || 'api') + '\n\nSpecGate ' + (side.framework || 'node') + ' MVP\n',
  };
  files[side.framework === 'nestjs' ? 'eslint.config.mjs' : 'eslint.config.js'] =
    eslintConfig(side);
  if (isTs(side)) files['tsconfig.json'] = tsconfig(side);
  if ((side.packageManager || 'pnpm') === 'pnpm') {
    files['pnpm-workspace.yaml'] = lines(
      'allowBuilds:',
      '  esbuild: true',
      'onlyBuiltDependencies:',
      '  - esbuild',
    );
  }
  if (side.framework === 'nestjs') {
    files['nest-cli.json'] =
      JSON.stringify({ collection: '@nestjs/schematics', sourceRoot: 'src' }, null, 2) + '\n';
  } else {
    files['vitest.config.ts'] = lines(
      'import { defineConfig } from "vitest/config";',
      '',
      'export default defineConfig({',
      '  test: { environment: "node" },',
      '});',
    );
  }
  if (hasDep(side, 'docker')) {
    files.Dockerfile = lines(
      'FROM node:' + String(side.nodeVersion || side.runtimeVersion || '22') + '-slim',
      'WORKDIR /app',
      'COPY package*.json ./',
      'RUN npm install',
      'COPY . .',
      'RUN npm run build',
      'EXPOSE 3000',
      'CMD ["npm", "start"]',
    );
  }
  return { ...files, ...extra };
}

function expressFiles(side, ts) {
  const ext = ts ? 'ts' : 'js';
  const typeImport = ts ? 'import type { Request, Response } from "express";\n' : '';
  const typed = ts
    ? {
        map: 'const items = new Map<number, Item>();',
        iface: 'export interface Item { id: number; name: string; description: string; }',
        schema:
          'const schema = z.object({ name: z.string().min(1), description: z.string().optional().default("") });',
        list: 'itemsRouter.get("/", (_req: Request, res: Response) => res.json([...items.values()]));',
        get: 'itemsRouter.get("/:id", (req: Request, res: Response) => {',
        post: 'itemsRouter.post("/", (req: Request, res: Response) => {',
        put: 'itemsRouter.post("/update", (req: Request, res: Response) => {',
        del: 'itemsRouter.post("/delete", (req: Request, res: Response) => {',
      }
    : {
        map: 'const items = new Map();',
        iface: '',
        schema:
          'const schema = z.object({ name: z.string().min(1), description: z.string().optional().default("") });',
        list: 'itemsRouter.get("/", (_req, res) => res.json([...items.values()]));',
        get: 'itemsRouter.get("/:id", (req, res) => {',
        post: 'itemsRouter.post("/", (req, res) => {',
        put: 'itemsRouter.post("/update", (req, res) => {',
        del: 'itemsRouter.post("/delete", (req, res) => {',
      };
  return baseFiles(side, {
    ['src/items.' + ext]: lines(
      'import { Router } from "express";',
      'import { z } from "zod";',
      typeImport,
      typed.iface,
      '',
      typed.map,
      'let sequence = 0;',
      '',
      'export function resetItems() {',
      '  items.clear();',
      '  sequence = 0;',
      '}',
      '',
      typed.schema,
      '',
      'export const itemsRouter = Router();',
      '',
      typed.list,
      '',
      typed.get,
      '  const id = Number(req.params.id);',
      '  const item = items.get(id);',
      '  if (!item) return res.status(404).json({ error: "not found" });',
      '  return res.json(item);',
      '});',
      '',
      typed.post,
      '  const parsed = schema.safeParse(req.body);',
      '  if (!parsed.success) return res.status(400).json({ error: "name is required" });',
      '  sequence += 1;',
      '  const item = { id: sequence, name: parsed.data.name, description: parsed.data.description };',
      '  items.set(item.id, item);',
      '  return res.status(201).json(item);',
      '});',
      '',
      typed.put,
      '  const id = req.body?.id;',
      '  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "id must be a positive integer" });',
      '  if (!items.has(id)) return res.status(404).json({ error: "not found" });',
      '  const parsed = schema.safeParse(req.body);',
      '  if (!parsed.success) return res.status(400).json({ error: "name is required" });',
      '  const item = { id, name: parsed.data.name, description: parsed.data.description };',
      '  items.set(id, item);',
      '  return res.json(item);',
      '});',
      '',
      typed.del,
      '  const id = req.body?.id;',
      '  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "id must be a positive integer" });',
      '  if (!items.delete(id)) return res.status(404).json({ error: "not found" });',
      '  return res.json({ id, deleted: true });',
      '});',
    ),
    ['src/app.' + ext]: lines(
      'import express from "express";',
      'import cors from "cors";',
      'import { itemsRouter } from "./items";',
      '',
      'export function createApp() {',
      '  const app = express();',
      '  app.use(cors());',
      '  app.use(express.json());',
      '  app.get("/health", (_req, res) => res.json({ status: "ok" }));',
      '  app.use("/api/items", itemsRouter);',
      '  app.use((_req, res) => res.status(404).json({ error: "not found" }));',
      '  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.status === 400 ? "invalid JSON" : "request failed" }));',
      '  return app;',
      '}',
    ),
    ['src/server.' + ext]: lines(
      'import { createApp } from "./app";',
      '',
      'createApp().listen(3000, () => console.log("listening on 3000"));',
    ),
    ['test/items.test.' + ext]: lines(
      'import { beforeEach, describe, expect, it } from "vitest";',
      'import request from "supertest";',
      'import { createApp } from "../src/app";',
      'import { resetItems } from "../src/items";',
      '',
      'const app = createApp();',
      '',
      'describe("items api", () => {',
      '  beforeEach(() => resetItems());',
      '',
      '  it("health", async () => {',
      '    const response = await request(app).get("/health");',
      '    expect(response.status).toBe(200);',
      '    expect(response.body).toEqual({ status: "ok" });',
      '  });',
      '',
      '  it("crud", async () => {',
      '    const created = await request(app).post("/api/items").send({ name: "demo" });',
      '    expect(created.status).toBe(201);',
      '    const id = created.body.id;',
      '    expect((await request(app).get("/api/items/" + id)).status).toBe(200);',
      '    expect((await request(app).post("/api/items/update").send({ id, name: "updated" })).status).toBe(200);',
      '    const deleted = await request(app).post("/api/items/delete").send({ id });',
      '    expect(deleted.status).toBe(200);',
      '    expect(deleted.body).toEqual({ id, deleted: true });',
      '    expect((await request(app).get("/api/items/" + id)).status).toBe(404);',
      '  });',
      '});',
    ),
  });
}

function fastifyFiles(side, ts) {
  const ext = ts ? 'ts' : 'js';
  const typed = ts
    ? {
        importType: 'import type { FastifyInstance } from "fastify";\n',
        map: 'const items = new Map<number, Item>();',
        iface: 'interface Item { id: number; name: string; description: string; }',
        app: 'export async function itemsRoutes(app: FastifyInstance) {',
      }
    : {
        importType: '',
        map: 'const items = new Map();',
        iface: '',
        app: 'export async function itemsRoutes(app) {',
      };
  return baseFiles(side, {
    ['src/items.' + ext]: lines(
      'import { z } from "zod";',
      typed.importType,
      typed.iface,
      '',
      typed.map,
      'let sequence = 0;',
      '',
      'export function resetItems() {',
      '  items.clear();',
      '  sequence = 0;',
      '}',
      '',
      'const schema = z.object({ name: z.string().min(1), description: z.string().optional().default("") });',
      '',
      typed.app,
      '  app.get("/api/items", async () => [...items.values()]);',
      '  app.get("/api/items/:id", async (request, reply) => {',
      ts
        ? '    const id = Number((request.params as { id: string }).id);'
        : '    const id = Number(request.params.id);',
      '    const item = items.get(id);',
      '    if (!item) return reply.code(404).send({ error: "not found" });',
      '    return item;',
      '  });',
      '  app.post("/api/items", async (request, reply) => {',
      '    const parsed = schema.safeParse(request.body);',
      '    if (!parsed.success) return reply.code(400).send({ error: "name is required" });',
      '    sequence += 1;',
      '    const item = { id: sequence, name: parsed.data.name, description: parsed.data.description };',
      '    items.set(item.id, item);',
      '    return reply.code(201).send(item);',
      '  });',
      '  app.post("/api/items/update", async (request, reply) => {',
      '    const parsedId = z.object({ id: z.number().int().positive() }).safeParse(request.body);',
      '    if (!parsedId.success) return reply.code(400).send({ error: "id must be a positive integer" });',
      '    const id = parsedId.data.id;',
      '    if (!items.has(id)) return reply.code(404).send({ error: "not found" });',
      '    const parsed = schema.safeParse(request.body);',
      '    if (!parsed.success) return reply.code(400).send({ error: "name is required" });',
      '    const item = { id, name: parsed.data.name, description: parsed.data.description };',
      '    items.set(id, item);',
      '    return item;',
      '  });',
      '  app.post("/api/items/delete", async (request, reply) => {',
      '    const parsedId = z.object({ id: z.number().int().positive() }).safeParse(request.body);',
      '    if (!parsedId.success) return reply.code(400).send({ error: "id must be a positive integer" });',
      '    const id = parsedId.data.id;',
      '    if (!items.delete(id)) return reply.code(404).send({ error: "not found" });',
      '    return { id, deleted: true };',
      '  });',
      '}',
    ),
    ['src/app.' + ext]: lines(
      'import Fastify from "fastify";',
      'import cors from "@fastify/cors";',
      'import sensible from "@fastify/sensible";',
      'import { itemsRoutes } from "./items";',
      '',
      'export function buildApp() {',
      '  const app = Fastify({ logger: false });',
      '  app.register(cors);',
      '  app.register(sensible);',
      '  app.get("/health", async () => ({ status: "ok" }));',
      '  app.register(itemsRoutes);',
      '  return app;',
      '}',
    ),
    ['src/server.' + ext]: lines(
      'import { buildApp } from "./app";',
      '',
      'buildApp().listen({ port: 3000 }, () => console.log("listening on 3000"));',
    ),
    ['test/items.test.' + ext]: lines(
      'import { beforeEach, describe, expect, it } from "vitest";',
      'import { buildApp } from "../src/app";',
      'import { resetItems } from "../src/items";',
      '',
      'describe("items api", () => {',
      '  beforeEach(() => resetItems());',
      '',
      '  it("health", async () => {',
      '    const app = buildApp();',
      '    const response = await app.inject({ method: "GET", url: "/health" });',
      '    expect(response.statusCode).toBe(200);',
      '    expect(response.json()).toEqual({ status: "ok" });',
      '    await app.close();',
      '  });',
      '',
      '  it("crud", async () => {',
      '    const app = buildApp();',
      '    const created = await app.inject({ method: "POST", url: "/api/items", payload: { name: "demo" } });',
      '    expect(created.statusCode).toBe(201);',
      '    const id = created.json().id;',
      '    expect((await app.inject({ method: "GET", url: "/api/items/" + id })).statusCode).toBe(200);',
      '    expect((await app.inject({ method: "POST", url: "/api/items/update", payload: { id, name: "updated" } })).statusCode).toBe(200);',
      '    const deleted = await app.inject({ method: "POST", url: "/api/items/delete", payload: { id } });',
      '    expect(deleted.statusCode).toBe(200);',
      '    expect(deleted.json()).toEqual({ id, deleted: true });',
      '    await app.close();',
      '  });',
      '});',
    ),
  });
}

function nestFiles(side) {
  return baseFiles(side, {
    'src/items/items.service.ts': lines(
      'import { Injectable } from "@nestjs/common";',
      '',
      'export interface Item {',
      '  id: number;',
      '  name: string;',
      '  description: string;',
      '}',
      '',
      '@Injectable()',
      'export class ItemsService {',
      '  private items = new Map<number, Item>();',
      '  private sequence = 0;',
      '',
      '  list(): Item[] {',
      '    return [...this.items.values()];',
      '  }',
      '',
      '  get(id: number): Item | undefined {',
      '    return this.items.get(id);',
      '  }',
      '',
      '  create(name: string, description = ""): Item {',
      '    this.sequence += 1;',
      '    const item = { id: this.sequence, name, description };',
      '    this.items.set(item.id, item);',
      '    return item;',
      '  }',
      '',
      '  update(id: number, name: string, description = ""): Item | undefined {',
      '    if (!this.items.has(id)) return undefined;',
      '    const item = { id, name, description };',
      '    this.items.set(id, item);',
      '    return item;',
      '  }',
      '',
      '  remove(id: number): boolean {',
      '    return this.items.delete(id);',
      '  }',
      '}',
    ),
    'src/items/items.controller.ts': lines(
      'import { Body, Controller, Get, HttpCode, HttpException, Param, Post } from "@nestjs/common";',
      'import { ItemsService } from "./items.service";',
      '',
      '@Controller("api/items")',
      'export class ItemsController {',
      '  constructor(private readonly items: ItemsService) {}',
      '',
      '  @Get()',
      '  list() {',
      '    return this.items.list();',
      '  }',
      '',
      '  @Get(":id")',
      '  get(@Param("id") id: string) {',
      '    const item = this.items.get(Number(id));',
      '    if (!item) throw new HttpException("not found", 404);',
      '    return item;',
      '  }',
      '',
      '  @Post()',
      '  create(@Body() body: { name?: string; description?: string }) {',
      '    const name = String(body?.name || "").trim();',
      '    if (!name) throw new HttpException("name is required", 400);',
      '    return this.items.create(name, body?.description || "");',
      '  }',
      '',
      '  @Post("update")',
      '  @HttpCode(200)',
      '  update(@Body() body: { id?: number; name?: string; description?: string }) {',
      '    const id = this.mutationId(body);',
      '    const name = String(body?.name || "").trim();',
      '    if (!name) throw new HttpException("name is required", 400);',
      '    const item = this.items.update(Number(id), name, body?.description || "");',
      '    if (!item) throw new HttpException("not found", 404);',
      '    return item;',
      '  }',
      '',
      '  @Post("delete")',
      '  @HttpCode(200)',
      '  remove(@Body() body: { id?: number }) {',
      '    const id = this.mutationId(body);',
      '    if (!this.items.remove(id)) throw new HttpException("not found", 404);',
      '    return { id, deleted: true };',
      '  }',
      '',
      '  private mutationId(body: { id?: number } | null) {',
      '    const id = body?.id;',
      '    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) throw new HttpException("id must be a positive integer", 400);',
      '    return id;',
      '  }',
      '}',
    ),
    'src/items/items.module.ts': lines(
      'import { Module } from "@nestjs/common";',
      'import { ItemsController } from "./items.controller";',
      'import { ItemsService } from "./items.service";',
      '',
      '@Module({',
      '  controllers: [ItemsController],',
      '  providers: [ItemsService],',
      '})',
      'export class ItemsModule {}',
    ),
    'src/app.module.ts': lines(
      'import { Module } from "@nestjs/common";',
      'import { ItemsModule } from "./items/items.module";',
      '',
      '@Module({ imports: [ItemsModule] })',
      'export class AppModule {}',
    ),
    'src/main.ts': lines(
      'import { NestFactory } from "@nestjs/core";',
      'import { AppModule } from "./app.module";',
      '',
      'async function bootstrap() {',
      '  const app = await NestFactory.create(AppModule);',
      '  await app.listen(3000);',
      '}',
      '',
      'bootstrap();',
    ),
    'test/items.spec.ts': lines(
      'import { Test } from "@nestjs/testing";',
      'import request from "supertest";',
      'import { AppModule } from "../src/app.module";',
      '',
      'describe("items api", () => {',
      '  it("crud", async () => {',
      '    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();',
      '    const app = moduleRef.createNestApplication();',
      '    await app.init();',
      '    const server = app.getHttpServer();',
      '    const created = await request(server).post("/api/items").send({ name: "demo" });',
      '    expect(created.status).toBe(201);',
      '    const id = created.body.id;',
      '    expect((await request(server).get("/api/items/" + id)).status).toBe(200);',
      '    expect((await request(server).post("/api/items/update").send({ id, name: "updated" })).body.name).toBe("updated");',
      '    const deleted = await request(server).post("/api/items/delete").send({ id });',
      '    expect(deleted.status).toBe(200);',
      '    expect(deleted.body).toEqual({ id, deleted: true });',
      '    await app.close();',
      '  });',
      '});',
    ),
  });
}

export function v4NodeFiles(side) {
  const ts = isTs(side);
  if (side.framework === 'nestjs') return nestFiles(side);
  if (side.framework === 'fastify') return fastifyFiles(side, ts);
  return expressFiles(side, ts);
}
