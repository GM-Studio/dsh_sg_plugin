# Internal delivery evidence: delivery-e58bf872e3a82029

- Project: project-bdb893f0e0efd274
- Change: jdk17-boot3.5-fix-zero-rate
- Commit: d9863e18ac04e90f388b5e85875c0c53fa62bc0c
- Environment: 4fabc5b38c39436974beb71d0bb5502b8e6bd4a1f67baaa7711fe0995b2cb65a
- Review mode: evidence-and-diff

## Acceptance
- AC-ZERO

## Evidence
- pilot-20ac36bad0805c0d
- pilot-abe151681da8e5e8
- pilot-52c0703716b9883f
- pilot-84973b701f1c13d5

## Internal details
```json
{
  "scenario": "fix-zero-rate",
  "contract": {
    "schemaVersion": 2,
    "changeId": "jdk17-boot3.5-fix-zero-rate",
    "parentDeliveryId": "delivery-59e80563337f2ce5",
    "type": "fix",
    "request": "Fix zero-task completion percentage regression.",
    "scope": [
      "Task statistics"
    ],
    "nonGoals": [
      "Do not change non-empty task statistics."
    ],
    "acceptance": [
      "AC-ZERO"
    ],
    "assumptions": [],
    "risks": [],
    "baselineId": "baseline-7568eca915d6c1d6",
    "status": "H1_PENDING"
  },
  "verification": {
    "schemaVersion": 2,
    "verificationId": "verify-47ee138866c184a1",
    "risk": "yellow",
    "independenceLevel": "fresh-context",
    "acCoverage": [
      {
        "acId": "AC-ZERO",
        "evidenceIds": [
          "pilot-20ac36bad0805c0d",
          "pilot-abe151681da8e5e8",
          "pilot-52c0703716b9883f",
          "pilot-84973b701f1c13d5"
        ],
        "sufficiency": "sufficient",
        "summary": "Passing evidence covers AC-ZERO."
      }
    ],
    "evidence": [
      "pilot-20ac36bad0805c0d",
      "pilot-abe151681da8e5e8",
      "pilot-52c0703716b9883f",
      "pilot-84973b701f1c13d5"
    ],
    "reviewMode": "evidence-and-diff",
    "environmentFingerprint": "4fabc5b38c39436974beb71d0bb5502b8e6bd4a1f67baaa7711fe0995b2cb65a",
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
      "cwd": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-Wnboa1\\jdk17-boot3.5\\backend",
      "startedAt": "2026-10-22T00:57:02.763Z",
      "finishedAt": "2026-10-22T00:57:04.246Z",
      "exitCode": 0,
      "stdout": "[INFO] Scanning for projects...\r\n[INFO] \r\n[INFO] ------------------------< com.example:task-api >------------------------\r\n[INFO] Building task-api 1.0.0\r\n[INFO]   from pom.xml\r\n[INFO] --------------------------------[ jar ]---------------------------------\r\n[INFO] \r\n[INFO] --- spotless:2.44.0:apply (default-cli) @ task-api ---\r\n[INFO] clean file: C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-Wnboa1\\jdk17-boot3.5\\backend\\src\\main\\java\\com\\example\\tasks\\vo\\TaskStatsVO.java\r\n[INFO] clean file: C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-Wnboa1\\jdk17-boot3.5\\backend\\src\\test\\java\\com\\example\\tasks\\TaskStatsApiTest.java\r\n[INFO] Spotless.Java is keeping 39 files clean - 2 were changed to be clean, 0 were already clean, 37 were skipped because caching determined they were already clean\r\n[INFO] ------------------------------------------------------------------------\r\n[INFO] BUILD SUCCESS\r\n[INFO] ------------------------------------------------------------------------\r\n[INFO] Total time:  0.626 s\r\n[INFO] Finished at: 2026-10-22T08:57:04+08:00\r\n[INFO] ------------------------------------------------------------------------\r\n",
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
      "cwd": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-Wnboa1\\jdk17-boot3.5\\backend",
      "startedAt": "2026-10-22T00:57:04.246Z",
      "finishedAt": "2026-10-22T00:57:13.873Z",
      "exitCode": 0,
      "stdout": "[INFO] Scanning for projects...\r\n[INFO] \r\n[INFO] ------------------------< com.example:task-api >------------------------\r\n[INFO] Building task-api 1.0.0\r\n[INFO]   from pom.xml\r\n[INFO] --------------------------------[ jar ]---------------------------------\r\n[INFO] \r\n[INFO] --- jacoco:0.8.13:prepare-agent (default) @ task-api ---\r\n[INFO] argLine set to -javaagent:C:\\\\Users\\\\Administrator\\\\.m2\\\\repository\\\\org\\\\jacoco\\\\org.jacoco.agent\\\\0.8.13\\\\org.jacoco.agent-0.8.13-runtime.jar=destfile=C:\\\\Users\\\\Administrator\\\\AppData\\\\Local\\\\Temp\\\\sg-delivery-pilot-Wnboa1\\\\jdk17-boot3.5\\\\backend\\\\target\\\\jacoco.exec\r\n[INFO] \r\n[INFO] --- resources:3.3.1:resources (default-resources) @ task-api ---\r\n[INFO] Copying 1 resource from src\\main\\resources to target\\classes\r\n[INFO] Copying 0 resource from src\\main\\resources to target\\classes\r\n[INFO] \r\n[INFO] --- compiler:3.14.1:compile (default-compile) @ task-api ---\r\n[INFO] Recompiling the module because of changed source code.\r\n[INFO] Compiling 33 source files with javac [debug parameters release 17] to target\\classes\r\n[INFO] \r\n[INFO] --- resources:3.3.1:testResources (default-testResources) @ task-api ---\r\n[INFO] skip non existing resourceDirectory C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-Wnboa1\\jdk17-boot3.5\\backend\\src\\test\\resources\r\n[INFO] \r\n[INFO] --- compiler:3.14.1:testCompile (default-testCompile) @ task-api ---\r\n[INFO] Recompiling the module because of changed dependency.\r\n[INFO] Compiling 6 source files with javac [debug parameters release 17] to target\\test-classes\r\n[INFO] \r\n[INFO] --- surefire:3.5.6:test (default-test) @ task-api ---\r\n[INFO] Using auto detected provider org.apache.maven.surefire.junitplatform.JUnitPlatformProvider\r\n[INFO] \r\n[INFO] -------------------------------------------------------\r\n[INFO]  T E S T S\r\n[INFO] -------------------------------------------------------\r\n[INFO] Running com.example.tasks.TaskStatsApiTest\r\n08:57:08.087 [main] INFO org.springframework.test.context.support.AnnotationConfigContextLoaderUtils -- Could not detect default configuration classes for test class [com.example.tasks.TaskStatsApiTest]: TaskStatsApiTest does not declare any static, non-private, non-final, nested classes annotated with @Configuration.\r\n08:57:08.242 [main] INFO org.springframework.boot.test.context.SpringBootTestContextBootstrapper -- Found @SpringBootConfiguration com.example.tasks.TaskApplication for test class com.example.tasks.TaskStatsApiTest\r\n\r\n  .   ____          _            __ _ _\n /\\\\ / ___'_ __ _ _(_)_ __  __ _ \\ \\ \\ \\\n( ( )\\___ | '_ | '_| | '_ \\/ _` | \\ \\ \\ \\\n \\\\/  ___)| |_)| | | | | || (_| |  ) ) ) )\n  '  |____| .__|_| |_|_| |_\\__, | / / / /\n =========|_|==============|___/=/_/_/_/\n\r\n :: Spring Boot ::               (v3.5.16)\r\n\r\n2026-10-22T08:57:08.827+08:00  INFO 20448 --- [           main] com.example.tasks.TaskStatsApiTest       : Starting TaskStatsApiTest using Java 17.0.18 with PID 20448 (started by Administrator in C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-Wnboa1\\jdk17-boot3.5\\backend)\r\n2026-10-22T08:57:08.829+08:00  INFO 20448 --- [           main] com.example.tasks.TaskStatsApiTest       : No active profile set, falling back to 1 default profile: \"default\"\r\n2026-10-22T08:57:09.814+08:00  INFO 20448 --- [           main] .s.d.r.c.RepositoryConfigurationDelegate : Bootstrapping Spring Data JPA repositories in DEFAULT mode.\r\n2026-10-22T08:57:09.880+08:00  INFO 20448 --- [           main] .s.d.r.c.RepositoryConfigurationDelegate : Finished Spring Data repository scanning in 56 ms. Found 2 JPA repository interfaces.\r\n2026-10-22T08:57:10.380+08:00  INFO 20448 --- [           main] o.hibernate.jpa.internal.util.LogHelper  : HHH000204: Processing PersistenceUnitInfo [name: default]\r\n2026-10-22T08:57:10.438+08:00  INFO 20448 --- [           main] org.hibernate.Version                    : HHH000412: Hibernate ORM core version 6.6.53.Final\r\n2026-10-22T08:57:10.473+08:00  INFO 20448 --- [           main] o.h.c.internal.RegionFactoryInitiator    : HHH000026: Second-level cache disabled\r\n2026-10-22T08:57:10.742+08:00  INFO 20448 --- [           main] o.s.o.j.p.SpringPersistenceUnitInfo      : No LoadTimeWeaver setup: ignoring JPA class transformer\r\n2026-10-22T08:57:10.771+08:00  INFO 20448 --- [           main] com.zaxxer.hikari.HikariDataSource       : HikariPool-1 - Starting...\r\n2026-10-22T08:57:10.992+08:00  INFO 20448 --- [           main] com.zaxxer.hikari.pool.HikariPool        : HikariPool-1 - Added connection conn0: url=jdbc:h2:mem:stats user=SA\r\n2026-10-22T08:57:10.994+08:00  INFO 20448 --- [           main] com.zaxxer.hikari.HikariDataSource       : HikariPool-1 - Start completed.\r\n2026-10-22T08:57:11.046+08:00  INFO 20448 --- [           main] org.hibernate.orm.connections.pooling    : HHH10001005: Database info:\n\tDatabase JDBC URL [Connecting through datasource 'HikariDataSource (HikariPool-1)']\n\tDatabase driver: undefined/unknown\n\tDatabase version: 2.3.232\n\tAutocommit mode: undefined/unknown\n\tIsolation level: undefined/unknown\n\tMinimum pool size: undefined/unknown\n\tMaximum pool size: undefined/unknown\r\n2026-10-22T08:57:11.734+08:00  INFO 20448 --- [           main] o.h.e.t.j.p.i.JtaPlatformInitiator       : HHH000489: No JTA platform available (set 'hibernate.transaction.jta.platform' to enable JTA platform integration)\r\n2026-10-22T08:57:11.788+08:00  INFO 20448 --- [           main] j.LocalContainerEntityManagerFactoryBean : Initialized JPA EntityManagerFactory for persistence unit 'default'\r\n2026-10-22T08:57:12.247+08:00  INFO 20448 --- [           main] r$InitializeUserDetailsManagerConfigurer : Global AuthenticationManager configured with UserDetailsService bean with name localUsersOnly\r\n2026-10-22T08:57:12.824+08:00  INFO 20448 --- [           main] o.s.b.a.e.web.EndpointLinksResolver      : Exposing 1 endpoint beneath base path '/actuator'\r\n2026-10-22T08:57:12.879+08:00  INFO 20448 --- [           main] o.s.b.t.m.w.SpringBootMockServletContext : Initializing Spring TestDispatcherServlet ''\r\n2026-10-22T08:57:12.879+08:00  INFO 20448 --- [           main] o.s.t.web.servlet.TestDispatcherServlet  : Initializing Servlet ''\r\n2026-10-22T08:57:12.880+08:00  INFO 20448 --- [           main] o.s.t.web.servlet.TestDispatcherServlet  : Completed initialization in 1 ms\r\n2026-10-22T08:57:12.920+08:00  INFO 20448 --- [           main] com.example.tasks.TaskStatsApiTest       : Started TaskStatsApiTest in 4.447 seconds (process running for 5.565)\r\n[INFO] Tests run: 2, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 5.782 s -- in com.example.tasks.TaskStatsApiTest\r\n[INFO] \r\n[INFO] Results:\r\n[INFO] \r\n[INFO] Tests run: 2, Failures: 0, Errors: 0, Skipped: 0\r\n[INFO] \r\n[INFO] ------------------------------------------------------------------------\r\n[INFO] BUILD SUCCESS\r\n[INFO] ------------------------------------------------------------------------\r\n[INFO] Total time:  8.830 s\r\n[INFO] Finished at: 2026-10-22T08:57:13+08:00\r\n[INFO] ------------------------------------------------------------------------\r\n",
      "stderr": "OpenJDK 64-Bit Server VM warning: Sharing is only supported for boot loader classes because bootstrap classpath has been appended\r\n"
    },
    {
      "command": [
        "D:\\Program Files\\nodejs\\npm.cmd",
        "run",
        "test"
      ],
      "cwd": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-Wnboa1\\jdk17-boot3.5\\frontend",
      "startedAt": "2026-10-22T00:57:13.873Z",
      "finishedAt": "2026-10-22T00:57:16.161Z",
      "exitCode": 0,
      "stdout": "\n> task-web@1.0.0 test\n> vitest run --coverage\n\n\n RUN  v4.0.18 C:/Users/Administrator/AppData/Local/Temp/sg-delivery-pilot-Wnboa1/jdk17-boot3.5/frontend\n      Coverage enabled with v8\n\n ✓ test/api.test.ts (4 tests) 15ms\n ✓ test/App.test.ts (7 tests) 359ms\n\n Test Files  2 passed (2)\n      Tests  11 passed (11)\n   Start at  08:57:14\n   Duration  1.62s (transform 151ms, setup 0ms, import 858ms, tests 374ms, environment 529ms)\n\n % Coverage report from v8\n-------------|---------|----------|---------|---------|---------------------\nFile         | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s   \n-------------|---------|----------|---------|---------|---------------------\nAll files    |   96.69 |    97.61 |   95.45 |   96.94 |                     \n src         |    95.6 |    97.34 |   94.18 |   95.88 |                     \n  App.vue    |   96.13 |    97.34 |   94.18 |   96.44 | 170-171,263-273,298 \n  main.ts    |       0 |      100 |     100 |       0 | 6                   \n src/api     |     100 |      100 |     100 |     100 |                     \n  auth.ts    |     100 |      100 |     100 |     100 |                     \n  files.ts   |     100 |      100 |     100 |     100 |                     \n  request.ts |     100 |      100 |     100 |     100 |                     \n  tasks.ts   |     100 |      100 |     100 |     100 |                     \n  types.ts   |       0 |        0 |       0 |       0 |                     \n-------------|---------|----------|---------|---------|---------------------\n",
      "stderr": ""
    },
    {
      "command": [
        "D:\\Program Files\\nodejs\\npm.cmd",
        "run",
        "build"
      ],
      "cwd": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-Wnboa1\\jdk17-boot3.5\\frontend",
      "startedAt": "2026-10-22T00:57:16.161Z",
      "finishedAt": "2026-10-22T00:57:20.236Z",
      "exitCode": 0,
      "stdout": "\n> task-web@1.0.0 build\n> vue-tsc --noEmit && vite build\n\nvite v7.3.1 building client environment for production...\ntransforming...\n✓ 1423 modules transformed.\nrendering chunks...\ncomputing gzip size...\ndist/index.html                   0.39 kB │ gzip:  0.26 kB\ndist/assets/index-BBrXui40.css  345.66 kB │ gzip: 47.84 kB\ndist/assets/index-DH6ZI0IC.js   274.35 kB │ gzip: 96.05 kB\n✓ built in 1.94s\n",
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
    "cwd": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-Wnboa1\\jdk17-boot3.5\\backend",
    "startedAt": "2026-10-22T00:56:52.792Z",
    "finishedAt": "2026-10-22T00:57:02.762Z",
    "exitCode": 1,
    "stdout": "[INFO] Scanning for projects...\r\n[INFO] \r\n[INFO] ------------------------< com.example:task-api >------------------------\r\n[INFO] Building task-api 1.0.0\r\n[INFO]   from pom.xml\r\n[INFO] --------------------------------[ jar ]---------------------------------\r\n[INFO] \r\n[INFO] --- jacoco:0.8.13:prepare-agent (default) @ task-api ---\r\n[INFO] argLine set to -javaagent:C:\\\\Users\\\\Administrator\\\\.m2\\\\repository\\\\org\\\\jacoco\\\\org.jacoco.agent\\\\0.8.13\\\\org.jacoco.agent-0.8.13-runtime.jar=destfile=C:\\\\Users\\\\Administrator\\\\AppData\\\\Local\\\\Temp\\\\sg-delivery-pilot-Wnboa1\\\\jdk17-boot3.5\\\\backend\\\\target\\\\jacoco.exec\r\n[INFO] \r\n[INFO] --- resources:3.3.1:resources (default-resources) @ task-api ---\r\n[INFO] Copying 1 resource from src\\main\\resources to target\\classes\r\n[INFO] Copying 0 resource from src\\main\\resources to target\\classes\r\n[INFO] \r\n[INFO] --- compiler:3.14.1:compile (default-compile) @ task-api ---\r\n[INFO] Recompiling the module because of changed source code.\r\n[INFO] Compiling 33 source files with javac [debug parameters release 17] to target\\classes\r\n[INFO] \r\n[INFO] --- resources:3.3.1:testResources (default-testResources) @ task-api ---\r\n[INFO] skip non existing resourceDirectory C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-Wnboa1\\jdk17-boot3.5\\backend\\src\\test\\resources\r\n[INFO] \r\n[INFO] --- compiler:3.14.1:testCompile (default-testCompile) @ task-api ---\r\n[INFO] Recompiling the module because of changed dependency.\r\n[INFO] Compiling 6 source files with javac [debug parameters release 17] to target\\test-classes\r\n[INFO] \r\n[INFO] --- surefire:3.5.6:test (default-test) @ task-api ---\r\n[INFO] Using auto detected provider org.apache.maven.surefire.junitplatform.JUnitPlatformProvider\r\n[INFO] \r\n[INFO] -------------------------------------------------------\r\n[INFO]  T E S T S\r\n[INFO] -------------------------------------------------------\r\n[INFO] Running com.example.tasks.TaskStatsApiTest\r\n08:56:56.785 [main] INFO org.springframework.test.context.support.AnnotationConfigContextLoaderUtils -- Could not detect default configuration classes for test class [com.example.tasks.TaskStatsApiTest]: TaskStatsApiTest does not declare any static, non-private, non-final, nested classes annotated with @Configuration.\r\n08:56:56.956 [main] INFO org.springframework.boot.test.context.SpringBootTestContextBootstrapper -- Found @SpringBootConfiguration com.example.tasks.TaskApplication for test class com.example.tasks.TaskStatsApiTest\r\n\r\n  .   ____          _            __ _ _\n /\\\\ / ___'_ __ _ _(_)_ __  __ _ \\ \\ \\ \\\n( ( )\\___ | '_ | '_| | '_ \\/ _` | \\ \\ \\ \\\n \\\\/  ___)| |_)| | | | | || (_| |  ) ) ) )\n  '  |____| .__|_| |_|_| |_\\__, | / / / /\n =========|_|==============|___/=/_/_/_/\n\r\n :: Spring Boot ::               (v3.5.16)\r\n\r\n2026-10-22T08:56:57.528+08:00  INFO 24124 --- [           main] com.example.tasks.TaskStatsApiTest       : Starting TaskStatsApiTest using Java 17.0.18 with PID 24124 (started by Administrator in C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-Wnboa1\\jdk17-boot3.5\\backend)\r\n2026-10-22T08:56:57.529+08:00  INFO 24124 --- [           main] com.example.tasks.TaskStatsApiTest       : No active profile set, falling back to 1 default profile: \"default\"\r\n2026-10-22T08:56:58.510+08:00  INFO 24124 --- [           main] .s.d.r.c.RepositoryConfigurationDelegate : Bootstrapping Spring Data JPA repositories in DEFAULT mode.\r\n2026-10-22T08:56:58.564+08:00  INFO 24124 --- [           main] .s.d.r.c.RepositoryConfigurationDelegate : Finished Spring Data repository scanning in 44 ms. Found 2 JPA repository interfaces.\r\n2026-10-22T08:56:59.105+08:00  INFO 24124 --- [           main] o.hibernate.jpa.internal.util.LogHelper  : HHH000204: Processing PersistenceUnitInfo [name: default]\r\n2026-10-22T08:56:59.158+08:00  INFO 24124 --- [           main] org.hibernate.Version                    : HHH000412: Hibernate ORM core version 6.6.53.Final\r\n2026-10-22T08:56:59.195+08:00  INFO 24124 --- [           main] o.h.c.internal.RegionFactoryInitiator    : HHH000026: Second-level cache disabled\r\n2026-10-22T08:56:59.492+08:00  INFO 24124 --- [           main] o.s.o.j.p.SpringPersistenceUnitInfo      : No LoadTimeWeaver setup: ignoring JPA class transformer\r\n2026-10-22T08:56:59.522+08:00  INFO 24124 --- [           main] com.zaxxer.hikari.HikariDataSource       : HikariPool-1 - Starting...\r\n2026-10-22T08:56:59.748+08:00  INFO 24124 --- [           main] com.zaxxer.hikari.pool.HikariPool        : HikariPool-1 - Added connection conn0: url=jdbc:h2:mem:stats user=SA\r\n2026-10-22T08:56:59.749+08:00  INFO 24124 --- [           main] com.zaxxer.hikari.HikariDataSource       : HikariPool-1 - Start completed.\r\n2026-10-22T08:56:59.802+08:00  INFO 24124 --- [           main] org.hibernate.orm.connections.pooling    : HHH10001005: Database info:\n\tDatabase JDBC URL [Connecting through datasource 'HikariDataSource (HikariPool-1)']\n\tDatabase driver: undefined/unknown\n\tDatabase version: 2.3.232\n\tAutocommit mode: undefined/unknown\n\tIsolation level: undefined/unknown\n\tMinimum pool size: undefined/unknown\n\tMaximum pool size: undefined/unknown\r\n2026-10-22T08:57:00.507+08:00  INFO 24124 --- [           main] o.h.e.t.j.p.i.JtaPlatformInitiator       : HHH000489: No JTA platform available (set 'hibernate.transaction.jta.platform' to enable JTA platform integration)\r\n2026-10-22T08:57:00.568+08:00  INFO 24124 --- [           main] j.LocalContainerEntityManagerFactoryBean : Initialized JPA EntityManagerFactory for persistence unit 'default'\r\n2026-10-22T08:57:01.041+08:00  INFO 24124 --- [           main] r$InitializeUserDetailsManagerConfigurer : Global AuthenticationManager configured with UserDetailsService bean with name localUsersOnly\r\n2026-10-22T08:57:01.643+08:00  INFO 24124 --- [           main] o.s.b.a.e.web.EndpointLinksResolver      : Exposing 1 endpoint beneath base path '/actuator'\r\n2026-10-22T08:57:01.691+08:00  INFO 24124 --- [           main] o.s.b.t.m.w.SpringBootMockServletContext : Initializing Spring TestDispatcherServlet ''\r\n2026-10-22T08:57:01.691+08:00  INFO 24124 --- [           main] o.s.t.web.servlet.TestDispatcherServlet  : Initializing Servlet ''\r\n2026-10-22T08:57:01.692+08:00  INFO 24124 --- [           main] o.s.t.web.servlet.TestDispatcherServlet  : Completed initialization in 1 ms\r\n2026-10-22T08:57:01.734+08:00  INFO 24124 --- [           main] com.example.tasks.TaskStatsApiTest       : Started TaskStatsApiTest in 4.559 seconds (process running for 5.705)\r\n\r\nMockHttpServletRequest:\r\n      HTTP Method = GET\r\n      Request URI = /api/tasks/stats\r\n       Parameters = {}\r\n          Headers = []\r\n             Body = null\r\n    Session Attrs = {SPRING_SECURITY_CONTEXT=SecurityContextImpl [Authentication=UsernamePasswordAuthenticationToken [Principal=org.springframework.security.core.userdetails.User [Username=viewer, Password=[PROTECTED], Enabled=true, AccountNonExpired=true, CredentialsNonExpired=true, AccountNonLocked=true, Granted Authorities=[ROLE_USER]], Credentials=[PROTECTED], Authenticated=true, Details=null, Granted Authorities=[ROLE_USER]]]}\r\n\r\nHandler:\r\n             Type = com.example.tasks.controller.TaskStatsController\r\n           Method = com.example.tasks.controller.TaskStatsController#stats()\r\n\r\nAsync:\r\n    Async started = false\r\n     Async result = null\r\n\r\nResolved Exception:\r\n             Type = null\r\n\r\nModelAndView:\r\n        View name = null\r\n             View = null\r\n            Model = null\r\n\r\nFlashMap:\r\n       Attributes = null\r\n\r\nMockHttpServletResponse:\r\n           Status = 200\r\n    Error message = null\r\n          Headers = [X-Trace-Id:\"8e7347fc-645f-45ba-bdde-c7905530d82f\", Content-Type:\"application/json\", X-Content-Type-Options:\"nosniff\", X-XSS-Protection:\"0\", Cache-Control:\"no-cache, no-store, max-age=0, must-revalidate\", Pragma:\"no-cache\", Expires:\"0\", X-Frame-Options:\"DENY\"]\r\n     Content type = application/json\r\n             Body = {\"code\":0,\"message\":\"OK\",\"data\":{\"total\":0,\"completed\":0,\"inProgress\":0,\"completionPercent\":100},\"traceId\":\"8e7347fc-645f-45ba-bdde-c7905530d82f\"}\r\n    Forwarded URL = null\r\n   Redirected URL = null\r\n          Cookies = []\r\n[ERROR] Tests run: 2, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: 5.924 s <<< FAILURE! -- in com.example.tasks.TaskStatsApiTest\r\n[ERROR] com.example.tasks.TaskStatsApiTest.emptyRepositoryReturnsZeroCompletionRate -- Time elapsed: 0.642 s <<< FAILURE!\r\njava.lang.AssertionError: JSON path \"$.data.completionPercent\" expected:<0> but was:<100>\r\n\tat org.springframework.test.util.AssertionErrors.fail(AssertionErrors.java:61)\r\n\tat org.springframework.test.util.AssertionErrors.assertEquals(AssertionErrors.java:128)\r\n\tat org.springframework.test.util.JsonPathExpectationsHelper.assertValue(JsonPathExpectationsHelper.java:172)\r\n\tat org.springframework.test.web.servlet.result.JsonPathResultMatchers.lambda$value$2(JsonPathResultMatchers.java:112)\r\n\tat org.springframework.test.web.servlet.MockMvc$1.andExpect(MockMvc.java:214)\r\n\tat com.example.tasks.TaskStatsApiTest.emptyRepositoryReturnsZeroCompletionRate(TaskStatsApiTest.java:52)\r\n\tat java.base/java.lang.reflect.Method.invoke(Method.java:569)\r\n\tat java.base/java.util.ArrayList.forEach(ArrayList.java:1511)\r\n\tat java.base/java.util.ArrayList.forEach(ArrayList.java:1511)\r\n\r\n[INFO] \r\n[INFO] Results:\r\n[INFO] \r\n[ERROR] Failures: \r\n[ERROR]   TaskStatsApiTest.emptyRepositoryReturnsZeroCompletionRate:52 JSON path \"$.data.completionPercent\" expected:<0> but was:<100>\r\n[INFO] \r\n[ERROR] Tests run: 2, Failures: 1, Errors: 0, Skipped: 0\r\n[INFO] \r\n[INFO] ------------------------------------------------------------------------\r\n[INFO] BUILD FAILURE\r\n[INFO] ------------------------------------------------------------------------\r\n[INFO] Total time:  9.130 s\r\n[INFO] Finished at: 2026-10-22T08:57:02+08:00\r\n[INFO] ------------------------------------------------------------------------\r\n[ERROR] Failed to execute goal org.apache.maven.plugins:maven-surefire-plugin:3.5.6:test (default-test) on project task-api: There are test failures.\r\n[ERROR] \r\n[ERROR] See C:\\Users\\Administrator\\AppData\\Local\\Temp\\sg-delivery-pilot-Wnboa1\\jdk17-boot3.5\\backend\\target\\surefire-reports for the individual test results.\r\n[ERROR] See dump files (if any exist) [date].dump, [date]-jvmRun[N].dump and [date].dumpstream.\r\n[ERROR] -> [Help 1]\r\n[ERROR] \r\n[ERROR] To see the full stack trace of the errors, re-run Maven with the -e switch.\r\n[ERROR] Re-run Maven using the -X switch to enable full debug logging.\r\n[ERROR] \r\n[ERROR] For more information about the errors and possible solutions, please read the following articles:\r\n[ERROR] [Help 1] http://cwiki.apache.org/confluence/display/MAVEN/MojoFailureException\r\n",
    "stderr": "OpenJDK 64-Bit Server VM warning: Sharing is only supported for boot loader classes because bootstrap classpath has been appended\r\n"
  }
}
```
