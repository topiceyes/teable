import {
  directoryBindMemberRoSchema,
  directoryMembersRoSchema,
  getDepartmentListRoSchema,
  getDepartmentUserRoSchema,
} from '@teable/openapi';
import { describe, expect, it } from 'vitest';

describe('directory query and binding contracts', () => {
  it('requires an explicit expected binding value', () => {
    expect(
      directoryBindMemberRoSchema.safeParse({
        corpId: 'corp',
        memberId: 'employee',
        userId: 'local',
      }).success
    ).toBe(false);
    expect(
      directoryBindMemberRoSchema.parse({
        corpId: 'corp',
        memberId: 'employee',
        userId: null,
        expectedUserId: 'local',
      }).userId
    ).toBeNull();
  });
  it('bounds pagination and rejects malformed query flags', () => {
    for (const take of ['0', '101', '1.5', 'Infinity']) {
      expect(getDepartmentUserRoSchema.safeParse({ take }).success).toBe(false);
      expect(directoryMembersRoSchema.safeParse({ corpId: 'corp', take }).success).toBe(false);
    }
    expect(
      getDepartmentListRoSchema.safeParse({ includeChildrenDepartment: 'invalid' }).success
    ).toBe(false);
    expect(
      getDepartmentListRoSchema.parse({ organizationId: 'org', includeChildrenDepartment: 'false' })
    ).toEqual({
      organizationId: 'org',
      includeChildrenDepartment: false,
    });
  });
});
