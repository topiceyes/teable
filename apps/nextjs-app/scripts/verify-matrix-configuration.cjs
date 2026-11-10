/** Local configuration acceptance. Uses only synthetic accounts, enterprise and base; cleans in finally. */
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
const corpId = 'matrix-configuration-' + suffix;
const connectionId = 'configuration-' + suffix;
const departmentId = 'department-' + suffix;
const employeeId = 'employee-' + suffix;
const adminId = 'usr' + randomBytes(8).toString('hex');
const userId = 'usr' + randomBytes(8).toString('hex');
const password = randomBytes(24).toString('hex');
const cookies = [];
let adminCookie, browser, spaceId, baseId;
let checks = 0;
function check(value, label) {
  if (!value) throw Error(label);
  checks++;
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
    // Some error responses have no JSON body; inspect their HTTP status instead.
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
(async () => {
  await db.connect();
  const salt = await backend('bcrypt').genSalt(10);
  const hash = await backend('bcrypt').hash(password, salt);
  for (const [id, name, admin] of [
    [adminId, '配置验收管理员', true],
    [userId, '配置验收员工', false],
  ])
    await db.query(
      'INSERT INTO users(id,name,email,password,salt,is_admin,notify_meta) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [id, name, id + '@example.invalid', hash, salt, admin, '{}']
    );
  await db.query(
    "INSERT INTO directory_connection(id,provider,tenant_id,name,modified_time) VALUES($1,'dingtalk',$2,'配置流程验收企业',NOW())",
    [connectionId, corpId]
  );
  await db.query(
    "INSERT INTO directory_department(id,connection_id,external_id,name,modified_time) VALUES($1,$2,'1','Alpha 验收部门',NOW()),($3,$2,'2','Other 验收部门',NOW())",
    [departmentId, connectionId, 'other-' + suffix]
  );
  await db.query(
    "INSERT INTO directory_member(id,connection_id,external_id,name,email,modified_time) VALUES($1,$2,'employee','配置验收员工',$3,NOW())",
    [employeeId, connectionId, userId + '@example.invalid']
  );
  await db.query(
    'INSERT INTO directory_membership(connection_id,member_id,department_id) VALUES($1,$2,$3)',
    [connectionId, employeeId, departmentId]
  );
  adminCookie = await signin(adminId);
  const userCookie = await signin(userId);
  let result = await request('POST', '/space', { name: '矩阵配置验收 ' + suffix });
  spaceId = result.data?.id;
  check(Boolean(spaceId), 'create isolated configuration space');
  result = await request('POST', '/base', { spaceId, name: '矩阵配置验收' });
  baseId = result.data?.id;
  check(Boolean(baseId), 'create isolated configuration base');
  const tables = [];
  for (const name of ['验收表 A', '验收表 B']) {
    result = await request('POST', `/base/${baseId}/table`, {
      name,
      fields: [
        { name: '名称', type: 'singleLineText' },
        { name: '创建人', type: 'createdBy' },
      ],
      records: [],
    });
    check(Boolean(result.data?.id), 'create synthetic table');
    tables.push(result.data);
  }
  result = await request('GET', '/authorityMatrix/options?baseId=' + baseId);
  const enterprise = result.data?.connections?.find((item) => item.id === connectionId);
  check(
    enterprise?.corpId === corpId && !('appSecret' in enterprise) && !('appKey' in enterprise),
    'admin options identify the enterprise without credentials'
  );
  check(
    (await request('GET', '/authorityMatrix/options?baseId=' + baseId, undefined, userCookie))
      .response.status === 403,
    'ordinary user cannot inspect administrative options'
  );
  browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const context = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 1440, height: 1050 },
  });
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
  await page.getByRole('region', { name: '2. 准备角色、员工账号和数据库成员' }).waitFor();
  check(true, 'matrix provides the role, binding and membership setup flow');
  await page.getByLabel('所属企业', { exact: true }).click();
  await page.getByRole('option', { name: '配置流程验收企业', exact: true }).click();
  await page.getByText('此企业尚无启用的业务角色', { exact: false }).waitFor();
  check(true, 'empty roles explain the next configuration step');
  await page.getByRole('button', { name: '管理业务角色', exact: true }).click();
  await page.getByRole('button', { name: '新建角色', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('角色名称', { exact: true }).fill('配置验收编辑者');
  await dialog.getByLabel('搜索部门名称或路径').fill('Alpha');
  await dialog.getByRole('combobox', { name: '选择部门', exact: true }).click();
  check(
    (await page.getByRole('option', { name: 'Other 验收部门', exact: true }).count()) === 0,
    'department search removes unrelated choices'
  );
  await page.getByRole('option', { name: 'Alpha 验收部门', exact: true }).click();
  const departmentSection = dialog
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: '部门映射', exact: true }) });
  await departmentSection.getByRole('button', { name: '添加规则', exact: true }).click();
  await dialog.getByRole('button', { name: '保存角色', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('combobox', { name: '选择业务角色', exact: true }).click();
  await page.getByRole('option', { name: '配置验收编辑者', exact: true }).click();
  check(true, 'new role is selectable without leaving or reloading the matrix');
  await page.getByRole('checkbox', { name: '全部现有数据表', exact: true }).click();
  await page.getByRole('combobox', { name: '权限快捷配置', exact: true }).click();
  await page.getByRole('option', { name: '新增与修改', exact: true }).click();
  await page.getByRole('button', { name: '添加规则', exact: true }).click();
  const roles = await request('GET', '/admin/organization/dingtalk/listRoles?corpId=' + corpId);
  const role = roles.data.find((item) => item.name === '配置验收编辑者');
  check(Boolean(role?.id), 'role saved within the selected enterprise');
  check(
    await page
      .getByRole('checkbox', { name: `${role.id} ${tables[0].id} record|update`, exact: true })
      .isChecked(),
    'bulk preset grants updates'
  );
  check(
    !(await page
      .getByRole('checkbox', { name: `${role.id} ${tables[1].id} record|delete`, exact: true })
      .isChecked()),
    'edit preset does not grant deletions'
  );
  check(
    await page.getByRole('button', { name: '添加规则', exact: true }).isDisabled(),
    'bulk addition does not duplicate role and table rules'
  );
  await page.getByRole('button', { name: '管理员工绑定', exact: true }).click();
  await page.getByRole('button', { name: '绑定账号', exact: true }).click();
  dialog = page.getByRole('dialog');
  check(
    (await dialog.getByRole('textbox').inputValue()) === userId + '@example.invalid',
    'binding suggests the employee email'
  );
  check(
    await dialog.getByRole('button', { name: '确认绑定', exact: true }).isDisabled(),
    'suggested identity is never bound automatically'
  );
  await dialog.getByRole('button', { name: '搜索', exact: true }).click();
  await dialog.getByRole('radio').check();
  await dialog.getByRole('button', { name: '确认绑定', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  check(
    await page
      .getByRole('checkbox', { name: `${role.id} ${tables[0].id} record|update`, exact: true })
      .isChecked(),
    'binding preserves unsaved matrix edits'
  );
  const members = await request(
    'GET',
    '/admin/organization/dingtalk/roleMembers?' + new URLSearchParams({ corpId, roleId: role.id })
  );
  check(
    members.data?.members?.some((member) => member.userId === userId),
    'bound employee matches the department role'
  );
  await page.getByRole('button', { name: '管理数据库成员', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.waitFor();
  check(
    (await dialog.innerText()).includes('矩阵配置验收'),
    'base member management opens for the current base'
  );
  await page.keyboard.press('Escape');
  await page
    .getByRole('checkbox', { name: '启用权限策略（追加授权与数据限制）', exact: true })
    .check();
  await page
    .getByRole('checkbox', {
      name: '我已核对企业、角色、表、字段与记录范围，确认保存后对相应账号生效。',
      exact: true,
    })
    .check();
  await page.getByRole('button', { name: '保存并生效', exact: true }).click();
  await page.getByText('上次保存成功，已对后续请求生效。', { exact: true }).waitFor();
  result = await request('GET', '/authorityMatrix/get?baseId=' + baseId);
  check(
    result.data?.revision === 1 &&
      result.data.policy.enabled &&
      result.data.policy.rules.length === 2,
    'save confirms the actual persisted policy'
  );
  await page
    .getByRole('checkbox', { name: `${role.id} ${tables[0].id} record|delete`, exact: true })
    .check();
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await page.getByRole('alertdialog').waitFor();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  check(
    await page
      .getByRole('checkbox', { name: `${role.id} ${tables[0].id} record|delete`, exact: true })
      .isChecked(),
    'canceling reload preserves unsaved edits'
  );
  await page
    .getByRole('checkbox', { name: `${role.id} ${tables[0].id} record|delete`, exact: true })
    .uncheck();
  await page.screenshot({
    path: '/tmp/teable-local-run/phase23-matrix-configuration.png',
    fullPage: true,
    animations: 'disabled',
  });
  check(errors.length === 0, 'configuration flow has no browser JavaScript errors');
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    let clean = true;
    try {
      if (
        spaceId &&
        (await request('DELETE', `/space/${spaceId}/permanent`)).response.status !== 200
      )
        throw Error('Fixture space cleanup failed');
      for (const cookie of cookies) await request('POST', '/auth/signout', {}, cookie);
      await db.query('DELETE FROM directory_connection WHERE id=$1', [connectionId]);
      await db.query('DELETE FROM users WHERE id=ANY($1::text[])', [[adminId, userId]]);
    } catch {
      clean = false;
      process.exitCode = 1;
      console.error('Synthetic cleanup failed');
    }
    await db.end();
    console.log(
      JSON.stringify({
        passed: checks,
        success: !process.exitCode,
        syntheticDataCleaned: clean,
        realEmployeesModified: false,
      })
    );
  });
