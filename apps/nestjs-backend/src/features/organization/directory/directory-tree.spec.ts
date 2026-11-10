import { describe, expect, it } from 'vitest';
import { DirectoryTree } from './directory-tree';
const nodes = [
  { id: 'root', externalId: '1', name: 'Company', parentExternalId: null },
  { id: 'sales', externalId: '2', name: 'Sales', parentExternalId: '1' },
  { id: 'regional', externalId: '3', name: 'Regional sales', parentExternalId: '2' },
  { id: 'finance', externalId: '4', name: 'Finance', parentExternalId: '1' },
];
describe('directory hierarchy queries', () => {
  it('lists roots, direct children, and recursive descendants separately', () => {
    const tree = new DirectoryTree(nodes);
    expect(tree.list().map((node) => node.id)).toEqual(['root']);
    expect(tree.list('root').map((node) => node.id)).toEqual(['finance', 'sales']);
    expect(tree.descendants('sales', true)).toEqual(['sales', 'regional']);
    expect(tree.list('sales', true, 'regional').map((node) => node.id)).toEqual(['regional']);
  });
  it('exposes local IDs and an inclusive path rather than external IDs', () => {
    expect(new DirectoryTree(nodes).dto('regional')).toEqual({
      id: 'regional',
      name: 'Regional sales',
      parentId: 'sales',
      path: ['root', 'sales', 'regional'],
      pathName: ['Company', 'Sales', 'Regional sales'],
      hasChildren: false,
    });
  });
  it('rejects unknown department scopes', () => {
    expect(() => new DirectoryTree(nodes).list('other-enterprise')).toThrow('Department not found');
  });
  it('rejects cycles and orphan hierarchy nodes', () => {
    const cyclic = nodes.map((node) => ({
      ...node,
      parentExternalId: node.id === 'root' ? '3' : node.parentExternalId,
    }));
    expect(() => new DirectoryTree(cyclic).descendants('root')).toThrow(
      'Invalid directory hierarchy'
    );
    expect(() => new DirectoryTree(cyclic).dto('regional')).toThrow('Invalid directory hierarchy');
    expect(() => new DirectoryTree(nodes.slice(1)).dto('sales')).toThrow(
      'Invalid directory hierarchy'
    );
  });
});
