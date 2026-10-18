---
name: replace-git-url
version: 1.0.0
description: "Replace all Git repository URLs in a SpecGate project in one step, making it easy to maintain your own version after forking"
---

# Replace Git URL

When a user has cloned the SpecGate source and wants to turn it into their own team's repository, use this skill to replace all Git URL dependencies in one step.

## Trigger Conditions

Trigger when the user says something like:
- "Help me change the git URL to XXX"
- "Replace the repository URL with XXX"
- "Switch to my repository XXX"
- "Change all gitlab/github URLs to XXX"
- "/replace-git-url XXX"

## Execution Flow

### 1. Obtain the new URL

Extract the new repository URL from the user's input. Accept any format:
- `https://github.com/user/repo.git`
- `git@github.com:user/repo.git`
- `https://gitlab.com/user/repo.git`

If the user does not provide a complete URL, infer it from context (e.g., if they provide `user/repo`, prefix it with `https://github.com/`).

### 2. Normalize the URL

Derive three forms from the URL the user provides:

```bash
# Example input: https://github.com/andyzx/AgentKit47-Github.git
NEW_REPO="https://github.com/andyzx/AgentKit47-Github.git"   # HTTPS repo
NEW_BASE="${NEW_REPO%.git}"                                    # https://github.com/andyzx/AgentKit47-Github
```

If the user provides the SSH format `git@github.com:user/repo.git`, convert it automatically:
- NEW_REPO → `https://github.com/user/repo.git`
- NEW_BASE → `https://github.com/user/repo`

### 3. Replace files

Modify files one by one in the following order:

#### 3.1 `package.json`

Use Node.js to modify the JSON fields precisely (do not use sed on JSON):

```javascript
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
pkg.repository = { type: 'git', url: '${NEW_REPO}' };
pkg.homepage = '${NEW_BASE}';
pkg.bugs = { url: '${NEW_BASE}/issues' };
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
```

#### 3.2 `scripts/install.sh`

Find the line with the fallback default URL (format `:-default-url}`) and replace it with the new one:

```bash
sed -i '' "s|:-https://[^}]*}|:-${NEW_REPO}}|" scripts/install.sh
```

If other stale git URLs remain in install.sh (such as examples in comments), replace those as well.

#### 3.3 `scripts/sync-to-github.sh` (if present)

Replace the `TARGET_REPO` variable:

```bash
sed -i '' "s|TARGET_REPO=.*|TARGET_REPO=\"${NEW_REPO}\"|" scripts/sync-to-github.sh
sed -i '' "s|TARGET_DIR=.*|TARGET_DIR=\"\${HOME}/qoder/github/$(basename ${NEW_BASE})\"|" scripts/sync-to-github.sh
```

### 4. Verify

After replacement, confirm the URLs in the key files are correct:

```bash
echo "=== package.json ==="
node -e "const p=require('./package.json'); console.log('repo:', p.repository.url); console.log('homepage:', p.homepage)"
echo ""
echo "=== install.sh defaults ==="
grep ":-.*}" scripts/install.sh | head -3
```

### 5. Output a summary

Report to the user:
- Which files were modified
- What the new repository URL is
- Suggest that the user can run `git diff` to review the changes

## Notes

- Modify `package.json` with Node.js, not sed (JSON format is sensitive)
- Replace only Git URLs; do not modify other configuration
- After modifying, prompt the user to review the changes and commit
- If the user wants to publish to npm, remind them to change the `name` field in `package.json` to avoid conflicts
