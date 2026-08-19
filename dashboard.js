let config = null, members = [], tests = [], answers = {};

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, ...opts });
  if (res.status === 401) { location.href = '/?error=login_required'; throw new Error('auth'); }
  return res.json();
}
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function rankIndex(rang) {
  const list = config?.raenge || [];
  const i = list.indexOf(rang);
  return i >= 0 ? i : 999;
}

document.addEventListener('DOMContentLoaded', async () => {
  const me = await api('/api/me');
  document.getElementById('userName').textContent = me.user.globalName || me.user.username;
  document.getElementById('userTag').textContent = '@' + me.user.username;
  document.getElementById('welcomeName').textContent = me.user.globalName || me.user.username;
  document.getElementById('userAvatar').src = me.user.avatar;

  config = await api('/api/config');
  document.getElementById('minBestehenLabel').textContent = config.einstellungstest.minBestehen + '%';

  const stSel = document.getElementById('mStatus');
  const rgSel = document.getElementById('mRang');
  const fSt = document.getElementById('filterStatus');
  const fRg = document.getElementById('filterRang');
  (config.statusOptionen || []).forEach(s => {
    stSel.innerHTML += `<option value="${esc(s)}">${esc(s)}</option>`;
    fSt.innerHTML += `<option value="${esc(s)}">${esc(s)}</option>`;
  });
  (config.raenge || []).forEach(r => {
    rgSel.innerHTML += `<option value="${esc(r)}">${esc(r)}</option>`;
    fRg.innerHTML += `<option value="${esc(r)}">${esc(r)}</option>`;
  });
  const sV = document.getElementById('sVerstoss');
  (config.sanktionen || []).forEach(s => {
    sV.innerHTML += `<option value="${esc(s.verstoß)}" data-strafe="${esc(s.erst)}">${esc(s.verstoß)}</option>`;
  });
  sV.addEventListener('change', () => {
    const opt = sV.selectedOptions[0];
    if (opt) document.getElementById('sStrafe').value = opt.dataset.strafe || '';
  });

  renderSanktionen(config.sanktionen);
  renderFragen(config.einstellungstest.fragen);
  await refreshMembers();
  await loadHistory();

  document.querySelectorAll('.nav-item, .quick-btn[data-section]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); if (el.dataset.section) showSection(el.dataset.section); });
  });
  document.getElementById('menuToggle').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
  document.getElementById('searchSanktion').addEventListener('input', filterSanktionen);
  document.getElementById('filterKategorie').addEventListener('change', filterSanktionen);
  document.getElementById('searchMember').addEventListener('input', renderMembers);
  document.getElementById('filterStatus').addEventListener('change', renderMembers);
  document.getElementById('filterRang').addEventListener('change', renderMembers);
  document.getElementById('submitTestBtn').addEventListener('click', submitTest);
  document.getElementById('btnAddMember').addEventListener('click', () => openMemberModal());
  document.getElementById('btnNewMember').addEventListener('click', () => { showSection('members'); openMemberModal(); });
  document.getElementById('memberForm').addEventListener('submit', saveMember);
  document.getElementById('sSubmit').addEventListener('click', saveSanktion);
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => document.getElementById(b.dataset.close).classList.add('hidden')));
});

function showSection(id) {
  document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  document.querySelector(`.nav-item[data-section="${id}"]`)?.classList.add('active');
  const titles = { overview: 'Übersicht', members: 'Mitglieder', sanktionen: 'Sanktionskatalog', test: 'Einstellungstest', 'tests-history': 'Test-Historie' };
  document.getElementById('pageTitle').textContent = titles[id] || 'Dashboard';
  document.getElementById('sidebar').classList.remove('open');
  if (id === 'members') refreshMembers();
  if (id === 'tests-history') loadHistory();
}

async function refreshMembers() {
  const data = await api('/api/members');
  members = data.members || [];
  document.getElementById('statMembers').textContent = members.length;
  document.getElementById('statActive').textContent = members.filter(m => m.status === 'Eingestellt' || m.status === 'Probezeit').length;
  document.getElementById('statSusp').textContent = members.filter(m => m.status === 'Suspendiert').length;
  renderMembers();
}

