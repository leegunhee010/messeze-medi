// 본사 messeze.com 접수함 ↔ data/inquiries.json 동기화 (GitHub Actions에서 실행)
// 1) 관리자 계정으로 로그인해 세션 쿠키를 받는다
// 2) [메디] 표시된 문의만 가져와 로컬 파일과 합친다 (로컬에서 바꾼 상태·메모는 서버로 올린다)
const fs = require('fs');
const path = require('path');
const BASE = process.env.MESSEZE_BASE || 'https://messeze.com';
const FILE = path.join(__dirname, '..', 'data', 'inquiries.json');
const ID = process.env.MESSEZE_ADMIN_ID || '';
const PW = process.env.MESSEZE_ADMIN_PW || '';

function readLocal() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return { updated: '', rows: [] }; }
}
function writeLocal(j) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(j, null, 2) + '\n');
}
function fail(msg, local) {
  local.error = msg; local.errorAt = new Date().toISOString();
  writeLocal(local);
  console.error('동기화 실패:', msg);
  process.exit(1);
}

(async () => {
  const local = readLocal();
  delete local.error; delete local.errorAt;
  if (!ID || !PW) return fail('MESSEZE_ADMIN_ID / MESSEZE_ADMIN_PW 시크릿이 없습니다. 관리자 > 상담 접수에서 본사 계정을 연결하세요.', local);

  // 1) 로그인
  const lr = await fetch(BASE + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ID, password: PW }), redirect: 'manual',
  });
  const lj = await lr.json().catch(() => null);
  if (!lj || lj.status !== true) return fail('본사 로그인 실패: ' + (lj && lj.message ? lj.message : lr.status), local);
  const cookie = (lr.headers.getSetCookie ? lr.headers.getSetCookie() : [lr.headers.get('set-cookie') || ''])
    .map(c => c.split(';')[0]).filter(Boolean).join('; ');
  if (!cookie) return fail('세션 쿠키를 받지 못했습니다.', local);
  const H = { Cookie: cookie, 'X-Requested-With': 'XMLHttpRequest' };

  // 2) 목록
  const rr = await fetch(BASE + '/api/compat?t=' + Date.now(), { headers: H });
  const rj = await rr.json().catch(() => null);
  if (!rj || rj.ok === false) return fail('접수함 조회 실패 (' + rr.status + ')', local);
  const serverRows = (rj.rows || rj.data || (Array.isArray(rj) ? rj : []))
    .filter(x => /^\[메디\]/.test(String(x.company || '')));

  // 3) 합치기: 로컬에서 바꾼(dirty) 상태·메모는 서버로 올리고, 나머지는 서버 값을 따른다
  const byRow = new Map(local.rows.map(r => [String(r.row), r]));
  const out = [];
  let pushed = 0;
  for (const s of serverRows) {
    const row = String(s.row ?? s.id ?? '');
    const loc = byRow.get(row);
    const item = {
      row,
      ts: String(s.ts || s.date || s.created || s.created_at || ''),
      name: String(s.name || ''),
      hospital: String(s.company || '').replace(/^\[메디\]\s*/, ''),
      phone: String(s.phone || ''),
      site: String(s.site || ''),
      status: String(s.status || '신규'),
      memo: String(s.memo || ''),
    };
    if (loc && loc.dirty) {
      const ur = await fetch(BASE + '/api/compat', {
        method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, H),
        body: JSON.stringify({ action: 'update', row: Number(row), status: loc.status, memo: loc.memo }),
      });
      const uj = await ur.json().catch(() => null);
      if (uj && uj.ok) { item.status = loc.status; item.memo = loc.memo; pushed++; }
      else { item.status = loc.status; item.memo = loc.memo; item.dirty = true; } // 다음 회차에 재시도
    }
    out.push(item);
  }
  out.sort((a, b) => (b.ts || '').localeCompare(a.ts || '') || Number(b.row) - Number(a.row));
  // 4) 문의 알림 메일 설정 상태 (비밀번호는 서버가 내보내지 않는다)
  let mail = local.mail || null;
  try {
    const mr = await fetch(BASE + '/api/admin/mail', { headers: H });
    const mj = await mr.json().catch(() => null);
    if (mj && mj.status === true && mj.data) {
      const d = mj.data;
      mail = { enabled: !!d.enabled, notifyEmail: d.notifyEmail || '', smtpHost: d.smtpHost || '', smtpUser: d.smtpUser || '', hasPassword: !!d.hasPassword, protocol: d.protocol || 'smtp' };
    }
  } catch (e) { /* 메일 설정 조회 실패는 동기화를 막지 않는다 */ }
  const next = { updated: new Date().toISOString(), mail, rows: out };
  const changed = JSON.stringify(next.rows) !== JSON.stringify(local.rows) || JSON.stringify(next.mail) !== JSON.stringify(local.mail || null) || local.error;
  if (changed || !local.updated) writeLocal(next);
  else { local.updated = next.updated; writeLocal(local); }
  console.log('서버 ' + serverRows.length + '건 · 로컬 ' + out.length + '건 · 서버로 올린 수정 ' + pushed + '건');
})().catch(e => fail(String(e && e.message || e), readLocal()));
