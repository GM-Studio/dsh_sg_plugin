export const fixedVersions = Object.freeze({
  java: '8',
  springBoot: '2.7.18',
  maven: '3.6+',
  h2: '2.1.214',
  vue: '3.5.13',
  vite: '5.4.14',
  typescript: '5.7.3',
  npm: '10+',
  node: '20+',
  playwright: '1.51.1',
});
export function fixedSelection() {
  return {
    backend: 'java',
    frontend: 'vue',
    profile: 'full',
    versions: { ...fixedVersions },
    sides: [
      {
        id: 'api',
        path: 'api',
        name: 'api',
        dir: 'api',
        role: 'backend',
        stack: 'java',
        language: 'java',
        framework: 'spring-boot',
        buildTool: 'maven',
        javaVersion: '8',
        runtimeVersion: '8',
      },
      {
        id: 'web',
        path: 'web',
        name: 'web',
        dir: 'web',
        role: 'frontend',
        stack: 'vue',
        language: 'typescript',
        framework: 'vue',
        packageManager: 'npm',
        runtimeVersion: '20+',
      },
    ],
    ports: { api: 8080, web: 5173 },
    storage: { kind: 'h2-file', path: 'api/data/items.mv.db', normalRestartPersistence: true },
    entity: {
      name: 'Item',
      fields: { id: 'server-generated integer', name: 'trimmed required string, length 1–100' },
    },
  };
}
export function fixedScaffoldFiles() {
  return { ...backendFiles, ...frontendFiles, ...documentationFiles };
}
const backendFiles = {
  'api/pom.xml': `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>2.7.18</version><relativePath/></parent><groupId>com.example</groupId><artifactId>item-api</artifactId><version>0.0.1-SNAPSHOT</version><properties><java.version>1.8</java.version></properties><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-data-jpa</artifactId></dependency><dependency><groupId>com.h2database</groupId><artifactId>h2</artifactId><scope>runtime</scope></dependency><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-test</artifactId><scope>test</scope></dependency></dependencies><build><plugins><plugin><groupId>org.springframework.boot</groupId><artifactId>spring-boot-maven-plugin</artifactId></plugin></plugins></build></project>
`,
  'api/src/main/resources/application.properties': `server.address=127.0.0.1
server.port=8080
spring.datasource.url=jdbc:h2:file:./data/items;DB_CLOSE_ON_EXIT=FALSE
spring.datasource.username=sa
spring.datasource.password=
spring.jpa.hibernate.ddl-auto=update
spring.jpa.open-in-view=false
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=20s
`,
  'api/src/main/java/com/example/items/ItemApplication.java': `package com.example.items;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
@SpringBootApplication public class ItemApplication { public static void main(String[] args) { SpringApplication.run(ItemApplication.class, args); } }
`,
  'api/src/main/java/com/example/items/Item.java': `package com.example.items;
import javax.persistence.*;
@Entity public class Item {
 @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
 @Column(nullable=false,length=100) private String name;
 public Item() {} public Item(String name) { this.name=name; }
 public Long getId() { return id; } public String getName() { return name; } public void setName(String name) { this.name=name; }
}
`,
  'api/src/main/java/com/example/items/ItemRepository.java': `package com.example.items;
import org.springframework.data.jpa.repository.JpaRepository;
public interface ItemRepository extends JpaRepository<Item,Long> {}
`,
  'api/src/main/java/com/example/items/ItemController.java': `package com.example.items;
import java.util.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
@RestController @RequestMapping("/api/items") public class ItemController {
 private final ItemRepository repository;
 public ItemController(ItemRepository repository) { this.repository=repository; }
 public static class Input { public String name; }
 private String checked(Input input) { String name=input==null || input.name==null ? "" : input.name.trim(); if(name.length()<1 || name.length()>100) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"name must contain 1–100 characters after trimming"); return name; }
 private Item found(Long id) { return repository.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,"Item not found")); }
 @GetMapping public List<Item> list() { return repository.findAll(org.springframework.data.domain.Sort.by("id")); }
 @GetMapping("/{id}") public Item detail(@PathVariable Long id) { return found(id); }
 @PostMapping public ResponseEntity<Item> create(@RequestBody Input input) { return ResponseEntity.status(201).body(repository.saveAndFlush(new Item(checked(input)))); }
 @PutMapping("/{id}") public Item update(@PathVariable Long id,@RequestBody Input input) { Item item=found(id); item.setName(checked(input)); return repository.saveAndFlush(item); }
 @DeleteMapping("/{id}") public ResponseEntity<Void> delete(@PathVariable Long id) { repository.delete(found(id)); repository.flush(); return ResponseEntity.noContent().build(); }
}
`,
  'api/src/main/java/com/example/items/ApiErrors.java': `package com.example.items;
import java.util.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.converter.HttpMessageNotReadableException;
@RestControllerAdvice public class ApiErrors {
 @ExceptionHandler(ResponseStatusException.class) public ResponseEntity<Map<String,String>> status(ResponseStatusException e) { return ResponseEntity.status(e.getStatus()).body(Collections.singletonMap("message",e.getReason())); }
 @ExceptionHandler(HttpMessageNotReadableException.class) public ResponseEntity<Map<String,String>> malformed() { return ResponseEntity.badRequest().body(Collections.singletonMap("message","Invalid JSON input")); }
}
`,
  'api/src/main/java/com/example/items/VerificationShutdown.java': `package com.example.items;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
@RestController @ConditionalOnProperty(name="verification.shutdown-token") public class VerificationShutdown {
 private final ConfigurableApplicationContext context; private final String token;
 public VerificationShutdown(ConfigurableApplicationContext context,@Value("\${verification.shutdown-token}") String token) { this.context=context; this.token=token; }
 @PostMapping("/internal/verification/shutdown") public ResponseEntity<Void> shutdown(@RequestHeader(value="X-Verification-Token",defaultValue="") String supplied) {
  if(!token.equals(supplied)) return ResponseEntity.status(403).build();
  Thread closer=new Thread(() -> { try { Thread.sleep(250); } catch(InterruptedException e) { Thread.currentThread().interrupt(); } context.close(); },"verification-shutdown"); closer.setDaemon(false); closer.start(); return ResponseEntity.accepted().build();
 }
}
`,
  'api/src/test/java/com/example/items/ItemDatabaseTest.java': String.raw`package com.example.items;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import javax.sql.DataSource;
import java.sql.Connection;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
@SpringBootTest @AutoConfigureMockMvc class ItemDatabaseTest {
 static final String RUN=java.util.UUID.randomUUID().toString();
 @DynamicPropertySource static void fileDatabase(DynamicPropertyRegistry r) { r.add("spring.datasource.url",() -> "jdbc:h2:file:./target/test-data/items-"+RUN+";DB_CLOSE_ON_EXIT=FALSE"); }
 @Autowired MockMvc mvc; @Autowired ItemRepository repository; @Autowired DataSource source;
 @Test void realDatabaseAndCrud() throws Exception {
  try(Connection c=source.getConnection()) { assertTrue(c.getMetaData().getURL().startsWith("jdbc:h2:file:")); }
  mvc.perform(post("/api/items").contentType("application/json").content("{\"name\":\"  persisted  \"}")).andExpect(status().isCreated()).andExpect(jsonPath("$.name").value("persisted"));
  Item item=repository.findAll().get(0); Long id=item.getId(); assertNotNull(id);
  mvc.perform(get("/api/items/"+id)).andExpect(status().isOk()).andExpect(jsonPath("$.name").value("persisted"));
  mvc.perform(get("/api/items")).andExpect(status().isOk()).andExpect(jsonPath("$[0].id").value(id));
  mvc.perform(put("/api/items/"+id).contentType("application/json").content("{\"name\":\" changed \"}")).andExpect(status().isOk());
  assertEquals("changed",repository.findById(id).get().getName());
  for(String bad:new String[]{"{}","{\"name\":null}","{\"name\":\"   \"}","{\"name\":\""+new String(new char[101]).replace('\0','x')+"\"}"}) {
   mvc.perform(post("/api/items").contentType("application/json").content(bad)).andExpect(status().isBadRequest());
   mvc.perform(put("/api/items/"+id).contentType("application/json").content(bad)).andExpect(status().isBadRequest());
  }
  mvc.perform(delete("/api/items/"+id)).andExpect(status().isNoContent()); assertFalse(repository.existsById(id));
  mvc.perform(get("/api/items/"+id)).andExpect(status().isNotFound());
  mvc.perform(put("/api/items/"+id).contentType("application/json").content("{\"name\":\"missing\"}")).andExpect(status().isNotFound());
  mvc.perform(delete("/api/items/"+id)).andExpect(status().isNotFound());
 }
}
`,
};
const frontendFiles = {
  'web/package.json':
    JSON.stringify(
      {
        name: 'item-web',
        version: '0.0.1',
        private: true,
        type: 'module',
        scripts: {
          dev: 'vite --host 127.0.0.1 --port 5173 --strictPort',
          build: 'vue-tsc --noEmit && vite build',
          test: 'node --test tests/*.test.mjs',
        },
        dependencies: { vue: fixedVersions.vue },
        devDependencies: {
          vite: fixedVersions.vite,
          '@vitejs/plugin-vue': '5.2.1',
          typescript: fixedVersions.typescript,
          'vue-tsc': '2.2.0',
          playwright: fixedVersions.playwright,
        },
      },
      null,
      2,
    ) + '\n',
  'web/index.html':
    '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Items</title></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>\n',
  'web/tsconfig.json':
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          lib: ['ES2020', 'DOM'],
          skipLibCheck: true,
          allowJs: true,
          noEmit: true,
        },
        include: ['src/**/*.ts', 'src/**/*.vue', 'src/**/*.mjs'],
      },
      null,
      2,
    ) + '\n',
  'web/vite.config.ts': `import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({plugins:[vue()],server:{host:'127.0.0.1',port:5173,strictPort:true,proxy:{'/api':'http://127.0.0.1:8080'}},preview:{host:'127.0.0.1',port:5173,strictPort:true}});
`,
  'web/src/main.ts': `import { createApp } from 'vue';
import App from './App.vue';
createApp(App).mount('#app');
`,
  'web/src/validation.mjs': `export function checkedName(value) {
 const name=String(value ?? '').trim();
 if(name.length<1 || name.length>100) throw new Error('name must contain 1–100 characters after trimming');
 return name;
}
`,
  'web/tests/validation.test.mjs': `import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedName } from '../src/validation.mjs';
test('trim and 1–100 boundaries',()=>{ assert.equal(checkedName('  item  '),'item'); assert.equal(checkedName('x'.repeat(100)).length,100); for(const value of [null,'','   ','x'.repeat(101)]) assert.throws(()=>checkedName(value),/1–100/); });
`,
  'web/src/App.vue': `<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { checkedName } from './validation.mjs';
type Item = {id:number;name:string};
const items=ref<Item[]>([]),name=ref(''),editing=ref<number|null>(null),detail=ref<Item|null>(null),busy=ref(false),error=ref('');
async function request(url:string,options:RequestInit={}) {
 const response=await fetch(url,options);
 if(!response.ok) { const body=await response.json().catch(()=>({message:'Request failed'})); throw new Error(body.message || 'Request failed ('+response.status+')'); }
 return response.status===204 ? null : response.json();
}
async function perform(action:()=>Promise<void>) { busy.value=true; error.value=''; try { await action(); } catch(e) { error.value=e instanceof Error ? e.message : 'Request failed'; } finally { busy.value=false; } }
async function list() { items.value=await request('/api/items'); }
async function save() { await perform(async()=>{ const valid=checkedName(name.value); await request('/api/items'+(editing.value===null?'':'/'+editing.value),{method:editing.value===null?'POST':'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({name:valid})}); name.value=''; editing.value=null; detail.value=null; await list(); }); }
async function show(id:number) { await perform(async()=>{detail.value=await request('/api/items/'+id);}); }
function edit(item:Item) { editing.value=item.id; name.value=item.name; }
async function remove(id:number) { await perform(async()=>{await request('/api/items/'+id,{method:'DELETE'}); detail.value=null; await list();}); }
onMounted(()=>perform(list));
</script>
<template>
 <main><h1>Items</h1><p v-if="busy" role="status">Loading…</p><p v-if="error" role="alert">{{error}}</p>
 <form @submit.prevent="save"><label for="name">Name</label><input id="name" v-model="name" :disabled="busy"><button type="submit" :disabled="busy">{{editing===null?'Create':'Save'}}</button><button v-if="editing!==null" type="button" @click="editing=null;name=''">Cancel</button></form>
 <button :disabled="busy" @click="perform(list)">Reload</button><p v-if="!busy && items.length===0" data-testid="empty">No items yet.</p>
 <ul><li v-for="item in items" :key="item.id" :data-testid="'item-'+item.id"><span>{{item.name}}</span> <button :disabled="busy" @click="show(item.id)">Details</button> <button :disabled="busy" @click="edit(item)">Edit</button> <button :disabled="busy" @click="remove(item.id)">Delete</button></li></ul>
 <section v-if="detail" data-testid="detail"><h2>Item details</h2><p>ID: {{detail.id}}</p><p>{{detail.name}}</p></section>
 </main>
</template>
<style>body{font:16px system-ui;margin:2rem;color:#182234}main{max-width:800px}input,button{padding:.5rem;margin:.25rem}li{margin:.75rem 0}[role=alert]{color:#b00020}</style>
`,
};
frontendFiles['web/verify-browser.mjs'] =
  "import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport { chromium } from 'playwright';\nconst mode=process.argv[2],marker=process.env.SG_VERIFY_MARKER;\nlet browser;\ntry {\n const executablePath=process.env.SG_BROWSER_PATH || chromium.executablePath();\n if(!fs.existsSync(executablePath)) throw new Error('Browser missing: install/provide existing Chrome or Edge, or preinstall Playwright Chromium. Automatic browser download is forbidden.');\n browser=await chromium.launch({executablePath,headless:true,timeout:30000});\n if(mode==='probe') { console.log('Existing real browser launch passed'); }\n else {\n  assert.ok(marker,'verification marker required');\n  const page=await browser.newPage(); page.setDefaultTimeout(15000);\n  const request=page.request;\n  const api='http://127.0.0.1:8080/api/items';\n  await page.goto('http://127.0.0.1:5173/');\n  await page.getByRole('button',{name:'Create',exact:true}).waitFor();\n  await page.waitForFunction(()=>!document.querySelector('[role=status]'));\n  async function save(name,button='Create') {\n   await page.getByLabel('Name',{exact:true}).fill(name);\n   const response=page.waitForResponse(r=>r.url().includes('/api/items') && ['POST','PUT'].includes(r.request().method()));\n   await page.getByRole('button',{name:button,exact:true}).click();\n   const result=await response; assert.ok(result.ok());\n   await page.waitForFunction(()=>!document.querySelector('[role=status]'));\n   return result.json();\n  }\n  if(mode==='crud') {\n   const listed=await request.get(api);assert.equal(listed.status(),200);\n   if((await listed.json()).length===0) await page.getByTestId('empty').waitFor();\n   for(const bad of ['   ','x'.repeat(101)]) {\n    await page.getByLabel('Name',{exact:true}).fill(bad);await page.getByRole('button',{name:'Create',exact:true}).click();\n    await page.getByRole('alert').waitFor(); assert.match(await page.getByRole('alert').innerText(),/1–100/);\n   }\n   for(const bad of [{},{name:null},{name:'   '},{name:'x'.repeat(101)}]) { const response=await request.post(api,{data:bad});assert.equal(response.status(),400); }\n   const first=await save('  '+marker+'  '); assert.equal(first.name,marker);assert.ok(Number.isInteger(first.id));assert.deepEqual(Object.keys(first).sort(),['id','name']);\n   const row=page.getByTestId('item-'+first.id);await row.waitFor();\n   await row.getByRole('button',{name:'Details',exact:true}).click();await page.getByTestId('detail').waitFor();assert.match(await page.getByTestId('detail').innerText(),new RegExp(marker));\n   await page.waitForFunction(()=>!document.querySelector('[role=status]'));\n   await row.getByRole('button',{name:'Edit',exact:true}).click();\n   const updated=await save(marker+'-updated','Save');assert.equal(updated.name,marker+'-updated');\n   const reread=await request.get(api+'/'+first.id);assert.equal((await reread.json()).name,marker+'-updated');\n   const deleted=page.waitForResponse(r=>r.url().endsWith('/'+first.id) && r.request().method()==='DELETE');\n   await row.getByRole('button',{name:'Delete',exact:true}).click();assert.equal((await deleted).status(),204);\n   await page.waitForFunction(id=>!document.querySelector('[data-testid=\"item-'+id+'\"]'),first.id);\n   assert.equal((await request.get(api+'/'+first.id)).status(),404);\n   const keep=await save(marker);assert.equal(keep.name,marker);\n   // Exercise actual network-error feedback, not a mocked success/API.\n   await page.context().setOffline(true);await page.getByRole('button',{name:'Reload',exact:true}).click();await page.getByRole('alert').waitFor();\n   await page.context().setOffline(false);await page.getByRole('button',{name:'Reload',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[role=status]'));\n   console.log('Real browser CRUD, details, validation, empty/loading/error UI passed');\n  } else if(mode==='persistence') {\n   const listed=await request.get(api);assert.equal(listed.status(),200);const item=(await listed.json()).find(item=>item.name===marker);assert.ok(item,'Persisted marker missing after normal backend restart');\n   await page.getByTestId('item-'+item.id).waitFor();\n   const detail=await request.get(api+'/'+item.id);assert.equal(detail.status(),200);assert.equal((await detail.json()).name,marker);\n   const deleted=page.waitForResponse(r=>r.url().endsWith('/'+item.id) && r.request().method()==='DELETE');\n   await page.getByTestId('item-'+item.id).getByRole('button',{name:'Delete',exact:true}).click();assert.equal((await deleted).status(),204);\n   assert.equal((await request.get(api+'/'+item.id)).status(),404);\n   console.log('Real browser normal-restart file persistence passed; marker removed');\n  } else throw new Error('Unknown verification mode');\n }\n} finally { if(browser) await browser.close(); }\n";
