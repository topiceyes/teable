import { describe, expect, it } from 'vitest';
import { directorySnapshotSchema } from './directory-snapshot';
import { createDirectorySyncPlan, type IDirectoryState } from './directory-sync-plan';
const snapshot = directorySnapshotSchema.parse({
  complete: true,
  departments: [{ externalId: '1', name: 'Company', parentExternalId: null }],
  members: [{ externalId: 'u1', name: 'Employee', active: true, departmentExternalIds: ['1'] }],
});
const state = (): IDirectoryState => ({
  departments: [{ ...snapshot.departments[0], inactiveTime: null }],
  members: [
    {
      externalId: 'u1',
      name: 'Employee',
      unionId: null,
      email: null,
      userId: 'local',
      externalRoleIds: [],
      inactiveTime: null,
      memberships: [{ department: { externalId: '1' } }],
    },
  ],
});
describe('directory sync preview', () => {
  it('is idempotent', () => {
    expect(createDirectorySyncPlan(snapshot, state()).changes).toEqual({
      departments: { added: [], updated: [], deactivated: [] },
      members: { added: [], updated: [], deactivated: [] },
    });
  });
  it('identifies additions, changes and deactivations', () => {
    const input = structuredClone(snapshot);
    input.departments[0].name = 'New name';
    input.members[0].externalId = 'u2';
    const plan = createDirectorySyncPlan(input, state());
    expect(plan.changes.departments.updated).toHaveLength(1);
    expect(plan.changes.members.added[0].externalId).toBe('u2');
    expect(plan.changes.members.deactivated[0].externalId).toBe('u1');
  });
  it('invalidates previews after binding or remote data changes', () => {
    const token = createDirectorySyncPlan(snapshot, state()).previewToken;
    const changed = state();
    changed.members[0].userId = 'other';
    expect(createDirectorySyncPlan(snapshot, changed).previewToken).not.toBe(token);
    expect(createDirectorySyncPlan({ ...snapshot, members: [] }, state()).previewToken).not.toBe(
      token
    );
  });
  it('shows reactivation and ignores already inactive missing employees', () => {
    const old = state();
    old.members[0].inactiveTime = new Date();
    expect(createDirectorySyncPlan(snapshot, old).changes.members.updated).toHaveLength(1);
    expect(
      createDirectorySyncPlan({ ...snapshot, members: [] }, old).changes.members.deactivated
    ).toEqual([]);
  });
});
