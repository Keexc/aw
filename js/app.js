// Point this at your deployed backend (e.g. Render URL) before going live.
const API_BASE = window.KEA_API_BASE || 'http://localhost:4000/api';

const categoryList = document.getElementById('categoryList');
const nomineeSection = document.getElementById('nominees');
const categoriesSection = document.getElementById('categories');
const nomineeList = document.getElementById('nomineeList');
const nomineeCategoryTitle = document.getElementById('nomineeCategoryTitle');
const resultsList = document.getElementById('resultsList');

let selectedNomineeId = null;
let currentTransactionId = null;
let pollTimer = null;

// Wraps fetch with a timeout so a slow/cold-starting backend doesn't leave
// the UI frozen with no feedback. Aborts the request after timeoutMs and
// throws a standard AbortError, which callers can check via err.name.
async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function loadCategories() {
  try {
    const res = await fetch(`${API_BASE}/categories`);
    const categories = await res.json();

    if (!categories.length) {
      categoryList.innerHTML = '<p class="muted">No categories open for voting yet.</p>';
      return;
    }

    const sections = {};
    categories.forEach(cat => {
      const key = cat.section || 'other';
      if (!sections[key]) sections[key] = [];
      sections[key].push(cat);
    });

    const sectionLabel = key => key.charAt(0).toUpperCase() + key.slice(1);

    categoryList.innerHTML = Object.entries(sections).map(([section, cats]) => `
      <div class="section-group">
        <h3 class="section-heading">${sectionLabel(section)}</h3>
        <div class="category-grid">
          ${cats.map(cat => `
            <div class="category-card" data-id="${cat.id}" data-name="${cat.name}" data-section="${cat.section}">
              <h3>${cat.name}</h3>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');

    categoryList.querySelectorAll('.category-card').forEach(card => {
      card.addEventListener('click', () => openCategory(card.dataset.id, card.dataset.name, card.dataset.section));
    });
  } catch (err) {
    categoryList.innerHTML = '<p class="muted">Could not load categories. Please refresh.</p>';
  }
}

async function openCategory(categoryId, categoryName, section) {
  categoriesSection.classList.add('hidden');
  nomineeSection.classList.remove('hidden');
  nomineeCategoryTitle.textContent = categoryName;
  nomineeList.innerHTML = '<p class="muted">Loading nominees…</p>';

  const prizeBox = document.getElementById('prizeInfo');
  if (section !== 'politics') {
    prizeBox.innerHTML = `
      <p><strong>Pos. 1</strong> — KSh 50,000 &nbsp;·&nbsp; <strong>Pos. 2</strong> — KSh 10,000</p>
      <p>Any nominee with more than 4,000 votes wins KSh 100,000</p>
    `;
    prizeBox.classList.remove('hidden');
  } else {
    prizeBox.innerHTML = '';
    prizeBox.classList.add('hidden');
  }

  const res = await fetch(`${API_BASE}/categories/${categoryId}/nominees`);
  const nominees = await res.json();

  nomineeList.innerHTML = nominees.map(n => `
    <div class="nominee-card">
      <img class="nominee-photo" src="${n.photo_url || 'https://placehold.co/400x300?text=Photo'}" alt="${n.full_name}" />
      <div class="nominee-body">
        <h4>${n.full_name}</h4>
        <p class="nominee-org">${n.organization || ''}${n.organization && n.county ? ' · ' : ''}${n.county || ''}</p>
        <p class="vote-count-line">${n.vote_count} vote${n.vote_count === 1 ? '' : 's'} so far</p>
        <button class="btn btn-primary btn-block" data-id="${n.id}" data-name="${n.full_name}">Vote for ${n.full_name.split(' ')[0]}</button>
      </div>
    </div>
  `).join('');

  nomineeList.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => openVoteModal(btn.dataset.id, btn.dataset.name));
  });
}

document.getElementById('backToCategories').addEventListener('click', () => {
  nomineeSection.classList.add('hidden');
  categoriesSection.classList.remove('hidden');
});

// ---- Vote modal ----
const voteModal = document.getElementById('voteModal');
const voteModalName = document.getElementById('voteModalName');
const voteCountInput = document.getElementById('voteCount');
const voteTotal = document.getElementById('voteTotal');
const votePhone = document.getElementById('votePhone');
const voteStatus = document.getElementById('voteStatus');
const submitVoteBtn = document.getElementById('submitVote');
const submitVoteBtnLabel = submitVoteBtn.textContent;
const VOTE_PRICE = 20;