const documentationFiles = {
  '.gitignore':
    'api/.m2-repository/\nweb/.npm-cache/\napi/target/\napi/data/\nweb/node_modules/\nweb/dist/\nweb/test-results/\nweb/playwright-report/\n',
  'README.md':
    '# Fixed CRUD starter\n\nJava 8, Spring Boot 2.7.18, Maven 3.6+, H2 file store; Vue 3, Vite 5, TypeScript and npm. No login, production deployment, toolchain download, global install, or automatic rollback.\n\nInstall from api: `mvn -B -Dmaven.repo.local=./.m2-repository dependency:go-offline`; from web: `npm install --no-audit --no-fund --cache ./.npm-cache`. Build/test API: `mvn -B -Dmaven.repo.local=./.m2-repository package`; UI: `npm run build` and `npm test`. Run from api: `java -Djava.io.tmpdir=./target -jar target/item-api-0.0.1-SNAPSHOT.jar`; from web: `npm run dev`. Fixed localhost ports 8080/5173 never fallback.\n\nItem: generated id, name trimmed to 1–100 characters. GET/POST /api/items; GET/PUT/DELETE /api/items/{id}. Invalid input 400; nonexistent item 404. H2 file api/data/items.mv.db, ignored by Git. Only normal-restart retention is promised, not production backup or crash recovery.\n\nBrowser verification requires an already installed Chrome/Edge or Playwright Chromium. No automatic browser download; missing browser fails explicitly. Verification-only random-token shutdown endpoint closes Spring normally for persistence testing and is absent without verification.shutdown-token.\n',
  'contracts/openapi.yaml':
    'openapi: 3.0.3\ninfo:\n  title: Item API\n  version: 0.0.1\nservers:\n  - url: http://127.0.0.1:8080\npaths:\n  /api/items:\n    get:\n      responses:\n        "200":\n          description: Item list\n          content:\n            application/json:\n              schema:\n                type: array\n                items:\n                  $ref: "#/components/schemas/Item"\n    post:\n      requestBody:\n        $ref: "#/components/requestBodies/Name"\n      responses:\n        "201":\n          description: Created Item\n          content:\n            application/json:\n              schema:\n                $ref: "#/components/schemas/Item"\n        "400":\n          description: Invalid name or JSON\n  /api/items/{id}:\n    parameters:\n      - in: path\n        name: id\n        required: true\n        schema:\n          type: integer\n          format: int64\n    get:\n      responses:\n        "200":\n          description: Item details\n          content:\n            application/json:\n              schema:\n                $ref: "#/components/schemas/Item"\n        "404":\n          description: Item not found\n    put:\n      requestBody:\n        $ref: "#/components/requestBodies/Name"\n      responses:\n        "200":\n          description: Updated Item\n          content:\n            application/json:\n              schema:\n                $ref: "#/components/schemas/Item"\n        "400":\n          description: Invalid name or JSON\n        "404":\n          description: Item not found\n    delete:\n      responses:\n        "204":\n          description: Deleted\n        "404":\n          description: Item not found\ncomponents:\n  schemas:\n    Item:\n      type: object\n      required: [id, name]\n      properties:\n        id:\n          type: integer\n          format: int64\n          readOnly: true\n        name:\n          type: string\n          minLength: 1\n          maxLength: 100\n          description: Length after trimming\n    Name:\n      type: object\n      required: [name]\n      properties:\n        name:\n          type: string\n          minLength: 1\n          maxLength: 100\n          description: Length after trimming\n  requestBodies:\n    Name:\n      required: true\n      content:\n        application/json:\n          schema:\n            $ref: "#/components/schemas/Name"\n',
};
