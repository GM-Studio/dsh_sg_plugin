# Internal delivery evidence: delivery-0554a3cd617382f3

- Project: project-684d30d69b19041b
- Change: jdk17-boot3.5-feature-stats
- Commit: 8472cdaf04e6fb72292a45e42f256a614ba97dd8
- Environment: de9da81007d049e0dee56deb604df78778a176a39f5c990604e15e940e552a4e
- Review mode: evidence-and-diff

## Acceptance
- AC-STATS

## Evidence
- pilot-0c045e227c3b172e
- pilot-ffa89a46a14414cb
- pilot-626aa7356164a9b2
- pilot-8995c45095c5ae72

## Internal details
```json
{
  "scenario": "feature-stats",
  "contract": {
    "schemaVersion": 2,
    "changeId": "jdk17-boot3.5-feature-stats",
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
    "baselineId": "baseline-4ed03bd0ad585f26",
    "status": "H1_PENDING"
  },
  "verification": {
    "schemaVersion": 2,
    "verificationId": "verify-0511eb21b8f75e01",
    "risk": "yellow",
    "independenceLevel": "fresh-context",
    "acCoverage": [
      {
        "acId": "AC-STATS",
        "evidenceIds": [
          "pilot-0c045e227c3b172e",
          "pilot-ffa89a46a14414cb",
          "pilot-626aa7356164a9b2",
          "pilot-8995c45095c5ae72"
        ],
        "sufficiency": "sufficient",
        "summary": "Passing evidence covers AC-STATS."
      }
    ],
    "evidence": [
      "pilot-0c045e227c3b172e",
      "pilot-ffa89a46a14414cb",
      "pilot-626aa7356164a9b2",
      "pilot-8995c45095c5ae72"
    ],
    "reviewMode": "evidence-and-diff",
    "environmentFingerprint": "de9da81007d049e0dee56deb604df78778a176a39f5c990604e15e940e552a4e",
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
      "cwd": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-MvqD21\\jdk17-boot3.5\\backend",
      "startedAt": "2026-10-22T00:48:04.472Z",
      "finishedAt": "2026-10-22T00:48:06.004Z",
      "exitCode": 0,
      "stdout": "[INFO] Scanning for projects...\r\n[INFO] \r\n[INFO] ------------------------< com.example:task-api >------------------------\r\n[INFO] Building task-api 1.0.0\r\n[INFO]   from pom.xml\r\n[INFO] --------------------------------[ jar ]---------------------------------\r\n[INFO] \r\n[INFO] --- spotless:2.44.0:apply (default-cli) @ task-api ---\r\n[INFO] clean file: C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-MvqD21\\jdk17-boot3.5\\backend\\src\\test\\java\\com\\example\\tasks\\TaskStatsApiTest.java\r\n[INFO] Spotless.Java is keeping 39 files clean - 1 were changed to be clean, 4 were already clean, 34 were skipped because caching determined they were already clean\r\n[INFO] ------------------------------------------------------------------------\r\n[INFO] BUILD SUCCESS\r\n[INFO] ------------------------------------------------------------------------\r\n[INFO] Total time:  0.658 s\r\n[INFO] Finished at: 2026-10-22T08:48:05+08:00\r\n[INFO] ------------------------------------------------------------------------\r\n",
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
      "cwd": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-MvqD21\\jdk17-boot3.5\\backend",
      "startedAt": "2026-10-22T00:48:06.004Z",
      "finishedAt": "2026-10-22T00:48:16.271Z",
      "exitCode": 0,
      "stdout": "[INFO] Scanning for projects...\r\n[INFO] \r\n[INFO] ------------------------< com.example:task-api >------------------------\r\n[INFO] Building task-api 1.0.0\r\n[INFO]   from pom.xml\r\n[INFO] --------------------------------[ jar ]---------------------------------\r\n[INFO] \r\n[INFO] --- jacoco:0.8.13:prepare-agent (default) @ task-api ---\r\n[INFO] argLine set to -javaagent:C:\\\\Users\\\\Administrator\\\\.m2\\\\repository\\\\org\\\\jacoco\\\\org.jacoco.agent\\\\0.8.13\\\\org.jacoco.agent-0.8.13-runtime.jar=destfile=C:\\\\Users\\\\Administrator\\\\AppData\\\\Local\\\\Temp\\\\sg-delivery-pilot-MvqD21\\\\jdk17-boot3.5\\\\backend\\\\target\\\\jacoco.exec\r\n[INFO] \r\n[INFO] --- resources:3.3.1:resources (default-resources) @ task-api ---\r\n[INFO] Copying 1 resource from src\\main\\resources to target\\classes\r\n[INFO] Copying 0 resource from src\\main\\resources to target\\classes\r\n[INFO] \r\n[INFO] --- compiler:3.14.1:compile (default-compile) @ task-api ---\r\n[INFO] Recompiling the module because of changed source code.\r\n[INFO] Compiling 33 source files with javac [debug parameters release 17] to target\\classes\r\n[INFO] \r\n[INFO] --- resources:3.3.1:testResources (default-testResources) @ task-api ---\r\n[INFO] skip non existing resourceDirectory C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-MvqD21\\jdk17-boot3.5\\backend\\src\\test\\resources\r\n[INFO] \r\n[INFO] --- compiler:3.14.1:testCompile (default-testCompile) @ task-api ---\r\n[INFO] Recompiling the module because of changed dependency.\r\n[INFO] Compiling 6 source files with javac [debug parameters release 17] to target\\test-classes\r\n[INFO] \r\n[INFO] --- surefire:3.5.6:test (default-test) @ task-api ---\r\n[INFO] Using auto detected provider org.apache.maven.surefire.junitplatform.JUnitPlatformProvider\r\n[INFO] \r\n[INFO] -------------------------------------------------------\r\n[INFO]  T E S T S\r\n[INFO] -------------------------------------------------------\r\n[INFO] Running com.example.tasks.TaskStatsApiTest\r\n08:48:10.062 [main] INFO org.springframework.test.context.support.AnnotationConfigContextLoaderUtils -- Could not detect default configuration classes for test class [com.example.tasks.TaskStatsApiTest]: TaskStatsApiTest does not declare any static, non-private, non-final, nested classes annotated with @Configuration.\r\n08:48:10.233 [main] INFO org.springframework.boot.test.context.SpringBootTestContextBootstrapper -- Found @SpringBootConfiguration com.example.tasks.TaskApplication for test class com.example.tasks.TaskStatsApiTest\r\n\r\n  .   ____          _            __ _ _\n /\\\\ / ___'_ __ _ _(_)_ __  __ _ \\ \\ \\ \\\n( ( )\\___ | '_ | '_| | '_ \\/ _` | \\ \\ \\ \\\n \\\\/  ___)| |_)| | | | | || (_| |  ) ) ) )\n  '  |____| .__|_| |_|_| |_\\__, | / / / /\n =========|_|==============|___/=/_/_/_/\n\r\n :: Spring Boot ::               (v3.5.16)\r\n\r\n2026-10-22T08:48:10.875+08:00  INFO 21976 --- [           main] com.example.tasks.TaskStatsApiTest       : Starting TaskStatsApiTest using Java 17.0.18 with PID 21976 (started by Administrator in C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-MvqD21\\jdk17-boot3.5\\backend)\r\n2026-10-22T08:48:10.877+08:00  INFO 21976 --- [           main] com.example.tasks.TaskStatsApiTest       : No active profile set, falling back to 1 default profile: \"default\"\r\n2026-10-22T08:48:11.915+08:00  INFO 21976 --- [           main] .s.d.r.c.RepositoryConfigurationDelegate : Bootstrapping Spring Data JPA repositories in DEFAULT mode.\r\n2026-10-22T08:48:11.969+08:00  INFO 21976 --- [           main] .s.d.r.c.RepositoryConfigurationDelegate : Finished Spring Data repository scanning in 45 ms. Found 2 JPA repository interfaces.\r\n2026-10-22T08:48:12.556+08:00  INFO 21976 --- [           main] o.hibernate.jpa.internal.util.LogHelper  : HHH000204: Processing PersistenceUnitInfo [name: default]\r\n2026-10-22T08:48:12.609+08:00  INFO 21976 --- [           main] org.hibernate.Version                    : HHH000412: Hibernate ORM core version 6.6.53.Final\r\n2026-10-22T08:48:12.645+08:00  INFO 21976 --- [           main] o.h.c.internal.RegionFactoryInitiator    : HHH000026: Second-level cache disabled\r\n2026-10-22T08:48:13.040+08:00  INFO 21976 --- [           main] o.s.o.j.p.SpringPersistenceUnitInfo      : No LoadTimeWeaver setup: ignoring JPA class transformer\r\n2026-10-22T08:48:13.081+08:00  INFO 21976 --- [           main] com.zaxxer.hikari.HikariDataSource       : HikariPool-1 - Starting...\r\n2026-10-22T08:48:13.306+08:00  INFO 21976 --- [           main] com.zaxxer.hikari.pool.HikariPool        : HikariPool-1 - Added connection conn0: url=jdbc:h2:mem:stats user=SA\r\n2026-10-22T08:48:13.307+08:00  INFO 21976 --- [           main] com.zaxxer.hikari.HikariDataSource       : HikariPool-1 - Start completed.\r\n2026-10-22T08:48:13.365+08:00  INFO 21976 --- [           main] org.hibernate.orm.connections.pooling    : HHH10001005: Database info:\n\tDatabase JDBC URL [Connecting through datasource 'HikariDataSource (HikariPool-1)']\n\tDatabase driver: undefined/unknown\n\tDatabase version: 2.3.232\n\tAutocommit mode: undefined/unknown\n\tIsolation level: undefined/unknown\n\tMinimum pool size: undefined/unknown\n\tMaximum pool size: undefined/unknown\r\n2026-10-22T08:48:14.096+08:00  INFO 21976 --- [           main] o.h.e.t.j.p.i.JtaPlatformInitiator       : HHH000489: No JTA platform available (set 'hibernate.transaction.jta.platform' to enable JTA platform integration)\r\n2026-10-22T08:48:14.181+08:00  INFO 21976 --- [           main] j.LocalContainerEntityManagerFactoryBean : Initialized JPA EntityManagerFactory for persistence unit 'default'\r\n2026-10-22T08:48:14.665+08:00  INFO 21976 --- [           main] r$InitializeUserDetailsManagerConfigurer : Global AuthenticationManager configured with UserDetailsService bean with name localUsersOnly\r\n2026-10-22T08:48:15.230+08:00  INFO 21976 --- [           main] o.s.b.a.e.web.EndpointLinksResolver      : Exposing 1 endpoint beneath base path '/actuator'\r\n2026-10-22T08:48:15.286+08:00  INFO 21976 --- [           main] o.s.b.t.m.w.SpringBootMockServletContext : Initializing Spring TestDispatcherServlet ''\r\n2026-10-22T08:48:15.286+08:00  INFO 21976 --- [           main] o.s.t.web.servlet.TestDispatcherServlet  : Initializing Servlet ''\r\n2026-10-22T08:48:15.287+08:00  INFO 21976 --- [           main] o.s.t.web.servlet.TestDispatcherServlet  : Completed initialization in 1 ms\r\n2026-10-22T08:48:15.328+08:00  INFO 21976 --- [           main] com.example.tasks.TaskStatsApiTest       : Started TaskStatsApiTest in 4.814 seconds (process running for 5.989)\r\n[INFO] Tests run: 1, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 6.175 s -- in com.example.tasks.TaskStatsApiTest\r\n[INFO] \r\n[INFO] Results:\r\n[INFO] \r\n[INFO] Tests run: 1, Failures: 0, Errors: 0, Skipped: 0\r\n[INFO] \r\n[INFO] ------------------------------------------------------------------------\r\n[INFO] BUILD SUCCESS\r\n[INFO] ------------------------------------------------------------------------\r\n[INFO] Total time:  9.395 s\r\n[INFO] Finished at: 2026-10-22T08:48:16+08:00\r\n[INFO] ------------------------------------------------------------------------\r\n",
      "stderr": "OpenJDK 64-Bit Server VM warning: Sharing is only supported for boot loader classes because bootstrap classpath has been appended\r\n"
    },
    {
      "command": [
        "D:\\Program Files\\nodejs\\npm.cmd",
        "run",
        "test"
      ],
      "cwd": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-MvqD21\\jdk17-boot3.5\\frontend",
      "startedAt": "2026-10-22T00:48:16.271Z",
      "finishedAt": "2026-10-22T00:48:18.590Z",
      "exitCode": 0,
      "stdout": "\n> task-web@1.0.0 test\n> vitest run --coverage\n\n\n RUN  v4.0.18 C:/Users/Administrator/AppData/Local/Temp/sg-delivery-pilot-MvqD21/jdk17-boot3.5/frontend\n      Coverage enabled with v8\n\n ✓ test/api.test.ts (4 tests) 15ms\n ✓ test/App.test.ts (7 tests) 379ms\n\n Test Files  2 passed (2)\n      Tests  11 passed (11)\n   Start at  08:48:16\n   Duration  1.67s (transform 153ms, setup 0ms, import 873ms, tests 394ms, environment 540ms)\n\n % Coverage report from v8\n-------------|---------|----------|---------|---------|---------------------\nFile         | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s   \n-------------|---------|----------|---------|---------|---------------------\nAll files    |   96.69 |    97.61 |   95.45 |   96.94 |                     \n src         |    95.6 |    97.34 |   94.18 |   95.88 |                     \n  App.vue    |   96.13 |    97.34 |   94.18 |   96.44 | 170-171,263-273,298 \n  main.ts    |       0 |      100 |     100 |       0 | 6                   \n src/api     |     100 |      100 |     100 |     100 |                     \n  auth.ts    |     100 |      100 |     100 |     100 |                     \n  files.ts   |     100 |      100 |     100 |     100 |                     \n  request.ts |     100 |      100 |     100 |     100 |                     \n  tasks.ts   |     100 |      100 |     100 |     100 |                     \n  types.ts   |       0 |        0 |       0 |       0 |                     \n-------------|---------|----------|---------|---------|---------------------\n",
      "stderr": ""
    },
    {
      "command": [
        "D:\\Program Files\\nodejs\\npm.cmd",
        "run",
        "build"
      ],
      "cwd": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-MvqD21\\jdk17-boot3.5\\frontend",
      "startedAt": "2026-10-22T00:48:18.590Z",
      "finishedAt": "2026-10-22T00:48:22.757Z",
      "exitCode": 0,
      "stdout": "\n> task-web@1.0.0 build\n> vue-tsc --noEmit && vite build\n\nvite v7.3.1 building client environment for production...\ntransforming...\n✓ 1423 modules transformed.\nrendering chunks...\ncomputing gzip size...\ndist/index.html                   0.39 kB │ gzip:  0.26 kB\ndist/assets/index-BBrXui40.css  345.66 kB │ gzip: 47.84 kB\ndist/assets/index-DH6ZI0IC.js   274.35 kB │ gzip: 96.05 kB\n✓ built in 1.97s\n",
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
    "cwd": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-MvqD21\\jdk17-boot3.5\\backend",
    "startedAt": "2026-10-22T00:47:55.192Z",
    "finishedAt": "2026-10-22T00:48:04.468Z",
    "exitCode": 1,
    "stdout": "[INFO] Scanning for projects...\r\n[INFO] \r\n[INFO] ------------------------< com.example:task-api >------------------------\r\n[INFO] Building task-api 1.0.0\r\n[INFO]   from pom.xml\r\n[INFO] --------------------------------[ jar ]---------------------------------\r\n[INFO] \r\n[INFO] --- jacoco:0.8.13:prepare-agent (default) @ task-api ---\r\n[INFO] argLine set to -javaagent:C:\\\\Users\\\\Administrator\\\\.m2\\\\repository\\\\org\\\\jacoco\\\\org.jacoco.agent\\\\0.8.13\\\\org.jacoco.agent-0.8.13-runtime.jar=destfile=C:\\\\Users\\\\Administrator\\\\AppData\\\\Local\\\\Temp\\\\sg-delivery-pilot-MvqD21\\\\jdk17-boot3.5\\\\backend\\\\target\\\\jacoco.exec\r\n[INFO] \r\n[INFO] --- resources:3.3.1:resources (default-resources) @ task-api ---\r\n[INFO] Copying 1 resource from src\\main\\resources to target\\classes\r\n[INFO] Copying 0 resource from src\\main\\resources to target\\classes\r\n[INFO] \r\n[INFO] --- compiler:3.14.1:compile (default-compile) @ task-api ---\r\n[INFO] Nothing to compile - all classes are up to date.\r\n[INFO] \r\n[INFO] --- resources:3.3.1:testResources (default-testResources) @ task-api ---\r\n[INFO] skip non existing resourceDirectory C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-MvqD21\\jdk17-boot3.5\\backend\\src\\test\\resources\r\n[INFO] \r\n[INFO] --- compiler:3.14.1:testCompile (default-testCompile) @ task-api ---\r\n[INFO] Recompiling the module because of changed source code.\r\n[INFO] Compiling 6 source files with javac [debug parameters release 17] to target\\test-classes\r\n[INFO] \r\n[INFO] --- surefire:3.5.6:test (default-test) @ task-api ---\r\n[INFO] Using auto detected provider org.apache.maven.surefire.junitplatform.JUnitPlatformProvider\r\n[INFO] \r\n[INFO] -------------------------------------------------------\r\n[INFO]  T E S T S\r\n[INFO] -------------------------------------------------------\r\n[INFO] Running com.example.tasks.TaskStatsApiTest\r\n08:47:58.762 [main] INFO org.springframework.test.context.support.AnnotationConfigContextLoaderUtils -- Could not detect default configuration classes for test class [com.example.tasks.TaskStatsApiTest]: TaskStatsApiTest does not declare any static, non-private, non-final, nested classes annotated with @Configuration.\r\n08:47:58.931 [main] INFO org.springframework.boot.test.context.SpringBootTestContextBootstrapper -- Found @SpringBootConfiguration com.example.tasks.TaskApplication for test class com.example.tasks.TaskStatsApiTest\r\n\r\n  .   ____          _            __ _ _\n /\\\\ / ___'_ __ _ _(_)_ __  __ _ \\ \\ \\ \\\n( ( )\\___ | '_ | '_| | '_ \\/ _` | \\ \\ \\ \\\n \\\\/  ___)| |_)| | | | | || (_| |  ) ) ) )\n  '  |____| .__|_| |_|_| |_\\__, | / / / /\n =========|_|==============|___/=/_/_/_/\n\r\n :: Spring Boot ::               (v3.5.16)\r\n\r\n2026-10-22T08:47:59.550+08:00  INFO 23152 --- [           main] com.example.tasks.TaskStatsApiTest       : Starting TaskStatsApiTest using Java 17.0.18 with PID 23152 (started by Administrator in C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-MvqD21\\jdk17-boot3.5\\backend)\r\n2026-10-22T08:47:59.552+08:00  INFO 23152 --- [           main] com.example.tasks.TaskStatsApiTest       : No active profile set, falling back to 1 default profile: \"default\"\r\n2026-10-22T08:48:00.601+08:00  INFO 23152 --- [           main] .s.d.r.c.RepositoryConfigurationDelegate : Bootstrapping Spring Data JPA repositories in DEFAULT mode.\r\n2026-10-22T08:48:00.661+08:00  INFO 23152 --- [           main] .s.d.r.c.RepositoryConfigurationDelegate : Finished Spring Data repository scanning in 49 ms. Found 2 JPA repository interfaces.\r\n2026-10-22T08:48:01.172+08:00  INFO 23152 --- [           main] o.hibernate.jpa.internal.util.LogHelper  : HHH000204: Processing PersistenceUnitInfo [name: default]\r\n2026-10-22T08:48:01.228+08:00  INFO 23152 --- [           main] org.hibernate.Version                    : HHH000412: Hibernate ORM core version 6.6.53.Final\r\n2026-10-22T08:48:01.264+08:00  INFO 23152 --- [           main] o.h.c.internal.RegionFactoryInitiator    : HHH000026: Second-level cache disabled\r\n2026-10-22T08:48:01.552+08:00  INFO 23152 --- [           main] o.s.o.j.p.SpringPersistenceUnitInfo      : No LoadTimeWeaver setup: ignoring JPA class transformer\r\n2026-10-22T08:48:01.585+08:00  INFO 23152 --- [           main] com.zaxxer.hikari.HikariDataSource       : HikariPool-1 - Starting...\r\n2026-10-22T08:48:01.797+08:00  INFO 23152 --- [           main] com.zaxxer.hikari.pool.HikariPool        : HikariPool-1 - Added connection conn0: url=jdbc:h2:mem:stats user=SA\r\n2026-10-22T08:48:01.799+08:00  INFO 23152 --- [           main] com.zaxxer.hikari.HikariDataSource       : HikariPool-1 - Start completed.\r\n2026-10-22T08:48:01.852+08:00  INFO 23152 --- [           main] org.hibernate.orm.connections.pooling    : HHH10001005: Database info:\n\tDatabase JDBC URL [Connecting through datasource 'HikariDataSource (HikariPool-1)']\n\tDatabase driver: undefined/unknown\n\tDatabase version: 2.3.232\n\tAutocommit mode: undefined/unknown\n\tIsolation level: undefined/unknown\n\tMinimum pool size: undefined/unknown\n\tMaximum pool size: undefined/unknown\r\n2026-10-22T08:48:02.561+08:00  INFO 23152 --- [           main] o.h.e.t.j.p.i.JtaPlatformInitiator       : HHH000489: No JTA platform available (set 'hibernate.transaction.jta.platform' to enable JTA platform integration)\r\n2026-10-22T08:48:02.618+08:00  INFO 23152 --- [           main] j.LocalContainerEntityManagerFactoryBean : Initialized JPA EntityManagerFactory for persistence unit 'default'\r\n2026-10-22T08:48:02.991+08:00  INFO 23152 --- [           main] r$InitializeUserDetailsManagerConfigurer : Global AuthenticationManager configured with UserDetailsService bean with name localUsersOnly\r\n2026-10-22T08:48:03.548+08:00  INFO 23152 --- [           main] o.s.b.a.e.web.EndpointLinksResolver      : Exposing 1 endpoint beneath base path '/actuator'\r\n2026-10-22T08:48:03.612+08:00  INFO 23152 --- [           main] o.s.b.t.m.w.SpringBootMockServletContext : Initializing Spring TestDispatcherServlet ''\r\n2026-10-22T08:48:03.612+08:00  INFO 23152 --- [           main] o.s.t.web.servlet.TestDispatcherServlet  : Initializing Servlet ''\r\n2026-10-22T08:48:03.613+08:00  INFO 23152 --- [           main] o.s.t.web.servlet.TestDispatcherServlet  : Completed initialization in 1 ms\r\n2026-10-22T08:48:03.655+08:00  INFO 23152 --- [           main] com.example.tasks.TaskStatsApiTest       : Started TaskStatsApiTest in 4.486 seconds (process running for 5.653)\r\n\r\nMockHttpServletRequest:\r\n      HTTP Method = GET\r\n      Request URI = /api/tasks/stats\r\n       Parameters = {}\r\n          Headers = []\r\n             Body = null\r\n    Session Attrs = {SPRING_SECURITY_CONTEXT=SecurityContextImpl [Authentication=UsernamePasswordAuthenticationToken [Principal=org.springframework.security.core.userdetails.User [Username=viewer, Password=[PROTECTED], Enabled=true, AccountNonExpired=true, CredentialsNonExpired=true, AccountNonLocked=true, Granted Authorities=[ROLE_USER]], Credentials=[PROTECTED], Authenticated=true, Details=null, Granted Authorities=[ROLE_USER]]]}\r\n\r\nHandler:\r\n             Type = com.example.tasks.controller.TaskController\r\n           Method = com.example.tasks.controller.TaskController#get(Long)\r\n\r\nAsync:\r\n    Async started = false\r\n     Async result = null\r\n\r\nResolved Exception:\r\n             Type = org.springframework.web.method.annotation.MethodArgumentTypeMismatchException\r\n\r\nModelAndView:\r\n        View name = null\r\n             View = null\r\n            Model = null\r\n\r\nFlashMap:\r\n       Attributes = null\r\n\r\nMockHttpServletResponse:\r\n           Status = 400\r\n    Error message = null\r\n          Headers = [X-Trace-Id:\"c064e157-e2a9-4601-9dc7-96f35a391f0d\", Content-Type:\"application/json\", X-Content-Type-Options:\"nosniff\", X-XSS-Protection:\"0\", Cache-Control:\"no-cache, no-store, max-age=0, must-revalidate\", Pragma:\"no-cache\", Expires:\"0\", X-Frame-Options:\"DENY\"]\r\n     Content type = application/json\r\n             Body = {\"code\":\"BAD_REQUEST\",\"message\":\"Malformed request\",\"data\":null,\"traceId\":\"c064e157-e2a9-4601-9dc7-96f35a391f0d\"}\r\n    Forwarded URL = null\r\n   Redirected URL = null\r\n          Cookies = []\r\n[ERROR] Tests run: 1, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: 5.706 s <<< FAILURE! -- in com.example.tasks.TaskStatsApiTest\r\n[ERROR] com.example.tasks.TaskStatsApiTest.statsCountsTasksByCompletion -- Time elapsed: 0.548 s <<< FAILURE!\r\njava.lang.AssertionError: Status expected:<200> but was:<400>\r\n\tat org.springframework.test.util.AssertionErrors.fail(AssertionErrors.java:61)\r\n\tat org.springframework.test.util.AssertionErrors.assertEquals(AssertionErrors.java:128)\r\n\tat org.springframework.test.web.servlet.result.StatusResultMatchers.lambda$matcher$9(StatusResultMatchers.java:640)\r\n\tat org.springframework.test.web.servlet.MockMvc$1.andExpect(MockMvc.java:214)\r\n\tat com.example.tasks.TaskStatsApiTest.statsCountsTasksByCompletion(TaskStatsApiTest.java:38)\r\n\tat java.base/java.lang.reflect.Method.invoke(Method.java:569)\r\n\tat java.base/java.util.ArrayList.forEach(ArrayList.java:1511)\r\n\tat java.base/java.util.ArrayList.forEach(ArrayList.java:1511)\r\n\r\n[INFO] \r\n[INFO] Results:\r\n[INFO] \r\n[ERROR] Failures: \r\n[ERROR]   TaskStatsApiTest.statsCountsTasksByCompletion:38 Status expected:<200> but was:<400>\r\n[INFO] \r\n[ERROR] Tests run: 1, Failures: 1, Errors: 0, Skipped: 0\r\n[INFO] \r\n[INFO] ------------------------------------------------------------------------\r\n[INFO] BUILD FAILURE\r\n[INFO] ------------------------------------------------------------------------\r\n[INFO] Total time:  8.462 s\r\n[INFO] Finished at: 2026-10-22T08:48:04+08:00\r\n[INFO] ------------------------------------------------------------------------\r\n[ERROR] Failed to execute goal org.apache.maven.plugins:maven-surefire-plugin:3.5.6:test (default-test) on project task-api: There are test failures.\r\n[ERROR] \r\n[ERROR] See C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-MvqD21\\jdk17-boot3.5\\backend\\target\\surefire-reports for the individual test results.\r\n[ERROR] See dump files (if any exist) [date].dump, [date]-jvmRun[N].dump and [date].dumpstream.\r\n[ERROR] -> [Help 1]\r\n[ERROR] \r\n[ERROR] To see the full stack trace of the errors, re-run Maven with the -e switch.\r\n[ERROR] Re-run Maven using the -X switch to enable full debug logging.\r\n[ERROR] \r\n[ERROR] For more information about the errors and possible solutions, please read the following articles:\r\n[ERROR] [Help 1] http://cwiki.apache.org/confluence/display/MAVEN/MojoFailureException\r\n",
    "stderr": "OpenJDK 64-Bit Server VM warning: Sharing is only supported for boot loader classes because bootstrap classpath has been appended\r\n"
  }
}
```
