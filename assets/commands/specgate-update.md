---
name: "SpecGate: Update"
description: "Update the specgate CLI tool to the latest version and synchronously upgrade all configurations in the project (Agents, Skills, Rules, templates, etc.). Use this command when the user says 'update specgate', 'upgrade specgate', 'specgate update', or 'specgate upgrade'."
category: Maintenance
tags: [specgate, update, upgrade, maintenance]
---

When the user requests an update/upgrade of specgate, perform the following steps to complete the CLI tool update and project configuration synchronization.

## Execution Steps

### 1. Run specgate update --yes --upgrade

Execute the all-in-one update command in the terminal:

```bash
specgate update --yes --upgrade
```

This command will:
- Check for and download the latest version of the specgate CLI tool
- Automatically compile, package, and install it globally
- Automatically run `specgate upgrade --yes` after installation to synchronize project configurations

### 2. If the above command fails

If `specgate` is not yet installed globally or the `--upgrade` flag is unavailable, fall back to step-by-step execution:

```bash
# Step 1: Update the CLI tool
specgate update --yes

# Step 2: Upgrade project configurations
specgate upgrade --yes
```

### 3. Report the result to the user

Give the user feedback based on the execution result:
- ✅ Success: report the CLI version and the project configuration upgrade result
- ⚠️ Partial success: the CLI was updated but the configuration upgrade failed; prompt the user to run `specgate upgrade --yes` manually
- ❌ Failure: report the cause of the error and the suggested remediation

## Notes

- Must be run in the project root directory (the directory containing `.specgate/config.yaml`)
- The `--yes` flag skips all interactive confirmations and suits automation scenarios
- The current configuration is backed up automatically before the upgrade
- If custom files conflict, a `.new` file is generated for manual merging
