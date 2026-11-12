/** Local HTTP/DB/Chrome acceptance for role rosters, history, checks and save-to-diagnosis. */
const { randomUUID, randomBytes } = require('node:crypto');
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
const suffix = randomUUID();
const corpId = 'role-management-' + suffix;
const foreignCorpId = corpId + '-foreign';
const departmentId = corpId + '-dept';
const memberId = corpId + '-employee';
const unboundId = corpId + '-unbound';
const inactiveId = corpId + '-inactive';
const foreignMemberId = corpId + '-foreign-member';
const adminId = 'usr' + randomBytes(8).toString('hex');
const employeeId = 'usr' + randomBytes(8).toString('hex');
const password = randomBytes(24).toString('hex');
let spaceId, baseId, tableId;
let browser,
  cookie = '',
  employeeCookie = '',
  passed = 0;
const api = '/admin/organization/dingtalk/';
const check = (value, label) => {
  if (!value) throw Error(label);
  passed++;
  console.log('PASS ' + label);
};
async function request(method, route, body, session = cookie) {
  const response = await fetch(origin + '/api' + route, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: session },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60000),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    /* Status diagnoses failures. */
  }
  return { status: response.status, data, response };
}
async function login(id) {
  const result = await request(
    'POST',
    '/auth/signin',
    { email: id + '@example.invalid', password },
    ''
  );
  check(result.status === 200, 'synthetic account login');
  return result.response.headers
    .getSetCookie()
    .map((item) => item.split(';')[0])
    .join('; ');
}
const sourceRules = [{ type: 'department', departmentId, includeDescendants: false }];
const namedRules = [{ type: 'member', memberId }];
async function roles() {
  const result = await request('GET', api + 'listRoles?corpId=' + corpId);
  check(result.status === 200, 'read scoped role revisions');
  return result.data;
}
async function toolsCheck(a, b) {
  let r = await request('GET', api + 'roleCounts?corpId=' + corpId);
  check(
    r.status === 200 && r.data.find((row) => row.roleId === a.id).effective === 1,
    'role counts deduplicate direct and inherited membership'
  );
  const roster = new URLSearchParams({
    corpId,
    roleId: a.id,
    binding: 'bound',
    source: 'department',
    departmentId,
  });
  r = await request('GET', api + 'roleRoster?' + roster);
  check(
    r.status === 200 && r.data.total === 1 && r.data.members[0].sources.includes('member'),
    'roster combines department binding and source filters'
  );
  r = await request(
    'GET',
    api +
      'roleRoster?' +
      new URLSearchParams({ corpId, roleId: b.id, scope: 'all', binding: 'unbound' })
  );
  check(
    r.status === 200 && r.data.total === 2,
    'all-employee roster exposes unbound candidates including inactive status'
  );
  const historyQuery = api + 'roleHistory?' + new URLSearchParams({ corpId, roleId: a.id });
  r = await request('GET', historyQuery);
  check(
    r.status === 200 &&
      r.data.total === 1 &&
      r.data.entries[0].before === null &&
      r.data.entries[0].actor.id === adminId,
    'role creation writes durable actor and first snapshot'
  );
  const batch = {
    corpId,
    roleId: b.id,
    expectedVersion: b.version,
    assigned: true,
    memberIds: [memberId, unboundId],
  };
  r = await request('POST', api + 'setRolePeople', batch);
  check(
    r.status === 200 && r.data.rules.length === 2 && r.data.version === 2,
    'HTTP batch adds multiple direct people atomically'
  );
  r = await request('GET', api + 'roleHistory?' + new URLSearchParams({ corpId, roleId: b.id }));
  check(
    r.data.total === 2 &&
      r.data.entries[0].before.version === 1 &&
      r.data.entries[0].after.version === 2,
    'durable history exposes exact before and after revisions'
  );
  const afterHistoryCount = r.data.total;
  r = await request('POST', api + 'setRolePeople', { ...batch, assigned: false });
  check(r.status === 409, 'stale bulk member edit is rejected');
  r = await request('GET', api + 'roleHistory?' + new URLSearchParams({ corpId, roleId: b.id }));
  check(r.data.total === afterHistoryCount, 'rejected save leaves no fabricated history entry');
  r = await request('POST', api + 'setRolePeople', {
    ...batch,
    assigned: false,
    expectedVersion: 2,
  });
  check(r.status === 200 && r.data.rules.length === 0, 'HTTP bulk direct removal succeeds');
  r = await request('POST', api + 'setRolePeople', {
    ...batch,
    expectedVersion: 3,
    memberIds: [foreignMemberId],
  });
  check(r.status === 404, 'bulk member edit rejects cross-enterprise identity');
  r = await request('POST', api + 'setRolePeople', {
    ...batch,
    expectedVersion: 3,
    memberIds: [inactiveId],
  });
  check(r.status === 404, 'bulk add rejects inactive employee');
  r = await request('POST', api + 'saveRole', {
    corpId,
    expectedVersion: 0,
    name: '失效配置验收',
    enabled: false,
    rules: [
      { type: 'member', memberId: unboundId },
      { type: 'member', memberId: inactiveId },
      { type: 'department', departmentId: corpId + '-missing-dep', includeDescendants: false },
    ],
  });
  check(r.status === 200, 'create disabled synthetic stale configuration for checks');
  r = await request('GET', api + 'roleChecks?corpId=' + corpId);
  check(
    r.status === 200 &&
      ['unboundMember', 'inactiveMember', 'invalidDepartment'].every((kind) =>
        r.data.issues.some((issue) => issue.kind === kind)
      ),
    'configuration checks enumerate unbound departed and invalid department references'
  );
  r = await request('POST', '/space', { name: '角色工具验收 ' + suffix });
  spaceId = r.data?.id;
  check(!!spaceId, 'create isolated access-check space');
  r = await request('POST', '/base', { spaceId, name: '角色工具验收库' });
  baseId = r.data?.id;
  check(!!baseId, 'create isolated access-check base');
  r = await request('POST', `/base/${baseId}/table`, {
    name: '权限检查表',
    fields: [{ name: 'Name', type: 'singleLineText' }],
    records: [],
  });
  tableId = r.data?.id;
  check(!!tableId, 'create isolated access-check table');
  r = await request('POST', '/authorityMatrix/save', {
    baseId,
    connectionId: corpId,
    expectedRevision: 0,
    policy: {
      version: 1,
      enabled: true,
      rules: [{ roleId: a.id, tableId, actions: ['table|read', 'record|read'] }],
    },
  });
  check(r.status === 200, 'reference assigned role in isolated base policy');
  r = await request(
    'GET',
    api + 'roleChecks?' + new URLSearchParams({ corpId, kind: 'noBaseAccess' })
  );
  check(
    r.status === 200 &&
      r.data.issues.some((issue) => issue.memberId === memberId && issue.baseId === baseId),
    'checks detect configured role without database membership'
  );
  for (const [method, route, body] of [
    ['GET', 'roleRoster?' + roster, undefined],
    ['GET', 'roleHistory?' + new URLSearchParams({ corpId, roleId: a.id }), undefined],
    ['GET', 'roleChecks?corpId=' + corpId, undefined],
    ['GET', 'roleCounts?corpId=' + corpId, undefined],
    ['POST', 'setRolePeople', batch],
  ])
    check(
      (await request(method, api + route, body, employeeCookie)).status === 403,
      'non-admin denied ' + route.split('?')[0]
    );
  check(
    (
      await request(
        'GET',
        api + 'roleHistory?' + new URLSearchParams({ corpId: foreignCorpId, roleId: a.id })
      )
    ).status === 404,
    'history reads reject foreign enterprise roles'
  );
  check(
    (
      await request(
        'GET',
        api + 'roleRoster?' + new URLSearchParams({ corpId: foreignCorpId, roleId: a.id })
      )
    ).status === 404,
    'roster reads reject foreign enterprise roles'
  );
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
    cookie.split('; ').map((pair) => {
      const at = pair.indexOf('=');
      return { name: pair.slice(0, at), value: pair.slice(at + 1), url: origin };
    })
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin + '/admin/directory', { waitUntil: 'networkidle', timeout: 90000 });
  await page.locator('#directory-connection').click();
  await page.getByRole('option', { name: '角色管理验收企业 · ' + corpId, exact: true }).click();
  const employeeRow = page
    .getByRole('row')
    .filter({ has: page.getByText('验收员工', { exact: true }) });
  await employeeRow.getByRole('button', { name: '管理角色', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: '部门负责人', exact: true }).waitFor();
  check(
    (await dialog.innerText()).includes('直接指定 / 部门规则'),
    'Chrome shows direct and inherited membership sources'
  );
  await dialog.getByRole('checkbox', { name: '部门负责人', exact: true }).uncheck();
  await dialog.getByRole('checkbox', { name: '指定审核人', exact: true }).check();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '继续编辑', exact: true })
    .click();
  check(
    await dialog.getByRole('checkbox', { name: '指定审核人', exact: true }).isChecked(),
    'Chrome preserves edits after cancelled discard'
  );
  await dialog.getByRole('button', { name: '预览成员变化', exact: true }).click();
  check(
    (await dialog.innerText()).includes('仍通过其他规则保留角色'),
    'Chrome explains retained department membership before saving'
  );
  await page.screenshot({
    path: path.resolve(
      __dirname,
      '../../../doc/knowledge-base/organization-permissions/assets/28-local-employee-roles.png'
    ),
    fullPage: true,
    animations: 'disabled',
  });
  await dialog.getByRole('button', { name: '保存并核验权限', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '重新检查', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  check(true, 'Chrome automatically opens employee permission diagnosis after saving');
  let saved = await roles();
  check(
    !saved
      .find((r) => r.name === '部门负责人')
      .rules.some((r) => r.type === 'member' && r.memberId === memberId) &&
      saved
        .find((r) => r.name === '指定审核人')
        .rules.some((r) => r.type === 'member' && r.memberId === memberId),
    'Chrome persists a multi-role change together'
  );
  await page.getByRole('button', { name: '业务角色', exact: true }).click();
  const roleRow = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: '指定审核人', exact: true }) });
  await roleRow.getByRole('button', { name: '变更历史', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByText(/版本 3 → 4/).waitFor();
  check(
    (await dialog.innerText()).includes('直接指定') &&
      (await dialog.innerText()).includes('验收管理员'),
    'Chrome displays persisted operator and member rule history diff'
  );
  await page.screenshot({
    path: path.resolve(
      __dirname,
      '../../../doc/knowledge-base/organization-permissions/assets/28-local-history.png'
    ),
    fullPage: true,
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await roleRow.getByRole('button', { name: '管理成员', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: '浏览范围', exact: true }).click();
  await page.getByRole('option', { name: '全部员工（可添加）', exact: true }).click();
  await dialog.getByRole('combobox', { name: '筛选绑定状态', exact: true }).click();
  await page.getByRole('option', { name: '未绑定账号', exact: true }).click();
  await dialog.getByRole('checkbox', { name: '验收未绑定', exact: true }).check();
  await dialog.getByRole('button', { name: '批量添加直接指定', exact: true }).click();
  await dialog.getByText(/验收未绑定 .*账号未绑定或不可用/).waitFor();
  check(true, 'Chrome previews pending unbound identity for bulk assignment');
  await dialog.getByRole('button', { name: '保存角色', exact: true }).click();
  await dialog
    .getByText('角色成员已保存，可点击“查看权限”核验实际权限。', { exact: true })
    .waitFor();
  check(true, 'Chrome saves filtered bulk assignment');
  await dialog.getByRole('checkbox', { name: '验收未绑定', exact: true }).check();
  await dialog.getByRole('button', { name: '批量移除直接指定', exact: true }).click();
  await dialog.getByRole('button', { name: '保存角色', exact: true }).click();
  await dialog
    .getByText('角色成员已保存，可点击“查看权限”核验实际权限。', { exact: true })
    .waitFor();
  check(true, 'Chrome removes filtered direct assignments without changing department rules');
  await page.screenshot({
    path: path.resolve(
      __dirname,
      '../../../doc/knowledge-base/organization-permissions/assets/28-local-roster.png'
    ),
    fullPage: true,
    animations: 'disabled',
  });
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '权限异常检查', exact: true }).click();
  await page.getByText('指定人员未绑定账号', { exact: false }).first().waitFor();
  check(
    (await page.locator('main').last().innerText()).includes('已离职员工仍被直接指定'),
    'Chrome shows actionable role configuration issues'
  );
  await page.screenshot({
    path: path.resolve(
      __dirname,
      '../../../doc/knowledge-base/organization-permissions/assets/28-local-checks.png'
    ),
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '业务角色', exact: true }).click();
  saved = await roles();
  await roleRow.getByRole('button', { name: '编辑角色', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '移除人员 验收员工', exact: true }).click();
  await dialog.getByRole('button', { name: '预览成员变化', exact: true }).click();
  await dialog.getByText(/验收员工 .*失去该角色/).waitFor();
  check(true, 'Chrome previews losing role membership before saving');
  const current = saved.find((r) => r.name === '指定审核人');
  check(
    (
      await request('POST', api + 'saveRole', {
        corpId,
        roleId: current.id,
        expectedVersion: current.version,
        name: current.name,
        enabled: current.enabled,
        rules: current.rules,
      })
    ).status === 200,
    'simulate another administrator saving the same role'
  );
  await dialog.getByRole('button', { name: '保存角色', exact: true }).click();
  await dialog
    .getByRole('alert')
    .getByText(/角色已被其他管理员修改/)
    .waitFor();
  check(await dialog.isVisible(), 'Chrome keeps draft open after a concurrent save conflict');
  await page.screenshot({
    path: path.resolve(
      __dirname,
      '../../../doc/knowledge-base/organization-permissions/assets/28-local-role-conflict.png'
    ),
    fullPage: true,
    animations: 'disabled',
  });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '放弃修改', exact: true })
    .click();
  check(errors.length === 0, 'Chrome has no page JavaScript errors');
  await browser.close();
  browser = undefined;
}
(async () => {
  await db.connect();
  const salt = await backend('bcrypt').genSalt(10);
  const hash = await backend('bcrypt').hash(password, salt);
  for (const [id, admin] of [
    [adminId, true],
    [employeeId, false],
  ])
    await db.query(
      'INSERT INTO users(id,name,email,password,salt,is_admin,notify_meta) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        id,
        admin ? '角色管理验收管理员' : '验收员工',
        id + '@example.invalid',
        hash,
        salt,
        admin,
        '{}',
      ]
    );
  for (const id of [corpId, foreignCorpId])
    await db.query(
      "INSERT INTO directory_connection(id,provider,tenant_id,name,app_key,app_secret,modified_time) VALUES($1,'dingtalk',$1,'角色管理验收企业','synthetic-key','synthetic-only-not-a-credential',NOW())",
      [id]
    );
  await db.query(
    'INSERT INTO directory_department(id,connection_id,external_id,name,modified_time) VALUES($1,$2,$1,$3,NOW())',
    [departmentId, corpId, '验收部门']
  );
  for (const [id, conn, user, name, inactive] of [
    [memberId, corpId, employeeId, '验收员工', null],
    [unboundId, corpId, null, '验收未绑定', null],
    [inactiveId, corpId, null, '验收离职', new Date()],
    [foreignMemberId, foreignCorpId, null, '验收外企业', null],
  ])
    await db.query(
      'INSERT INTO directory_member(id,connection_id,external_id,user_id,name,inactive_time,modified_time) VALUES($1,$2,$1,$3,$4,$5,NOW())',
      [id, conn, user, name, inactive]
    );
  await db.query(
    'INSERT INTO directory_membership(connection_id,member_id,department_id) VALUES($1,$2,$3)',
    [corpId, memberId, departmentId]
  );
  cookie = await login(adminId);
  employeeCookie = await login(employeeId);
  const created = [];
  for (const [name, rules] of [
    ['部门负责人', [...sourceRules, ...namedRules]],
    ['指定审核人', []],
  ]) {
    const r = await request('POST', api + 'saveRole', {
      corpId,
      expectedVersion: 0,
      name,
      rules,
      enabled: true,
    });
    check(r.status === 200, 'create isolated role fixture');
    created.push(r.data);
  }
  const [a, b] = created;
  const draft = {
    corpId,
    roleId: a.id,
    expectedVersion: a.version,
    name: a.name,
    enabled: true,
    rules: sourceRules,
  };
  let r = await request('POST', api + 'previewRole', draft);
  check(
    r.status === 200 && r.data.counts.retained === 1 && r.data.before === 1 && r.data.after === 1,
    'HTTP preview detects direct removal retained by department'
  );
  check(
    (await roles()).find((role) => role.id === a.id).version === a.version,
    'preview never writes the role'
  );
  r = await request('POST', api + 'previewRole', {
    ...draft,
    rules: [{ type: 'member', memberId: unboundId }],
  });
  check(
    r.status === 200 &&
      r.data.counts.removed === 1 &&
      r.data.counts.pending === 1 &&
      r.data.after === 0,
    'HTTP preview distinguishes removed and unbound identities'
  );
  r = await request('POST', api + 'previewRole', { ...draft, skip: 1, take: 1 });
  check(
    r.status === 200 && r.data.total === 1 && r.data.members.length === 0,
    'HTTP preview paginates changes with stable totals'
  );
  r = await request('GET', api + 'memberRoles?' + new URLSearchParams({ corpId, memberId }));
  check(
    r.status === 200 &&
      r.data.roles.find((role) => role.id === a.id).sources.join(',') === 'member,department',
    'HTTP employee roles reports every matching source'
  );
  const batch = {
    corpId,
    memberId,
    assignments: [
      { roleId: a.id, expectedVersion: a.version, assigned: false },
      { roleId: b.id, expectedVersion: b.version, assigned: true },
    ],
  };
  r = await request('POST', api + 'saveMemberRoles', {
    ...batch,
    assignments: [batch.assignments[0], { ...batch.assignments[1], expectedVersion: 999 }],
  });
  check(r.status === 409, 'stale second role rejects the whole batch');
  const unchanged = await roles();
  check(
    unchanged.every((role) => role.version === 1) &&
      unchanged.find((role) => role.id === a.id).rules.length === 2,
    'database confirms no partial role update'
  );
  for (const [method, route, body] of [
    ['GET', 'memberRoles?' + new URLSearchParams({ corpId, memberId }), undefined],
    ['POST', 'previewRole', draft],
    ['POST', 'saveMemberRoles', batch],
  ])
    check(
      (await request(method, api + route, body, employeeCookie)).status === 403,
      'non-admin denied ' + route.split('?')[0]
    );
  check(
    (
      await request(
        'GET',
        api + 'memberRoles?' + new URLSearchParams({ corpId, memberId: foreignMemberId })
      )
    ).status === 404,
    'foreign employee lookup rejected'
  );
  check(
    (await request('POST', api + 'saveMemberRoles', { ...batch, memberId: foreignMemberId }))
      .status === 404,
    'foreign employee assignment rejected'
  );
  for (const invalid of [
    [],
    [batch.assignments[0], batch.assignments[0]],
    [{ ...batch.assignments[0], expectedVersion: 0 }],
  ])
    check(
      (await request('POST', api + 'saveMemberRoles', { ...batch, assignments: invalid }))
        .status === 400,
      'invalid batch rejected'
    );
  check(
    (
      await request('POST', api + 'previewRole', {
        ...draft,
        rules: [{ type: 'member', memberId: inactiveId }],
      })
    ).status === 404,
    'departed employee rejected during preview'
  );
  await toolsCheck(a, b);
  if (process.env.TEABLE_ACCEPTANCE_BROWSER === '1') await browserCheck();
  console.log(JSON.stringify({ passed, success: true }));
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    let cleaned = true;
    try {
      if (spaceId && (await request('DELETE', `/space/${spaceId}/permanent`)).status !== 200)
        throw Error('Space cleanup failed');
      for (const session of [cookie, employeeCookie].filter(Boolean))
        await request('POST', '/auth/signout', {}, session);
      await db.query('DELETE FROM directory_connection WHERE id=ANY($1::text[])', [
        [corpId, foreignCorpId],
      ]);
      await db.query('DELETE FROM users WHERE id=ANY($1::text[])', [[adminId, employeeId]]);
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
