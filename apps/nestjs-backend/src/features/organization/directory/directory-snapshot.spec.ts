import { describe, expect, it } from 'vitest';
import { directorySnapshotSchema } from './directory-snapshot';

const snapshot = () => ({
  complete: true,
  departments: [
    { externalId: 'root', parentExternalId: null, name: 'Company' },
    { externalId: 'finance', parentExternalId: 'root', name: 'Finance' },
  ],
  members: [
    {
      externalId: 'employee-1',
      name: 'Employee',
      active: true,
      departmentExternalIds: ['root', 'finance'],
      externalRoleIds: ['manager'],
    },
  ],
});

describe('directory snapshot validation', () => {
  it('accepts multiple departments and preserves source roles as metadata', () => {
    const parsed = directorySnapshotSchema.parse(snapshot());
    expect(parsed.members[0].departmentExternalIds).toEqual(['root', 'finance']);
    expect(parsed.members[0].externalRoleIds).toEqual(['manager']);
    expect(parsed.members[0]).not.toHaveProperty('userId');
  });

  it('rejects partial snapshots', () => {
    expect(directorySnapshotSchema.safeParse({ ...snapshot(), complete: false }).success).toBe(
      false
    );
  });

  it('rejects orphan departments and cyclic hierarchies', () => {
    for (const parentExternalId of ['missing', 'finance']) {
      const input = snapshot();
      input.departments[0].parentExternalId = parentExternalId;
      expect(directorySnapshotSchema.safeParse(input).success).toBe(false);
    }
  });

  it('rejects duplicate employee and department identities', () => {
    const input = snapshot();
    input.members.push(input.members[0]);
    input.departments.push(input.departments[0]);
    const result = directorySnapshotSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toHaveLength(2);
  });

  it('rejects memberships referencing missing or duplicate departments', () => {
    for (const departmentExternalIds of [['unknown'], ['root', 'root'], []]) {
      const input = snapshot();
      input.members[0].departmentExternalIds = departmentExternalIds;
      expect(directorySnapshotSchema.safeParse(input).success).toBe(false);
    }
  });

  it('allows inactive employees without department membership', () => {
    const input = snapshot();
    input.members[0].active = false;
    input.members[0].departmentExternalIds = [];
    expect(directorySnapshotSchema.safeParse(input).success).toBe(true);
  });

  it('rejects local account links and permission grants supplied by a provider', () => {
    for (const extra of [{ userId: 'local-user' }, { roleName: 'owner' }, { isAdmin: true }]) {
      const input = snapshot();
      Object.assign(input.members[0], extra);
      expect(directorySnapshotSchema.safeParse(input).success).toBe(false);
    }
  });

  it('handles deep hierarchies without recursive traversal', () => {
    const departments = Array.from({ length: 10000 }, (_, index) => ({
      externalId: `${index}`,
      parentExternalId: index ? `${index - 1}` : null,
      name: `${index}`,
    })).reverse();
    expect(
      directorySnapshotSchema.safeParse({ complete: true, departments, members: [] }).success
    ).toBe(true);
  });
});
