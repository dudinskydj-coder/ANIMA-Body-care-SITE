# Backup Workflow

Before editing any existing project file:

1. Run `./backup-file.sh "<file>"`
2. Confirm the copy exists in `backup/`
3. Only then modify the original file

Rules:

- Store backups in the project-root `backup/` directory.
- Keep the original filename plus `YYYYMMDD_HHMM` in the backup name.
- Create one backup per file before each edit session.
- Never delete old backups automatically.
