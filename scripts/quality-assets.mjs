// Checks code assets that need a materialized project, not a raw .tpl parser.
import fs from 'node:fs';
import path from 'node:path';
import { javaFullstackFiles } from '../src/v4/java-fullstack-template.js';
import { normalizeJavaPreset } from '../src/v4/java-versions.js';
import { bootstrapCodeFiles } from '../src/v3/bootstrap-code.js';
import { scanToolchains, pickJavaHome, verifyJavaProject } from '../src/v4/java-verify.js';
import { executeCommand } from './quality-checks.mjs';
import { materializeReference } from './quality-reference.mjs';
const files = process.argv.slice(2);
if (files.some((name) => name.startsWith('test/fixtures/reference-note/'))) {
  const root = fs.mkdtempSync(path.resolve('.specgate/reference-check-'));
  materializeReference(root, process.cwd());
  const repo = process.env.SG_QUALITY_REPOSITORY || process.cwd();
  const result = await verifyJavaProject({
    root,
    install: false,
    full: false,
    scan: {
      extraJavaRoots: [path.join(repo, '.specgate/toolchains')],
      extraMavenRoots: [path.join(repo, '.specgate/toolchains')],
    },
    onProgress: (event) => console.log(event.message),
  });
  console.log('Reference evidence: ' + path.join(root, '.specgate/verify-report.json'));
  if (!result.ok) throw new Error(result.message);
}
if (files.some((name) => name.startsWith('assets/scaffold/java/'))) {
  const preset = normalizeJavaPreset('jdk8-boot2.7').preset;
  const generated = javaFullstackFiles({ preset });
  const root = fs.mkdtempSync(path.resolve('.specgate/scaffold-check-'));
  const tools = scanToolchains({
    root: process.env.SG_QUALITY_REPOSITORY || process.cwd(),
    scan: { requestedJdk: '8' },
  });
  const java = pickJavaHome(tools.java, '8');
  if (!java || !tools.maven)
    throw new Error('JDK8 and Maven required for Java scaffold verification');
  let pom = generated['backend/pom.xml'];
  pom = pom.replace('<style>AOSP</style>', '<style>GOOGLE</style>');
  pom = pom.replace(/<plugin><groupId>org.jacoco<\/groupId>[\s\S]*?<\/plugin>/, '');
  for (const artifact of ['spring-boot-starter-security', 'spring-security-test'])
    pom = pom.replace(
      new RegExp(
        '<dependency><groupId>[^<]+</groupId><artifactId>' +
          artifact +
          '</artifactId>[\\s\\S]*?</dependency>',
      ),
      '',
    );
  const write = (name, text) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  write('pom.xml', pom);
  write('checkstyle.xml', generated['backend/checkstyle.xml']);
  write(
    'src/main/java/com/example/demo/Application.java',
    'package com.example.demo;\n@org.springframework.boot.autoconfigure.SpringBootApplication\npublic class Application { public static void main(String[] args) { org.springframework.boot.SpringApplication.run(Application.class, args); } }\n',
  );
  for (const [name, text] of Object.entries(
    bootstrapCodeFiles('java', { packageName: 'com.example.demo', bootVersion: '2.7.18' }),
  ))
    write(name, text);
  const env = {
    ...process.env,
    JAVA_HOME: java,
    PATH: path.join(java, 'bin') + path.delimiter + (process.env.PATH || ''),
  };
  env.Path = env.PATH;
  // The synthetic application/store are formatted independently; candidate controller bytes remain unchanged.
  executeCommand(
    'scaffold-tests-static',
    tools.maven.path,
    ['-B', '-ntp', 'test', 'checkstyle:check'],
    { cwd: root, env },
  );
  executeCommand(
    'scaffold-format',
    tools.maven.path,
    ['-B', '-ntp', 'spotless:check', '-DspotlessFiles=.*ItemController.*[.]java'],
    { cwd: root, env },
  );
}
if (
  files.some(
    (name) =>
      /^assets\/e2e\/customer\/backend\/[A-Za-z0-9]+\.java$/.test(name) ||
      /^assets\/e2e\/customer\/source\/backend\/src\/main\/java\/.+\.java$/.test(name),
  )
) {
  const preset = normalizeJavaPreset('jdk8-boot2.7').preset;
  const generated = javaFullstackFiles({ preset });
  const root = fs.mkdtempSync(path.resolve('.specgate/customer-e2e-check-'));
  const write = (name, text) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  for (const [name, text] of Object.entries(generated)) write(name, text);

  const customerRoot = path.join(process.cwd(), 'assets/e2e/customer');
  fs.cpSync(path.join(customerRoot, 'source'), root, { recursive: true });
  write(
    'backend/src/test/java/com/example/tasks/CustomerApiTest.java',
    fs.readFileSync(path.join(customerRoot, 'backend/CustomerApiTest.java'), 'utf8'),
  );

  const tools = scanToolchains({
    root: process.env.SG_QUALITY_REPOSITORY || process.cwd(),
    scan: { requestedJdk: '8' },
  });
  const java = pickJavaHome(tools.java, '8');
  if (!java || !tools.maven)
    throw new Error('JDK8 and Maven required for Customer E2E asset verification');
  const env = {
    ...process.env,
    JAVA_HOME: java,
    PATH: path.join(java, 'bin') + path.delimiter + (process.env.PATH || ''),
  };
  env.Path = env.PATH;
  executeCommand(
    'customer-e2e-tests-static',
    tools.maven.path,
    ['-B', '-ntp', '-Dtest=CustomerApiTest', 'test', 'checkstyle:check'],
    { cwd: path.join(root, 'backend'), env },
  );
}
