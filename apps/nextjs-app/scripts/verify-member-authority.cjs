/** Fixed local acceptance; all synthetic users, directory and space are cleaned in finally. */
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
if (!['localhost', '127.0.0.1'].includes(dbUrl.hostname))
  throw Error('Local development DB required');
dbUrl.pathname = '/teable_dev_20261109';
const db = new (backend('pg').Client)({ connectionString: dbUrl.href });
const { chromium } = require('@playwright/test');
const origin = 'http://localhost:3000';
const suffix = randomUUID();
const corpId = 'authority-' + suffix;
const connectionId = 'authority-connection-' + suffix;
const memberId = 'authority-member-' + suffix;
const departmentId = 'authority-department-' + suffix;
const roleId = 'authority-role-' + suffix;
const adminId = 'usr' + randomBytes(8).toString('hex');
const userId = 'usr' + randomBytes(8).toString('hex');
const password = randomBytes(24).toString('hex');
const cookies = [];
let adminCookie, userCookie, browser, spaceId, baseId, deniedBaseId, tableId, hiddenId;
let passed = 0;
function check(value, label) {
  if (!value) throw Error(label);
  passed++;
  console.log('PASS ' + label);
}
async function request(method, route, body, cookie = adminCookie) {
  const response = await fetch(origin + '/api' + route, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie || '',
      'x-teable-canary': 'true',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(45000),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    /* Check HTTP status for non-JSON errors. */
  }
  return { response, data };
}
async function signin(id) {
  const { response } = await request(
    'POST',
    '/auth/signin',
    { email: id + '@example.invalid', password },
    ''
  );
  check(response.status === 200, 'synthetic account signs in');
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  cookies.push(cookie);
  return cookie;
}
async function overview(extra = {}, cookie = adminCookie) {
  return request(
    'GET',
    '/authorityMatrix/memberOverview?' + new URLSearchParams({ corpId, memberId, ...extra }),
    undefined,
    cookie
  );
}
async function details(extra = {}, cookie = adminCookie) {
  return request(
    'GET',
    '/authorityMatrix/memberTables?' + new URLSearchParams({ corpId, memberId, baseId, ...extra }),
    undefined,
    cookie
  );
}
async function savePolicy(targetBase, targetTable, revision, enabled = true) {
  const policy = {
    version: 1,
    enabled,
    rules: [
      {
        roleId,
        tableId: targetTable,
        actions: ['table|read', 'record|read', 'record|create', 'record|update'],
      },
    ],
    restrictions:
      targetBase === baseId
        ? [{ tableId, hiddenFieldIds: [hiddenId], readOnlyFieldIds: [], rowScope: 'department' }]
        : [],
  };
  const result = await request('POST', '/authorityMatrix/save', {
    baseId: targetBase,
    connectionId,
    expectedRevision: revision,
    policy,
  });
  check(result.response.status === 200, 'save isolated matrix policy');
  return policy;
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
  await page.goto(origin + '/admin/directory', { waitUntil: 'networkidle', timeout: 90000 });
  await page.getByLabel('企业连接', { exact: true }).click();
  await page.getByRole('option').filter({ hasText: corpId }).click();
  const row = page.getByRole('row').filter({ hasText: '诊断验收员工' });
  await row.getByRole('button', { name: '查看权限', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('heading', { name: '人员授权总览与诊断 · 诊断验收员工', exact: true })
    .waitFor();
  check(
    (await dialog.innerText()).includes('诊断验收部门') &&
      (await dialog.innerText()).includes('诊断验收编辑者'),
    'browser opens selected employee identity and effective business role'
  );
  await dialog.getByLabel('搜索数据库名称、空间名称或数据库 ID', { exact: true }).fill(baseId);
  await dialog.getByLabel('搜索数据库名称、空间名称或数据库 ID', { exact: true }).press('Enter');
  await dialog.getByRole('button', { name: '检查表权限', exact: true }).click();
  const tableRegion = dialog.getByRole('region', { name: '数据表权限详情', exact: true });
  await tableRegion.getByRole('heading', { name: '诊断验收数据表', exact: true }).waitFor();
  check(
    (await tableRegion.innerText()).includes('写权限包含已匹配业务角色的矩阵追加授权'),
    'browser explains matrix write source'
  );
  check(
    (await tableRegion.innerText()).includes('诊断敏感字段'),
    'browser names actual hidden fields'
  );
  check(
    (await tableRegion.innerText()).includes('同直接部门成员创建'),
    'browser explains department creator scope'
  );
  await db.query('UPDATE directory_business_role SET enabled=false WHERE id=$1', [roleId]);
  await dialog.getByRole('button', { name: '重新检查', exact: true }).click();
  await tableRegion.getByText('当前有效角色没有命中此表的启用矩阵规则', { exact: false }).waitFor();
  const update = tableRegion
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: '修改记录', exact: true }) });
  check(
    (await update.innerText()).includes('拒绝'),
    'browser refresh reflects revoked role without using administrator rights'
  );
  await db.query('UPDATE directory_business_role SET enabled=true WHERE id=$1', [roleId]);
  await dialog.getByRole('button', { name: '重新检查', exact: true }).click();
  await tableRegion.getByText('写权限包含已匹配业务角色的矩阵追加授权', { exact: false }).waitFor();
  await dialog.screenshot({
    path: '/tmp/teable-local-run/phase24-member-authority.png',
    animations: 'disabled',
  });
  check(errors.length === 0, 'employee authority dialog has no browser JavaScript errors');
  await browser.close();
  browser = undefined;
}
(async () => {
  await db.connect();
  const salt = await backend('bcrypt').genSalt(10);
  const hash = await backend('bcrypt').hash(password, salt);
  for (const [id, name, admin] of [
    [adminId, '诊断验收管理员', true],
    [userId, '诊断验收账号', false],
  ])
    await db.query(
      'INSERT INTO users(id,name,email,password,salt,is_admin,notify_meta) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [id, name, id + '@example.invalid', hash, salt, admin, '{}']
    );
  adminCookie = await signin(adminId);
  userCookie = await signin(userId);
  await db.query(
    "INSERT INTO directory_connection(id,provider,tenant_id,name,app_key,app_secret,modified_time) VALUES($1,'dingtalk',$2,'人员权限诊断验收企业','synthetic-key','synthetic-secret',NOW())",
    [connectionId, corpId]
  );
  await db.query(
    "INSERT INTO directory_department(id,connection_id,external_id,name,modified_time) VALUES($1,$2,'1','诊断验收部门',NOW())",
    [departmentId, connectionId]
  );
  await db.query(
    "INSERT INTO directory_member(id,connection_id,external_id,name,email,modified_time) VALUES($1,$2,'employee','诊断验收员工',$3,NOW())",
    [memberId, connectionId, userId + '@example.invalid']
  );
  await db.query(
    'INSERT INTO directory_membership(connection_id,member_id,department_id) VALUES($1,$2,$3)',
    [connectionId, memberId, departmentId]
  );
  await db.query(
    "INSERT INTO directory_business_role(id,connection_id,name,name_key,rules,modified_time) VALUES($1,$2,'诊断验收编辑者',$1,$3,NOW())",
    [
      roleId,
      connectionId,
      JSON.stringify([{ type: 'department', departmentId, includeDescendants: false }]),
    ]
  );
  let r = await request('POST', '/space', { name: '人员权限诊断验收 ' + suffix });
  spaceId = r.data?.id;
  check(Boolean(spaceId), 'create isolated space');
  for (const name of ['诊断验收数据库', '诊断验收未授权库']) {
    r = await request('POST', '/base', { spaceId, name });
    check(Boolean(r.data?.id), 'create isolated base');
    if (!baseId) baseId = r.data.id;
    else deniedBaseId = r.data.id;
  }
  r = await request('POST', `/base/${baseId}/table`, {
    name: '诊断验收数据表',
    fields: [
      { name: '名称', type: 'singleLineText' },
      { name: '诊断敏感字段', type: 'singleLineText' },
      { name: '创建人', type: 'createdBy' },
    ],
    records: [],
  });
  tableId = r.data?.id;
  hiddenId = r.data?.fields.find((field) => field.name === '诊断敏感字段')?.id;
  check(Boolean(tableId && hiddenId), 'create isolated table with creator and private field');
  const deniedTable = await request('POST', `/base/${deniedBaseId}/table`, {
    name: '未授权数据表',
    fields: [{ name: '名称', type: 'singleLineText' }],
    records: [],
  });
  check(Boolean(deniedTable.data?.id), 'create table in inaccessible base');
  await savePolicy(baseId, tableId, 0);
  await savePolicy(deniedBaseId, deniedTable.data.id, 0);
  check(
    (await overview({}, userCookie)).response.status === 403,
    'ordinary user cannot inspect employee overview'
  );
  check(
    (await details({}, userCookie)).response.status === 403,
    'ordinary user cannot inspect table diagnosis'
  );
  check(
    (await overview({ corpId: 'foreign-' + corpId })).response.status === 404,
    'employee cannot be selected from a different enterprise'
  );
  check(
    (await details({ corpId: 'foreign-' + corpId })).response.status === 404,
    'table inspection verifies employee enterprise'
  );
  check(
    (await overview({ take: '21' })).response.status === 400,
    'oversized base page is rejected'
  );
  check(
    (await details({ skip: '-1' })).response.status === 400,
    'invalid table pagination is rejected'
  );
  r = await overview({ search: baseId });
  check(
    r.data?.diagnostics.includes('accountUnbound') && !r.data.bases[0].hasBaseAccess,
    'unbound employee receives no substitute administrator permissions'
  );
  r = await details();
  check(
    r.data?.tables[0].actions.every((action) => !action.allowed),
    'unbound employee has no table action grants'
  );
  r = await request('POST', '/admin/organization/dingtalk/bindMember', {
    corpId,
    memberId,
    userId,
    expectedUserId: null,
  });
  check(r.response.status === 200, 'bind only the synthetic employee account');
  await db.query(
    "INSERT INTO collaborator(id,resource_id,resource_type,role_name,principal_id,principal_type,created_by) VALUES($1,$2,'base','viewer',$3,'user',$4)",
    [randomUUID(), baseId, userId, adminId]
  );
  r = await overview({ search: baseId });
  check(
    r.data?.employee.roles.some((role) => role.id === roleId) &&
      r.data.employee.account.id === userId,
    'overview resolves bound account and effective role'
  );
  check(
    r.data?.bases[0].hasBaseAccess &&
      r.data.bases[0].memberships.some(
        (item) => item.role === 'viewer' && item.resourceType === 'base'
      ),
    'overview explains actual base membership'
  );
  r = await details();
  check(
    r.data?.tables[0].actions.find((action) => action.action === 'record|update')?.allowed &&
      r.data.tables[0].diagnostics.includes('matrixWrite'),
    'table diagnosis matches actual matrix write grant'
  );
  check(
    r.data?.tables[0].dataScope.hiddenFields.includes('诊断敏感字段') &&
      r.data.tables[0].dataScope.rowScope === 'department',
    'table diagnosis includes hidden fields and department scope'
  );
  check(
    !JSON.stringify(r.data).includes('dbTableName') &&
      !JSON.stringify(r.data).includes('creatorIds'),
    'diagnosis does not return internal database names or creator ID sets'
  );
  r = await details({ baseId: deniedBaseId });
  check(
    r.data?.tables[0].diagnostics.includes('noBaseAccess') &&
      r.data.tables[0].actions.every((action) => !action.allowed),
    'matching role cannot bypass missing base membership'
  );
  r = await overview({ search: '人员权限诊断验收 ' + suffix, take: '1' });
  check(
    r.data?.total === 2 && r.data.bases.length === 1,
    'base pagination is bounded and space search is scoped'
  );
  check(
    (await details({ search: 'absent-table' })).data?.total === 0,
    'table search returns only matching active tables'
  );
  await browserCheck();
  await db.query(
    "UPDATE collaborator SET role_name='editor' WHERE resource_id=$1 AND principal_id=$2",
    [baseId, userId]
  );
  r = await details();
  check(
    r.data?.tables[0].diagnostics.includes('collaboratorWrite'),
    'existing editor grant is explained separately from matrix'
  );
  await db.query('UPDATE directory_member SET inactive_time=NOW() WHERE id=$1', [memberId]);
  r = await details();
  check(
    r.data?.tables[0].diagnostics.includes('employeeInactive') &&
      r.data.tables[0].diagnostics.includes('emptyDepartmentScope'),
    'departure removes role and yields an empty department creator scope'
  );
  check(
    r.data?.tables[0].actions.find((action) => action.action === 'record|update').allowed &&
      r.data.tables[0].diagnostics.includes('collaboratorWrite'),
    'departure does not falsely report removal of independent local writes'
  );
  await db.query('UPDATE directory_member SET inactive_time=NULL WHERE id=$1', [memberId]);
  await db.query('UPDATE directory_connection SET enabled=false WHERE id=$1', [connectionId]);
  r = await overview({ search: baseId });
  check(
    r.data?.diagnostics.includes('connectionDisabled') &&
      r.data.employee.roles.length === 0 &&
      r.data.bases[0].hasBaseAccess,
    'disabled enterprise is distinct from surviving local membership'
  );
  await db.query('UPDATE directory_connection SET enabled=true WHERE id=$1', [connectionId]);
  await savePolicy(baseId, tableId, 1, false);
  r = await details();
  check(
    r.data?.tables[0].diagnostics.includes('policyDisabled') && r.data.tables[0].dataScope === null,
    'disabled policy diagnosis includes absence of its data restrictions'
  );
  await db.query('UPDATE table_authority_policy SET policy=$1 WHERE base_id=$2', [
    JSON.stringify({ invalid: true }),
    baseId,
  ]);
  r = await overview({ search: baseId });
  check(
    r.data?.bases[0].diagnostics.includes('policyInvalid'),
    'invalid saved policy is explained explicitly'
  );
  await db.query('UPDATE users SET deactivated_time=NOW() WHERE id=$1', [userId]);
  r = await details();
  check(
    r.data?.tables[0].diagnostics.includes('accountInactive') &&
      r.data.tables[0].actions.every((action) => !action.allowed),
    'disabled local account is never evaluated as an active login'
  );
  await db.query('UPDATE users SET deactivated_time=NULL WHERE id=$1', [userId]);
  await db.query('UPDATE base SET deleted_time=NOW() WHERE id=$1', [deniedBaseId]);
  check(
    (await overview({ search: deniedBaseId })).data?.total === 0,
    'deleted base is excluded from overview'
  );
  check(
    (await details({ baseId: deniedBaseId })).response.status === 404,
    'deleted base cannot be inspected as active'
  );
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    let cleaned = true;
    try {
      if (spaceId) {
        if (deniedBaseId)
          await db.query('UPDATE base SET deleted_time=NULL WHERE id=$1', [deniedBaseId]);
        const r = await request('DELETE', `/space/${spaceId}/permanent`);
        if (r.response.status !== 200) throw Error('Synthetic space cleanup failed');
      }
      for (const cookie of cookies) await request('POST', '/auth/signout', {}, cookie);
      await db.query('DELETE FROM directory_connection WHERE id=$1', [connectionId]);
      await db.query('DELETE FROM users WHERE id=ANY($1::text[])', [[adminId, userId]]);
    } catch {
      cleaned = false;
      process.exitCode = 1;
      console.error('Synthetic cleanup failed');
    }
    await db.end();
    console.log(
      JSON.stringify({
        passed,
        success: !process.exitCode,
        syntheticDataCleaned: cleaned,
        realEmployeesModified: false,
      })
    );
  });