function renderMembers() {
  const q = (document.getElementById('searchMember')?.value || '').toLowerCase();
  const st = document.getElementById('filterStatus')?.value || 'all';
  const rg = document.getElementById('filterRang')?.value || 'all';
  const list = document.getElementById('membersList');
  let filtered = members.filter(m => {
    const text = `${m.vorname} ${m.nachname} ${m.telefon} ${m.discordId} ${m.discordName}`.toLowerCase();
    return text.includes(q) && (st === 'all' || m.status === st) && (rg === 'all' || m.rang === rg);
  });
  filtered.sort((a, b) => {
    const ri = rankIndex(a.rang) - rankIndex(b.rang);
    if (ri !== 0) return ri;
    return `${a.nachname} ${a.vorname}`.localeCompare(`${b.nachname} ${b.vorname}`, 'de');
  });
  if (!filtered.length) { list.innerHTML = '<p class="muted">Keine Mitglieder gefunden.</p>'; return; }

  let html = '', lastRank = null;
  for (const m of filtered) {
    if (m.rang !== lastRank) {
      html += `<div class="rank-group-header"><i class="fas fa-chevron-right" style="font-size:9px;opacity:.6"></i> ${esc(m.rang)}</div>`;
      lastRank = m.rang;
    }
    const sankCount = (m.sanktionen || []).length;
    const statusClass = m.status === 'Eingestellt' ? 'st-ok' : m.status === 'Probezeit' ? 'st-probe' : m.status === 'Suspendiert' ? 'st-susp' : 'st-fire';
    html += `<div class="member-card">
      <div class="member-main" onclick="showMemberDetail('${m.id}')">
        <div class="member-avatar">${esc((m.vorname||'?')[0])}${esc((m.nachname||'?')[0])}</div>
        <div class="member-info">
          <h4>${esc(m.vorname)} ${esc(m.nachname)}</h4>
          <p><span class="rang-badge">${esc(m.rang)}</span> <span class="status-badge ${statusClass}">${esc(m.status)}</span></p>
          <p class="member-meta">${m.telefon ? '📞 ' + esc(m.telefon) : ''} ${m.discordId ? '· ID: ' + esc(m.discordId) : ''} ${sankCount ? '· ⚠ ' + sankCount + ' Sanktion(en)' : ''}</p>
        </div>
      </div>
      <div class="member-actions">
        <button class="btn-sm" onclick="event.stopPropagation();openMemberModal('${m.id}')" title="Bearbeiten"><i class="fas fa-edit"></i></button>
        <button class="btn-sm" onclick="event.stopPropagation();openSanktionModal('${m.id}')" title="Sanktion"><i class="fas fa-gavel"></i></button>
        <button class="btn-sm" onclick="event.stopPropagation();deleteMember('${m.id}')" title="Löschen"><i class="fas fa-trash"></i></button>
      </div>
    </div>`;
  }
  list.innerHTML = html;
}

function showMemberDetail(id) {
  const m = members.find(x => x.id === id);
  if (!m) return;
  const sank = (m.sanktionen || []).map(s => `
    <div class="detail-frage">
      <span class="tag-falsch">${esc(s.verstoß)}</span>
      <span>${esc(s.strafe)} · ${esc(s.datum)} · von ${esc(s.von)}${s.grund ? ' · ' + esc(s.grund) : ''}
        <button class="btn-sm" style="margin-left:8px" onclick="deleteSanktion('${m.id}','${s.id}')">×</button>
      </span>
    </div>`).join('') || '<p class="muted">Keine Sanktionen</p>';
  document.getElementById('detailBody').innerHTML = `
    <h2>${esc(m.vorname)} ${esc(m.nachname)}</h2>
    <div class="detail-row"><span>Rang:</span> <strong>${esc(m.rang)}</strong></div>
    <div class="detail-row"><span>Status:</span> <strong>${esc(m.status)}</strong></div>
    <div class="detail-row"><span>Telefon:</span> ${esc(m.telefon || '–')}</div>
    <div class="detail-row"><span>Discord:</span> ${esc(m.discordName || '–')} ${m.discordId ? '(' + esc(m.discordId) + ')' : ''}</div>
    <div class="detail-row"><span>Eingestellt am:</span> ${esc(m.eingestelltAm || '–')} ${m.eingestelltVon ? 'von ' + esc(m.eingestelltVon) : ''}</div>
    ${m.notizen ? `<div class="detail-row"><span>Notizen:</span> ${esc(m.notizen)}</div>` : ''}
    <h3 style="margin:16px 0 8px;font-size:15px">Sanktionen (${(m.sanktionen||[]).length})</h3>
    <div class="detail-fragen">${sank}</div>
    <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="primary-btn" style="width:auto" onclick="document.getElementById('detailModal').classList.add('hidden');openMemberModal('${m.id}')"><i class="fas fa-edit"></i> Bearbeiten</button>
      <button class="primary-btn" style="width:auto;background:var(--red);color:#fff" onclick="document.getElementById('detailModal').classList.add('hidden');openSanktionModal('${m.id}')"><i class="fas fa-gavel"></i> Sanktion</button>
    </div>`;
  document.getElementById('detailModal').classList.remove('hidden');
}

