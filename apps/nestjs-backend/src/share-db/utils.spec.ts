import type { CreateOp, DeleteOp, EditOp } from 'sharedb';
import { describe, expect, it } from 'vitest';
import { stripInstructionlessComponents } from './utils';

const opMetadata = {
  src: 'test',
  seq: 1,
  v: 1,
  m: null,
  create: undefined,
  del: undefined,
  op: undefined,
};

describe('stripInstructionlessComponents', () => {
  it('removes a component that carries no json0 instruction', () => {
    const op: EditOp = {
      ...opMetadata,
      c: 'viw_tblTest',
      d: 'viwTest',
      v: 3,
      op: [{ p: ['name'], oi: 'Renamed' }, { p: ['filter'] }],
    };

    expect(stripInstructionlessComponents(op)).toEqual({
      ...op,
      op: [{ p: ['name'], oi: 'Renamed' }],
    });
  });

  it('drops an op whose components are all instruction-less', () => {
    const op: EditOp = {
      ...opMetadata,
      c: 'viw_tblTest',
      d: 'viwTest',
      v: 3,
      op: [{ p: ['filter'] }],
    };

    expect(stripInstructionlessComponents(op)).toBeUndefined();
  });

  it('keeps explicit nulls, which are instructions', () => {
    const op: EditOp = {
      ...opMetadata,
      c: 'viw_tblTest',
      d: 'viwTest',
      v: 3,
      op: [{ p: ['filter'], od: null, oi: null }],
    };

    expect(stripInstructionlessComponents(op)).toEqual(op);
  });

  it('passes through ops without a component list and ops that are fully applicable', () => {
    const editOp: EditOp = {
      ...opMetadata,
      c: 'tbl_bseTest',
      d: 'tblTest',
      v: 2,
      op: [{ p: ['name'], oi: 'Renamed' }],
    };
    const createOp: CreateOp = {
      ...opMetadata,
      c: 'tbl_bseTest',
      d: 'tblTest',
      create: { type: 'json0', data: {} },
    };
    const deleteOp: DeleteOp = { ...opMetadata, c: 'tbl_bseTest', d: 'tblTest', del: true };

    expect(stripInstructionlessComponents(editOp)).toEqual(editOp);
    expect(stripInstructionlessComponents(createOp)).toEqual(createOp);
    expect(stripInstructionlessComponents(deleteOp)).toEqual(deleteOp);
  });
});
