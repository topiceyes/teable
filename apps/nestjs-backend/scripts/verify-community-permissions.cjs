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
const connectionId = 'acceptance-' + suffix;
const departmentId = 'department-' + suffix;
const roleId = 'role-' + suffix;
const memberId = 'member-' + suffix;
const fixturePassword = randomBytes(24).toString('hex');
const cookies = [];
const sockets = [];
let adminCookie, userCookie, spaceId, baseId;
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
async function setRole(enabled) {
  await db.query('UPDATE directory_business_role SET enabled=$1 WHERE id=$2', [enabled, roleId]);
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
async function verifyBrowser(tableId, viewId, actorCookie) {
  const appRequire = createRequire(path.resolve(__dirname, '../../nextjs-app/package.json'));
  const { chromium } = appRequire('@playwright/test');
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  try {
    const context = await browser.newContext({
      locale: 'zh-CN',
      viewport: { width: 1440, height: 1050 },
    });
    const addCookies = (cookie) =>
      context.addCookies(
        cookie.split('; ').map((pair) => {
          const i = pair.indexOf('=');
          return {
            name: pair.slice(0, i),
            value: pair.slice(i + 1),
            url: origin,
          };
        })
      );
    await addCookies(adminCookie);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin + '/admin/directory', {
      waitUntil: 'networkidle',
      timeout: 90000,
    });
    await page.getByRole('heading', { name: '钉钉组织目录', exact: true }).waitFor();
    await page.getByRole('button', { name: '配置钉钉企业', exact: true }).click();
    const editor = page.getByRole('dialog');
    await editor.waitFor();
    check(
      await editor.getByLabel('企业名称').isVisible(),
      'browser opens DingTalk connection configuration'
    );
    await editor.getByRole('button', { name: '取消', exact: true }).click();
    await page
      .getByRole('group', { name: '目录管理' })
      .getByRole('button', { name: '部门', exact: true })
      .click();
    await page.getByRole('heading', { name: '部门', exact: true }).waitFor();
    check(
      await page.getByRole('navigation', { name: '部门路径' }).isVisible(),
      'browser opens organization department navigation'
    );
    await page.goto(origin + `/base/${baseId}/authority-matrix`, {
      waitUntil: 'networkidle',
      timeout: 60000,
    });
    await page.getByRole('region', { name: '权限预览' }).waitFor();
    check(
      await page.getByRole('heading', { name: '字段与记录限制' }).isVisible(),
      'browser matrix shows independent data restriction editor'
    );
    const region = page.getByRole('region', { name: '权限预览' });
    await region.getByLabel('本地账号邮箱').fill(userId + '@example.invalid');
    await region.getByRole('combobox').selectOption(tableId);
    await region.getByRole('button', { name: '检查权限' }).click();
    await region.getByRole('status').waitFor();
    check(
      (await region.getByRole('status').innerText()).includes('仅本人创建'),
      'browser permission preview displays actual record restriction'
    );
    await page.screenshot({
      path:
        process.env.TEABLE_ACCEPTANCE_SCREENSHOT ||
        '/tmp/teable-local-run/authority-matrix-browser.png',
      fullPage: true,
      animations: 'disabled',
    });
    await context.clearCookies();
    await addCookies(actorCookie);
    const payloads = [];
    const sentQueries = [];
    const queryReplies = [];
    const decodeFrames = (raw) => {
      const text = String(raw);
      if (!text.startsWith('[') && !text.startsWith('a[')) return [];
      return JSON.parse(text.startsWith('a') ? text.slice(1) : text).map((item) =>
        JSON.parse(item)
      );
    };
    page.on('websocket', (socket) => {
      socket.on('framesent', (frame) => sentQueries.push(...decodeFrames(frame.payload)));
      socket.on('framereceived', (frame) => {
        payloads.push(String(frame.payload));
        queryReplies.push(...decodeFrames(frame.payload));
      });
    });
    const response = await page.goto(origin + `/base/${baseId}/table/${tableId}/${viewId}`, {
      waitUntil: 'networkidle',
      timeout: 60000,
    });
    check(response.status() === 200, 'restricted user opens a table in the browser');
    check(
      !payloads.join('').includes('private-admin-value'),
      'browser realtime frames do not disclose another creator sensitive data'
    );
    for (let attempt = 0; attempt < 40 && !payloads.join('').includes('my-row'); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    check(
      payloads.join('').includes('my-row'),
      'restricted browser receives its own record snapshot'
    );
    const personal = page.locator('#personal-view-switch');
    await personal.waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector('#personal-view-switch')?.getAttribute('data-state') === 'checked'
    );
    check(await personal.isDisabled(), 'restricted browser keeps personal view enabled');
    const waitQuery = async (key, action) => {
      const offset = sentQueries.length;
      await action();
      for (let attempt = 0; attempt < 200; attempt++) {
        const request = sentQueries
          .slice(offset)
          .find(
            (message) =>
              message.a === 'qs' && message.c === 'rec_' + tableId && message.q?.[key]?.length
          );
        const response =
          request &&
          queryReplies.find((message) => message.a === 'qs' && message.id === request.id);
        if (response) {
          if (response.error)
            throw new Error('Browser query failed: ' + JSON.stringify(response.error));
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('Browser query did not complete: ' + key);
    };
    await page.getByRole('button', { name: '排序', exact: true }).click();
    const sorted = await waitQuery('orderBy', () =>
      page.getByRole('option', { name: 'Name', exact: true }).click()
    );
    check(sorted, 'browser personal sorting fetches authorized rows');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '分组', exact: true }).click();
    const grouped = await waitQuery('groupBy', () =>
      page.getByRole('option', { name: 'Name', exact: true }).click()
    );
    check(grouped, 'browser personal grouping fetches authorized rows');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+f');
    const search = page.getByPlaceholder('搜索', { exact: true });
    await search.waitFor();
    const searched = await waitQuery('search', () => search.fill('my-row'));
    check(searched, 'browser search works with personal sorting and grouping');
    if (errors.length)
      console.log(
        JSON.stringify({
          browserErrors: errors.map((error) => error.slice(0, 1200)),
        })
      );
    await page.screenshot({
      path: '/tmp/teable-local-run/restricted-table-browser.png',
      animations: 'disabled',
    });
    check(errors.length === 0, 'browser matrix and restricted table have no JavaScript errors');
    check(
      (await page.getByText('Runtime Error', { exact: true }).count()) === 0,
      'restricted table has no development runtime error overlay'
    );
  } finally {
    await browser.close();
  }
}
async function main() {
  await db.connect();
  adminCookie = await login(adminEmail, adminPassword);
  const salt = await r('bcrypt').genSalt(10);
  const hash = await r('bcrypt').hash(fixturePassword, salt);
  for (const [id, name] of [
    [userId, 'Acceptance actor'],
    [otherId, 'Acceptance other'],
  ]) {
    await db.query(
      'INSERT INTO users(id,name,email,password,salt,is_admin,last_modified_time) VALUES($1,$2,$3,$4,$5,false,NOW())',
      [id, name, id + '@example.invalid', hash, salt]
    );
  }
  userCookie = await login(userId + '@example.invalid', fixturePassword);
  let connections = await http('GET', '/admin/organization/dingtalk/connections');
  check(
    connections.status === 200 &&
      Array.isArray(connections.data) &&
      connections.data.every((item) => !Object.hasOwn(item, 'appSecret')),
    'administrator connection list never returns appSecret'
  );
  for (const [method, route] of [
    ['GET', '/admin/organization/dingtalk/connections'],
    ['POST', '/admin/organization/dingtalk/saveConnection'],
    ['POST', '/admin/organization/dingtalk/testConnection'],
  ])
    check(
      (await http(method, route, method === 'POST' ? {} : undefined, userCookie)).status === 403,
      'ordinary account cannot access DingTalk administration: ' + route
    );
  let result = await http('POST', '/space', {
    name: 'Permission acceptance ' + suffix,
  });
  spaceId = result.data?.id;
  check(Boolean(spaceId), 'create isolated acceptance space');
  result = await http('POST', '/base', {
    name: 'Permission acceptance',
    spaceId,
  });
  baseId = result.data?.id;
  check(Boolean(baseId), 'create isolated acceptance base');
  await db.query('UPDATE base SET v2_enabled=$1 WHERE id=$2', [mode === 'v2', baseId]);
  await db.query(
    'INSERT INTO collaborator(id,resource_id,resource_type,role_name,principal_id,principal_type,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [randomUUID(), baseId, 'base', 'viewer', userId, 'user', userId]
  );
  await db.query(
    "INSERT INTO directory_connection(id,provider,tenant_id,name,modified_time) VALUES($1,'dingtalk',$1,'Acceptance only',NOW())",
    [connectionId]
  );
  await db.query(
    "INSERT INTO directory_department(id,connection_id,external_id,name,modified_time) VALUES($1,$2,'1','Acceptance department',NOW())",
    [departmentId, connectionId]
  );
  await db.query(
    "INSERT INTO directory_member(id,connection_id,external_id,user_id,name,modified_time) VALUES($1,$2,$1,$3,'Acceptance actor',NOW())",
    [memberId, connectionId, userId]
  );
  await db.query(
    'INSERT INTO directory_membership(connection_id,member_id,department_id) VALUES($1,$2,$3)',
    [connectionId, memberId, departmentId]
  );
  await db.query(
    "INSERT INTO directory_business_role(id,connection_id,name,name_key,rules,modified_time) VALUES($1,$2,'Acceptance writer','acceptance writer',$3,NOW())",
    [
      roleId,
      connectionId,
      JSON.stringify([{ type: 'department', departmentId, includeDescendants: true }]),
    ]
  );
  result = await http('POST', `/base/${baseId}/table`, {
    name: 'Acceptance records',
    fields: [
      { name: 'Name', type: 'singleLineText' },
      { name: 'Sensitive', type: 'singleLineText' },
      { name: 'Locked', type: 'singleLineText' },
      { name: 'Creator', type: 'createdBy' },
    ],
    records: [],
  });
  const table = result.data;
  check(Boolean(table?.id), 'create acceptance table');
  const tableId = table.id;
  const field = table.fields.find((f) => f.name === 'Name').id;
  const recordPath = `/table/${tableId}/record`;
  check(
    (
      await http(
        'POST',
        recordPath,
        { fieldKeyType: 'id', records: [{ fields: { [field]: 'denied' } }] },
        userCookie
      )
    ).status === 403,
    'viewer cannot create without matrix'
  );
  const policy = {
    version: 1,
    enabled: true,
    rules: [
      {
        roleId,
        tableId,
        actions: ['table|read', 'record|read', 'record|create', 'record|update', 'record|delete'],
      },
    ],
  };
  result = await http('POST', '/authorityMatrix/save', {
    baseId,
    connectionId,
    expectedRevision: 0,
    policy,
  });
  check(result.status === 200, 'save matrix through administrator API');
  result = await http(
    'POST',
    recordPath,
    { fieldKeyType: 'id', records: [{ fields: { [field]: 'created' } }] },
    userCookie
  );
  check(
    result.response.headers.get('x-teable-v2') === String(mode === 'v2'),
    'record write executes requested ' + mode + ' engine'
  );
  const recordId = result.data?.records?.[0]?.id;
  check(Boolean(recordId), 'matrix writer can create record through HTTP');
  check(
    (
      await http(
        'PATCH',
        recordPath + '/' + recordId,
        { fieldKeyType: 'id', record: { fields: { [field]: 'updated' } } },
        userCookie
      )
    ).status === 200,
    'matrix writer can update record'
  );
  result = await http(
    'PATCH',
    `/table/${tableId}/selection/paste`,
    {
      viewId: table.views[0].id,
      ranges: [
        [0, 0],
        [0, 0],
      ],
      content: 'pasted-one\npasted-two',
      projection: [field],
    },
    userCookie
  );
  check(result.status === 200, 'matrix writer can paste and extend rows');
  check(
    (
      await http(
        'POST',
        `/table/${tableId}/field`,
        { name: 'Not allowed', type: 'singleLineText' },
        userCookie
      )
    ).status === 403,
    'record grants do not grant field structure permissions'
  );
  result = await http('POST', `/base/${baseId}/table`, {
    name: 'Acceptance link target',
    fields: [{ name: 'Name', type: 'singleLineText' }],
    records: [],
  });
  const target = result.data;
  check(Boolean(target?.id), 'create separate link target table');
  result = await http('POST', `/table/${tableId}/field`, {
    name: 'Relation',
    type: 'link',
    options: {
      relationship: 'manyMany',
      foreignTableId: target.id,
      isOneWay: true,
    },
  });
  const linkId = result.data?.id;
  check(Boolean(linkId), 'create source link field');
  check(
    (
      await http(
        'POST',
        `/table/${target.id}/record`,
        { records: [{ fields: { Name: 'unauthorized-target' } }] },
        userCookie
      )
    ).status === 403,
    'source table grant does not grant target table creation'
  );
  result = await http(
    'PATCH',
    recordPath + '/' + recordId,
    {
      fieldKeyType: 'id',
      typecast: true,
      record: { fields: { [linkId]: 'unauthorized-title-created-target' } },
    },
    userCookie
  );
  const linkWriteStatus = result.status;
  result = await http('GET', `/table/${target.id}/record`);
  check(
    result.status === 200 && result.data.records.length === 0,
    'cross-table title write has no unauthorized target insert (HTTP ' + linkWriteStatus + ')'
  );
  await setRole(false);
  check(
    (
      await http(
        'PATCH',
        recordPath + '/' + recordId,
        { fieldKeyType: 'id', record: { fields: { [field]: 'forbidden' } } },
        userCookie
      )
    ).status === 403,
    'role revocation denies next write'
  );
  await setRole(true);
  await db.query('UPDATE directory_member SET inactive_time=NOW() WHERE id=$1', [memberId]);
  check(
    (await http('DELETE', recordPath + '/' + recordId, undefined, userCookie)).status === 403,
    'inactive employee loses derived delete permission'
  );
  await db.query('UPDATE directory_member SET inactive_time=NULL,user_id=NULL WHERE id=$1', [
    memberId,
  ]);
  check(
    (
      await http(
        'POST',
        recordPath,
        { fieldKeyType: 'id', records: [{ fields: { [field]: 'denied' } }] },
        userCookie
      )
    ).status === 403,
    'unbound employee loses derived create permission'
  );
  await db.query('UPDATE directory_member SET user_id=$1 WHERE id=$2', [userId, memberId]);
  const live = await subscribeRecord(tableId, recordId, userCookie);
  check(live.socket.readyState === 1, 'real WebSocket subscribes to an authorized record');
  const closed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Revoked socket remained open')), 15000);
    live.socket.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  await db.query('DELETE FROM collaborator WHERE resource_id=$1 AND principal_id=$2', [
    baseId,
    userId,
  ]);
  await http('PATCH', recordPath + '/' + recordId, {
    fieldKeyType: 'id',
    record: { fields: { [field]: 'private-after-base-revoke' } },
  });
  await closed;
  check(
    !JSON.stringify(live.wire).includes('private-after-base-revoke'),
    'revoked live socket closes before receiving another record operation'
  );
  check(
    (await http('GET', recordPath, undefined, userCookie)).status === 403,
    'matrix cannot create base membership'
  );
  await db.query(
    'INSERT INTO collaborator(id,resource_id,resource_type,role_name,principal_id,principal_type,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [randomUUID(), baseId, 'base', 'editor', userId, 'user', userId]
  );
  await setRole(false);
  check(
    (
      await http(
        'PATCH',
        recordPath + '/' + recordId,
        { fieldKeyType: 'id', record: { fields: { [field]: 'manual-grant' } } },
        userCookie
      )
    ).status === 200,
    'revoking derived role preserves manual editor permission'
  );
  check(
    (await http('DELETE', recordPath + '/' + recordId, undefined, userCookie)).status === 200,
    'manual editor can delete record'
  );
  result = await http(
    'GET',
    '/authorityMatrix/preview?' +
      new URLSearchParams({
        baseId,
        tableId,
        email: userId + '@example.invalid',
      })
  );
  check(
    result.status === 200 &&
      result.data.hasBaseAccess &&
      result.data.actions
        .find((action) => action.action === 'record|update')
        ?.sources.includes('collaborator'),
    'administrator preview explains effective collaborator grant'
  );
  check(
    (
      await http(
        'GET',
        '/authorityMatrix/preview?' +
          new URLSearchParams({
            baseId,
            tableId,
            email: userId + '@example.invalid',
          }),
        undefined,
        userCookie
      )
    ).status === 403,
    'ordinary user cannot impersonate another account in permission preview'
  );
  const sensitive = table.fields.find((f) => f.name === 'Sensitive').id;
  const locked = table.fields.find((f) => f.name === 'Locked').id;
  result = await http('POST', recordPath, {
    fieldKeyType: 'id',
    records: [
      {
        fields: {
          [field]: 'admin-created',
          [sensitive]: 'private-admin-value',
        },
      },
    ],
  });
  const adminRecord = result.data?.records?.[0]?.id;
  check(Boolean(adminRecord), 'create another owner record for scope isolation');
  const restriction = {
    tableId,
    hiddenFieldIds: [sensitive],
    readOnlyFieldIds: [locked],
    rowScope: 'own',
  };
  await setRole(true);
  result = await http('POST', '/authorityMatrix/save', {
    baseId,
    connectionId,
    expectedRevision: 1,
    policy: { ...policy, restrictions: [restriction] },
  });
  check(result.status === 200, 'save field and own-record restrictions');
  result = await http(
    'POST',
    recordPath,
    { fieldKeyType: 'id', records: [{ fields: { [field]: 'my-row' } }] },
    userCookie
  );
  const ownRecord = result.data?.records?.[0]?.id;
  check(Boolean(ownRecord), 'restricted editor can create a row without protected fields');
  result = await http(
    'GET',
    recordPath + '?fieldKeyType=id&ignoreViewQuery=true',
    undefined,
    userCookie
  );
  check(
    result.status === 200 &&
      result.data.records.some((record) => record.id === ownRecord) &&
      result.data.records.every((record) => record.id !== adminRecord),
    'own-row filter applies even when caller ignores view query'
  );
  const permittedRowCount = result.data.records.length;
  check(
    !JSON.stringify(result.data).includes(sensitive) &&
      !JSON.stringify(result.data).includes('private-admin-value'),
    'hidden cells omitted from list response'
  );
  result = await http('GET', `/table/${tableId}/aggregation/row-count`, undefined, userCookie);
  check(
    result.status === 200 && result.data.rowCount === permittedRowCount,
    'row count uses the same authorized row scope'
  );
  check(
    (await http('GET', recordPath + '/' + adminRecord, undefined, userCookie)).status === 403,
    'direct id lookup cannot read another creator record'
  );
  check(
    (
      await http(
        'PATCH',
        recordPath + '/' + adminRecord,
        { fieldKeyType: 'id', record: { fields: { [field]: 'not-allowed' } } },
        userCookie
      )
    ).status === 403,
    'direct id update cannot change another creator record'
  );
  check(
    (
      await http(
        'PATCH',
        recordPath + '/' + ownRecord,
        { fieldKeyType: 'id', record: { fields: { [locked]: 'not-allowed' } } },
        userCookie
      )
    ).status === 403,
    'read-only field cannot be written by id'
  );
  check(
    (
      await http(
        'PATCH',
        recordPath + '/' + ownRecord,
        {
          fieldKeyType: 'name',
          record: { fields: { Sensitive: 'not-allowed' } },
        },
        userCookie
      )
    ).status === 403,
    'hidden field cannot be written by name'
  );
  check(
    (await http('GET', `/table/${tableId}/field/${sensitive}`, undefined, userCookie)).status ===
      403,
    'hidden field metadata cannot be read directly'
  );
  result = await http('GET', `/table/${tableId}/field`, undefined, userCookie);
  check(
    result.status === 200 && !JSON.stringify(result.data).includes(sensitive),
    'hidden field omitted from field list'
  );
  check(
    (
      await http(
        'GET',
        recordPath +
          '?filter=' +
          encodeURIComponent(
            JSON.stringify({
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: sensitive,
                  operator: 'is',
                  value: 'private-admin-value',
                },
              ],
            })
          ),
        undefined,
        userCookie
      )
    ).status === 403,
    'hidden-field predicate cannot be used as a side channel'
  );
  check(
    (await http('POST', recordPath + '/socket/snapshot-bulk', { ids: [adminRecord] }, userCookie))
      .status === 403,
    'socket snapshot recovery cannot bypass row scope'
  );
  check(
    (
      await http(
        'PATCH',
        `/table/${tableId}/selection/paste`,
        { viewId: table.views[0].id, ranges: [[0, 0]], content: 'bypass' },
        userCookie
      )
    ).status === 403,
    'unsupported positional write fails closed on restricted tables'
  );
  check(
    (
      await http(
        'DELETE',
        recordPath +
          '?' +
          new URLSearchParams([
            ['recordIds[]', ownRecord],
            ['recordIds[]', adminRecord],
          ]),
        undefined,
        userCookie
      )
    ).status === 403,
    'mixed-owner bulk delete rejected atomically'
  );
  check(
    (await http('GET', recordPath + '/' + ownRecord, undefined, userCookie)).status === 200,
    'denied bulk delete leaves the permitted record untouched'
  );
  check(
    (await http('DELETE', recordPath + '/' + adminRecord, undefined, userCookie)).status === 403,
    'direct id delete cannot remove another creator record'
  );
  check(
    (
      await http(
        'PATCH',
        recordPath,
        {
          fieldKeyType: 'id',
          records: [
            { id: ownRecord, fields: { [field]: 'batch-must-not-write' } },
            { id: adminRecord, fields: { [field]: 'batch-must-not-write' } },
          ],
        },
        userCookie
      )
    ).status === 403,
    'mixed-owner batch update rejected before any write'
  );
  result = await http(
    'GET',
    recordPath + '/' + ownRecord + '?fieldKeyType=id',
    undefined,
    userCookie
  );
  check(result.data?.fields?.[field] === 'my-row', 'denied batch update leaves own row unchanged');
  check(
    (
      await http(
        'POST',
        recordPath + '/socket/snapshot-bulk',
        { ids: [ownRecord, adminRecord] },
        userCookie
      )
    ).status === 403,
    'mixed-owner bulk snapshots reject the complete request'
  );
  check(
    (
      await http(
        'PATCH',
        recordPath + '/' + ownRecord,
        { fieldKeyType: 'name', record: { fields: { Locked: 'forbidden' } } },
        userCookie
      )
    ).status === 403,
    'read-only fields reject writes by name'
  );
  for (const query of [
    { orderBy: JSON.stringify([{ fieldId: sensitive, order: 'asc' }]) },
    { groupBy: JSON.stringify([{ fieldId: sensitive, order: 'asc' }]) },
    { 'search[]': ['private-admin-value', sensitive] },
  ]) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
    check(
      (await http('GET', recordPath + '?' + params, undefined, userCookie)).status === 403,
      'query side channel denied: ' + Object.keys(query)[0]
    );
  }
  // Query behavior must work on more than one row, and hidden cells in an authorized
  // row must not affect all-field search counts or group membership.
  result = await http('PATCH', recordPath + '/' + ownRecord, {
    fieldKeyType: 'id',
    record: { fields: { [sensitive]: 'private-own-value' } },
  });
  check(result.status === 200, 'administrator sets a hidden value on an authorized test row');
  result = await http(
    'POST',
    recordPath,
    {
      fieldKeyType: 'id',
      records: [{ fields: { [field]: 'aaa-row' } }],
    },
    userCookie
  );
  const sortedRecord = result.data?.records?.[0]?.id;
  check(Boolean(sortedRecord), 'create a second permitted row for query verification');
  const queryRead = (suffix, searchValue, extra = {}) => {
    const params = new URLSearchParams(extra);
    if (searchValue !== undefined) {
      params.append('search[]', searchValue);
      params.append('search[]', '');
      params.append('search[]', suffix === 'search-matches' ? 'false' : 'true');
    }
    const route = suffix === 'record' ? recordPath : `/table/${tableId}/aggregation/${suffix}`;
    return http('GET', route + '?' + params, undefined, userCookie);
  };
  result = await queryRead('record', undefined, {
    fieldKeyType: 'id',
    orderBy: JSON.stringify([{ fieldId: field, order: 'asc' }]),
  });
  check(
    result.status === 200 &&
      result.data.records.length === permittedRowCount + 1 &&
      result.data.records[0].id === sortedRecord &&
      result.data.records[1].id === ownRecord &&
      result.data.records.every((row) => row.id !== adminRecord),
    'visible ascending sort works within own rows'
  );
  result = await queryRead('record', undefined, {
    fieldKeyType: 'id',
    orderBy: JSON.stringify([{ fieldId: field, order: 'desc' }]),
  });
  check(
    result.status === 200 &&
      result.data.records.at(-1).id === sortedRecord &&
      result.data.records.every(
        (row, index, rows) =>
          !index || rows[index - 1].fields[field].localeCompare(row.fields[field]) >= 0
      ),
    'visible descending sort reverses the authorized row order'
  );
  result = await queryRead('group-points', undefined, {
    groupBy: JSON.stringify([{ fieldId: field, order: 'asc' }]),
  });
  check(
    result.status === 200 &&
      result.data
        .filter((point) => point.type === 1)
        .reduce((sum, point) => sum + point.count, 0) ===
        permittedRowCount + 1 &&
      !JSON.stringify(result.data).includes('admin-created'),
    'visible grouping counts only authorized rows'
  );
  result = await queryRead('record-index', undefined, {
    recordId: ownRecord,
    orderBy: JSON.stringify([{ fieldId: field, order: 'asc' }]),
  });
  check(result.status === 200 && result.data?.index === 1, 'record index follows visible sorting');
  result = await queryRead('record-index', undefined, {
    recordId: adminRecord,
  });
  check(result.status === 403, 'record index rejects a foreign creator id');
  for (const term of ['my-row', 'private-own-value', 'private-admin-value']) {
    const expected = term === 'my-row' ? 1 : 0;
    result = await queryRead('record', term);
    check(
      result.status === 200 && result.data.records.length === expected,
      'all-field record search respects hidden cells and rows: ' + term
    );
    result = await queryRead('row-count', term);
    check(
      result.status === 200 && result.data.rowCount === expected,
      'searched row count stays in scope: ' + term
    );
    result = await queryRead('search-count', term);
    check(
      result.status === 200 && result.data.count === expected,
      'search count stays in scope without a projection contract: ' + term
    );
    result = await queryRead('search-cell-count', term);
    check(
      result.status === 200 && result.data.matchedCellCount === expected,
      'matching cell count stays in scope: ' + term
    );
    result = await queryRead('search-index', term, { take: '100', skip: '0' });
    check(
      result.status === 200 &&
        (result.data?.length || 0) === expected &&
        (!expected || (result.data[0].recordId === ownRecord && result.data[0].fieldId === field)),
      'search indexes contain only visible authorized cells: ' + term
    );
    result = await queryRead('search-matches', term, {
      take: '100',
      skip: '0',
    });
    check(
      result.status === 200 &&
        result.data.matches.length === expected &&
        result.data.matches.every(
          (match) => match.recordId === ownRecord && match.fieldId === field
        ),
      'search match scan contains only visible authorized cells: ' + term
    );
    result = await queryRead('group-points', term, {
      groupBy: JSON.stringify([{ fieldId: field, order: 'asc' }]),
    });
    check(
      result.status === 200 &&
        (result.data || [])
          .filter((point) => point.type === 1)
          .reduce((sum, point) => sum + point.count, 0) === expected,
      'grouping with search keeps the same field and row scope: ' + term
    );
  }
  check(
    (await http('DELETE', recordPath + '/' + sortedRecord, undefined, userCookie)).status === 200,
    'remove the extra query fixture before the remaining regressions'
  );
  const spaceCollaboratorId = randomUUID();
  await db.query(
    'INSERT INTO collaborator(id,resource_id,resource_type,role_name,principal_id,principal_type,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [spaceCollaboratorId, spaceId, 'space', 'owner', userId, 'user', userId]
  );
  try {
    for (const route of ['/base/duplicate', '/base/duplicate-stream'])
      check(
        (await http('POST', route, { fromBaseId: baseId, spaceId, withRecords: true }, userCookie))
          .status === 403,
        'restricted source cannot be copied via ' + route
      );
  } finally {
    await db.query('DELETE FROM collaborator WHERE id=$1', [spaceCollaboratorId]);
  }
  check(
    (await http('GET', `/export/${tableId}`, undefined, userCookie)).status === 403,
    'restricted table cannot be exported'
  );
  if (process.env.TEABLE_ACCEPTANCE_BROWSER === '1')
    await verifyBrowser(tableId, table.views[0].id, userCookie);
  // Department mode: only active, explicitly bound peers in direct departments join the scope.
  const otherCookie = await login(otherId + '@example.invalid', fixturePassword);
  await db.query(
    'INSERT INTO collaborator(id,resource_id,resource_type,role_name,principal_id,principal_type,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [randomUUID(), baseId, 'base', 'editor', otherId, 'user', userId]
  );
  const peerMember = 'peer-' + suffix;
  await db.query(
    "INSERT INTO directory_member(id,connection_id,external_id,user_id,name,modified_time) VALUES($1,$2,$1,$3,'Acceptance peer',NOW())",
    [peerMember, connectionId, otherId]
  );
  await db.query(
    'INSERT INTO directory_membership(connection_id,member_id,department_id) VALUES($1,$2,$3)',
    [connectionId, peerMember, departmentId]
  );
  result = await http(
    'POST',
    recordPath,
    { fieldKeyType: 'id', records: [{ fields: { [field]: 'peer-row' } }] },
    otherCookie
  );
  const peerRecord = result.data?.records?.[0]?.id;
  check(Boolean(peerRecord), 'create department peer record under own scope');
  result = await http('POST', '/authorityMatrix/save', {
    baseId,
    connectionId,
    expectedRevision: 2,
    policy: {
      ...policy,
      restrictions: [{ ...restriction, rowScope: 'department' }],
    },
  });
  check(result.status === 200, 'save direct-department row restriction');
  result = await http('GET', recordPath + '?fieldKeyType=id', undefined, userCookie);
  check(
    result.status === 200 &&
      result.data.records.some((record) => record.id === peerRecord) &&
      result.data.records.every((record) => record.id !== adminRecord),
    'department scope includes active bound peers but excludes outsiders'
  );
  await db.query('UPDATE directory_member SET inactive_time=NOW() WHERE id=$1', [peerMember]);
  result = await http('GET', recordPath + '?fieldKeyType=id', undefined, userCookie);
  check(
    result.status === 200 && result.data.records.every((record) => record.id !== peerRecord),
    'departed peer creator loses department visibility immediately'
  );
  await db.query('UPDATE directory_member SET user_id=NULL WHERE id=$1', [memberId]);
  result = await http('GET', recordPath + '?fieldKeyType=id', undefined, userCookie);
  check(
    result.status === 200 && result.data.records.length === 0,
    'unbound caller receives no department rows'
  );
  result = await http(
    'GET',
    '/authorityMatrix/preview?' +
      new URLSearchParams({
        baseId,
        tableId,
        email: userId + '@example.invalid',
      })
  );
  check(
    result.status === 200 &&
      result.data.dataScope?.rowScope === 'department' &&
      result.data.dataScope.hiddenFields.includes('Sensitive'),
    'permission preview explains field and row restrictions'
  );
}
function cleanupFailure() {
  console.error('Acceptance fixture cleanup did not complete');
  process.exitCode = 1;
}
main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const socket of sockets) socket.close();
    for (const cookie of cookies)
      await http('POST', '/auth/signout', {}, cookie).catch(cleanupFailure);
    if (spaceId) {
      // Logout above invalidates administrator session; use a fresh one only for cleanup.
      try {
        adminCookie = await login(adminEmail, adminPassword);
        const result = await http('DELETE', `/space/${spaceId}/permanent`);
        if (result.status !== 200) throw new Error('Fixture space cleanup failed');
        await http('POST', '/auth/signout', {});
      } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
      }
    }
    await db
      .query('DELETE FROM directory_connection WHERE id=$1', [connectionId])
      .catch(cleanupFailure);
    await db
      .query('DELETE FROM users WHERE id=ANY($1::text[])', [[userId, otherId]])
      .catch(cleanupFailure);
    await db.end();
    console.log(
      JSON.stringify({
        passed,
        database,
        mode,
        success: !process.exitCode,
        realEmployeesModified: false,
      })
    );
  });
