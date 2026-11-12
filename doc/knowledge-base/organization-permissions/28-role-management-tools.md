# Role management tools (1.4.0)

Employee role saves open permission diagnosis. Role rosters support direct department, binding and source filters with paginated batch direct assignments and mandatory impact previews. Role lists show effective and unbound counts.

Role configuration history stores the actor, timestamp and before/after snapshots in the same database transaction as the role update. History begins when this feature is enabled; earlier events are not reconstructed. History is read-only.

Permission checks identify inactive or unbound direct assignees, unavailable accounts, stale department/member references, and effective roles referenced by policies without base access. Checks reuse actual interactive account permissions and never repair configuration automatically.

Apply migration `20261111000000_add_directory_role_history` and regenerate Prisma Client before running the new application. The additional history table can remain when rolling back to 1.3.1. No v2 domain changes are involved.

Validation: backend 224 passed (5 existing opt-in tests skipped), frontend 66 passed, new HTTP/database/Chrome acceptance 63 passed, prior v1 54 and v2/Chrome 65 passed. Full backend/frontend type checks and affected-file lint passed. Acceptance fixtures were cleaned. Human DingTalk QR authorization was not exercised.
