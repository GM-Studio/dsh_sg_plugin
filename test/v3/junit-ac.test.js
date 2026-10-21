import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJunitXml } from '../../src/v3/suites.js';

test('JUnit reconciles display tags, Python markers and legal Java AC101_method names', () => {
  const xml =
    '<testsuite><testcase name="[AC-001] display" classname="Demo"/>' +
    '<testcase name="test_AC_002_case" classname="Demo"/>' +
    '<testcase name="AC101_noteCrud" classname="Demo"/>' +
    '<testcase name="ordinary123name" classname="Demo"/></testsuite>';
  const report = parseJunitXml(xml, { suiteId: 'backend', fileResolver: () => 'test/Demo.java' });
  assert.deepEqual(
    report.cases.map((item) => item.ac),
    [['AC-001'], ['AC-002'], ['AC-101'], []],
  );
});
