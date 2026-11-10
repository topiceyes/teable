/* eslint-disable teable/no-bare-fetch -- Requests only target the fixed local acceptance origin. */
/** Local HTTP/DB acceptance. Password on stdin; temporary fixtures are removed in finally. */
const { randomUUID, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const r = createRequire(path.resolve(__dirname, '../package.json'));
r('dotenv-flow').config({
  path: path.resolve(__dirname, '../../nextjs-app'),
  node_env: 'development',
  silent: true,
});
const database = 'teable_dev_20261109';
const url = new URL(process.env.PRISMA_META_DATABASE_URL || process.env.PRISMA_DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Local database required');
url.pathname = '/' + database;
const db = new (r('pg').Client)({ connectionString: url.toString() });
const origin = 'http://localhost:3000';
const mode = process.env.TEABLE_ACCEPTANCE_MODE || 'v2';
if (!['v1', 'v2'].includes(mode)) throw new Error('TEABLE_ACCEPTANCE_MODE must be v1 or v2');
const adminEmail = process.env.TEABLE_ACCEPTANCE_ADMIN_EMAIL;
if (!adminEmail) throw new Error('TEABLE_ACCEPTANCE_ADMIN_EMAIL is required');
const adminPassword = fs.readFileSync(0, 'utf8').trim();
const suffix = randomUUID();
const userId = 'usr' + randomBytes(8).toString('hex');
const otherId = 'usr' + randomBytes(8).toString('hex');
const childId = 'usr' + randomBytes(8).toString('hex');
const connectionId = 'acceptance-' + suffix;
const departmentId = 'department-' + suffix;
const childDepartmentId = 'child-department-' + suffix;
let role;
const fixturePassword = randomBytes(24).toString('hex');
const cookies = [];
const sockets = [];
let adminCookie, userCookie, spaceId, baseId;
let policyRevision = 0;
const actors = [userId, otherId, childId];
const actorCookies = [];
const corpId = connectionId;
const memberIds = actors.map((_, index) => 'pilot-member-' + index + '-' + suffix);
const directoryPath = '/admin/organization/dingtalk';
let passed = 0;
function check(condition, label) {
  if (!condition) throw new Error(label);
  passed++;
  console.log('PASS ' + label);
}
async function http(method, route, body, cookie = adminCookie) {
  const response = await fetch(origin + '/api' + route, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie || '',
      Connection: 'close',
      'x-teable-canary': mode === 'v2' ? 'true' : 'false',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(45000),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // Non-JSON failures are represented by their HTTP status.
  }
  return { status: response.status, data, response };
}
async function login(email, password) {
  const result = await http('POST', '/auth/signin', { email, password }, '');
  if (result.status !== 200) throw new Error('Acceptance login failed: ' + result.status);
  const cookie = result.response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  cookies.push(cookie);
  return cookie;
}
async function subscribeRecord(tableId, recordId, cookie) {
  const WebSocket = r('ws');
  const socket = new WebSocket(
    'ws://localhost:3001/socket/000/' + randomBytes(8).toString('hex') + '/websocket',
    { headers: { Cookie: cookie } }
  );
  sockets.push(socket);
  const wire = [];
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Socket subscription timed out')), 15000);
    socket.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.on('message', (raw) => {
      const text = raw.toString();
      if (!text.startsWith('a')) return;
      for (const encoded of JSON.parse(text.slice(1))) {
        const message = JSON.parse(encoded);
        wire.push(message);
        if (message.a === 'init')
          socket.send(
            JSON.stringify([JSON.stringify({ a: 's', c: 'rec_' + tableId, d: recordId })])
          );
        if (message.a === 's') {
          clearTimeout(timeout);
          if (message.error) reject(new Error('Socket subscription rejected'));
          else resolve();
        }
      }
    });
  });
  return { socket, wire };
}
async function bind(index, user, expected) {
  return http('POST', directoryPath + '/bindMember', {
    corpId,
    memberId: memberIds[index],
    userId: user,
    expectedUserId: expected,
  });
}
async function saveRole(enabled, includeDescendants) {
  const result = await http('POST', directoryPath + '/saveRole', {
    corpId,
    ...(role ? { roleId: role.id } : {}),
    expectedVersion: role?.version || 0,
    name: 'Pilot department writer',
    enabled,
    rules: [{ type: 'department', departmentId, includeDescendants }],
  });
  check(result.status === 200, 'administrator saves role revision ' + (role?.version || 0));
  role = result.data;
}
async function roleMembers(expected) {
  const result = await http(
    'GET',
    directoryPath + '/roleMembers?' + new URLSearchParams({ corpId, roleId: role.id })
  );
  check(
    result.status === 200 &&
      result.data.total === expected.length &&
      result.data.members
        .map((member) => member.userId)
        .sort()
        .join() === [...expected].sort().join(),
    'role member preview matches ' + expected.length + ' active bindings'
  );
}
async function savePolicy(tableId, hidden, locked, rowScope, enabled = true) {
  const result = await http('POST', '/authorityMatrix/save', {
    baseId,
    connectionId,
    expectedRevision: policyRevision,
    policy: {
      version: 1,
      enabled,
      rules: [
        {
          roleId: role.id,
          tableId,
          actions: ['table|read', 'record|read', 'record|create', 'record|update', 'record|delete'],
        },
      ],
      restrictions: [{ tableId, hiddenFieldIds: [hidden], readOnlyFieldIds: [locked], rowScope }],
    },
  });
  check(result.status === 200, 'save ' + rowScope + ' data scope revision ' + policyRevision);
  policyRevision = result.data.revision;
}
async function verifyRows(path, index, expected, label) {
  const result = await http('GET', path + '?fieldKeyType=id', undefined, actorCookies[index]);
  check(
    result.status === 200 &&
      result.data.records
        .map((record) => record.id)
        .sort()
        .join() === [...expected].sort().join(),
    label
  );
  return result.data;
}
async function verifyPilotBrowser(table) {
  const appRequire = createRequire(path.resolve(__dirname, '../../nextjs-app/package.json'));
  const { chromium } = appRequire('@playwright/test');
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  try {
    for (const [index, expected, forbidden, filename] of [
      [
        0,
        ['pilot-A-row', 'pilot-B-row'],
        ['pilot-C-row', 'pilot-admin-row', 'pilot-secret'],
        'department-pilot-parent.png',
      ],
      [
        2,
        ['pilot-C-row'],
        ['pilot-A-row', 'pilot-B-row', 'pilot-admin-row', 'pilot-secret'],
        'department-pilot-child.png',
      ],
    ]) {
      const context = await browser.newContext({
        locale: 'zh-CN',
        viewport: { width: 1440, height: 1000 },
      });
      await context.addCookies(
        actorCookies[index].split('; ').map((pair) => {
          const separator = pair.indexOf('=');
          return { name: pair.slice(0, separator), value: pair.slice(separator + 1), url: origin };
        })
      );
      const page = await context.newPage();
      const errors = [],
        frames = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('websocket', (socket) =>
        socket.on('framereceived', (frame) => frames.push(String(frame.payload)))
      );
      const response = await page.goto(
        origin + `/base/${baseId}/table/${table.id}/${table.views[0].id}`,
        { waitUntil: 'networkidle', timeout: 90000 }
      );
      check(response.status() === 200, 'browser department account ' + index + ' opens grid');
      await page.waitForFunction(() => document.querySelector('canvas'), undefined, {
        timeout: 20000,
      });
      for (
        let attempt = 0;
        attempt < 80 && !expected.every((name) => frames.join('').includes(name));
        attempt++
      )
        await new Promise((resolve) => setTimeout(resolve, 250));
      const wire = frames.join('');
      check(
        expected.every((name) => wire.includes(name)) &&
          forbidden.every((name) => !wire.includes(name)),
        'browser account ' + index + ' receives only permitted department snapshots'
      );
      check(
        errors.length === 0 &&
          (await page.getByText('Runtime Error', { exact: true }).count()) === 0,
        'browser account ' + index + ' has no JavaScript or runtime overlay errors'
      );
      await page.screenshot({ path: '/tmp/teable-local-run/' + filename, animations: 'disabled' });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
async function main() {
  await db.connect();
  adminCookie = await login(adminEmail, adminPassword);
  const salt = await r('bcrypt').genSalt(10);
  const hash = await r('bcrypt').hash(fixturePassword, salt);
  for (const [index, id] of actors.entries()) {
    await db.query(
      'INSERT INTO users(id,name,email,password,salt,is_admin,last_modified_time) VALUES($1,$2,$3,$4,$5,false,NOW())',
      [id, 'Department pilot ' + index, id + '@example.invalid', hash, salt]
    );
    actorCookies.push(await login(id + '@example.invalid', fixturePassword));
  }
  userCookie = actorCookies[0];
  let result = await http('POST', '/space', { name: 'Department pilot ' + suffix });
  spaceId = result.data?.id;
  check(Boolean(spaceId), 'create isolated pilot space');
  result = await http('POST', '/base', { name: 'Department permission pilot', spaceId });
  baseId = result.data?.id;
  check(Boolean(baseId), 'create isolated pilot base');
  await db.query('UPDATE base SET v2_enabled=$1 WHERE id=$2', [mode === 'v2', baseId]);
  await db.query(
    "INSERT INTO directory_connection(id,provider,tenant_id,name,modified_time) VALUES($1,'dingtalk',$1,'Department pilot only',NOW())",
    [connectionId]
  );
  for (const [id, externalId, parent, name] of [
    [departmentId, 'parent', null, 'Pilot parent department'],
    [childDepartmentId, 'child', 'parent', 'Pilot child department'],
  ])
    await db.query(
      'INSERT INTO directory_department(id,connection_id,external_id,parent_external_id,name,modified_time) VALUES($1,$2,$3,$4,$5,NOW())',
      [id, connectionId, externalId, parent, name]
    );
  for (const [index, id] of actors.entries()) {
    await db.query(
      'INSERT INTO collaborator(id,resource_id,resource_type,role_name,principal_id,principal_type,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [randomUUID(), baseId, 'base', 'viewer', id, 'user', id]
    );
    await db.query(
      'INSERT INTO directory_member(id,connection_id,external_id,name,modified_time) VALUES($1,$2,$1,$3,NOW())',
      [memberIds[index], connectionId, 'Pilot employee ' + index]
    );
    await db.query(
      'INSERT INTO directory_membership(connection_id,member_id,department_id) VALUES($1,$2,$3)',
      [connectionId, memberIds[index], index === 2 ? childDepartmentId : departmentId]
    );
    check(
      (await bind(index, id, null)).status === 200,
      'bind test employee ' + index + ' through administrator API'
    );
  }
  check(
    (await bind(0, null, null)).status === 409,
    'stale binding edit rejected without overwriting identity'
  );
  result = await http(
    'POST',
    directoryPath + '/bindMember',
    { corpId, memberId: memberIds[0], userId: null, expectedUserId: userId },
    userCookie
  );
  check(result.status === 403, 'ordinary employee cannot change directory binding');
  result = await http('GET', directoryPath + '/listDepartments?' + new URLSearchParams({ corpId }));
  check(
    result.status === 200 &&
      result.data.length === 2 &&
      result.data.some(
        (department) => department.id === childDepartmentId && department.parentId === departmentId
      ),
    'administrator sees correct parent-child department tree'
  );
  await saveRole(true, false);
  await roleMembers([userId, otherId]);
  result = await http('POST', `/base/${baseId}/table`, {
    name: 'Department pilot records',
    fields: [
      { name: 'Name', type: 'singleLineText' },
      { name: 'Sensitive', type: 'singleLineText' },
      { name: 'Locked', type: 'singleLineText' },
      { name: 'Creator', type: 'createdBy' },
    ],
    records: [],
  });
  const table = result.data;
  check(Boolean(table?.id), 'create department pilot table');
  const field = table.fields.find((item) => item.name === 'Name').id;
  const hidden = table.fields.find((item) => item.name === 'Sensitive').id;
  const locked = table.fields.find((item) => item.name === 'Locked').id;
  const recordPath = `/table/${table.id}/record`;
  const write = (index, id, name, extra = {}) =>
    http(
      id ? 'PATCH' : 'POST',
      recordPath + (id ? '/' + id : ''),
      {
        fieldKeyType: 'id',
        ...(id
          ? { record: { fields: { [field]: name, ...extra } } }
          : { records: [{ fields: { [field]: name, ...extra } }] }),
      },
      actorCookies[index]
    );
  check(
    (await write(0, null, 'before-grant')).status === 403,
    'department binding alone does not grant record creation'
  );
  await savePolicy(table.id, hidden, locked, 'department');
  check(
    (await write(2, null, 'before-child-grant')).status === 403,
    'direct department mapping excludes child department employee'
  );
  await saveRole(true, true);
  await roleMembers(actors);
  const rowIds = [];
  for (const index of [0, 1, 2]) {
    result = await write(index, null, 'pilot-' + ['A', 'B', 'C'][index] + '-row');
    check(
      result.status === 201 && Boolean(result.data?.records?.[0]?.id),
      'matrix grants scoped creation to employee ' + index
    );
    check(
      result.response.headers.get('x-teable-v2') === String(mode === 'v2'),
      'employee ' + index + ' writes through requested ' + mode + ' engine'
    );
    rowIds.push(result.data.records[0].id);
  }
  result = await http('POST', recordPath, {
    fieldKeyType: 'id',
    records: [{ fields: { [field]: 'pilot-admin-row', [hidden]: 'pilot-secret' } }],
  });
  const adminRow = result.data?.records?.[0]?.id;
  check(Boolean(adminRow), 'administrator creates outsider record for isolation checks');
  const [ownRow, peerRow, childRow] = rowIds;
  const list = await verifyRows(
    recordPath,
    0,
    [ownRow, peerRow],
    'parent employee reads own and direct department peer rows'
  );
  await verifyRows(recordPath, 1, [ownRow, peerRow], 'peer sees symmetric direct department scope');
  await verifyRows(
    recordPath,
    2,
    [childRow],
    'child employee receives role grant but only child department rows'
  );
  check(
    !JSON.stringify(list).includes(hidden) && !JSON.stringify(list).includes('pilot-secret'),
    'sensitive field absent from department list'
  );
  check(
    list.records.every((record) => record.permissions.update[locked] === false),
    'read-only cell permissions exposed to grid'
  );
  check(
    (await write(0, peerRow, 'pilot-B-row')).status === 200,
    'department writer can update an in-scope peer row'
  );
  check(
    (await write(0, childRow, 'bypass')).status === 403,
    'parent role descendants do not expand department row scope'
  );
  check(
    (await write(0, ownRow, 'pilot-A-row', { [locked]: 'bypass' })).status === 403,
    'read-only field write rejected'
  );
  check(
    (await write(0, ownRow, 'pilot-A-row', { [hidden]: 'bypass' })).status === 403,
    'hidden field write rejected'
  );
  result = await http('GET', `/table/${table.id}/aggregation/row-count`, undefined, userCookie);
  check(
    result.status === 200 && result.data.rowCount === 2,
    'department count equals permitted rows'
  );
  check(
    (
      await http(
        'POST',
        recordPath + '/socket/snapshot-bulk',
        { ids: [ownRow, childRow] },
        userCookie
      )
    ).status === 403,
    'mixed-department snapshot request rejected'
  );
  if (process.env.TEABLE_ACCEPTANCE_BROWSER === '1') await verifyPilotBrowser(table);
  await savePolicy(table.id, hidden, locked, 'own');
  await verifyRows(recordPath, 0, [ownRow], 'own scope removes department peers without new login');
  await savePolicy(table.id, hidden, locked, 'department');
  check((await bind(0, null, userId)).status === 200, 'administrator unbinds employee through API');
  await verifyRows(
    recordPath,
    0,
    [],
    'unbound employee has empty department scope in existing session'
  );
  check(
    (await write(0, ownRow, 'after-unbind')).status === 403,
    'unbinding immediately removes derived write permission'
  );
  check((await bind(0, userId, null)).status === 200, 'administrator rebinds employee through API');
  await verifyRows(recordPath, 0, [ownRow, peerRow], 'rebinding restores current department scope');
  const live = await subscribeRecord(table.id, peerRow, userCookie);
  check(live.socket.readyState === 1, 'parent subscribes to in-scope peer before departure');
  const closed = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Departed peer subscription remained open')),
      15000
    );
    live.socket.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  // Simulate a completed sync marking only this synthetic employee inactive.
  await db.query(
    'UPDATE directory_member SET inactive_time=NOW() WHERE id=$1 AND connection_id=$2',
    [memberIds[1], connectionId]
  );
  await verifyRows(
    recordPath,
    0,
    [ownRow],
    'departed peer records removed from active colleague scope'
  );
  await verifyRows(
    recordPath,
    1,
    [],
    'departed employee cannot read department rows with old session'
  );
  check(
    (await write(1, peerRow, 'after-departure')).status === 403,
    'departed employee loses matrix writes'
  );
  check((await bind(1, otherId, otherId)).status === 409, 'inactive employee cannot be rebound');
  result = await http('PATCH', recordPath + '/' + peerRow, {
    fieldKeyType: 'id',
    record: { fields: { [field]: 'private-after-departure' } },
  });
  check(result.status === 200, 'administrator can update archived employee record');
  await closed;
  check(
    !JSON.stringify(live.wire).includes('private-after-departure'),
    'existing peer socket closes before post-departure data delivery'
  );
  await db.query(
    'UPDATE directory_member SET inactive_time=NULL WHERE id=$1 AND connection_id=$2',
    [memberIds[1], connectionId]
  );
  await roleMembers(actors);
  await saveRole(false, true);
  check(
    (await write(0, ownRow, 'role-disabled')).status === 403,
    'disabled role removes derived writes in current session'
  );
  await db.query(
    "UPDATE collaborator SET role_name='editor' WHERE resource_id=$1 AND principal_id=$2",
    [baseId, otherId]
  );
  check(
    (await write(1, peerRow, 'manual-editor')).status === 200,
    'manual editor survives derived role revocation'
  );
  check(
    (await write(1, childRow, 'manual-bypass')).status === 403,
    'manual editor remains subject to department row restriction'
  );
  await saveRole(true, true);
  await db.query('UPDATE directory_connection SET enabled=false WHERE id=$1', [connectionId]);
  await verifyRows(
    recordPath,
    0,
    [],
    'disabled enterprise connection fails closed for department scope'
  );
  check(
    (await write(0, ownRow, 'disabled-connection')).status === 403,
    'disabled enterprise removes matrix write grant'
  );
  await db.query('UPDATE directory_connection SET enabled=true WHERE id=$1', [connectionId]);
  await db.query('UPDATE users SET deactivated_time=NOW() WHERE id=$1', [otherId]);
  await verifyRows(
    recordPath,
    0,
    [ownRow],
    'inactive local account creator removed from colleague scope'
  );
  result = await http('GET', recordPath, undefined, actorCookies[1]);
  check([401, 403].includes(result.status), 'inactive local account cannot use old HTTP session');
  await db.query('UPDATE users SET deactivated_time=NULL WHERE id=$1', [otherId]);
  result = await http(
    'GET',
    '/authorityMatrix/preview?' +
      new URLSearchParams({ baseId, tableId: table.id, email: userId + '@example.invalid' })
  );
  check(
    result.status === 200 &&
      result.data.dataScope?.rowScope === 'department' &&
      result.data.roles.some((item) => item.id === role.id),
    'administrator preview matches department role and row scope'
  );
}
function failCleanup() {
  console.error('Pilot fixture cleanup failed');
  process.exitCode = 1;
}
main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const socket of sockets) socket.close();
    if (spaceId && adminCookie) {
      try {
        const result = await http('DELETE', `/space/${spaceId}/permanent`);
        if (result.status !== 200) throw new Error('Pilot space cleanup failed');
      } catch {
        failCleanup();
      }
    }
    await db
      .query('DELETE FROM directory_connection WHERE id=$1', [connectionId])
      .catch(failCleanup);
    await db.query('DELETE FROM users WHERE id=ANY($1::text[])', [actors]).catch(failCleanup);
    for (const cookie of cookies)
      await http('POST', '/auth/signout', {}, cookie).catch(failCleanup);
    const fixtures = await db
      .query(
        `SELECT
    (SELECT count(*)::int FROM space WHERE id=$1) AS spaces,
    (SELECT count(*)::int FROM users WHERE id=ANY($2::text[])) AS users,
    (SELECT count(*)::int FROM directory_connection WHERE id=$3) AS connections`,
        [spaceId || '', actors, connectionId]
      )
      .catch(failCleanup);
    if (fixtures && Object.values(fixtures.rows[0]).some(Boolean)) failCleanup();
    await db.end();
    console.log(
      JSON.stringify({
        passed,
        database,
        mode,
        success: !process.exitCode,
        fixtures: fixtures?.rows[0],
        realEmployeesModified: false,
      })
    );
  });
