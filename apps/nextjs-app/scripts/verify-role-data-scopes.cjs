/** Fixed local v1/v2 HTTP, WebSocket and Chrome acceptance; synthetic fixtures are cleaned. */
const { randomBytes, randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const path = require('node:path');
const backend = createRequire(path.resolve(__dirname, '../../nestjs-backend/package.json'));
backend('dotenv-flow').config({
  path: path.resolve(__dirname, '..'),
  node_env: 'development',
  silent: true,
});
const dbUrl = new URL(process.env.PRISMA_META_DATABASE_URL || process.env.PRISMA_DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(dbUrl.hostname)) throw Error('Local database required');
dbUrl.pathname = '/teable_dev_20261109';
const db = new (backend('pg').Client)({ connectionString: dbUrl.href });
const { chromium } = require('@playwright/test');
const origin = 'http://localhost:3000';
const mode = process.env.TEABLE_ACCEPTANCE_MODE || 'v2';
if (!['v1', 'v2'].includes(mode)) throw Error('Invalid engine');
const suffix = randomUUID();
const connectionId = 'role-scope-' + suffix;
const corpId = connectionId;
const deptId = 'scope-dept-' + suffix;
const otherDeptId = 'scope-other-dept-' + suffix;
const managerRoleId = 'manager-' + suffix;
const executiveRoleId = 'executive-' + suffix;
const adminId = 'usr' + randomBytes(8).toString('hex');
const people = ['员工', '负责人', '管理人员'].map((name, index) => ({
  id: 'usr' + randomBytes(8).toString('hex'),
  memberId: 'member-' + index + '-' + suffix,
  name,
  index,
  cookie: '',
  recordId: '',
}));
const password = randomBytes(24).toString('hex');
const cookies = [],
  sockets = [];
let adminCookie,
  browser,
  spaceId,
  baseId,
  tableId,
  fields,
  revision = 0,
  passed = 0;
const check = (value, label) => {
  if (!value) throw Error(label);
  passed++;
  console.log('PASS ' + label);
};
async function request(method, route, body, cookie = adminCookie) {
  const response = await fetch(origin + '/api' + route, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie || '',
      'x-teable-canary': String(mode === 'v2'),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(45000),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    /* HTTP status diagnoses non-JSON failures. */
  }
  return { status: response.status, data, response };
}
async function login(id) {
  const r = await request('POST', '/auth/signin', { email: id + '@example.invalid', password }, '');
  check(r.status === 200, 'synthetic account login');
  const cookie = r.response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  cookies.push(cookie);
  return cookie;
}
function restriction() {
  return {
    tableId,
    rowScope: 'own',
    hiddenFieldIds: [fields.Private],
    readOnlyFieldIds: [],
    roleOverrides: [
      {
        roleId: managerRoleId,
        rowScope: 'department',
        hiddenFieldIds: [],
        readOnlyFieldIds: [fields.Locked],
      },
      { roleId: executiveRoleId, rowScope: 'all', hiddenFieldIds: [], readOnlyFieldIds: [] },
    ],
  };
}
async function save(scope) {
  const r = await request('POST', '/authorityMatrix/save', {
    baseId,
    connectionId,
    expectedRevision: revision,
    policy: { version: 1, enabled: true, rules: [], restrictions: [scope] },
  });
  check(r.status === 200, 'save role data scope policy');
  revision = r.data.revision;
}
async function records(person) {
  return request('GET', `/table/${tableId}/record?fieldKeyType=id`, undefined, person.cookie);
}
async function preview(person) {
  return request(
    'GET',
    '/authorityMatrix/preview?' +
      new URLSearchParams({ baseId, tableId, email: person.id + '@example.invalid' })
  );
}
async function update(person, targetId, changes) {
  return request(
    'PATCH',
    `/table/${tableId}/record/${targetId}`,
    { fieldKeyType: 'id', record: { fields: changes } },
    person.cookie
  );
}
async function subscribe(person, targetId) {
  const socket = new (backend('ws'))(
    'ws://localhost:3001/socket/000/' + randomBytes(8).toString('hex') + '/websocket',
    { headers: { Cookie: person.cookie } }
  );
  sockets.push(socket);
  const wire = [];
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Record subscription timed out')), 15000);
    socket.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.on('message', (raw) => {
      const text = raw.toString();
      if (!text.startsWith('a')) return;
      for (const encoded of JSON.parse(text.slice(1))) {
        const msg = JSON.parse(encoded);
        wire.push(msg);
        if (msg.a === 'init')
          socket.send(
            JSON.stringify([JSON.stringify({ a: 's', c: 'rec_' + tableId, d: targetId })])
          );
        if (msg.a === 's') {
          clearTimeout(timeout);
          if (msg.error) reject(Error('Subscription refused'));
          else resolve();
        }
      }
    });
  });
  return { socket, wire };
}
async function browserCheck() {
  browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const context = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 1440, height: 1050 },
  });
  context.setDefaultTimeout(30000);
  await context.addCookies(
    adminCookie.split('; ').map((pair) => {
      const at = pair.indexOf('=');
      return { name: pair.slice(0, at), value: pair.slice(at + 1), url: origin };
    })
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin + `/base/${baseId}/authority-matrix`, {
    waitUntil: 'networkidle',
    timeout: 90000,
  });
  const region = page.getByRole('region', {
    name: `${tableId} 按角色设置范围（从上到下匹配）`,
    exact: true,
  });
  await region.waitFor();
  await region.getByRole('heading', { name: '1. 负责人角色', exact: true }).waitFor();
  await region.getByRole('heading', { name: '2. 管理角色', exact: true }).waitFor();
  check(
    (await region.innerText()).includes('负责人角色') &&
      (await region.innerText()).includes('管理角色'),
    'browser shows separate editable role scopes'
  );
  check(
    (await region
      .getByRole('combobox', { name: `${tableId}:${managerRoleId} 记录范围`, exact: true })
      .inputValue()) === 'department',
    'browser displays manager department scope'
  );
  await region.getByRole('button', { name: `${executiveRoleId} 上移`, exact: true }).click();
  await page
    .getByRole('checkbox', {
      name: '我已核对企业、角色、表、字段与记录范围，确认保存后对相应账号生效。',
      exact: true,
    })
    .check();
  await page.getByRole('button', { name: '保存并生效', exact: true }).click();
  await page.getByText('上次保存成功，已对后续请求生效。', { exact: true }).waitFor();
  const current = await request('GET', '/authorityMatrix/get?baseId=' + baseId);
  revision = current.data.revision;
  check(
    current.data.policy.restrictions[0].roleOverrides[0].roleId === executiveRoleId,
    'browser persists explicit multi-role priority'
  );
  const p = page.getByRole('region', { name: '权限预览', exact: true });
  await p.getByLabel('本地账号邮箱').fill(people[1].id + '@example.invalid');
  await p.getByRole('combobox').selectOption(tableId);
  await p.getByRole('button', { name: '检查权限', exact: true }).click();
  await p.getByText('数据范围来源: 管理角色', { exact: true }).waitFor();
  check(true, 'browser permission preview explains the selected role scope');
  await page.screenshot({
    path: '/tmp/teable-local-run/phase25-role-scopes.png',
    fullPage: true,
    animations: 'disabled',
  });
  check(errors.length === 0, 'role scope configuration has no browser JavaScript errors');
  await browser.close();
  browser = undefined;
}
(async () => {
  await db.connect();
  const salt = await backend('bcrypt').genSalt(10);
  const hash = await backend('bcrypt').hash(password, salt);
  for (const person of [{ id: adminId, name: '角色范围验收管理员' }, ...people])
    await db.query(
      'INSERT INTO users(id,name,email,password,salt,is_admin,notify_meta) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        person.id,
        person.name,
        person.id + '@example.invalid',
        hash,
        salt,
        person.id === adminId,
        '{}',
      ]
    );
  adminCookie = await login(adminId);
  for (const person of people) person.cookie = await login(person.id);
  let r = await request('POST', '/space', { name: '角色数据范围验收 ' + suffix });
  spaceId = r.data?.id;
  check(Boolean(spaceId), 'create isolated space');
  r = await request('POST', '/base', { name: '角色数据范围验收', spaceId });
  baseId = r.data?.id;
  check(Boolean(baseId), 'create isolated base');
  await db.query('UPDATE base SET v2_enabled=$1 WHERE id=$2', [mode === 'v2', baseId]);
  r = await request('POST', `/base/${baseId}/table`, {
    name: '角色范围数据表',
    fields: [
      { name: 'Name', type: 'singleLineText' },
      { name: 'Private', type: 'singleLineText' },
      { name: 'Locked', type: 'singleLineText' },
      { name: 'Creator', type: 'createdBy' },
    ],
    records: [],
  });
  tableId = r.data?.id;
  fields = Object.fromEntries(r.data.fields.map((field) => [field.name, field.id]));
  check(Boolean(tableId), 'create table with creator and protected fields');
  await db.query(
    "INSERT INTO directory_connection(id,provider,tenant_id,name,modified_time) VALUES($1,'dingtalk',$1,'角色数据范围验收企业',NOW())",
    [connectionId]
  );
  for (const [id, name] of [
    [deptId, '业务部门'],
    [otherDeptId, '其他部门'],
  ])
    await db.query(
      'INSERT INTO directory_department(id,connection_id,external_id,name,modified_time) VALUES($1,$2,$1,$3,NOW())',
      [id, connectionId, name]
    );
  for (const person of people) {
    await db.query(
      "INSERT INTO collaborator(id,resource_id,resource_type,role_name,principal_id,principal_type,created_by) VALUES($1,$2,'base','editor',$3,'user',$4)",
      [randomUUID(), baseId, person.id, adminId]
    );
    await db.query(
      'INSERT INTO directory_member(id,connection_id,external_id,user_id,name,external_role_ids,modified_time) VALUES($1,$2,$1,$3,$4,$5,NOW())',
      [
        person.memberId,
        connectionId,
        person.id,
        person.name,
        person.index === 1 ? ['manager', 'executive'] : person.index === 2 ? ['executive'] : [],
      ]
    );
    await db.query(
      'INSERT INTO directory_membership(connection_id,member_id,department_id) VALUES($1,$2,$3)',
      [connectionId, person.memberId, person.index === 2 ? otherDeptId : deptId]
    );
    r = await request(
      'POST',
      `/table/${tableId}/record`,
      {
        fieldKeyType: 'id',
        records: [
          {
            fields: {
              [fields.Name]: 'row-' + person.index,
              [fields.Private]: 'secret-' + person.index,
              [fields.Locked]: 'locked-' + person.index,
            },
          },
        ],
      },
      person.cookie
    );
    person.recordId = r.data?.records?.[0]?.id;
    check(Boolean(person.recordId), 'create actor-owned synthetic record');
    check(
      r.response.headers.get('x-teable-v2') === String(mode === 'v2'),
      'record executes selected ' + mode + ' engine'
    );
  }
  for (const [id, name, source] of [
    [managerRoleId, '负责人角色', 'manager'],
    [executiveRoleId, '管理角色', 'executive'],
  ])
    await db.query(
      'INSERT INTO directory_business_role(id,connection_id,name,name_key,rules,modified_time) VALUES($1,$2,$3,$1,$4,NOW())',
      [id, connectionId, name, JSON.stringify([{ type: 'externalRole', externalRoleId: source }])]
    );
  const initial = restriction();
  await save(initial);
  const [employee, manager, executive] = people;
  r = await records(employee);
  check(
    r.status === 200 && r.data.records.length === 1 && r.data.records[0].id === employee.recordId,
    'unmatched employee falls back to own creator scope'
  );
  check(!JSON.stringify(r.data).includes('secret-'), 'fallback hides private fields');
  check(
    (await update(employee, manager.recordId, { [fields.Name]: 'forbidden' })).status === 403,
    'employee cannot update another creator record'
  );
  check(
    (await update(employee, employee.recordId, { [fields.Private]: 'forbidden' })).status === 403,
    'employee cannot write hidden fields'
  );
  check(
    (await update(employee, employee.recordId, { [fields.Name]: 'own-allowed' })).status === 200,
    'employee can update own permitted field'
  );
  r = await records(manager);
  check(
    r.status === 200 && r.data.records.length === 2,
    'first matched manager role sees direct-department creators'
  );
  check(
    JSON.stringify(r.data).includes('secret-0'),
    'manager role replaces fallback hidden fields'
  );
  check(
    (await update(manager, employee.recordId, { [fields.Locked]: 'forbidden' })).status === 403,
    'manager role read-only field is enforced'
  );
  check(
    (await update(manager, executive.recordId, { [fields.Name]: 'forbidden' })).status === 403,
    'manager cannot write outside department despite another lower-priority role'
  );
  r = await records(executive);
  check(
    r.status === 200 && r.data.records.length === 3,
    'all-record management role sees all creators'
  );
  check(
    (await update(executive, employee.recordId, { [fields.Locked]: 'executive-allowed' }))
      .status === 200,
    'management role can edit field read-only for manager'
  );
  r = await preview(manager);
  check(
    r.data?.dataScope.appliedRole.id === managerRoleId &&
      r.data.dataScope.rowScope === 'department',
    'permission preview uses same first matched role'
  );
  const diagnostic = await request(
    'GET',
    '/authorityMatrix/memberTables?' +
      new URLSearchParams({ corpId, memberId: manager.memberId, baseId })
  );
  check(
    diagnostic.data?.tables[0].dataScope.appliedRole.id === managerRoleId,
    'employee authority diagnosis names the actual scope role'
  );
  const stream = await subscribe(manager, employee.recordId);
  check(true, 'manager subscribes to in-department employee record');
  check(
    (await update(employee, employee.recordId, { [fields.Name]: 'before-revoke-visible' }))
      .status === 200,
    'authorized record update succeeds before role revocation'
  );
  for (
    let attempt = 0;
    attempt < 40 && !JSON.stringify(stream.wire).includes('before-revoke-visible');
    attempt++
  )
    await new Promise((resolve) => setTimeout(resolve, 100));
  check(
    JSON.stringify(stream.wire).includes('before-revoke-visible'),
    'active manager receives the subscribed record update before revocation'
  );
  await db.query('UPDATE directory_member SET external_role_ids=$1 WHERE id=$2', [
    [],
    manager.memberId,
  ]);
  r = await records(manager);
  check(
    r.status === 200 && r.data.records.length === 1 && r.data.records[0].id === manager.recordId,
    'role revocation immediately restores fallback own scope'
  );
  check(
    (await update(employee, employee.recordId, { [fields.Name]: 'revoked-scope-secret' }))
      .status === 200,
    'record update succeeds after subscriber role revocation'
  );
  await new Promise((resolve) => setTimeout(resolve, 1000));
  check(
    !JSON.stringify(stream.wire).includes('revoked-scope-secret'),
    'revoked role receives no later out-of-scope record update'
  );
  stream.socket.close();
  await db.query('UPDATE directory_member SET external_role_ids=$1 WHERE id=$2', [
    ['manager', 'executive'],
    manager.memberId,
  ]);
  const swapped = {
    ...initial,
    roleOverrides: [initial.roleOverrides[1], initial.roleOverrides[0]],
  };
  await save(swapped);
  r = await records(manager);
  check(
    r.data?.records.length === 3,
    'changing explicit priority selects management scope for multi-role account'
  );
  await save(initial);
  if (process.env.TEABLE_ACCEPTANCE_BROWSER === '1') await browserCheck();
  await db.query('UPDATE directory_connection SET enabled=false WHERE id=$1', [connectionId]);
  r = await records(executive);
  check(
    r.data?.records.length === 1 && r.data.records[0].id === executive.recordId,
    'disabled enterprise cannot retain management data scope'
  );
  await db.query('UPDATE directory_connection SET enabled=true WHERE id=$1', [connectionId]);
  await db.query('UPDATE directory_member SET inactive_time=NOW() WHERE id=$1', [
    executive.memberId,
  ]);
  r = await records(executive);
  check(r.data?.records.length === 1, 'departed employee loses role scope and uses fallback');
  await db.query('UPDATE directory_member SET inactive_time=NULL WHERE id=$1', [
    executive.memberId,
  ]);
  await db.query(
    "UPDATE collaborator SET role_name='viewer' WHERE resource_id=$1 AND principal_id=$2",
    [baseId, executive.id]
  );
  check(
    (await update(executive, employee.recordId, { [fields.Name]: 'forbidden' })).status === 403,
    'all-record role scope does not create table write grants'
  );
  await db.query('DELETE FROM collaborator WHERE resource_id=$1 AND principal_id=$2', [
    baseId,
    executive.id,
  ]);
  check(
    (await records(executive)).status === 403,
    'role scope never creates missing database membership'
  );
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const socket of sockets) socket.close();
    if (browser) await browser.close();
    let cleaned = true;
    try {
      if (spaceId && (await request('DELETE', `/space/${spaceId}/permanent`)).status !== 200)
        throw Error('Space cleanup failed');
      for (const cookie of cookies) await request('POST', '/auth/signout', {}, cookie);
      await db.query('DELETE FROM directory_connection WHERE id=$1', [connectionId]);
      await db.query('DELETE FROM users WHERE id=ANY($1::text[])', [
        [adminId, ...people.map((person) => person.id)],
      ]);
    } catch {
      cleaned = false;
      process.exitCode = 1;
      console.error('Synthetic cleanup failed');
    }
    await db.end();
    console.log(
      JSON.stringify({
        passed,
        mode,
        success: !process.exitCode,
        syntheticDataCleaned: cleaned,
        realEmployeesModified: false,
      })
    );
  });
