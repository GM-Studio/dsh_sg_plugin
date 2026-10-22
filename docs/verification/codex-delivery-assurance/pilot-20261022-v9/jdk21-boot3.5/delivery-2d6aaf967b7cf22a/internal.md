# Internal delivery evidence: delivery-2d6aaf967b7cf22a

- Project: project-516bae15846143ff
- Change: jdk21-boot3.5-modify-completion-percent
- Commit: 4272323ac0352452af2cbd1f96f195a81ef5a3af
- Environment: 842a5680e931e44b0f301c1ab63c93031c8be4fa368a529f41002bbdf222b1c0
- Review mode: evidence-and-diff

## Acceptance
- AC-RATE

## Evidence
- pilot-4985c5d51f8991f2
- pilot-f58f734d64f59845
- pilot-21b2b801f337b9e9
- pilot-0380f883b7f311e0

## Internal details
```json
{
  "scenario": "modify-completion-percent",
  "contract": {
    "schemaVersion": 2,
    "changeId": "jdk21-boot3.5-modify-completion-percent",
    "parentDeliveryId": "delivery-67b50c7aed303818",
    "type": "modify",
    "request": "Add completion percentage to task statistics.",
    "scope": [
      "Task statistics response"
    ],
    "nonGoals": [
      "Do not change task filtering."
    ],
    "acceptance": [
      "AC-RATE"
    ],
    "assumptions": [],
    "risks": [],
    "baselineId": "baseline-8fe8f383711fb25f",
    "status": "H1_PENDING"
  },
  "verification": {
    "schemaVersion": 2,
    "verificationId": "verify-e872745029e5dee8",
    "risk": "yellow",
    "independenceLevel": "fresh-context",
    "acCoverage": [
      {
        "acId": "AC-RATE",
        "evidenceIds": [
          "pilot-4985c5d51f8991f2",
          "pilot-f58f734d64f59845",
          "pilot-21b2b801f337b9e9",
          "pilot-0380f883b7f311e0"
        ],
        "sufficiency": "sufficient",
        "summary": "Passing evidence covers AC-RATE."
      }
    ],
    "evidence": [
      "pilot-4985c5d51f8991f2",
      "pilot-f58f734d64f59845",
      "pilot-21b2b801f337b9e9",
      "pilot-0380f883b7f311e0"
    ],
    "reviewMode": "evidence-and-diff",
    "environmentFingerprint": "842a5680e931e44b0f301c1ab63c93031c8be4fa368a529f41002bbdf222b1c0",
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
      "cwd": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-MvqD21\\jdk21-boot3.5\\backend",
      "startedAt": "2026-10-22T00:51:35.922Z",
      "finishedAt": "2026-10-22T00:51:37.395Z",
      "exitCode": 0,
      "stdout": "[INFO] Scanning for projects...\r\n[INFO] \r\n[INFO] ------------------------< com.example:task-api >------------------------\r\n[INFO] Building task-api 1.0.0\r\n[INFO]   from pom.xml\r\n[INFO] --------------------------------[ jar ]---------------------------------\r\n[INFO] \r\n[INFO] --- spotless:2.44.0:apply (default-cli) @ task-api ---\r\n[INFO] clean file: C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-MvqD21\\jdk21-boot3.5\\backend\\src\\main\\java\\com\\example\\tasks\\vo\\TaskStatsVO.java\r\n[INFO] clean file: C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-MvqD21\\jdk21-boot3.5\\backend\\src\\test\\java\\com\\example\\tasks\\TaskStatsApiTest.java\r\n[INFO] Spotless.Java is keeping 39 files clean - 2 were changed to be clean, 0 were already clean, 37 were skipped because caching determined they were already clean\r\n[INFO] ------------------------------------------------------------------------\r\n[INFO] BUILD SUCCESS\r\n[INFO] ------------------------------------------------------------------------\r\n[INFO] Total time:  0.653 s\r\n[INFO] Finished at: 2026-10-22T08:51:37+08:00\r\n[INFO] ------------------------------------------------------------------------\r\n",
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
      "cwd": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-MvqD21\\jdk21-boot3.5\\backend",
      "startedAt": "2026-10-22T00:51:37.395Z",
      "finishedAt": "2026-10-22T00:51:46.081Z",
      "exitCode": 0,
      "stdout": "[INFO] Scanning for projects...\r\n[INFO] \r\n[INFO] ------------------------< com.example:task-api >------------------------\r\n[INFO] Building task-api 1.0.0\r\n[INFO]   from pom.xml\r\n[INFO] --------------------------------[ jar ]---------------------------------\r\n[INFO] \r\n[INFO] --- jacoco:0.8.13:prepare-agent (default) @ task-api ---\r\n[INFO] argLine set to -javaagent:C:\\\\Users\\\\Administrator\\\\.m2\\\\repository\\\\org\\\\jacoco\\\\org.jacoco.agent\\\\0.8.13\\\\org.jacoco.agent-0.8.13-runtime.jar=destfile=C:\\\\Users\\\\Administrator\\\\AppData\\\\Local\\\\Temp\\\\sg-delivery-pilot-MvqD21\\\\jdk21-boot3.5\\\\backend\\\\target\\\\jacoco.exec\r\n[INFO] \r\n[INFO] --- resources:3.3.1:resources (default-resources) @ task-api ---\r\n[INFO] Copying 1 resource from src\\main\\resources to target\\classes\r\n[INFO] Copying 0 resource from src\\main\\resources to target\\classes\r\n[INFO] \r\n[INFO] --- compiler:3.14.1:compile (default-compile) @ task-api ---\r\n[INFO] Recompiling the module because of changed source code.\r\n[INFO] Compiling 33 source files with javac [debug parameters release 21] to target\\classes\r\n[INFO] \r\n[INFO] --- resources:3.3.1:testResources (default-testResources) @ task-api ---\r\n[INFO] skip non existing resourceDirectory C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-MvqD21\\jdk21-boot3.5\\backend\\src\\test\\resources\r\n[INFO] \r\n[INFO] --- compiler:3.14.1:testCompile (default-testCompile) @ task-api ---\r\n[INFO] Recompiling the module because of changed dependency.\r\n[INFO] Compiling 6 source files with javac [debug parameters release 21] to target\\test-classes\r\n[INFO] \r\n[INFO] --- surefire:3.5.6:test (default-test) @ task-api ---\r\n[INFO] Using auto detected provider org.apache.maven.surefire.junitplatform.JUnitPlatformProvider\r\n[INFO] \r\n[INFO] -------------------------------------------------------\r\n[INFO]  T E S T S\r\n[INFO] -------------------------------------------------------\r\n[INFO] Running com.example.tasks.TaskStatsApiTest\r\n08:51:40.931 [main] INFO org.springframework.test.context.support.AnnotationConfigContextLoaderUtils -- Could not detect default configuration classes for test class [com.example.tasks.TaskStatsApiTest]: TaskStatsApiTest does not declare any static, non-private, non-final, nested classes annotated with @Configuration.\r\n08:51:41.054 [main] INFO org.springframework.boot.test.context.SpringBootTestContextBootstrapper -- Found @SpringBootConfiguration com.example.tasks.TaskApplication for test class com.example.tasks.TaskStatsApiTest\r\n\r\n  .   ____          _            __ _ _\n /\\\\ / ___'_ __ _ _(_)_ __  __ _ \\ \\ \\ \\\n( ( )\\___ | '_ | '_| | '_ \\/ _` | \\ \\ \\ \\\n \\\\/  ___)| |_)| | | | | || (_| |  ) ) ) )\n  '  |____| .__|_| |_|_| |_\\__, | / / / /\n =========|_|==============|___/=/_/_/_/\n\r\n :: Spring Boot ::               (v3.5.16)\r\n\r\n2026-10-22T08:51:41.430+08:00  INFO 21800 --- [           main] com.example.tasks.TaskStatsApiTest       : Starting TaskStatsApiTest using Java 21.0.9 with PID 21800 (started by Administrator in C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-MvqD21\\jdk21-boot3.5\\backend)\r\n2026-10-22T08:51:41.431+08:00  INFO 21800 --- [           main] com.example.tasks.TaskStatsApiTest       : No active profile set, falling back to 1 default profile: \"default\"\r\n2026-10-22T08:51:42.160+08:00  INFO 21800 --- [           main] .s.d.r.c.RepositoryConfigurationDelegate : Bootstrapping Spring Data JPA repositories in DEFAULT mode.\r\n2026-10-22T08:51:42.205+08:00  INFO 21800 --- [           main] .s.d.r.c.RepositoryConfigurationDelegate : Finished Spring Data repository scanning in 36 ms. Found 2 JPA repository interfaces.\r\n2026-10-22T08:51:42.611+08:00  INFO 21800 --- [           main] o.hibernate.jpa.internal.util.LogHelper  : HHH000204: Processing PersistenceUnitInfo [name: default]\r\n2026-10-22T08:51:42.660+08:00  INFO 21800 --- [           main] org.hibernate.Version                    : HHH000412: Hibernate ORM core version 6.6.53.Final\r\n2026-10-22T08:51:42.688+08:00  INFO 21800 --- [           main] o.h.c.internal.RegionFactoryInitiator    : HHH000026: Second-level cache disabled\r\n2026-10-22T08:51:42.935+08:00  INFO 21800 --- [           main] o.s.o.j.p.SpringPersistenceUnitInfo      : No LoadTimeWeaver setup: ignoring JPA class transformer\r\n2026-10-22T08:51:42.965+08:00  INFO 21800 --- [           main] com.zaxxer.hikari.HikariDataSource       : HikariPool-1 - Starting...\r\n2026-10-22T08:51:43.214+08:00  INFO 21800 --- [           main] com.zaxxer.hikari.pool.HikariPool        : HikariPool-1 - Added connection conn0: url=jdbc:h2:mem:stats user=SA\r\n2026-10-22T08:51:43.216+08:00  INFO 21800 --- [           main] com.zaxxer.hikari.HikariDataSource       : HikariPool-1 - Start completed.\r\n2026-10-22T08:51:43.276+08:00  INFO 21800 --- [           main] org.hibernate.orm.connections.pooling    : HHH10001005: Database info:\n\tDatabase JDBC URL [Connecting through datasource 'HikariDataSource (HikariPool-1)']\n\tDatabase driver: undefined/unknown\n\tDatabase version: 2.3.232\n\tAutocommit mode: undefined/unknown\n\tIsolation level: undefined/unknown\n\tMinimum pool size: undefined/unknown\n\tMaximum pool size: undefined/unknown\r\n2026-10-22T08:51:43.950+08:00  INFO 21800 --- [           main] o.h.e.t.j.p.i.JtaPlatformInitiator       : HHH000489: No JTA platform available (set 'hibernate.transaction.jta.platform' to enable JTA platform integration)\r\n2026-10-22T08:51:44.010+08:00  INFO 21800 --- [           main] j.LocalContainerEntityManagerFactoryBean : Initialized JPA EntityManagerFactory for persistence unit 'default'\r\n2026-10-22T08:51:44.470+08:00  INFO 21800 --- [           main] r$InitializeUserDetailsManagerConfigurer : Global AuthenticationManager configured with UserDetailsService bean with name localUsersOnly\r\n2026-10-22T08:51:44.977+08:00  INFO 21800 --- [           main] o.s.b.a.e.web.EndpointLinksResolver      : Exposing 1 endpoint beneath base path '/actuator'\r\n2026-10-22T08:51:45.026+08:00  INFO 21800 --- [           main] o.s.b.t.m.w.SpringBootMockServletContext : Initializing Spring TestDispatcherServlet ''\r\n2026-10-22T08:51:45.027+08:00  INFO 21800 --- [           main] o.s.t.web.servlet.TestDispatcherServlet  : Initializing Servlet ''\r\n2026-10-22T08:51:45.027+08:00  INFO 21800 --- [           main] o.s.t.web.servlet.TestDispatcherServlet  : Completed initialization in 0 ms\r\n2026-10-22T08:51:45.069+08:00  INFO 21800 --- [           main] com.example.tasks.TaskStatsApiTest       : Started TaskStatsApiTest in 3.884 seconds (process running for 4.785)\r\n[INFO] Tests run: 1, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 5.066 s -- in com.example.tasks.TaskStatsApiTest\r\n[INFO] \r\n[INFO] Results:\r\n[INFO] \r\n[INFO] Tests run: 1, Failures: 0, Errors: 0, Skipped: 0\r\n[INFO] \r\n[INFO] ------------------------------------------------------------------------\r\n[INFO] BUILD SUCCESS\r\n[INFO] ------------------------------------------------------------------------\r\n[INFO] Total time:  7.808 s\r\n[INFO] Finished at: 2026-10-22T08:51:46+08:00\r\n[INFO] ------------------------------------------------------------------------\r\n",
      "stderr": "Mockito is currently self-attaching to enable the inline-mock-maker. This will no longer work in future releases of the JDK. Please add Mockito as an agent to your build as described in Mockito's documentation: https://javadoc.io/doc/org.mockito/mockito-core/latest/org.mockito/org/mockito/Mockito.html#0.3\r\nOpenJDK 64-Bit Server VM warning: Sharing is only supported for boot loader classes because bootstrap classpath has been appended\r\nWARNING: A Java agent has been loaded dynamically (C:\\Users\\Administrator\\.m2\\repository\\net\\bytebuddy\\byte-buddy-agent\\1.17.8\\byte-buddy-agent-1.17.8.jar)\r\nWARNING: If a serviceability tool is in use, please run with -XX:+EnableDynamicAgentLoading to hide this warning\r\nWARNING: If a serviceability tool is not in use, please run with -Djdk.instrument.traceUsage for more information\r\nWARNING: Dynamic loading of agents will be disallowed by default in a future release\r\n"
    },
    {
      "command": [
        "D:\\Program Files\\nodejs\\npm.cmd",
        "run",
        "test"
      ],
      "cwd": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-MvqD21\\jdk21-boot3.5\\frontend",
      "startedAt": "2026-10-22T00:51:46.081Z",
      "finishedAt": "2026-10-22T00:51:48.400Z",
      "exitCode": 0,
      "stdout": "\n> task-web@1.0.0 test\n> vitest run --coverage\n\n\n RUN  v4.0.18 C:/Users/Administrator/AppData/Local/Temp/sg-delivery-pilot-MvqD21/jdk21-boot3.5/frontend\n      Coverage enabled with v8\n\n ✓ test/api.test.ts (4 tests) 15ms\n ✓ test/App.test.ts (7 tests) 383ms\n\n Test Files  2 passed (2)\n      Tests  11 passed (11)\n   Start at  08:51:46\n   Duration  1.65s (transform 150ms, setup 0ms, import 859ms, tests 398ms, environment 521ms)\n\n % Coverage report from v8\n-------------|---------|----------|---------|---------|---------------------\nFile         | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s   \n-------------|---------|----------|---------|---------|---------------------\nAll files    |   96.69 |    97.61 |   95.45 |   96.94 |                     \n src         |    95.6 |    97.34 |   94.18 |   95.88 |                     \n  App.vue    |   96.13 |    97.34 |   94.18 |   96.44 | 170-171,263-273,298 \n  main.ts    |       0 |      100 |     100 |       0 | 6                   \n src/api     |     100 |      100 |     100 |     100 |                     \n  auth.ts    |     100 |      100 |     100 |     100 |                     \n  files.ts   |     100 |      100 |     100 |     100 |                     \n  request.ts |     100 |      100 |     100 |     100 |                     \n  tasks.ts   |     100 |      100 |     100 |     100 |                     \n  types.ts   |       0 |        0 |       0 |       0 |                     \n-------------|---------|----------|---------|---------|---------------------\n",
      "stderr": ""
    },
    {
      "command": [
        "D:\\Program Files\\nodejs\\npm.cmd",
        "run",
        "build"
      ],
      "cwd": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-MvqD21\\jdk21-boot3.5\\frontend",
      "startedAt": "2026-10-22T00:51:48.400Z",
      "finishedAt": "2026-10-22T00:51:52.529Z",
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
    "cwd": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-MvqD21\\jdk21-boot3.5\\backend",
    "startedAt": "2026-10-22T00:51:27.620Z",
    "finishedAt": "2026-10-22T00:51:35.922Z",
    "exitCode": 1,
    "stdout": "[INFO] Scanning for projects...\r\n[INFO] \r\n[INFO] ------------------------< com.example:task-api >------------------------\r\n[INFO] Building task-api 1.0.0\r\n[INFO]   from pom.xml\r\n[INFO] --------------------------------[ jar ]---------------------------------\r\n[INFO] \r\n[INFO] --- jacoco:0.8.13:prepare-agent (default) @ task-api ---\r\n[INFO] argLine set to -javaagent:C:\\\\Users\\\\Administrator\\\\.m2\\\\repository\\\\org\\\\jacoco\\\\org.jacoco.agent\\\\0.8.13\\\\org.jacoco.agent-0.8.13-runtime.jar=destfile=C:\\\\Users\\\\Administrator\\\\AppData\\\\Local\\\\Temp\\\\sg-delivery-pilot-MvqD21\\\\jdk21-boot3.5\\\\backend\\\\target\\\\jacoco.exec\r\n[INFO] \r\n[INFO] --- resources:3.3.1:resources (default-resources) @ task-api ---\r\n[INFO] Copying 1 resource from src\\main\\resources to target\\classes\r\n[INFO] Copying 0 resource from src\\main\\resources to target\\classes\r\n[INFO] \r\n[INFO] --- compiler:3.14.1:compile (default-compile) @ task-api ---\r\n[INFO] Nothing to compile - all classes are up to date.\r\n[INFO] \r\n[INFO] --- resources:3.3.1:testResources (default-testResources) @ task-api ---\r\n[INFO] skip non existing resourceDirectory C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-MvqD21\\jdk21-boot3.5\\backend\\src\\test\\resources\r\n[INFO] \r\n[INFO] --- compiler:3.14.1:testCompile (default-testCompile) @ task-api ---\r\n[INFO] Recompiling the module because of changed source code.\r\n[INFO] Compiling 6 source files with javac [debug parameters release 21] to target\\test-classes\r\n[INFO] \r\n[INFO] --- surefire:3.5.6:test (default-test) @ task-api ---\r\n[INFO] Using auto detected provider org.apache.maven.surefire.junitplatform.JUnitPlatformProvider\r\n[INFO] \r\n[INFO] -------------------------------------------------------\r\n[INFO]  T E S T S\r\n[INFO] -------------------------------------------------------\r\n[INFO] Running com.example.tasks.TaskStatsApiTest\r\n08:51:30.803 [main] INFO org.springframework.test.context.support.AnnotationConfigContextLoaderUtils -- Could not detect default configuration classes for test class [com.example.tasks.TaskStatsApiTest]: TaskStatsApiTest does not declare any static, non-private, non-final, nested classes annotated with @Configuration.\r\n08:51:30.916 [main] INFO org.springframework.boot.test.context.SpringBootTestContextBootstrapper -- Found @SpringBootConfiguration com.example.tasks.TaskApplication for test class com.example.tasks.TaskStatsApiTest\r\n\r\n  .   ____          _            __ _ _\n /\\\\ / ___'_ __ _ _(_)_ __  __ _ \\ \\ \\ \\\n( ( )\\___ | '_ | '_| | '_ \\/ _` | \\ \\ \\ \\\n \\\\/  ___)| |_)| | | | | || (_| |  ) ) ) )\n  '  |____| .__|_| |_|_| |_\\__, | / / / /\n =========|_|==============|___/=/_/_/_/\n\r\n :: Spring Boot ::               (v3.5.16)\r\n\r\n2026-10-22T08:51:31.310+08:00  INFO 20852 --- [           main] com.example.tasks.TaskStatsApiTest       : Starting TaskStatsApiTest using Java 21.0.9 with PID 20852 (started by Administrator in C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-MvqD21\\jdk21-boot3.5\\backend)\r\n2026-10-22T08:51:31.311+08:00  INFO 20852 --- [           main] com.example.tasks.TaskStatsApiTest       : No active profile set, falling back to 1 default profile: \"default\"\r\n2026-10-22T08:51:32.024+08:00  INFO 20852 --- [           main] .s.d.r.c.RepositoryConfigurationDelegate : Bootstrapping Spring Data JPA repositories in DEFAULT mode.\r\n2026-10-22T08:51:32.073+08:00  INFO 20852 --- [           main] .s.d.r.c.RepositoryConfigurationDelegate : Finished Spring Data repository scanning in 41 ms. Found 2 JPA repository interfaces.\r\n2026-10-22T08:51:32.461+08:00  INFO 20852 --- [           main] o.hibernate.jpa.internal.util.LogHelper  : HHH000204: Processing PersistenceUnitInfo [name: default]\r\n2026-10-22T08:51:32.502+08:00  INFO 20852 --- [           main] org.hibernate.Version                    : HHH000412: Hibernate ORM core version 6.6.53.Final\r\n2026-10-22T08:51:32.529+08:00  INFO 20852 --- [           main] o.h.c.internal.RegionFactoryInitiator    : HHH000026: Second-level cache disabled\r\n2026-10-22T08:51:32.778+08:00  INFO 20852 --- [           main] o.s.o.j.p.SpringPersistenceUnitInfo      : No LoadTimeWeaver setup: ignoring JPA class transformer\r\n2026-10-22T08:51:32.806+08:00  INFO 20852 --- [           main] com.zaxxer.hikari.HikariDataSource       : HikariPool-1 - Starting...\r\n2026-10-22T08:51:33.045+08:00  INFO 20852 --- [           main] com.zaxxer.hikari.pool.HikariPool        : HikariPool-1 - Added connection conn0: url=jdbc:h2:mem:stats user=SA\r\n2026-10-22T08:51:33.046+08:00  INFO 20852 --- [           main] com.zaxxer.hikari.HikariDataSource       : HikariPool-1 - Start completed.\r\n2026-10-22T08:51:33.110+08:00  INFO 20852 --- [           main] org.hibernate.orm.connections.pooling    : HHH10001005: Database info:\n\tDatabase JDBC URL [Connecting through datasource 'HikariDataSource (HikariPool-1)']\n\tDatabase driver: undefined/unknown\n\tDatabase version: 2.3.232\n\tAutocommit mode: undefined/unknown\n\tIsolation level: undefined/unknown\n\tMinimum pool size: undefined/unknown\n\tMaximum pool size: undefined/unknown\r\n2026-10-22T08:51:33.800+08:00  INFO 20852 --- [           main] o.h.e.t.j.p.i.JtaPlatformInitiator       : HHH000489: No JTA platform available (set 'hibernate.transaction.jta.platform' to enable JTA platform integration)\r\n2026-10-22T08:51:33.865+08:00  INFO 20852 --- [           main] j.LocalContainerEntityManagerFactoryBean : Initialized JPA EntityManagerFactory for persistence unit 'default'\r\n2026-10-22T08:51:34.325+08:00  INFO 20852 --- [           main] r$InitializeUserDetailsManagerConfigurer : Global AuthenticationManager configured with UserDetailsService bean with name localUsersOnly\r\n2026-10-22T08:51:34.844+08:00  INFO 20852 --- [           main] o.s.b.a.e.web.EndpointLinksResolver      : Exposing 1 endpoint beneath base path '/actuator'\r\n2026-10-22T08:51:34.894+08:00  INFO 20852 --- [           main] o.s.b.t.m.w.SpringBootMockServletContext : Initializing Spring TestDispatcherServlet ''\r\n2026-10-22T08:51:34.894+08:00  INFO 20852 --- [           main] o.s.t.web.servlet.TestDispatcherServlet  : Initializing Servlet ''\r\n2026-10-22T08:51:34.895+08:00  INFO 20852 --- [           main] o.s.t.web.servlet.TestDispatcherServlet  : Completed initialization in 1 ms\r\n2026-10-22T08:51:34.938+08:00  INFO 20852 --- [           main] com.example.tasks.TaskStatsApiTest       : Started TaskStatsApiTest in 3.879 seconds (process running for 4.772)\r\n\r\nMockHttpServletRequest:\r\n      HTTP Method = GET\r\n      Request URI = /api/tasks/stats\r\n       Parameters = {}\r\n          Headers = []\r\n             Body = null\r\n    Session Attrs = {SPRING_SECURITY_CONTEXT=SecurityContextImpl [Authentication=UsernamePasswordAuthenticationToken [Principal=org.springframework.security.core.userdetails.User [Username=viewer, Password=[PROTECTED], Enabled=true, AccountNonExpired=true, CredentialsNonExpired=true, AccountNonLocked=true, Granted Authorities=[ROLE_USER]], Credentials=[PROTECTED], Authenticated=true, Details=null, Granted Authorities=[ROLE_USER]]]}\r\n\r\nHandler:\r\n             Type = com.example.tasks.controller.TaskStatsController\r\n           Method = com.example.tasks.controller.TaskStatsController#stats()\r\n\r\nAsync:\r\n    Async started = false\r\n     Async result = null\r\n\r\nResolved Exception:\r\n             Type = null\r\n\r\nModelAndView:\r\n        View name = null\r\n             View = null\r\n            Model = null\r\n\r\nFlashMap:\r\n       Attributes = null\r\n\r\nMockHttpServletResponse:\r\n           Status = 200\r\n    Error message = null\r\n          Headers = [X-Trace-Id:\"d8506d3c-2366-4895-958a-969888e72b6f\", Content-Type:\"application/json\", X-Content-Type-Options:\"nosniff\", X-XSS-Protection:\"0\", Cache-Control:\"no-cache, no-store, max-age=0, must-revalidate\", Pragma:\"no-cache\", Expires:\"0\", X-Frame-Options:\"DENY\"]\r\n     Content type = application/json\r\n             Body = {\"code\":0,\"message\":\"OK\",\"data\":{\"total\":3,\"completed\":2,\"inProgress\":1},\"traceId\":\"d8506d3c-2366-4895-958a-969888e72b6f\"}\r\n    Forwarded URL = null\r\n   Redirected URL = null\r\n          Cookies = []\r\n[ERROR] Tests run: 1, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: 5.036 s <<< FAILURE! -- in com.example.tasks.TaskStatsApiTest\r\n[ERROR] com.example.tasks.TaskStatsApiTest.statsCountsTasksByCompletion -- Time elapsed: 0.684 s <<< FAILURE!\r\njava.lang.AssertionError: No value at JSON path \"$.data.completionPercent\"\r\n\tat org.springframework.test.util.JsonPathExpectationsHelper.evaluateJsonPath(JsonPathExpectationsHelper.java:351)\r\n\tat org.springframework.test.util.JsonPathExpectationsHelper.assertValue(JsonPathExpectationsHelper.java:148)\r\n\tat org.springframework.test.web.servlet.result.JsonPathResultMatchers.lambda$value$2(JsonPathResultMatchers.java:112)\r\n\tat org.springframework.test.web.servlet.MockMvc$1.andExpect(MockMvc.java:214)\r\n\tat com.example.tasks.TaskStatsApiTest.statsCountsTasksByCompletion(TaskStatsApiTest.java:42)\r\n\tat java.base/java.lang.reflect.Method.invoke(Method.java:580)\r\n\tat java.base/java.util.ArrayList.forEach(ArrayList.java:1596)\r\n\tat java.base/java.util.ArrayList.forEach(ArrayList.java:1596)\r\nCaused by: com.jayway.jsonpath.PathNotFoundException: No results for path: $['data']['completionPercent']\r\n\r\n[INFO] \r\n[INFO] Results:\r\n[INFO] \r\n[ERROR] Failures: \r\n[ERROR]   TaskStatsApiTest.statsCountsTasksByCompletion:42 No value at JSON path \"$.data.completionPercent\"\r\n[INFO] \r\n[ERROR] Tests run: 1, Failures: 1, Errors: 0, Skipped: 0\r\n[INFO] \r\n[INFO] ------------------------------------------------------------------------\r\n[INFO] BUILD FAILURE\r\n[INFO] ------------------------------------------------------------------------\r\n[INFO] Total time:  7.455 s\r\n[INFO] Finished at: 2026-10-22T08:51:35+08:00\r\n[INFO] ------------------------------------------------------------------------\r\n[ERROR] Failed to execute goal org.apache.maven.plugins:maven-surefire-plugin:3.5.6:test (default-test) on project task-api: There are test failures.\r\n[ERROR] \r\n[ERROR] See C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-MvqD21\\jdk21-boot3.5\\backend\\target\\surefire-reports for the individual test results.\r\n[ERROR] See dump files (if any exist) [date].dump, [date]-jvmRun[N].dump and [date].dumpstream.\r\n[ERROR] -> [Help 1]\r\n[ERROR] \r\n[ERROR] To see the full stack trace of the errors, re-run Maven with the -e switch.\r\n[ERROR] Re-run Maven using the -X switch to enable full debug logging.\r\n[ERROR] \r\n[ERROR] For more information about the errors and possible solutions, please read the following articles:\r\n[ERROR] [Help 1] http://cwiki.apache.org/confluence/display/MAVEN/MojoFailureException\r\n",
    "stderr": "Mockito is currently self-attaching to enable the inline-mock-maker. This will no longer work in future releases of the JDK. Please add Mockito as an agent to your build as described in Mockito's documentation: https://javadoc.io/doc/org.mockito/mockito-core/latest/org.mockito/org/mockito/Mockito.html#0.3\r\nWARNING: A Java agent has been loaded dynamically (C:\\Users\\Administrator\\.m2\\repository\\net\\bytebuddy\\byte-buddy-agent\\1.17.8\\byte-buddy-agent-1.17.8.jar)\r\nWARNING: If a serviceability tool is in use, please run with -XX:+EnableDynamicAgentLoading to hide this warning\r\nWARNING: If a serviceability tool is not in use, please run with -Djdk.instrument.traceUsage for more information\r\nWARNING: Dynamic loading of agents will be disallowed by default in a future release\r\nOpenJDK 64-Bit Server VM warning: Sharing is only supported for boot loader classes because bootstrap classpath has been appended\r\n"
  }
}
```
