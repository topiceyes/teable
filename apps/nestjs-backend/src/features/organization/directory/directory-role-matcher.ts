import type { IDirectoryRoleRule } from '@teable/openapi';
import { DirectoryTree } from './directory-tree';

type IDepartment = ConstructorParameters<typeof DirectoryTree>[0][number];
type IMember = { memberId?: string; departmentIds: string[]; externalRoleIds: string[] };

/** Rules are alternative ways to join a role. Several matching rules never multiply grants. */
export function compileDirectoryRoleRules(rules: IDirectoryRoleRule[], departments: IDepartment[]) {
  const tree = new DirectoryTree(departments);
  const activeDepartmentIds = new Set(departments.map((department) => department.id));
  const departmentIds = new Set<string>();
  const externalRoleIds = new Set<string>();
  const memberIds = new Set<string>();
  for (const rule of rules) {
    if (rule.type === 'externalRole') {
      externalRoleIds.add(rule.externalRoleId);
    } else if (rule.type === 'member') {
      memberIds.add(rule.memberId);
    } else if (activeDepartmentIds.has(rule.departmentId)) {
      const ids = rule.includeDescendants
        ? tree.descendants(rule.departmentId, true)
        : [rule.departmentId];
      ids.forEach((id) => departmentIds.add(id));
    }
  }
  return (member: IMember) =>
    (member.memberId !== undefined && memberIds.has(member.memberId)) ||
    member.departmentIds.some((id) => departmentIds.has(id)) ||
    member.externalRoleIds.some((id) => externalRoleIds.has(id));
}
