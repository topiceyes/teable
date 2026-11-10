import { ConflictException, NotFoundException } from '@nestjs/common';
import type { IGetDepartmentVo } from '@teable/openapi';

type IDepartmentNode = {
  id: string;
  externalId: string;
  name: string;
  parentExternalId: string | null;
};

/** Resolves external hierarchy links to stable local IDs without recursive traversal. */
export class DirectoryTree {
  private readonly byId: Map<string, IDepartmentNode>;
  private readonly byExternalId: Map<string, IDepartmentNode>;
  private readonly children = new Map<string | null, IDepartmentNode[]>();
  private readonly paths = new Map<string, IDepartmentNode[]>();

  constructor(private readonly nodes: IDepartmentNode[]) {
    this.byId = new Map(nodes.map((node) => [node.id, node]));
    this.byExternalId = new Map(nodes.map((node) => [node.externalId, node]));
    for (const node of nodes) {
      const children = this.children.get(node.parentExternalId) || [];
      children.push(node);
      this.children.set(node.parentExternalId, children);
    }
  }

  require(id: string) {
    const node = this.byId.get(id);
    if (!node) throw new NotFoundException('Department not found in this organization');
    return node;
  }

  private path(node: IDepartmentNode) {
    const cached = this.paths.get(node.id);
    if (cached) return cached;
    const chain: IDepartmentNode[] = [];
    const seen = new Set<string>();
    let current: IDepartmentNode | undefined = node;
    while (current) {
      if (seen.has(current.id)) throw new ConflictException('Invalid directory hierarchy');
      seen.add(current.id);
      chain.push(current);
      const parent: string | null = current.parentExternalId;
      if (parent && !this.byExternalId.has(parent))
        throw new ConflictException('Invalid directory hierarchy');
      current = parent ? this.byExternalId.get(parent) : undefined;
    }
    chain.reverse();
    this.paths.set(node.id, chain);
    return chain;
  }

  descendants(id: string, includeSelf = false) {
    const root = this.require(id);
    const queue = [root];
    const seen = new Set<string>();
    for (let index = 0; index < queue.length; index++) {
      const node = queue[index];
      if (seen.has(node.id)) throw new ConflictException('Invalid directory hierarchy');
      seen.add(node.id);
      queue.push(...(this.children.get(node.externalId) || []));
    }
    return (includeSelf ? queue : queue.slice(1)).map((node) => node.id);
  }

  dto(id: string): IGetDepartmentVo {
    const node = this.require(id);
    const path = this.path(node);
    return {
      id: node.id,
      name: node.name,
      ...(path.length > 1 ? { parentId: path[path.length - 2].id } : {}),
      path: path.map((ancestor) => ancestor.id),
      pathName: path.map((ancestor) => ancestor.name),
      hasChildren: Boolean(this.children.get(node.externalId)?.length),
    };
  }

  list(parentId?: string, includeChildren = false, search?: string) {
    const parent = parentId ? this.require(parentId) : undefined;
    const ids = includeChildren && parent ? new Set(this.descendants(parent.id)) : undefined;
    const candidates = includeChildren
      ? this.nodes.filter((node) => !ids || ids.has(node.id))
      : this.children.get(parent?.externalId || null) || [];
    const needle = search?.toLocaleLowerCase();
    return candidates
      .filter((node) => !needle || node.name.toLocaleLowerCase().includes(needle))
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
      .map((node) => this.dto(node.id));
  }
}
