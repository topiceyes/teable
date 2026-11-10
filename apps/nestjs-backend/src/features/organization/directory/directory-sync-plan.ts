import { createHash } from 'node:crypto';
import type { IDirectorySnapshot } from './directory-snapshot';

type IDepartment = {
  externalId: string;
  name: string;
  parentExternalId: string | null;
  inactiveTime: Date | null;
};
type IMember = {
  externalId: string;
  name: string;
  unionId: string | null;
  email: string | null;
  userId: string | null;
  externalRoleIds: string[];
  inactiveTime: Date | null;
  memberships: { department: { externalId: string } }[];
};
export type IDirectoryState = { departments: IDepartment[]; members: IMember[] };

const sortById = <T extends { externalId: string }>(values: T[]) =>
  [...values].sort((left, right) => left.externalId.localeCompare(right.externalId));
const memberValue = (member: IDirectorySnapshot['members'][number]) => ({
  externalId: member.externalId,
  name: member.name,
  active: member.active,
  unionId: member.unionId || null,
  email: member.email || null,
  departmentExternalIds: [...member.departmentExternalIds].sort(),
  externalRoleIds: [...member.externalRoleIds].sort(),
});

export function createDirectorySyncPlan(snapshot: IDirectorySnapshot, state: IDirectoryState) {
  const incomingDepartments = sortById(snapshot.departments);
  const incomingMembers = sortById(snapshot.members.map(memberValue));
  const departments = sortById(
    state.departments.map((value) => ({
      externalId: value.externalId,
      name: value.name,
      parentExternalId: value.parentExternalId,
      active: !value.inactiveTime,
    }))
  );
  const members = sortById(
    state.members.map(({ memberships, inactiveTime, userId, ...value }) => ({
      ...memberValue({
        ...value,
        unionId: value.unionId || undefined,
        email: value.email || undefined,
        active: !inactiveTime,
        departmentExternalIds: memberships.map((item) => item.department.externalId),
      }),
      userId,
    }))
  );
  const oldDepartments = new Map(departments.map((item) => [item.externalId, item]));
  const oldMembers = new Map(
    members.map(({ userId: _userId, ...item }) => [item.externalId, item])
  );
  const departmentIds = new Set(incomingDepartments.map((item) => item.externalId));
  const memberIds = new Set(incomingMembers.map((item) => item.externalId));
  const changes = {
    departments: {
      added: incomingDepartments.filter((item) => !oldDepartments.has(item.externalId)),
      updated: incomingDepartments.filter((item) => {
        const old = oldDepartments.get(item.externalId);
        return (
          old &&
          (!old.active || old.name !== item.name || old.parentExternalId !== item.parentExternalId)
        );
      }),
      deactivated: departments.filter((item) => item.active && !departmentIds.has(item.externalId)),
    },
    members: {
      added: incomingMembers.filter((item) => !oldMembers.has(item.externalId)),
      updated: incomingMembers.filter((item) => {
        const old = oldMembers.get(item.externalId);
        return old && JSON.stringify(old) !== JSON.stringify(item);
      }),
      deactivated: members
        .filter((item) => item.active && !memberIds.has(item.externalId))
        .map(({ userId: _userId, ...item }) => item),
    },
  };
  // Binding changes invalidate the preview too. Deterministic ordering tolerates provider reordering.
  const previewToken = createHash('sha256')
    .update(
      JSON.stringify({
        incomingDepartments,
        incomingMembers,
        departments,
        members,
      })
    )
    .digest('hex');
  return { previewToken, changes };
}
