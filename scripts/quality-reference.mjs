// Materialize reference code without the unrelated sg-change agent/browser workflow.
import fs from 'node:fs';
import path from 'node:path';
import { javaFullstackFiles } from '../src/v4/java-fullstack-template.js';
import { normalizeJavaPreset } from '../src/v4/java-versions.js';

export function materializeReference(root, repo) {
  const files = javaFullstackFiles({ preset: normalizeJavaPreset('jdk8-boot2.7').preset });
  const java = 'backend/src/main/java/com/example/tasks/';
  for (const name of [
    'entity/Task.java',
    'repository/TaskRepository.java',
    'dto/TaskRequest.java',
    'dto/UpdateTaskRequest.java',
    'vo/TaskVO.java',
    'service/TaskService.java',
    'controller/TaskController.java',
  ]) {
    files[java + name.replaceAll('Task', 'Note')] = files[java + name]
      .replaceAll('Task', 'Note')
      .replaceAll('/api/tasks', '/api/notes')
      .replace('name = "tasks"', 'name = "notes"')
      .replaceAll('${app.tasks.', '${app.notes.')
      // Renaming Task to Note changes lexical import order in these synthetic helpers.
      .replace(
        'import com.example.tasks.vo.OperationResult;\nimport com.example.tasks.vo.PageResult;\nimport com.example.tasks.vo.NoteVO;',
        'import com.example.tasks.vo.NoteVO;\nimport com.example.tasks.vo.OperationResult;\nimport com.example.tasks.vo.PageResult;',
      );
  }
  const targets = {
    'NoteApiTest.java': 'backend/src/test/java/com/example/tasks/NoteApiTest.java',
    'notes.ts': 'frontend/src/api/notes.ts',
    'notes.test.ts': 'frontend/test/notes.test.ts',
    'NotesPanel.vue': 'frontend/src/components/NotesPanel.vue',
  };
  for (const [name, target] of Object.entries(targets))
    files[target] = fs.readFileSync(
      path.join(repo, 'test/fixtures/reference-note', name + '.tpl'),
      'utf8',
    );
  // No synthetic edits to App.vue: component and typed API are compiled and tested directly.
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  fs.mkdirSync(path.join(root, '.specgate'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.specgate/monorepo.json'),
    JSON.stringify({ stack: 'java-vue', preset: 'jdk8-boot2.7' }),
  );
  return targets;
}