function openMemberModal(id) {
  document.getElementById('memberModalTitle').textContent = id ? 'Mitglied bearbeiten' : 'Mitglied einstellen';
  document.getElementById('mId').value = id || '';
  if (id) {
    const m = members.find(x => x.id === id);
    if (!m) return;
    document.getElementById('mVorname').value = m.vorname || '';
    document.getElementById('mNachname').value = m.nachname || '';
    document.getElementById('mTelefon').value = m.telefon || '';
    document.getElementById('mStatus').value = m.status || 'Probezeit';
    document.getElementById('mRang').value = m.rang || (config.raenge || []).slice(-1)[0] || 'Prospect';
    document.getElementById('mDatum').value = m.eingestelltAm || '';
    document.getElementById('mDiscordName').value = m.discordName || '';
    document.getElementById('mDiscordId').value = m.discordId || '';
    document.getElementById('mNotizen').value = m.notizen || '';
  } else {
    document.getElementById('memberForm').reset();
    document.getElementById('mId').value = '';
    document.getElementById('mDatum').value = new Date().toISOString().slice(0, 10);
    document.getElementById('mStatus').value = 'Probezeit';
    const ranks = config.raenge || [];
    document.getElementById('mRang').value = ranks[ranks.length - 1] || 'Recruit';
  }
  document.getElementById('memberModal').classList.remove('hidden');
}

async function saveMember(e) {
  e.preventDefault();
  const id = document.getElementById('mId').value;
  const body = {
    vorname: document.getElementById('mVorname').value.trim(),
    nachname: document.getElementById('mNachname').value.trim(),
    telefon: document.getElementById('mTelefon').value.trim(),
    status: document.getElementById('mStatus').value,
    rang: document.getElementById('mRang').value,
    eingestelltAm: document.getElementById('mDatum').value,
    discordName: document.getElementById('mDiscordName').value.trim(),
    discordId: document.getElementById('mDiscordId').value.trim(),
    notizen: document.getElementById('mNotizen').value.trim()
  };
  if (id) await api('/api/members/' + id, { method: 'PUT', body: JSON.stringify(body) });
  else await api('/api/members', { method: 'POST', body: JSON.stringify(body) });
  document.getElementById('memberModal').classList.add('hidden');
  await refreshMembers();
}

async function deleteMember(id) {
  if (!confirm('Mitglied wirklich löschen?')) return;
  await api('/api/members/' + id, { method: 'DELETE' });
  await refreshMembers();
}

function openSanktionModal(memberId) {
  document.getElementById('sMemberId').value = memberId;
  document.getElementById('sDatum').value = new Date().toISOString().slice(0, 10);
  const sV = document.getElementById('sVerstoss');
  if (sV.options.length) document.getElementById('sStrafe').value = sV.selectedOptions[0]?.dataset.strafe || '';
  document.getElementById('sGrund').value = '';
  document.getElementById('sanktionModal').classList.remove('hidden');
}

async function saveSanktion() {
  const mid = document.getElementById('sMemberId').value;
  await api('/api/members/' + mid + '/sanktion', {
    method: 'POST',
    body: JSON.stringify({
      verstoß: document.getElementById('sVerstoss').value,
      strafe: document.getElementById('sStrafe').value,
      grund: document.getElementById('sGrund').value,
      datum: document.getElementById('sDatum').value
    })
  });
  document.getElementById('sanktionModal').classList.add('hidden');
  await refreshMembers();
  showMemberDetail(mid);
}

async function deleteSanktion(mid, sid) {
  if (!confirm('Sanktion entfernen?')) return;
  await api(`/api/members/${mid}/sanktion/${sid}`, { method: 'DELETE' });
  await refreshMembers();
  showMemberDetail(mid);
}

