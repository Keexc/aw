const API_BASE = window.TCA_API_BASE || 'http://localhost:4000/api';
let token = localStorage.getItem('kea_admin_token') || null;
let categoriesCache = [];

const loginScreen = document.getElementById('loginScreen');
const dashboard = document.getElementById('dashboard');

function authHeaders() {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) }
  });
  if (res.status === 401) { logout(); throw new Error('Session expired'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---- Auth ----
document.getElementById('loginBtn').addEventListener('click', async () => {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';

  try {
    const res = await fetch(`${API_BASE}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');

    token = data.token;
    localStorage.setItem('kea_admin_token', token);
    showDashboard();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('logoutBtn').addEventListener('click', logout);
function logout() {
  token = null;
  localStorage.removeItem('kea_admin_token');
  dashboard.classList.add('hidden');
  loginScreen.classList.remove('hidden');
}

function showDashboard() {
  loginScreen.classList.add('hidden');
  dashboard.classList.remove('hidden');
  loadAnalytics();
  loadCategories();
  loadNominees();
  loadTransactions();
  loadNominations();
}

if (token) showDashboard();

// ---- Analytics ----
async function loadAnalytics() {
  try {
    const stats = await api('/admin/analytics');
    document.getElementById('statsRow').innerHTML = `
      ${statCard('Total votes', stats.total_votes)}
      ${statCard('Votes today', stats.votes_today)}
      ${statCard('Revenue', `KSh ${stats.revenue_collected}`)}
      ${statCard('Payment success rate', `${stats.payment_success_rate_pct}%`)}
      ${statCard('Top nominee', stats.most_voted_nominee?.full_name || '—')}
    `;
  } catch (err) { /* session may have expired; login screen already shown */ }
}
function statCard(label, value) {
  return `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`;
}

// ---- Categories ----
async function loadCategories() {
  const data = await api('/categories').catch(() => []);
  categoriesCache = data;
  const table = document.getElementById('categoryTable');
  table.innerHTML = `
    <tr><th>Name</th><th>Section</th><th>Voting open</th><th>Countdown ends</th><th></th></tr>
    ${data.map(c => `
      <tr>
        <td>${c.name}</td>
        <td>${c.section}</td>
        <td>${c.is_active ? 'Open' : 'Closed'}</td>
        <td>${c.voting_ends_at ? new Date(c.voting_ends_at).toLocaleString() : '—'}</td>
        <td class="row-actions">
          <button onclick="toggleVoting('${c.id}', ${!c.is_active})">${c.is_active ? 'Close voting' : 'Open voting'}</button>
          <button onclick="setCountdownPrompt('${c.id}', '${c.name.replace(/'/g, "\\'")}')">Set countdown</button>
          <button class="danger" onclick="deleteCategory('${c.id}')">Delete</button>
        </td>
      </tr>
    `).join('')}
  `;
}

window.setCountdownPrompt = (categoryId, name) => {
  openFormModal(`Set countdown — ${name}`, `
    <label class="field"><span>Voting ends at</span><input id="f_countdown" type="datetime-local" /></label>
  `, async () => {
    const value = document.getElementById('f_countdown').value;
    await api(`/admin/categories/${categoryId}`, {
      method: 'PATCH',
      body: JSON.stringify({ voting_ends_at: value ? new Date(value).toISOString() : null })
    });
    loadCategories();
  });
};

window.toggleVoting = async (id, newState) => {
  await api(`/admin/categories/${id}/toggle-voting`, { method: 'PATCH', body: JSON.stringify({ is_active: newState }) });
  loadCategories();
};
window.deleteCategory = async (id) => {
  if (!confirm('Delete this category and all its nominees?')) return;
  await api(`/admin/categories/${id}`, { method: 'DELETE' });
  loadCategories();
  loadNominees();
};

document.getElementById('newCategoryBtn').addEventListener('click', () => {
  openFormModal('New category', `
    <label class="field"><span>Section</span>
      <select id="f_section">
        <option value="entertainment">Entertainment</option>
        <option value="politics">Politics</option>
      </select>
    </label>
    <label class="field"><span>Category name</span><input id="f_name" placeholder="e.g. Best Radio Presenter" /></label>
    <label class="field"><span>Display order</span><input id="f_order" type="number" value="0" /></label>
    <label class="field"><span>Voting ends at (optional)</span><input id="f_countdown_new" type="datetime-local" /></label>
  `, async () => {
    const countdownValue = document.getElementById('f_countdown_new').value;
    await api('/admin/categories', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('f_name').value,
        section: document.getElementById('f_section').value,
        display_order: Number(document.getElementById('f_order').value),
        voting_ends_at: countdownValue ? new Date(countdownValue).toISOString() : null
      })
    });
    loadCategories();
  });
});

// ---- Nominees ----
async function loadNominees() {
  const all = await api('/admin/nominees-overview').catch(() => []);
  const table = document.getElementById('nomineeTable');
  table.innerHTML = `
    <tr><th>Name</th><th>Category</th><th>Votes</th><th></th></tr>
    ${all.map(n => `
      <tr>
        <td>${n.full_name}</td>
        <td>${n.categoryName}</td>
        <td>${n.vote_count}</td>
        <td class="row-actions">
          <button onclick="addVotesPrompt('${n.id}', '${n.full_name.replace(/'/g, "\\'")}')">Add votes</button>
          <button onclick="deductVotesPrompt('${n.id}', '${n.full_name.replace(/'/g, "\\'")}')">Deduct votes</button>
          <button class="danger" onclick="deleteNominee('${n.id}')">Delete</button>
        </td>
      </tr>
    `).join('')}
  `;
}
window.deleteNominee = async (id) => {
  if (!confirm('Delete this nominee?')) return;
  await api(`/admin/nominees/${id}`, { method: 'DELETE' });
  loadNominees();
};

window.addVotesPrompt = (nomineeId, name) => {
  openFormModal(`Add votes — ${name}`, `
    <label class="field"><span>Number of votes</span><input id="f_votecount" type="number" min="1" value="1" /></label>
    <label class="field"><span>Note (optional)</span><input id="f_votenote" placeholder="e.g. sponsor bonus, corrected missed payment" /></label>
  `, async () => {
    await api(`/admin/nominees/${nomineeId}/votes`, {
      method: 'POST',
      body: JSON.stringify({
        count: Number(document.getElementById('f_votecount').value),
        note: document.getElementById('f_votenote').value
      })
    });
    loadNominees();
    loadAnalytics();
  });
};

window.deductVotesPrompt = (nomineeId, name) => {
  openFormModal(`Deduct votes — ${name}`, `
    <label class="field"><span>Number of votes to remove</span><input id="f_deductcount" type="number" min="1" value="1" /></label>
    <label class="field"><span>Reason (optional)</span><input id="f_deductnote" placeholder="e.g. credited without payment" /></label>
  `, async () => {
    await api(`/admin/nominees/${nomineeId}/votes/deduct`, {
      method: 'POST',
      body: JSON.stringify({
        count: Number(document.getElementById('f_deductcount').value),
        note: document.getElementById('f_deductnote').value
      })
    });
    loadNominees();
    loadAnalytics();
  });
};

document.getElementById('newNomineeBtn').addEventListener('click', () => {
  const sections = [...new Set(categoriesCache.map(c => c.section))];
  const options = sections.map(section => `
    <optgroup label="${section.charAt(0).toUpperCase() + section.slice(1)}">
      ${categoriesCache.filter(c => c.section === section).map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
    </optgroup>
  `).join('');
  openFormModal('New nominee', `
    <label class="field"><span>Category</span><select id="f_cat">${options}</select></label>
    <label class="field"><span>Full name</span><input id="f_fullname" /></label>
    <label class="field"><span>Organization</span><input id="f_org" /></label>
    <label class="field"><span>County</span><input id="f_county" /></label>
    <label class="field"><span>Photo URL</span><input id="f_photo" /></label>
  `, async () => {
    await api('/admin/nominees', {
      method: 'POST',
      body: JSON.stringify({
        category_id: document.getElementById('f_cat').value,
        full_name: document.getElementById('f_fullname').value,
        organization: document.getElementById('f_org').value,
        county: document.getElementById('f_county').value,
        photo_url: document.getElementById('f_photo').value
      })
    });
    loadNominees();
  });
});

// ---- Transactions ----
async function loadTransactions() {
  const data = await api('/admin/transactions').catch(() => []);
  const table = document.getElementById('transactionTable');
  table.innerHTML = `
    <tr><th>Phone</th><th>Votes</th><th>Amount</th><th>Status</th><th>Receipt</th><th>Date</th></tr>
    ${data.slice(0, 100).map(t => `
      <tr>
        <td>${t.phone_number}</td>
        <td>${t.votes_requested}</td>
        <td>KSh ${t.amount}</td>
        <td>${t.status}</td>
        <td>${t.mpesa_receipt || '—'}</td>
        <td>${new Date(t.created_at).toLocaleString()}</td>
      </tr>
    `).join('')}
  `;
}
document.getElementById('exportCsv').addEventListener('click', (e) => {
  e.preventDefault();
  fetch(`${API_BASE}/admin/export/csv`, { headers: authHeaders() })
    .then(res => res.blob())
    .then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'tca-votes-export.csv';
      a.click();
    });
});

// ---- Shared modal form helper ----
const formModal = document.getElementById('formModal');
document.getElementById('closeFormModal').addEventListener('click', () => formModal.classList.add('hidden'));

function openFormModal(title, bodyHtml, onSubmit) {
  document.getElementById('formModalTitle').textContent = title;
  document.getElementById('formModalBody').innerHTML = bodyHtml;
  document.getElementById('formModalStatus').textContent = '';
  formModal.classList.remove('hidden');

  const submitBtn = document.getElementById('formModalSubmit');
  const newBtn = submitBtn.cloneNode(true); // clear old listeners
  submitBtn.replaceWith(newBtn);
  newBtn.addEventListener('click', async () => {
    try {
      await onSubmit();
      formModal.classList.add('hidden');
    } catch (err) {
      document.getElementById('formModalStatus').textContent = err.message;
      document.getElementById('formModalStatus').className = 'vote-status error';
    }
  });
}

// ---- Nomination applications ----
async function loadNominations() {
  const data = await api('/admin/nominations?status=pending').catch(() => []);
  const table = document.getElementById('nominationTable');

  if (!data.length) {
    table.innerHTML = '<tr><td class="muted">No pending applications.</td></tr>';
    return;
  }

  table.innerHTML = `
    <tr><th>Name</th><th>Category</th><th>Email</th><th>M-Pesa Phone</th><th>WhatsApp</th><th>Applied</th><th></th></tr>
    ${data.map(a => `
      <tr>
        <td>${a.full_name}</td>
        <td>${a.categoryName}</td>
        <td>${a.email || '—'}</td>
        <td>${a.phone_number}</td>
        <td>${a.whatsapp_number || '—'}</td>
        <td>${new Date(a.created_at).toLocaleString()}</td>
        <td class="row-actions">
          <button onclick="acceptNomination('${a.id}')">Accept</button>
          <button class="danger" onclick="rejectNomination('${a.id}')">Reject</button>
        </td>
      </tr>
    `).join('')}
  `;
}

window.acceptNomination = async (id) => {
  if (!confirm('Accept this application and add them as a nominee?')) return;
  await api(`/admin/nominations/${id}/accept`, { method: 'POST' });
  loadNominations();
  loadNominees();
};

window.rejectNomination = async (id) => {
  if (!confirm('Reject this application?')) return;
  await api(`/admin/nominations/${id}/reject`, { method: 'POST' });
  loadNominations();
};
