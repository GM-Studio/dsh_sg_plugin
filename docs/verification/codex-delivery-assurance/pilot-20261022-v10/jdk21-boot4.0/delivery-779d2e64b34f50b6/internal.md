# Internal delivery evidence: delivery-779d2e64b34f50b6

- Project: project-8237cb1f4c4af4b8
- Change: jdk21-boot4.0-feature-stats
- Commit: f48764f3a8414d8e90830c59e28d0f3fb9b62a04
- Environment: 34aa444a23c0b9116960d0a1c14a51079ac0180b7eb000434d86aaa3a643c9c0
- Review mode: evidence-and-diff

## Acceptance
- AC-STATS

## Evidence
- pilot-08d85b4c52c0b025
- pilot-83bb7b5c57f53ee3
- pilot-b6e0951c737758fa
- pilot-0c3c89d5dc64a0b8

## Internal details
```json
{
  "scenario": "feature-stats",
  "contract": {
    "schemaVersion": 2,
    "changeId": "jdk21-boot4.0-feature-stats",
    "parentDeliveryId": null,
    "type": "feature",
    "request": "Add task completion statistics.",
    "scope": [
      "Task statistics endpoint"
    ],
    "nonGoals": [
      "Do not change task editing or filtering."
    ],
    "acceptance": [
      "AC-STATS"
    ],
    "assumptions": [],
    "risks": [],
    "baselineId": "baseline-bca28d47d9ba4c36",
    "status": "H1_PENDING"
  },
  "verification": {
    "schemaVersion": 2,
    "verificationId": "verify-21f0e499f16c53f5",
    "risk": "yellow",
    "independenceLevel": "fresh-context",
    "acCoverage": [
      {
        "acId": "AC-STATS",
        "evidenceIds": [
          "pilot-08d85b4c52c0b025",
          "pilot-83bb7b5c57f53ee3",
          "pilot-b6e0951c737758fa",
          "pilot-0c3c89d5dc64a0b8"
        ],
        "sufficiency": "sufficient",
        "summary": "Passing evidence covers AC-STATS."
      }
    ],
    "evidence": [
      "pilot-08d85b4c52c0b025",
      "pilot-83bb7b5c57f53ee3",
      "pilot-b6e0951c737758fa",
      "pilot-0c3c89d5dc64a0b8"
    ],
    "reviewMode": "evidence-and-diff",
    "environmentFingerprint": "34aa444a23c0b9116960d0a1c14a51079ac0180b7eb000434d86aaa3a643c9c0",
    "openRisks": [],
    "decision": "requires-h3"
  },
  "receipts": [
    {
      "command": [
        "C:\\Users\\Administrator\\.m2\\wrapper\\dists\\apache-maven-3.9.11\\03d7e36a140982eea48e22c1dcac01d8862b2550b2939e09a0809bbc5182a5bc\\bin\\mvn.cmd",
        "-B",
        "-ntp",
        "spotless:apply"
      ],
      "cwd": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-Wnboa1\\jdk21-boot4.0\\backend",
      "startedAt": "2026-10-22T01:02:10.453Z",
      "finishedAt": "2026-10-22T01:02:11.983Z",
      "exitCode": 0,
      "stdout": "[INFO] Scanning for projects...\r\n[INFO] \r\n[INFO] ------------------------< com.example:task-api >------------------------\r\n[INFO] Building task-api 1.0.0\r\n[INFO]   from pom.xml\r\n[INFO] --------------------------------[ jar ]---------------------------------\r\n[INFO] \r\n[INFO] --- spotless:2.44.0:apply (default-cli) @ task-api ---\r\n[INFO] clean file: C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-Wnboa1\\jdk21-boot4.0\\backend\\src\\test\\java\\com\\example\\tasks\\TaskStatsApiTest.java\r\n[INFO] Spotless.Java is keeping 39 files clean - 1 were changed to be clean, 4 were already clean, 34 were skipped because caching determined they were already clean\r\n[INFO] ------------------------------------------------------------------------\r\n[INFO] BUILD SUCCESS\r\n[INFO] ------------------------------------------------------------------------\r\n[INFO] Total time:  0.667 s\r\n[INFO] Finished at: 2026-10-22T09:02:11+08:00\r\n[INFO] ------------------------------------------------------------------------\r\n",
      "stderr": ""
    },
    {
      "command": [
        "C:\\Users\\Administrator\\.m2\\wrapper\\dists\\apache-maven-3.9.11\\03d7e36a140982eea48e22c1dcac01d8862b2550b2939e09a0809bbc5182a5bc\\bin\\mvn.cmd",
        "-B",
        "-ntp",
        "-Dtest=TaskStatsApiTest",
        "test"
      ],
      "cwd": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-Wnboa1\\jdk21-boot4.0\\backend",
      "startedAt": "2026-10-22T01:02:11.983Z",
      "finishedAt": "2026-10-22T01:02:21.165Z",
      "exitCode": 0,
      "stdout": "[INFO] Scanning for projects...\r\n[INFO] \r\n[INFO] ------------------------< com.example:task-api >------------------------\r\n[INFO] Building task-api 1.0.0\r\n[INFO]   from pom.xml\r\n[INFO] --------------------------------[ jar ]---------------------------------\r\n[INFO] \r\n[INFO] --- jacoco:0.8.13:prepare-agent (default) @ task-api ---\r\n[INFO] argLine set to -javaagent:C:\\\\Users\\\\Administrator\\\\.m2\\\\repository\\\\org\\\\jacoco\\\\org.jacoco.agent\\\\0.8.13\\\\org.jacoco.agent-0.8.13-runtime.jar=destfile=C:\\\\Users\\\\Administrator\\\\AppData\\\\Local\\\\Temp\\\\sg-delivery-pilot-Wnboa1\\\\jdk21-boot4.0\\\\backend\\\\target\\\\jacoco.exec\r\n[INFO] \r\n[INFO] --- resources:3.3.1:resources (default-resources) @ task-api ---\r\n[INFO] Copying 1 resource from src\\main\\resources to target\\classes\r\n[INFO] Copying 0 resource from src\\main\\resources to target\\classes\r\n[INFO] \r\n[INFO] --- compiler:3.14.1:compile (default-compile) @ task-api ---\r\n[INFO] Recompiling the module because of changed source code.\r\n[INFO] Compiling 33 source files with javac [debug parameters release 21] to target\\classes\r\n[INFO] \r\n[INFO] --- resources:3.3.1:testResources (default-testResources) @ task-api ---\r\n[INFO] skip non existing resourceDirectory C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-Wnboa1\\jdk21-boot4.0\\backend\\src\\test\\resources\r\n[INFO] \r\n[INFO] --- compiler:3.14.1:testCompile (default-testCompile) @ task-api ---\r\n[INFO] Recompiling the module because of changed dependency.\r\n[INFO] Compiling 6 source files with javac [debug parameters release 21] to target\\test-classes\r\n[INFO] /C:/Users/Administrator/AppData/Local/Temp/sg-delivery-pilot-Wnboa1/jdk21-boot4.0/backend/src/test/java/com/example/tasks/TaskApiTest.java: C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-Wnboa1\\jdk21-boot4.0\\backend\\src\\test\\java\\com\\example\\tasks\\TaskApiTest.javaʹ�û򸲸����ѹ�ʱ�� API��\r\n[INFO] /C:/Users/Administrator/AppData/Local/Temp/sg-delivery-pilot-Wnboa1/jdk21-boot4.0/backend/src/test/java/com/example/tasks/TaskApiTest.java: �й���ϸ��Ϣ, ��ʹ�� -Xlint:deprecation ���±��롣\r\n[INFO] \r\n[INFO] --- surefire:3.5.4:test (default-test) @ task-api ---\r\n[INFO] Using auto detected provider org.apache.maven.surefire.junitplatform.JUnitPlatformProvider\r\n[INFO] \r\n[INFO] -------------------------------------------------------\r\n[INFO]  T E S T S\r\n[INFO] -------------------------------------------------------\r\n[INFO] Running com.example.tasks.TaskStatsApiTest\r\n09:02:15.800 [main] INFO org.springframework.test.context.support.AnnotationConfigContextLoaderUtils -- Could not detect default configuration classes for test class [com.example.tasks.TaskStatsApiTest]: TaskStatsApiTest does not declare any static, non-private, non-final, nested classes annotated with @Configuration.\r\n09:02:15.898 [main] INFO org.springframework.boot.test.context.SpringBootTestContextBootstrapper -- Found @SpringBootConfiguration com.example.tasks.TaskApplication for test class com.example.tasks.TaskStatsApiTest\r\n\r\n  .   ____          _            __ _ _\n /\\\\ / ___'_ __ _ _(_)_ __  __ _ \\ \\ \\ \\\n( ( )\\___ | '_ | '_| | '_ \\/ _` | \\ \\ \\ \\\n \\\\/  ___)| |_)| | | | | || (_| |  ) ) ) )\n  '  |____| .__|_| |_|_| |_\\__, | / / / /\n =========|_|==============|___/=/_/_/_/\n\r\n :: Spring Boot ::                (v4.0.0)\r\n\r\n2026-10-22T09:02:16.272+08:00  INFO 23864 --- [           main] com.example.tasks.TaskStatsApiTest       : Starting TaskStatsApiTest using Java 21.0.9 with PID 23864 (started by Administrator in C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-Wnboa1\\jdk21-boot4.0\\backend)\r\n2026-10-22T09:02:16.273+08:00  INFO 23864 --- [           main] com.example.tasks.TaskStatsApiTest       : No active profile set, falling back to 1 default profile: \"default\"\r\n2026-10-22T09:02:16.895+08:00  INFO 23864 --- [           main] .s.d.r.c.RepositoryConfigurationDelegate : Bootstrapping Spring Data JPA repositories in DEFAULT mode.\r\n2026-10-22T09:02:16.947+08:00  INFO 23864 --- [           main] .s.d.r.c.RepositoryConfigurationDelegate : Finished Spring Data repository scanning in 45 ms. Found 2 JPA repository interfaces.\r\n2026-10-22T09:02:17.369+08:00  INFO 23864 --- [           main] o.hibernate.jpa.internal.util.LogHelper  : HHH000204: Processing PersistenceUnitInfo [name: default]\r\n2026-10-22T09:02:17.415+08:00  INFO 23864 --- [           main] org.hibernate.Version                    : HHH000412: Hibernate ORM core version 7.1.8.Final\r\n2026-10-22T09:02:17.829+08:00  INFO 23864 --- [           main] o.s.o.j.p.SpringPersistenceUnitInfo      : No LoadTimeWeaver setup: ignoring JPA class transformer\r\n2026-10-22T09:02:17.870+08:00  INFO 23864 --- [           main] com.zaxxer.hikari.HikariDataSource       : HikariPool-1 - Starting...\r\n2026-10-22T09:02:18.087+08:00  INFO 23864 --- [           main] com.zaxxer.hikari.pool.HikariPool        : HikariPool-1 - Added connection conn0: url=jdbc:h2:mem:stats user=SA\r\n2026-10-22T09:02:18.088+08:00  INFO 23864 --- [           main] com.zaxxer.hikari.HikariDataSource       : HikariPool-1 - Start completed.\r\n2026-10-22T09:02:18.140+08:00  INFO 23864 --- [           main] org.hibernate.orm.connections.pooling    : HHH10001005: Database info:\n\tDatabase JDBC URL [jdbc:h2:mem:stats]\n\tDatabase driver: H2 JDBC Driver\n\tDatabase dialect: H2Dialect\n\tDatabase version: 2.3.232\n\tDefault catalog/schema: STATS/PUBLIC\n\tAutocommit mode: undefined/unknown\n\tIsolation level: READ_COMMITTED [default READ_COMMITTED]\n\tJDBC fetch size: 100\n\tPool: DatasourceConnectionProviderImpl\n\tMinimum pool size: undefined/unknown\n\tMaximum pool size: undefined/unknown\r\n2026-10-22T09:02:18.887+08:00  INFO 23864 --- [           main] o.h.e.t.j.p.i.JtaPlatformInitiator       : HHH000489: No JTA platform available (set 'hibernate.transaction.jta.platform' to enable JTA platform integration)\r\n2026-10-22T09:02:18.955+08:00  INFO 23864 --- [           main] j.LocalContainerEntityManagerFactoryBean : Initialized JPA EntityManagerFactory for persistence unit 'default'\r\n2026-10-22T09:02:19.190+08:00  INFO 23864 --- [           main] o.s.d.j.r.query.QueryEnhancerFactories   : Hibernate is in classpath; If applicable, HQL parser will be used.\r\n2026-10-22T09:02:19.473+08:00  INFO 23864 --- [           main] r$InitializeUserDetailsManagerConfigurer : Global AuthenticationManager configured with UserDetailsService bean with name localUsersOnly\r\n2026-10-22T09:02:19.962+08:00  INFO 23864 --- [           main] o.s.b.t.m.w.SpringBootMockServletContext : Initializing Spring TestDispatcherServlet ''\r\n2026-10-22T09:02:19.962+08:00  INFO 23864 --- [           main] o.s.t.web.servlet.TestDispatcherServlet  : Initializing Servlet ''\r\n2026-10-22T09:02:19.967+08:00  INFO 23864 --- [           main] o.s.b.a.e.web.EndpointLinksResolver      : Exposing 1 endpoint beneath base path '/actuator'\r\n2026-10-22T09:02:19.972+08:00  INFO 23864 --- [           main] o.s.t.web.servlet.TestDispatcherServlet  : Completed initialization in 10 ms\r\n2026-10-22T09:02:20.018+08:00  INFO 23864 --- [           main] com.example.tasks.TaskStatsApiTest       : Started TaskStatsApiTest in 3.987 seconds (process running for 5.038)\r\n[INFO] Tests run: 1, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 5.310 s -- in com.example.tasks.TaskStatsApiTest\r\n[INFO] \r\n[INFO] Results:\r\n[INFO] \r\n[INFO] Tests run: 1, Failures: 0, Errors: 0, Skipped: 0\r\n[INFO] \r\n[INFO] ------------------------------------------------------------------------\r\n[INFO] BUILD SUCCESS\r\n[INFO] ------------------------------------------------------------------------\r\n[INFO] Total time:  8.343 s\r\n[INFO] Finished at: 2026-10-22T09:02:21+08:00\r\n[INFO] ------------------------------------------------------------------------\r\n",
      "stderr": "Mockito is currently self-attaching to enable the inline-mock-maker. This will no longer work in future releases of the JDK. Please add Mockito as an agent to your build as described in Mockito's documentation: https://javadoc.io/doc/org.mockito/mockito-core/latest/org.mockito/org/mockito/Mockito.html#0.3\r\nOpenJDK 64-Bit Server VM warning: Sharing is only supported for boot loader classes because bootstrap classpath has been appended\r\nWARNING: A Java agent has been loaded dynamically (C:\\Users\\Administrator\\.m2\\repository\\net\\bytebuddy\\byte-buddy-agent\\1.17.8\\byte-buddy-agent-1.17.8.jar)\r\nWARNING: If a serviceability tool is in use, please run with -XX:+EnableDynamicAgentLoading to hide this warning\r\nWARNING: If a serviceability tool is not in use, please run with -Djdk.instrument.traceUsage for more information\r\nWARNING: Dynamic loading of agents will be disallowed by default in a future release\r\n"
    },
    {
      "command": [
        "D:\\Program Files\\nodejs\\npm.cmd",
        "run",
        "test"
      ],
      "cwd": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-Wnboa1\\jdk21-boot4.0\\frontend",
      "startedAt": "2026-10-22T01:02:21.165Z",
      "finishedAt": "2026-10-22T01:02:23.536Z",
      "exitCode": 0,
      "stdout": "\n> task-web@1.0.0 test\n> vitest run --coverage\n\n\n RUN  v4.0.18 C:/Users/Administrator/AppData/Local/Temp/sg-delivery-pilot-Wnboa1/jdk21-boot4.0/frontend\n      Coverage enabled with v8\n\n ✓ test/api.test.ts (4 tests) 15ms\n ✓ test/App.test.ts (7 tests) 366ms\n\n Test Files  2 passed (2)\n      Tests  11 passed (11)\n   Start at  09:02:21\n   Duration  1.68s (transform 150ms, setup 0ms, import 886ms, tests 381ms, environment 541ms)\n\n % Coverage report from v8\n-------------|---------|----------|---------|---------|---------------------\nFile         | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s   \n-------------|---------|----------|---------|---------|---------------------\nAll files    |   96.69 |    97.61 |   95.45 |   96.94 |                     \n src         |    95.6 |    97.34 |   94.18 |   95.88 |                     \n  App.vue    |   96.13 |    97.34 |   94.18 |   96.44 | 170-171,263-273,298 \n  main.ts    |       0 |      100 |     100 |       0 | 6                   \n src/api     |     100 |      100 |     100 |     100 |                     \n  auth.ts    |     100 |      100 |     100 |     100 |                     \n  files.ts   |     100 |      100 |     100 |     100 |                     \n  request.ts |     100 |      100 |     100 |     100 |                     \n  tasks.ts   |     100 |      100 |     100 |     100 |                     \n  types.ts   |       0 |        0 |       0 |       0 |                     \n-------------|---------|----------|---------|---------|---------------------\n",
      "stderr": ""
    },
    {
      "command": [
        "D:\\Program Files\\nodejs\\npm.cmd",
        "run",
        "build"
      ],
      "cwd": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-Wnboa1\\jdk21-boot4.0\\frontend",
      "startedAt": "2026-10-22T01:02:23.536Z",
      "finishedAt": "2026-10-22T01:02:27.692Z",
      "exitCode": 0,
      "stdout": "\n> task-web@1.0.0 build\n> vue-tsc --noEmit && vite build\n\nvite v7.3.1 building client environment for production...\ntransforming...\n✓ 1423 modules transformed.\nrendering chunks...\ncomputing gzip size...\ndist/index.html                   0.39 kB │ gzip:  0.26 kB\ndist/assets/index-BBrXui40.css  345.66 kB │ gzip: 47.84 kB\ndist/assets/index-DH6ZI0IC.js   274.35 kB │ gzip: 96.05 kB\n✓ built in 1.96s\n",
      "stderr": ""
    }
  ],
  "redReceipt": {
    "command": [
      "C:\\Users\\Administrator\\.m2\\wrapper\\dists\\apache-maven-3.9.11\\03d7e36a140982eea48e22c1dcac01d8862b2550b2939e09a0809bbc5182a5bc\\bin\\mvn.cmd",
      "-B",
      "-ntp",
      "-Dtest=TaskStatsApiTest",
      "test"
    ],
    "cwd": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-Wnboa1\\jdk21-boot4.0\\backend",
    "startedAt": "2026-10-22T01:02:02.019Z",
    "finishedAt": "2026-10-22T01:02:10.449Z",
    "exitCode": 1,
    "stdout": "[INFO] Scanning for projects...\r\n[INFO] \r\n[INFO] ------------------------< com.example:task-api >------------------------\r\n[INFO] Building task-api 1.0.0\r\n[INFO]   from pom.xml\r\n[INFO] --------------------------------[ jar ]---------------------------------\r\n[INFO] \r\n[INFO] --- jacoco:0.8.13:prepare-agent (default) @ task-api ---\r\n[INFO] argLine set to -javaagent:C:\\\\Users\\\\Administrator\\\\.m2\\\\repository\\\\org\\\\jacoco\\\\org.jacoco.agent\\\\0.8.13\\\\org.jacoco.agent-0.8.13-runtime.jar=destfile=C:\\\\Users\\\\Administrator\\\\AppData\\\\Local\\\\Temp\\\\sg-delivery-pilot-Wnboa1\\\\jdk21-boot4.0\\\\backend\\\\target\\\\jacoco.exec\r\n[INFO] \r\n[INFO] --- resources:3.3.1:resources (default-resources) @ task-api ---\r\n[INFO] Copying 1 resource from src\\main\\resources to target\\classes\r\n[INFO] Copying 0 resource from src\\main\\resources to target\\classes\r\n[INFO] \r\n[INFO] --- compiler:3.14.1:compile (default-compile) @ task-api ---\r\n[INFO] Nothing to compile - all classes are up to date.\r\n[INFO] \r\n[INFO] --- resources:3.3.1:testResources (default-testResources) @ task-api ---\r\n[INFO] skip non existing resourceDirectory C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-Wnboa1\\jdk21-boot4.0\\backend\\src\\test\\resources\r\n[INFO] \r\n[INFO] --- compiler:3.14.1:testCompile (default-testCompile) @ task-api ---\r\n[INFO] Recompiling the module because of changed source code.\r\n[INFO] Compiling 6 source files with javac [debug parameters release 21] to target\\test-classes\r\n[INFO] /C:/Users/Administrator/AppData/Local/Temp/sg-delivery-pilot-Wnboa1/jdk21-boot4.0/backend/src/test/java/com/example/tasks/TaskApiTest.java: C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-Wnboa1\\jdk21-boot4.0\\backend\\src\\test\\java\\com\\example\\tasks\\TaskApiTest.javaʹ�û򸲸����ѹ�ʱ�� API��\r\n[INFO] /C:/Users/Administrator/AppData/Local/Temp/sg-delivery-pilot-Wnboa1/jdk21-boot4.0/backend/src/test/java/com/example/tasks/TaskApiTest.java: �й���ϸ��Ϣ, ��ʹ�� -Xlint:deprecation ���±��롣\r\n[INFO] \r\n[INFO] --- surefire:3.5.4:test (default-test) @ task-api ---\r\n[INFO] Using auto detected provider org.apache.maven.surefire.junitplatform.JUnitPlatformProvider\r\n[INFO] \r\n[INFO] -------------------------------------------------------\r\n[INFO]  T E S T S\r\n[INFO] -------------------------------------------------------\r\n[INFO] Running com.example.tasks.TaskStatsApiTest\r\n09:02:05.397 [main] INFO org.springframework.test.context.support.AnnotationConfigContextLoaderUtils -- Could not detect default configuration classes for test class [com.example.tasks.TaskStatsApiTest]: TaskStatsApiTest does not declare any static, non-private, non-final, nested classes annotated with @Configuration.\r\n09:02:05.493 [main] INFO org.springframework.boot.test.context.SpringBootTestContextBootstrapper -- Found @SpringBootConfiguration com.example.tasks.TaskApplication for test class com.example.tasks.TaskStatsApiTest\r\n\r\n  .   ____          _            __ _ _\n /\\\\ / ___'_ __ _ _(_)_ __  __ _ \\ \\ \\ \\\n( ( )\\___ | '_ | '_| | '_ \\/ _` | \\ \\ \\ \\\n \\\\/  ___)| |_)| | | | | || (_| |  ) ) ) )\n  '  |____| .__|_| |_|_| |_\\__, | / / / /\n =========|_|==============|___/=/_/_/_/\n\r\n :: Spring Boot ::                (v4.0.0)\r\n\r\n2026-10-22T09:02:05.855+08:00  INFO 16748 --- [           main] com.example.tasks.TaskStatsApiTest       : Starting TaskStatsApiTest using Java 21.0.9 with PID 16748 (started by Administrator in C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-Wnboa1\\jdk21-boot4.0\\backend)\r\n2026-10-22T09:02:05.856+08:00  INFO 16748 --- [           main] com.example.tasks.TaskStatsApiTest       : No active profile set, falling back to 1 default profile: \"default\"\r\n2026-10-22T09:02:06.455+08:00  INFO 16748 --- [           main] .s.d.r.c.RepositoryConfigurationDelegate : Bootstrapping Spring Data JPA repositories in DEFAULT mode.\r\n2026-10-22T09:02:06.506+08:00  INFO 16748 --- [           main] .s.d.r.c.RepositoryConfigurationDelegate : Finished Spring Data repository scanning in 44 ms. Found 2 JPA repository interfaces.\r\n2026-10-22T09:02:06.946+08:00  INFO 16748 --- [           main] o.hibernate.jpa.internal.util.LogHelper  : HHH000204: Processing PersistenceUnitInfo [name: default]\r\n2026-10-22T09:02:06.995+08:00  INFO 16748 --- [           main] org.hibernate.Version                    : HHH000412: Hibernate ORM core version 7.1.8.Final\r\n2026-10-22T09:02:07.421+08:00  INFO 16748 --- [           main] o.s.o.j.p.SpringPersistenceUnitInfo      : No LoadTimeWeaver setup: ignoring JPA class transformer\r\n2026-10-22T09:02:07.456+08:00  INFO 16748 --- [           main] com.zaxxer.hikari.HikariDataSource       : HikariPool-1 - Starting...\r\n2026-10-22T09:02:07.662+08:00  INFO 16748 --- [           main] com.zaxxer.hikari.pool.HikariPool        : HikariPool-1 - Added connection conn0: url=jdbc:h2:mem:stats user=SA\r\n2026-10-22T09:02:07.664+08:00  INFO 16748 --- [           main] com.zaxxer.hikari.HikariDataSource       : HikariPool-1 - Start completed.\r\n2026-10-22T09:02:07.713+08:00  INFO 16748 --- [           main] org.hibernate.orm.connections.pooling    : HHH10001005: Database info:\n\tDatabase JDBC URL [jdbc:h2:mem:stats]\n\tDatabase driver: H2 JDBC Driver\n\tDatabase dialect: H2Dialect\n\tDatabase version: 2.3.232\n\tDefault catalog/schema: STATS/PUBLIC\n\tAutocommit mode: undefined/unknown\n\tIsolation level: READ_COMMITTED [default READ_COMMITTED]\n\tJDBC fetch size: 100\n\tPool: DatasourceConnectionProviderImpl\n\tMinimum pool size: undefined/unknown\n\tMaximum pool size: undefined/unknown\r\n2026-10-22T09:02:08.434+08:00  INFO 16748 --- [           main] o.h.e.t.j.p.i.JtaPlatformInitiator       : HHH000489: No JTA platform available (set 'hibernate.transaction.jta.platform' to enable JTA platform integration)\r\n2026-10-22T09:02:08.505+08:00  INFO 16748 --- [           main] j.LocalContainerEntityManagerFactoryBean : Initialized JPA EntityManagerFactory for persistence unit 'default'\r\n2026-10-22T09:02:08.737+08:00  INFO 16748 --- [           main] o.s.d.j.r.query.QueryEnhancerFactories   : Hibernate is in classpath; If applicable, HQL parser will be used.\r\n2026-10-22T09:02:08.959+08:00  INFO 16748 --- [           main] r$InitializeUserDetailsManagerConfigurer : Global AuthenticationManager configured with UserDetailsService bean with name localUsersOnly\r\n2026-10-22T09:02:09.509+08:00  INFO 16748 --- [           main] o.s.b.t.m.w.SpringBootMockServletContext : Initializing Spring TestDispatcherServlet ''\r\n2026-10-22T09:02:09.509+08:00  INFO 16748 --- [           main] o.s.t.web.servlet.TestDispatcherServlet  : Initializing Servlet ''\r\n2026-10-22T09:02:09.513+08:00  INFO 16748 --- [           main] o.s.b.a.e.web.EndpointLinksResolver      : Exposing 1 endpoint beneath base path '/actuator'\r\n2026-10-22T09:02:09.518+08:00  INFO 16748 --- [           main] o.s.t.web.servlet.TestDispatcherServlet  : Completed initialization in 9 ms\r\n2026-10-22T09:02:09.557+08:00  INFO 16748 --- [           main] com.example.tasks.TaskStatsApiTest       : Started TaskStatsApiTest in 3.934 seconds (process running for 4.974)\r\n\r\nMockHttpServletRequest:\r\n      HTTP Method = GET\r\n      Request URI = /api/tasks/stats\r\n       Parameters = {}\r\n          Headers = []\r\n             Body = null\r\n    Session Attrs = {SPRING_SECURITY_CONTEXT=SecurityContextImpl [Authentication=UsernamePasswordAuthenticationToken [Principal=org.springframework.security.core.userdetails.User [Username=viewer, Password=[PROTECTED], Enabled=true, AccountNonExpired=true, CredentialsNonExpired=true, AccountNonLocked=true, Granted Authorities=[ROLE_USER]], Credentials=[PROTECTED], Authenticated=true, Details=null, Granted Authorities=[ROLE_USER]]]}\r\n\r\nHandler:\r\n             Type = com.example.tasks.controller.TaskController\r\n           Method = com.example.tasks.controller.TaskController#get(Long)\r\n\r\nAsync:\r\n    Async started = false\r\n     Async result = null\r\n\r\nResolved Exception:\r\n             Type = org.springframework.web.method.annotation.MethodArgumentTypeMismatchException\r\n\r\nModelAndView:\r\n        View name = null\r\n             View = null\r\n            Model = null\r\n\r\nFlashMap:\r\n       Attributes = null\r\n\r\nMockHttpServletResponse:\r\n           Status = 400\r\n    Error message = null\r\n          Headers = [X-Trace-Id:\"6b04269a-87e7-479d-bca2-8a9cc25a1d3e\", Content-Type:\"application/json\", X-Content-Type-Options:\"nosniff\", X-XSS-Protection:\"0\", Cache-Control:\"no-cache, no-store, max-age=0, must-revalidate\", Pragma:\"no-cache\", Expires:\"0\", X-Frame-Options:\"DENY\"]\r\n     Content type = application/json\r\n             Body = {\"code\":\"BAD_REQUEST\",\"data\":null,\"message\":\"Malformed request\",\"traceId\":\"6b04269a-87e7-479d-bca2-8a9cc25a1d3e\"}\r\n    Forwarded URL = null\r\n   Redirected URL = null\r\n          Cookies = []\r\n[ERROR] Tests run: 1, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: 4.989 s <<< FAILURE! -- in com.example.tasks.TaskStatsApiTest\r\n[ERROR] com.example.tasks.TaskStatsApiTest.statsCountsTasksByCompletion -- Time elapsed: 0.582 s <<< FAILURE!\r\njava.lang.AssertionError: Status expected:<200> but was:<400>\r\n\tat org.springframework.test.util.AssertionErrors.fail(AssertionErrors.java:62)\r\n\tat org.springframework.test.util.AssertionErrors.assertEquals(AssertionErrors.java:129)\r\n\tat org.springframework.test.web.servlet.result.StatusResultMatchers.lambda$matcher$0(StatusResultMatchers.java:600)\r\n\tat org.springframework.test.web.servlet.MockMvc$1.andExpect(MockMvc.java:212)\r\n\tat com.example.tasks.TaskStatsApiTest.statsCountsTasksByCompletion(TaskStatsApiTest.java:38)\r\n\r\n[INFO] \r\n[INFO] Results:\r\n[INFO] \r\n[ERROR] Failures: \r\n[ERROR]   TaskStatsApiTest.statsCountsTasksByCompletion:38 Status expected:<200> but was:<400>\r\n[INFO] \r\n[ERROR] Tests run: 1, Failures: 1, Errors: 0, Skipped: 0\r\n[INFO] \r\n[INFO] ------------------------------------------------------------------------\r\n[INFO] BUILD FAILURE\r\n[INFO] ------------------------------------------------------------------------\r\n[INFO] Total time:  7.545 s\r\n[INFO] Finished at: 2026-10-22T09:02:10+08:00\r\n[INFO] ------------------------------------------------------------------------\r\n[ERROR] Failed to execute goal org.apache.maven.plugins:maven-surefire-plugin:3.5.4:test (default-test) on project task-api: There are test failures.\r\n[ERROR] \r\n[ERROR] See C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-Wnboa1\\jdk21-boot4.0\\backend\\target\\surefire-reports for the individual test results.\r\n[ERROR] See dump files (if any exist) [date].dump, [date]-jvmRun[N].dump and [date].dumpstream.\r\n[ERROR] -> [Help 1]\r\n[ERROR] \r\n[ERROR] To see the full stack trace of the errors, re-run Maven with the -e switch.\r\n[ERROR] Re-run Maven using the -X switch to enable full debug logging.\r\n[ERROR] \r\n[ERROR] For more information about the errors and possible solutions, please read the following articles:\r\n[ERROR] [Help 1] http://cwiki.apache.org/confluence/display/MAVEN/MojoFailureException\r\n",
    "stderr": "Mockito is currently self-attaching to enable the inline-mock-maker. This will no longer work in future releases of the JDK. Please add Mockito as an agent to your build as described in Mockito's documentation: https://javadoc.io/doc/org.mockito/mockito-core/latest/org.mockito/org/mockito/Mockito.html#0.3\r\nWARNING: A Java agent has been loaded dynamically (C:\\Users\\Administrator\\.m2\\repository\\net\\bytebuddy\\byte-buddy-agent\\1.17.8\\byte-buddy-agent-1.17.8.jar)\r\nWARNING: If a serviceability tool is in use, please run with -XX:+EnableDynamicAgentLoading to hide this warning\r\nWARNING: If a serviceability tool is not in use, please run with -Djdk.instrument.traceUsage for more information\r\nWARNING: Dynamic loading of agents will be disallowed by default in a future release\r\nOpenJDK 64-Bit Server VM warning: Sharing is only supported for boot loader classes because bootstrap classpath has been appended\r\n"
  }
}
```