function setButtonLoading(isLoading, label) {
  submitVoteBtn.disabled = isLoading;
  submitVoteBtn.classList.toggle('btn-loading', isLoading);
  submitVoteBtn.textContent = isLoading ? (label || 'Sending…') : submitVoteBtnLabel;
}

function openVoteModal(nomineeId, name) {
  selectedNomineeId = nomineeId;
  voteModalName.textContent = `Vote for ${name}`;
  voteCountInput.value = 1;
  votePhone.value = '';
  voteStatus.textContent = '';
  voteStatus.className = 'vote-status';
  setButtonLoading(false);
  updateTotal();
  voteModal.classList.remove('hidden');
}

function updateTotal() {
  const count = Math.max(1, parseInt(voteCountInput.value, 10) || 1);
  voteTotal.textContent = `KSh ${count * VOTE_PRICE}`;
}
voteCountInput.addEventListener('input', updateTotal);

document.getElementById('closeModal').addEventListener('click', () => {
  clearInterval(pollTimer);
  voteModal.classList.add('hidden');
});

submitVoteBtn.addEventListener('click', async () => {
  const votes = Math.max(1, parseInt(voteCountInput.value, 10) || 1);
  const phone = votePhone.value.trim();

  if (!/^0(7|1)\d{8}$/.test(phone) && !/^254(7|1)\d{8}$/.test(phone)) {
    setStatus('Enter a valid Safaricom number, e.g. 07XXXXXXXX', 'error');
    return;
  }

  setButtonLoading(true, 'Sending prompt…');
  setStatus('Sending M-Pesa prompt to your phone…', '');

  try {
    // The backend now responds as soon as the transaction is recorded and
    // sends the STK push in the background, so this should return quickly.
    // The 12s timeout here only guards against a cold-starting/unreachable
    // backend, not against the M-Pesa prompt itself (that's handled by polling).
    const res = await fetchWithTimeout(`${API_BASE}/payments/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nomineeId: selectedNomineeId, phone, votes })
    }, 12000);
    const data = await res.json();

    if (!res.ok) {
      setStatus(data.error || 'Something went wrong. Please try again.', 'error');
      setButtonLoading(false);
      return;
    }

    currentTransactionId = data.transactionId;
    setButtonLoading(true, 'Waiting for payment…');
    setStatus('Check your phone and enter your M-Pesa PIN to complete the vote.', '');
    pollPaymentStatus();
  } catch (err) {
    if (err.name === 'AbortError') {
      setStatus('Server is taking a while to respond (it may be waking up). Please try again in a few seconds.', 'error');
    } else {
      setStatus('Network error. Please try again.', 'error');
    }
    setButtonLoading(false);
  }
});

function pollPaymentStatus() {
  let attempts = 0;
  pollTimer = setInterval(async () => {
    attempts += 1;
    if (attempts > 10) { // ~30s timeout
      clearInterval(pollTimer);
      setStatus('Still waiting on confirmation. If you completed payment, your vote will be credited shortly.', '');
      setButtonLoading(false);
      return;
    }

    try {
      const res = await fetchWithTimeout(`${API_BASE}/payments/status/${currentTransactionId}`, {}, 8000);
      const data = await res.json();

      if (data.status === 'success') {
        clearInterval(pollTimer);
        setStatus(`Thank you! ${data.votes_requested} vote(s) recorded.`, 'success');
        setButtonLoading(false);
        loadResults();
      } else if (data.status === 'failed') {
        clearInterval(pollTimer);
        setStatus('Payment was not completed. No votes were recorded.', 'error');
        setButtonLoading(false);
      }
    } catch (err) {
      // A single slow/aborted poll isn't fatal — just let the next tick retry.
    }
  }, 3000);
}

function setStatus(msg, type) {
  voteStatus.textContent = msg;
  voteStatus.className = `vote-status ${type}`;
}

// ---- Public results ----
async function loadResults() {
  const res = await fetch(`${API_BASE}/results`);
  const results = await res.json();

  if (!results.length) {
    resultsList.innerHTML = '<p class="muted">No results yet.</p>';
    return;
  }

  resultsList.innerHTML = results.map(r => `
    <div class="result-category">
      <h3>${r.category.name}</h3>
      <p class="result-total">${r.total_votes} total vote${r.total_votes === 1 ? '' : 's'}</p>
      ${r.nominees.map(n => `
        <div class="result-row">
          <span class="result-name">${n.full_name}</span>
          <span class="result-bar-track"><span class="result-bar-fill" style="width:${n.percentage}%"></span></span>
          <span class="result-pct">${n.percentage}%</span>
        </div>
      `).join('')}
    </div>
  `).join('');
}

loadCategories();
loadResults();
setInterval(loadResults, 15000); // keep the public leaderboard fresh