function renderSanktionen(data) {
  const tbody = document.querySelector('#sanktionTable tbody');
  const labels = { aktivitaet: 'Aktivität', verhalten: 'Verhalten', sicherheit: 'Sicherheit', rp: 'RP' };
  tbody.innerHTML = (data || []).map(item => {
    const severe = /kündigung|blacklist|rang-abzug/i.test(item.dritt);
    return `<tr>
      <td><strong>${esc(item.verstoß)}</strong></td>
      <td><span class="badge ${item.kategorie}">${labels[item.kategorie] || item.kategorie}</span></td>
      <td class="penalty">${esc(item.erst)}</td>
      <td class="penalty">${esc(item.zweit)}</td>
      <td class="penalty ${severe ? 'severe' : ''}">${esc(item.dritt)}</td>
    </tr>`;
  }).join('');
}

function filterSanktionen() {
  if (!config) return;
  const search = document.getElementById('searchSanktion').value.toLowerCase();
  const kat = document.getElementById('filterKategorie').value;
  renderSanktionen(config.sanktionen.filter(i => i.verstoß.toLowerCase().includes(search) && (kat === 'all' || i.kategorie === kat)));
}

function renderFragen(fragen) {
  answers = {};
  const list = document.getElementById('fragenList');
  document.getElementById('liveGesamt').textContent = fragen.length;
  list.innerHTML = fragen.map(f => `
    <div class="frage-card" data-id="${f.id}">
      <div class="frage-header"><span class="frage-nr">#${f.id}</span><span class="frage-text">${esc(f.frage)}</span></div>
      ${f.hinweis ? `<div class="frage-hinweis">Prüfer-Hinweis: ${esc(f.hinweis)}</div>` : ''}
      <div class="frage-actions">
        <button type="button" class="btn-richtig" data-id="${f.id}" data-val="true"><i class="fas fa-check"></i> Richtig</button>
        <button type="button" class="btn-falsch" data-id="${f.id}" data-val="false"><i class="fas fa-times"></i> Falsch</button>
      </div>
    </div>`).join('');
  list.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id, val = btn.dataset.val === 'true';
      answers[id] = val;
      const card = list.querySelector(`.frage-card[data-id="${id}"]`);
      card.classList.remove('richtig', 'falsch');
      card.classList.add(val ? 'richtig' : 'falsch');
      card.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateLiveScore(fragen.length);
    });
  });
  updateLiveScore(fragen.length);
}

function updateLiveScore(gesamt) {
  const bewertete = Object.keys(answers).length;
  const richtig = Object.values(answers).filter(v => v === true).length;
  document.getElementById('liveBewertet').textContent = bewertete;
  document.getElementById('liveRichtig').textContent = richtig;
  document.getElementById('liveProzent').textContent = (gesamt ? Math.round((richtig / gesamt) * 100) : 0) + '%';
}

async function submitTest() {
  if (!Object.keys(answers).length) { alert('Mindestens eine Frage bewerten.'); return; }
  const btn = document.getElementById('submitTestBtn');
  btn.disabled = true;
  try {
    const result = await api('/api/tests', { method: 'POST', body: JSON.stringify({ answers }) });
    const t = result.test;
    alert(t.bestanden ? `BESTANDEN (${t.prozent}%) – jetzt unter Mitglieder einstellen.` : `Nicht bestanden (${t.prozent}%).`);
    renderFragen(config.einstellungstest.fragen);
    await loadHistory();
    if (t.bestanden) showSection('members');
    else showSection('tests-history');
  } finally { btn.disabled = false; }
}

async function loadHistory() {
  const data = await api('/api/tests');
  tests = data.tests || [];
  document.getElementById('statTests').textContent = tests.length;
  const list = document.getElementById('historyList');
  if (!tests.length) { list.innerHTML = '<p class="muted">Noch keine Tests.</p>'; return; }
  list.innerHTML = tests.map(t => {
    const date = new Date(t.datum).toLocaleString('de-DE');
    return `<div class="history-card">
      <div class="history-status ${t.bestanden ? 'pass' : 'fail'}">${t.prozent}%</div>
      <div class="history-info">
        <h4>${t.bestanden ? 'Bestanden' : 'Nicht bestanden'}</h4>
        <p>${t.richtig}/${t.gesamt} · ${esc(t.geprueftVon)} · ${date}</p>
      </div>
      <button class="btn-sm" onclick="deleteTest('${t.id}')"><i class="fas fa-trash"></i></button>
    </div>`;
  }).join('');
}

async function deleteTest(id) {
  if (!confirm('Löschen?')) return;
  await api('/api/tests/' + id, { method: 'DELETE' });
  loadHistory();
}
