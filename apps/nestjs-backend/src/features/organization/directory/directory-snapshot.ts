import { z } from 'zod';

const externalId = z.string().trim().min(1);

/** Normalized provider data. It contains neither credentials nor permission grants. */
export const directorySnapshotSchema = z
  .object({
    // A failed/page-limited crawl must never masquerade as a full snapshot.
    complete: z.literal(true),
    departments: z.array(
      z
        .object({
          externalId,
          parentExternalId: externalId.nullable(),
          name: z.string().trim().min(1),
        })
        .strict()
    ),
    members: z.array(
      z
        .object({
          externalId,
          unionId: externalId.optional(),
          name: z.string().trim().min(1),
          email: z.email().optional(),
          active: z.boolean(),
          departmentExternalIds: z.array(externalId),
          externalRoleIds: z.array(externalId).default([]),
        })
        .strict()
    ),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    const departments = new Map<string, (typeof snapshot.departments)[number]>();
    snapshot.departments.forEach((department, index) => {
      if (departments.has(department.externalId)) {
        issue(['departments', index, 'externalId'], 'Duplicate department identity');
      }
      departments.set(department.externalId, department);
    });

    const visited = new Set<string>();
    snapshot.departments.forEach((department, index) => {
      if (department.parentExternalId && !departments.has(department.parentExternalId)) {
        issue(['departments', index, 'parentExternalId'], 'Unknown parent department');
      }
      // Iterative traversal also handles deep enterprise hierarchies without recursion.
      const ancestors = new Set<string>();
      let current: typeof department | undefined = department;
      while (current && !visited.has(current.externalId)) {
        if (ancestors.has(current.externalId)) {
          issue(
            ['departments', index, 'parentExternalId'],
            'Department hierarchy contains a cycle'
          );
          break;
        }
        ancestors.add(current.externalId);
        current = current.parentExternalId ? departments.get(current.parentExternalId) : undefined;
      }
      ancestors.forEach((id) => visited.add(id));
    });

    const memberIds = new Set<string>();
    snapshot.members.forEach((member, index) => {
      if (memberIds.has(member.externalId)) {
        issue(['members', index, 'externalId'], 'Duplicate member identity');
      }
      memberIds.add(member.externalId);
      if (member.active && !member.departmentExternalIds.length) {
        issue(['members', index, 'departmentExternalIds'], 'Active member requires a department');
      }
      const departmentIds = new Set<string>();
      member.departmentExternalIds.forEach((id, departmentIndex) => {
        const path = ['members', index, 'departmentExternalIds', departmentIndex];
        if (!departments.has(id)) issue(path, 'Unknown member department');
        if (departmentIds.has(id)) issue(path, 'Duplicate member department');
        departmentIds.add(id);
      });
      if (new Set(member.externalRoleIds).size !== member.externalRoleIds.length) {
        issue(['members', index, 'externalRoleIds'], 'Duplicate external role');
      }
    });
  });

export type IDirectorySnapshot = z.infer<typeof directorySnapshotSchema>;
