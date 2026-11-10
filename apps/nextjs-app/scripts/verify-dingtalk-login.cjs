/** Fixed local browser acceptance; all synthetic users/connections are cleaned in finally. */
const { createRequire } = require('node:module');
const { randomBytes, randomUUID } = require('node:crypto');
const path = require('node:path');
const backend = createRequire(path.resolve(__dirname, '../../nestjs-backend/package.json'));
backend('dotenv-flow').config({ path: path.resolve(__dirname, '..'), node_env: 'development', silent: true });
const dbUrl = new URL(process.env.PRISMA_META_DATABASE_URL || process.env.PRISMA_DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(dbUrl.hostname)) throw Error('Local development DB required');
dbUrl.pathname = '/teable_dev_20261109';
const db = new (backend('pg').Client)({ connectionString: dbUrl.href });
const { chromium } = require('@playwright/test');
const origin = 'http://localhost:3000';
const corpId = 'dingtalk-login-browser-' + randomUUID();
const userId = 'usr' + randomBytes(8).toString('hex');
const password = randomBytes(24).toString('hex');
let cookie, browser, connectionId;
let checks = 0;
function check(value, label) { if (!value) throw Error(label); checks++; console.log('PASS ' + label); }
(async () => {
  await db.connect();
  const salt = await backend('bcrypt').genSalt(10);
  await db.query('INSERT INTO users(id,name,email,password,salt,is_admin,notify_meta) VALUES($1,$2,$3,$4,$5,true,$6)',[userId,'扫码验收管理员',userId+'@example.invalid',await backend('bcrypt').hash(password,salt),salt,'{}']);
  connectionId = 'dingtalk-browser-' + randomUUID();
  await db.query('INSERT INTO directory_connection(id,provider,tenant_id,name,app_key,app_secret,configuration_version,login_enabled,auto_provision,modified_time) VALUES($1,$2,$3,$4,$5,$6,1,true,true,NOW())',[connectionId,'dingtalk',corpId,'扫码登录验收（临时）','synthetic-key','synthetic-secret']);
  browser = await chromium.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true });
  const context = await browser.newContext({locale:'zh-CN',viewport:{width:1400,height:1000}});
  const page = await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/auth/login',{waitUntil:'networkidle',timeout:90000});
  await page.getByRole('button',{name:'钉钉扫码登录 · 扫码登录验收（临时）'}).waitFor();
  check(true,'browser shows enterprise DingTalk QR sign-in');
  await page.screenshot({path:'/tmp/teable-local-run/phase22-login.png'});
  const signin=await fetch(origin+'/api/auth/signin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:userId+'@example.invalid',password})});
  check(signin.status===200,'synthetic administrator signs in');
  cookie=signin.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  await context.addCookies(cookie.split('; ').map(pair=>{const at=pair.indexOf('=');return{name:pair.slice(0,at),value:pair.slice(at+1),url:origin};}));
  await page.goto(origin+'/admin/directory',{waitUntil:'networkidle',timeout:90000});
  await page.getByRole('button',{name:'配置钉钉企业',exact:true}).click();const dialog=page.getByRole('dialog');
  const login=dialog.getByRole('checkbox',{name:'启用钉钉扫码登录'});const auto=dialog.getByRole('checkbox',{name:'允许首次扫码自动创建普通账号并绑定员工'});
  check(!await login.isChecked(),'enterprise QR sign-in is off by default');check(await auto.isDisabled(),'provisioning cannot be enabled before login');
  await login.click();await auto.click();check(await auto.isChecked(),'administrator can opt in to enterprise provisioning');
  check((await dialog.innerText()).includes('/api/auth/dingtalk/callback'),'editor displays configured callback address');
  await dialog.screenshot({path:'/tmp/teable-local-run/phase22-config.png'});
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
  const bind=await context.request.post(origin+'/api/auth/dingtalk/bind',{data:{corpId,redirect:'/space'}});
  check(bind.ok(),'authenticated cookie session may start employee binding');
  const target=new URL((await bind.json()).url);check(target.origin==='https://login.dingtalk.com','binding returns only the official authorization URL');
  check(errors.length===0,'login and admin pages have no JavaScript errors');
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(async()=>{
  if(cookie)await fetch(origin+'/api/auth/signout',{method:'POST',headers:{Cookie:cookie}}).catch(()=>{});
  if(browser)await browser.close();
  try { if(connectionId)await db.query('DELETE FROM directory_connection WHERE id=$1',[connectionId]);await db.query('DELETE FROM users WHERE id=$1',[userId]);console.log(JSON.stringify({passed:checks,success:!process.exitCode,syntheticDataCleaned:true,realEmployeesModified:false})); } catch { console.error('Synthetic cleanup failed');process.exitCode=1; }
  await db.end();
});
