/* Taalam accounts: free 7-day trial, then an account (e-mail + password) and a 5 €/month subscription.
   Shared by "تعلم الهولندي.html" and "موقع مدرسة الطريق.html". Arabic UI in فصحى مبسّطة.
   Backend: Supabase (free). Until TAALAM_CONFIG has a project URL and its public (anon) key, the page runs in
   "local" mode: the trial is counted in this browser and sign-up shows that accounts open soon.
   Security notes: only the PUBLIC anon key may ever be written here. Access to the database is limited by
   row-level security (see supabase/schema.sql). The subscription date (paid_until) can only be changed by the server. */
(function () {
  'use strict';
  var TAALAM_CONFIG = {
    url: '',      // e.g. https://abcd1234.supabase.co   (filled in after Hazem creates the project)
    anonKey: '',  // the project's public "anon" / "publishable" key — never the service_role key
    trialDays: 7,
    priceText: '5 يورو في الشهر'
  };
  var SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
  var TRIAL_KEY = 'taalam-trial-start', DAY = 864e5;
  var online = !!(TAALAM_CONFIG.url && TAALAM_CONFIG.anonKey);
  var sb = null, user = null, profile = null, ready = false, listeners = [];

  function lsGet(k) { try { return localStorage.getItem(k) } catch (e) { return null } }
  function lsSet(k, v) { try { localStorage.setItem(k, v) } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] }) }

  /* ---------- trial (counted from the first visit in this browser) ---------- */
  var start = +lsGet(TRIAL_KEY);
  if (!start) { start = Date.now(); lsSet(TRIAL_KEY, String(start)) }
  function localTrialEnd() { return start + TAALAM_CONFIG.trialDays * DAY }
  function accessUntil() {
    var t = localTrialEnd();
    if (profile) {
      var a = Date.parse(profile.trial_ends_at || '') || 0, b = Date.parse(profile.paid_until || '') || 0;
      t = Math.max(t, a, b);
    }
    return t;
  }
  function daysLeft() { return Math.max(0, Math.ceil((accessUntil() - Date.now()) / DAY)) }
  function isPaid() { return !!(profile && Date.parse(profile.paid_until || '') > Date.now()) }
  function hasAccess() { return accessUntil() > Date.now() }
  function dayWord(n) { return n === 1 ? 'يوم واحد' : n === 2 ? 'يومان' : (n >= 3 && n <= 10) ? n + ' أيام' : n + ' يوماً' }

  /* ---------- styles (use the page's own color tokens) ---------- */
  var css = document.createElement('style');
  css.textContent = [
    '.tl-bg{position:fixed;inset:0;z-index:30;background:rgba(10,20,35,.6);display:grid;place-items:center;padding:16px;padding-top:max(16px,env(safe-area-inset-top,0px));overflow:auto}',
    '.tl-box{background:var(--card);color:var(--ink);border-radius:16px;padding:22px;max-width:420px;width:100%;box-shadow:0 12px 44px rgba(0,0,0,.35)}',
    '.tl-box h2{font-family:var(--f-display,inherit);font-size:1.3em;margin:0 0 6px}',
    '.tl-box p{margin:0 0 12px;color:var(--muted)}',
    '.tl-tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;background:var(--bg);border-radius:10px;padding:4px;margin:10px 0 14px}',
    '.tl-tabs button{border:0;background:none;color:var(--muted);font:inherit;padding:9px;border-radius:8px;cursor:pointer;min-height:44px}',
    '.tl-tabs button[aria-selected="true"]{background:var(--card);color:var(--ink);font-weight:700;box-shadow:0 1px 3px rgba(0,0,0,.12)}',
    '.tl-f{display:grid;gap:4px;margin-bottom:12px}.tl-f label{font-weight:600;font-size:.92em}',
    '.tl-in{width:100%;font:inherit;padding:11px 12px;border:1.5px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink);min-height:46px}',
    '.tl-in:focus-visible{outline:3px solid var(--yellow,#f5c400);outline-offset:1px}',
    '.tl-pw{position:relative}.tl-pw .tl-in{padding-inline-end:76px}',
    '.tl-eye{position:absolute;inset-inline-end:6px;top:50%;transform:translateY(-50%);border:0;background:var(--bg);color:var(--ink);border-radius:8px;padding:6px 10px;font:inherit;font-size:.85em;cursor:pointer;min-height:36px}',
    '.tl-hint{font-size:.8em;color:var(--muted)}.tl-hint.bad{color:var(--bad)}.tl-hint.ok{color:var(--ok)}',
    '.tl-chk{display:flex;gap:8px;align-items:flex-start;font-size:.88em;margin:4px 0 14px}.tl-chk input{width:20px;height:20px;margin-top:2px}',
    '.tl-btn{width:100%;background:var(--blue);color:#fff;border:0;border-radius:10px;padding:12px;font:inherit;font-weight:700;cursor:pointer;min-height:48px}',
    '.tl-btn[disabled]{opacity:.55;cursor:default}.tl-btn.ghost{background:transparent;color:var(--blue);border:1.5px solid var(--blue);margin-top:8px}',
    '.tl-link{background:none;border:0;color:var(--blue);font:inherit;cursor:pointer;padding:8px 0;text-decoration:underline;min-height:40px}',
    '.tl-msg{border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:.92em}.tl-msg.err{background:var(--bad-soft);color:var(--ink);border-inline-start:4px solid var(--bad)}',
    '.tl-msg.ok{background:var(--ok-soft);color:var(--ink);border-inline-start:4px solid var(--ok)}',
    '.tl-close{float:inline-end;border:0;background:var(--bg);color:var(--ink);border-radius:999px;width:40px;height:40px;font-size:1.2em;cursor:pointer}',
    '.tl-plan{border:2px solid var(--blue);border-radius:12px;padding:14px;margin:6px 0 14px}.tl-plan b{font-size:1.6em;font-family:var(--f-display,inherit)}',
    '.tl-plan ul{margin:8px 0 0;padding-inline-start:20px}',
    '.tl-bar{background:var(--blue-soft);color:var(--ink);border-radius:10px;padding:8px 12px;margin-top:12px;display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;font-size:.9em}',
    '.tl-bar button{background:var(--blue);color:#fff;border:0;border-radius:8px;padding:6px 12px;font:inherit;cursor:pointer;min-height:40px}',
    '.tl-row{display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--line)}'
  ].join('\n');
  document.head.appendChild(css);

  /* ---------- dialog shell ---------- */
  var bg = null, lastFocus = null, locked = false;
  function close() { if (!bg || locked) return; bg.remove(); bg = null; document.removeEventListener('keydown', onKey); if (lastFocus && lastFocus.focus) lastFocus.focus() }
  function onKey(e) { if (e.key === 'Escape') close() }
  function open(html, opts) {
    opts = opts || {}; locked = !!opts.locked;
    if (!bg) {
      lastFocus = document.activeElement;
      bg = document.createElement('div'); bg.className = 'tl-bg'; bg.setAttribute('role', 'dialog'); bg.setAttribute('aria-modal', 'true');
      bg.addEventListener('click', function (e) { if (e.target === bg) close() });
      document.addEventListener('keydown', onKey); document.body.appendChild(bg);
    }
    bg.innerHTML = '<div class="tl-box" dir="rtl" lang="ar">' + (locked ? '' : '<button class="tl-close" type="button" aria-label="إغلاق">×</button>') + html + '</div>';
    var c = bg.querySelector('.tl-close'); if (c) c.onclick = close;
    var f = bg.querySelector('input,button.tl-btn'); if (f) setTimeout(function () { f.focus() }, 30);
    return bg.querySelector('.tl-box');
  }
  function msg(box, text, kind) { var m = box.querySelector('.tl-msg'); if (!m) { m = document.createElement('div'); box.querySelector('form,.tl-body').prepend(m) } m.className = 'tl-msg ' + (kind || 'err'); m.setAttribute('role', kind === 'ok' ? 'status' : 'alert'); m.textContent = text }
  function pwField(id, label, auto) {
    return '<div class="tl-f"><label for="' + id + '">' + label + '</label><div class="tl-pw"><input class="tl-in" id="' + id + '" type="password" autocomplete="' + auto + '" required minlength="8" dir="ltr">' +
      '<button class="tl-eye" type="button" data-for="' + id + '" aria-label="إظهار كلمة السر">إظهار</button></div></div>';
  }
  function wireEyes(box) {
    box.querySelectorAll('.tl-eye').forEach(function (b) {
      b.onclick = function () { var i = box.querySelector('#' + b.dataset.for); var show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.textContent = show ? 'إخفاء' : 'إظهار'; b.setAttribute('aria-label', show ? 'إخفاء كلمة السر' : 'إظهار كلمة السر') };
    });
  }
  function strength(pw) {
    if (pw.length < 8) return ['قصيرة: 8 أحرف على الأقل', 'bad'];
    var k = 0; if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) k++; if (/\d/.test(pw)) k++; if (/[^A-Za-z0-9]/.test(pw)) k++; if (pw.length >= 12) k++;
    return k >= 3 ? ['قوية ✓', 'ok'] : k >= 1 ? ['مقبولة. أضف رقماً أو رمزاً لتصبح أقوى.', ''] : ['ضعيفة: أضف أرقاماً وحروفاً كبيرة.', 'bad'];
  }
  function trErr(e) {
    var m = (e && (e.message || e.error_description || '')) + '';
    if (/Invalid login credentials/i.test(m)) return 'البريد الإلكتروني أو كلمة السر غير صحيحة.';
    if (/Email not confirmed/i.test(m)) return 'لم تؤكّد بريدك بعد. افتح الرسالة التي أرسلناها واضغط رابط التأكيد.';
    if (/already registered|already exists/i.test(m)) return 'يوجد حساب بهذا البريد. سجّل الدخول، أو اضغط «نسيت كلمة السر؟».';
    if (/rate limit|too many/i.test(m)) return 'محاولات كثيرة. انتظر دقيقة ثم حاول مرة أخرى.';
    if (/password/i.test(m)) return 'كلمة السر غير مقبولة. استعمل 8 أحرف على الأقل.';
    if (/network|fetch/i.test(m)) return 'لا يوجد اتصال بالإنترنت. تأكّد من الاتصال وحاول مرة أخرى.';
    return 'حدث خطأ. حاول مرة أخرى بعد قليل.';
  }

  /* ---------- screens ---------- */
  function authScreen(tab, note) {
    tab = tab || 'up';
    var head = note ? '<div class="tl-msg ' + (note.kind || 'ok') + '" role="status">' + esc(note.text) + '</div>' : '';
    var box = open(
      '<h2>' + (tab === 'up' ? 'أنشئ حسابك' : 'سجّل الدخول') + '</h2>' +
      '<p>' + (tab === 'up' ? 'حسابك يحفظ تقدّمك على كل أجهزتك، ويفعّل اشتراكك.' : 'أهلاً بعودتك! تابع من حيث توقّفت.') + '</p>' +
      '<div class="tl-tabs" role="tablist"><button type="button" role="tab" data-t="up" aria-selected="' + (tab === 'up') + '">حساب جديد</button><button type="button" role="tab" data-t="in" aria-selected="' + (tab === 'in') + '">تسجيل الدخول</button></div>' +
      '<form novalidate>' + head +
      '<div class="tl-f"><label for="tl-mail">البريد الإلكتروني</label><input class="tl-in" id="tl-mail" type="email" autocomplete="email" inputmode="email" required dir="ltr" placeholder="name@example.com"></div>' +
      pwField('tl-pw', 'كلمة السر', tab === 'up' ? 'new-password' : 'current-password') +
      (tab === 'up' ? '<div class="tl-hint" id="tl-str" aria-live="polite">8 أحرف على الأقل</div><label class="tl-chk"><input type="checkbox" id="tl-ok" required><span>أوافق على شروط الاستعمال وسياسة الخصوصية. نحفظ بريدك وتقدّمك فقط، ولا نشاركهما مع أحد.</span></label>' : '') +
      '<button class="tl-btn" type="submit">' + (tab === 'up' ? 'أنشئ الحساب' : 'دخول') + '</button>' +
      (tab === 'in' ? '<button class="tl-link" type="button" id="tl-forgot">نسيت كلمة السر؟</button>' : '') +
      '</form>');
    wireEyes(box);
    box.querySelectorAll('[data-t]').forEach(function (b) { b.onclick = function () { authScreen(b.dataset.t) } });
    var pw = box.querySelector('#tl-pw'), st = box.querySelector('#tl-str');
    if (st) pw.oninput = function () { var r = strength(pw.value); st.textContent = r[0]; st.className = 'tl-hint ' + r[1] };
    var fg = box.querySelector('#tl-forgot'); if (fg) fg.onclick = function () { forgotScreen(box.querySelector('#tl-mail').value) };
    box.querySelector('form').onsubmit = function (e) {
      e.preventDefault();
      var mail = box.querySelector('#tl-mail').value.trim(), pass = pw.value, btn = box.querySelector('.tl-btn');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return msg(box, 'اكتب بريداً إلكترونياً صحيحاً، مثل name@example.com.');
      if (pass.length < 8) return msg(box, 'كلمة السر قصيرة: 8 أحرف على الأقل.');
      if (tab === 'up' && !box.querySelector('#tl-ok').checked) return msg(box, 'وافق على الشروط أولاً لإنشاء الحساب.');
      if (!online) return msg(box, 'الحسابات ستفتح قريباً. يمكنك الآن متابعة التعلّم، وتقدّمك محفوظ في هذا المتصفح.', 'ok');
      btn.disabled = true; btn.textContent = 'لحظة…';
      var p = tab === 'up'
        ? sb.auth.signUp({ email: mail, password: pass, options: { emailRedirectTo: location.origin + location.pathname } })
        : sb.auth.signInWithPassword({ email: mail, password: pass });
      p.then(function (r) {
        btn.disabled = false; btn.textContent = tab === 'up' ? 'أنشئ الحساب' : 'دخول';
        if (r.error) return msg(box, trErr(r.error));
        if (tab === 'up' && !r.data.session) return open('<div class="tl-body"><h2>تحقّق من بريدك 📬</h2><p>أرسلنا رسالة إلى <b dir="ltr">' + esc(mail) + '</b>. افتحها واضغط «تأكيد البريد»، ثم ارجع وسجّل الدخول.</p><p>لم تصلك؟ انظر في مجلد الرسائل غير المرغوب فيها (Spam).</p><button class="tl-btn" type="button" id="tl-go">حسناً</button></div>').querySelector('#tl-go').onclick = function () { authScreen('in') };
        close();
      });
    };
  }
  function forgotScreen(mail) {
    var box = open('<h2>نسيت كلمة السر؟</h2><p>اكتب بريدك، ونرسل لك رابطاً لاختيار كلمة سر جديدة.</p><form novalidate><div class="tl-f"><label for="tl-fm">البريد الإلكتروني</label><input class="tl-in" id="tl-fm" type="email" autocomplete="email" dir="ltr" required value="' + esc(mail || '') + '"></div><button class="tl-btn" type="submit">أرسل الرابط</button><button class="tl-link" type="button" id="tl-back">رجوع إلى تسجيل الدخول</button></form>');
    box.querySelector('#tl-back').onclick = function () { authScreen('in') };
    box.querySelector('form').onsubmit = function (e) {
      e.preventDefault(); var m = box.querySelector('#tl-fm').value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)) return msg(box, 'اكتب بريداً إلكترونياً صحيحاً.');
      if (!online) return msg(box, 'الحسابات ستفتح قريباً.', 'ok');
      sb.auth.resetPasswordForEmail(m, { redirectTo: location.origin + location.pathname }).then(function (r) {
        /* same answer whether the address exists or not, so nobody can test which e-mails have accounts */
        if (r.error && /rate|network|fetch/i.test(r.error.message || '')) return msg(box, trErr(r.error));
        msg(box, 'إن كان لهذا البريد حساب، فستصلك رسالة خلال دقائق. افتحها واضغط الرابط.', 'ok');
      });
    };
  }
  function newPasswordScreen() {
    var box = open('<h2>اختر كلمة سر جديدة</h2><form novalidate>' + pwField('tl-np', 'كلمة السر الجديدة', 'new-password') + '<div class="tl-hint" id="tl-str2">8 أحرف على الأقل</div><button class="tl-btn" type="submit" style="margin-top:12px">احفظ كلمة السر</button></form>', { locked: true });
    wireEyes(box); var i = box.querySelector('#tl-np'), h = box.querySelector('#tl-str2');
    i.oninput = function () { var r = strength(i.value); h.textContent = r[0]; h.className = 'tl-hint ' + r[1] };
    box.querySelector('form').onsubmit = function (e) {
      e.preventDefault(); if (i.value.length < 8) return msg(box, 'كلمة السر قصيرة: 8 أحرف على الأقل.');
      sb.auth.updateUser({ password: i.value }).then(function (r) {
        if (r.error) return msg(box, trErr(r.error)); locked = false;
        open('<div class="tl-body"><h2>تم ✓</h2><p>غيّرنا كلمة السر. أنت الآن مسجّل الدخول.</p><button class="tl-btn" type="button" id="tl-k">متابعة</button></div>').querySelector('#tl-k').onclick = close;
      });
    };
  }
  function planScreen(lockedNow) {
    var box = open(
      '<div class="tl-body"><h2>' + (lockedNow ? 'انتهت التجربة المجانية' : 'الاشتراك') + '</h2>' +
      '<p>' + (lockedNow ? 'نتمنّى أن الأسبوع أفادك! لتتابع التعلّم، اشترك بمبلغ رمزي يساعدنا على الاستمرار.' : 'جرّبت الموقع، والآن تابع بلا انقطاع.') + '</p>' +
      '<div class="tl-plan"><b>' + esc(TAALAM_CONFIG.priceText) + '</b><ul><li>كل دروس الهولندية والمراجعة الذكية</li><li>تحضير امتحان القيادة النظري بالعربية</li><li>تقدّمك محفوظ على كل أجهزتك</li><li>يمكنك الإلغاء في أي وقت</li></ul></div>' +
      (user ? '<button class="tl-btn" type="button" id="tl-pay">اشترك الآن</button>' : '<button class="tl-btn" type="button" id="tl-up">أنشئ حساباً للاشتراك</button><button class="tl-btn ghost" type="button" id="tl-in">لدي حساب: تسجيل الدخول</button>') +
      '</div>', { locked: !!lockedNow });
    var u = box.querySelector('#tl-up'), i = box.querySelector('#tl-in'), p = box.querySelector('#tl-pay');
    if (u) u.onclick = function () { locked = false; authScreen('up') };
    if (i) i.onclick = function () { locked = false; authScreen('in') };
    if (p) p.onclick = function () { msg(box, 'الدفع عبر iDEAL سيفتح قريباً. سنرسل لك رسالة عندما يصبح جاهزاً.', 'ok') };
  }
  function accountScreen() {
    if (!user) return authScreen('in');
    var box = open('<div class="tl-body"><h2>حسابي</h2>' +
      '<div class="tl-row"><span>البريد</span><b dir="ltr">' + esc(user.email) + '</b></div>' +
      '<div class="tl-row"><span>الحالة</span><b>' + (isPaid() ? 'مشترك حتى ' + new Date(Date.parse(profile.paid_until)).toLocaleDateString('ar') : hasAccess() ? 'تجربة مجانية: بقي ' + dayWord(daysLeft()) : 'انتهت التجربة') + '</b></div>' +
      '<div class="tl-row"><span>تقدّمك</span><b>محفوظ في حسابك ✓</b></div>' +
      (isPaid() ? '' : '<button class="tl-btn" type="button" id="tl-sub" style="margin-top:14px">الاشتراك (' + esc(TAALAM_CONFIG.priceText) + ')</button>') +
      '<button class="tl-btn ghost" type="button" id="tl-out">تسجيل الخروج</button></div>');
    var s = box.querySelector('#tl-sub'); if (s) s.onclick = function () { planScreen(false) };
    box.querySelector('#tl-out').onclick = function () { sb.auth.signOut().then(function () { user = null; profile = null; close(); emit() }) };
  }

  /* ---------- trial banner + lock ---------- */
  function banner() {
    if (isPaid()) return '';
    var n = daysLeft();
    if (!hasAccess()) return online ? '' : '<div class="tl-bar" role="status"><span>انتهت التجربة المجانية. الاشتراك يفتح قريباً، ويمكنك المتابعة مجاناً حتى ذلك الوقت.</span></div>';
    return '<div class="tl-bar" role="status"><span>🎁 تجربة مجانية: بقي ' + dayWord(n) + (user ? '' : '. أنشئ حساباً ليُحفظ تقدّمك') + '</span><button type="button" onclick="Taalam.' + (user ? 'plans' : 'signup') + '()">' + (user ? 'اشترك' : 'أنشئ حساباً') + '</button></div>';
  }
  /* lock only when accounts and payment really work; before that nobody may be locked out */
  function enforce() { if (online && ready && !hasAccess()) planScreen(true) }

  /* ---------- progress sync (one JSON row per user) ---------- */
  var KEYS = ['nl-ar-a0-v1', 'rijbewijs-study-v1'];
  function pushProgress() {
    if (!online || !user) return;
    var data = {}; KEYS.forEach(function (k) { var v = lsGet(k); if (v) data[k] = v });
    sb.from('progress').upsert({ user_id: user.id, data: data, updated_at: new Date().toISOString() }).then(function () {});
  }
  function pullProgress() {
    return sb.from('progress').select('data').eq('user_id', user.id).maybeSingle().then(function (r) {
      var remote = r.data && r.data.data; if (!remote) return pushProgress();
      var changed = false;
      KEYS.forEach(function (k) { var here = lsGet(k) || '', there = remote[k] || ''; if (there.length > here.length) { lsSet(k, there); changed = true } });
      if (changed) location.reload(); else pushProgress();
    });
  }

  function emit() { listeners.forEach(function (f) { try { f() } catch (e) {} }) }
  function loadProfile() {
    return sb.from('profiles').select('trial_ends_at,paid_until').eq('id', user.id).maybeSingle().then(function (r) { profile = r.data || null });
  }
  function boot() {
    if (!online) { ready = true; emit(); enforce(); return }
    var s = document.createElement('script'); s.src = SDK; s.async = true;
    s.onerror = function () { ready = true; emit() };
    s.onload = function () {
      sb = window.supabase.createClient(TAALAM_CONFIG.url, TAALAM_CONFIG.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
      sb.auth.onAuthStateChange(function (ev, session) {
        if (ev === 'PASSWORD_RECOVERY') { user = session && session.user; return newPasswordScreen() }
        var was = user && user.id; user = session ? session.user : null;
        if (user && user.id !== was) loadProfile().then(function () { emit(); pullProgress(); enforce() });
        else if (!user) { profile = null; emit() }
      });
      sb.auth.getSession().then(function (r) {
        user = r.data.session ? r.data.session.user : null;
        (user ? loadProfile() : Promise.resolve()).then(function () { ready = true; emit(); enforce(); if (user) pullProgress() });
      });
    };
    document.head.appendChild(s);
  }
  window.addEventListener('pagehide', pushProgress);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') pushProgress() });

  window.Taalam = {
    online: online, onChange: function (f) { listeners.push(f) },
    user: function () { return user }, banner: banner, daysLeft: daysLeft, hasAccess: hasAccess, isPaid: isPaid,
    signup: function () { authScreen('up') }, login: function () { authScreen('in') },
    account: function () { user ? accountScreen() : authScreen('in') }, plans: function () { planScreen(false) }
  };
  boot();
})();
