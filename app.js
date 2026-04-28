/*
  app.js - Fast Facts Simulator logic

  Overview:
  - Loads a local `data.json` file organized as { category: { LETTER: [words...] } }
  - Controls round lifecycle: pick category -> pick letter -> pick a canonical answer -> start timer
  - Validates user input against all words for the displayed category+letter
  - Provides progressive hints based on the canonical answer (prefix reveals)

  This file is intentionally verbose with comments and JSDoc so beginners can follow along.
*/

// ----------------------------- Helper utilities -----------------------------

/**
 * Normalize an answer string for comparison:
 * - lowercase, trim, remove punctuation, collapse spaces
 * @param {string} s
 * @returns {string}
 */
function normalize(s){
  return (s || "")
    .toLowerCase()
    .normalize('NFKD') // decompose diacritics if present
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/[^a-z0-9\s]/g, '') // remove punctuation
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim();
}

/**
 * Pick a random element from an array
 * @template T
 * @param {T[]} arr
 * @returns {T}
 */
function rand(arr){
  return arr[Math.floor(Math.random()*arr.length)];
}

// ----------------------------- App state -----------------------------
const state = {
  data: null, // loaded JSON data
  categories: [], // category names
  current: {
    category: null,
    letter: null,
    canonical: null, // canonical answer for hint progression
    validList: [], // all valid words for this category+letter
    hintIndex: 0, // how many characters revealed (prefix length)
    hintCap: 0, // maximum prefix length allowed by mode
    timerMs: 0, // current timer in seconds
    timerId: null, // interval id
    timeLeft: 0, // seconds remaining
    nextTimeout: null // id for scheduled auto-next after correct
  }
};

// ----------------------------- DOM references -----------------------------
const refs = {
  // optional native selects (kept for fallback)
  categorySelect: document.getElementById('categorySelect'),
  timerSelect: document.getElementById('timerSelect'),
  modeSelect: document.getElementById('modeSelect'),
  // primary controls
  startBtn: document.getElementById('startBtn'),
  categoryToggle: document.getElementById('categoryToggle'),
  categoryMenu: document.getElementById('categoryMenu'),
  categoryList: document.getElementById('categoryList'),
  timerToggle: document.getElementById('timerToggle'),
  timerMenu: document.getElementById('timerMenu'),
  timerList: document.getElementById('timerList'),
  modeToggle: document.getElementById('modeToggle'),
  modeMenu: document.getElementById('modeMenu'),
  modeList: document.getElementById('modeList'),
  // displays / inputs
  categoryDisplay: document.getElementById('categoryDisplay'),
  timeText: document.getElementById('timeText'),
  timePct: document.getElementById('timePct'),
  progressBar: document.getElementById('progressBar'),
  answerInput: document.getElementById('answerInput'),
  hintBtn: document.getElementById('hintBtn'),
  revealBtn: document.getElementById('revealBtn'),
  feedback: document.getElementById('feedback'),
  letterDisplay: document.getElementById('letterDisplay'),
  exampleAnswer: document.getElementById('exampleAnswer'),
  exampleArea: document.getElementById('exampleArea')
};

// Theme toggle element (added to header)
refs.themeToggle = document.getElementById('themeToggle');

/**
 * Populate custom timer and mode dropdowns (if present).
 */
function populateControls(){
  // timers
  const timers = [10,20,30,40,50,60];
  if(refs.timerList){
    refs.timerList.innerHTML = '';
    timers.forEach((t, idx)=>{
      const li = document.createElement('li');
      li.textContent = `${t}s`;
      li.dataset.value = String(t);
      if(t===30) li.classList.add('selected');
      refs.timerList.appendChild(li);
    });
    if(refs.timerToggle){ refs.timerToggle.dataset.value = '30'; refs.timerToggle.textContent = '30s ▾'; }
  }

  // modes
  const modes = [{v:'easy',label:'Easy'},{v:'medium',label:'Medium'},{v:'hard',label:'Hard'}];
  if(refs.modeList){
    refs.modeList.innerHTML = '';
    modes.forEach((m, idx)=>{
      const li = document.createElement('li');
      li.textContent = m.label;
      li.dataset.value = m.v;
      if(m.v==='easy') li.classList.add('selected');
      refs.modeList.appendChild(li);
    });
    if(refs.modeToggle){ refs.modeToggle.dataset.value = 'easy'; refs.modeToggle.textContent = 'Mode: Easy ▾'; }
  }
}

// ----------------------------- Data loading -----------------------------
/**
 * Load the local data.json and build a categories list.
 */
async function loadData(){
  try{
    const res = await fetch('./data.json');
    if(!res.ok) throw new Error('Could not load data.json: '+res.status);
    const data = await res.json();
    state.data = data;
    state.categories = Object.keys(data).filter(cat => {
      // ensure category has at least one letter with a non-empty list
      const letters = Object.keys(data[cat] || {});
      return letters.some(L => Array.isArray(data[cat][L]) && data[cat][L].length>0);
    }).sort();
    populateCategorySelect();
    // populate timer/mode controls (if present)
    populateControls();
  }catch(err){
    console.error(err);
    refs.feedback.textContent = 'Failed to load data.json — see console for details.';
  }
}

/**
 * Populate the category select dropdown with the loaded categories.
 */
function populateCategorySelect(){
  // If native select exists (fallback), populate it. Otherwise populate custom dropdown list.
  if(refs.categorySelect){
    while(refs.categorySelect.options.length>1) refs.categorySelect.remove(1);
    state.categories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      refs.categorySelect.appendChild(opt);
    });
    return;
  }

  // populate custom dropdown list
  if(refs.categoryList){
    refs.categoryList.innerHTML = '';
    // add Random Category as first option
    const items = ['Random Category', ...state.categories];
    items.forEach((cat, idx) => {
      const li = document.createElement('li');
      li.textContent = cat;
      li.dataset.value = (idx===0) ? '__random__' : cat;
      if(idx===0) li.classList.add('selected');
      refs.categoryList.appendChild(li);
    });
  }
}

// ----------------------------- Round lifecycle -----------------------------
/**
 * Start the next round. Picks category, letter, canonical answer, resets UI, and starts timer.
 */
function nextRound(){
  stopTimer();
  clearFeedback();
  hideExample();

  // Ensure action buttons are in their normal state when starting a new round
  restoreActionButtons();

  // decide category: user-chosen or random
  // determine chosen category from either native select or custom dropdown toggle
  let chosen;
  if(refs.categorySelect){
    chosen = refs.categorySelect.value;
  }else if(refs.categoryToggle){
    chosen = refs.categoryToggle.dataset.value || '__random__';
  }
  let category = chosen === '__random__' ? rand(state.categories) : chosen;
  state.current.category = category;
  refs.categoryDisplay.textContent = category || '—';

  // pick a random letter from category that has words
  const letters = Object.keys(state.data[category] || {}).filter(L=> state.data[category][L].length>0);
  const letter = rand(letters);
  state.current.letter = letter;
  refs.letterDisplay.textContent = letter;

  // valid words for this category+letter
  const valid = (state.data[category][letter] || []).slice();
  state.current.validList = valid;

  // pick a canonical answer for hint progression (random choice)
  const canonical = rand(valid);
  state.current.canonical = canonical;
  state.current.hintIndex = 0;

  // establish hint cap depending on mode (support native select or custom toggle)
  const mode = (refs.modeSelect && refs.modeSelect.value) ? refs.modeSelect.value : (refs.modeToggle && refs.modeToggle.dataset.value) ? refs.modeToggle.dataset.value : 'easy';
  const fullLen = String(canonical).length;
  if(mode === 'easy') state.current.hintCap = fullLen;
  else if(mode === 'medium') state.current.hintCap = Math.ceil(fullLen/2);
  else state.current.hintCap = 0; // hard: no hints

  // timer setup (support native select or custom toggle)
  const t = Number((refs.timerSelect && refs.timerSelect.value) ? refs.timerSelect.value : (refs.timerToggle && refs.timerToggle.dataset.value) ? refs.timerToggle.dataset.value : 30) || 30;
  state.current.timerMs = t;
  state.current.timeLeft = t;

  // reset UI elements
  refs.answerInput.value = '';
  refs.answerInput.disabled = false;
  refs.hintBtn.disabled = (state.current.hintCap<=0);
  refs.hintBtn.textContent = 'Hint';
  refs.revealBtn.disabled = false;
  hideExample();

  renderTimer();
  startTimer();
  refs.answerInput.focus();
}

// ----------------------------- Timer -----------------------------
function startTimer(){
  stopTimer();
  state.current.timerId = setInterval(()=>{
    state.current.timeLeft -= 1;
    if(state.current.timeLeft <= 0){
      state.current.timeLeft = 0;
      renderTimer();
      stopTimer();
          // handle timeout: disable input and show a Next Round button in place of Hint/Reveal
          handleTimeout();
      return;
    }
    renderTimer();
  }, 1000);
}

function stopTimer(){
  if(state.current.timerId){
    clearInterval(state.current.timerId);
    state.current.timerId = null;
  }
}

function renderTimer(){
  const left = state.current.timeLeft;
  const total = state.current.timerMs || 1;
  refs.timeText.textContent = `Time Remaining: ${left}s`;
  const pct = Math.round((left/total)*100);
  refs.timePct.textContent = `${pct}%`;
  refs.progressBar.style.width = `${pct}%`;
}

// ----------------------------- Hint & Reveal -----------------------------
/**
 * Reveal the next prefix of the canonical answer, up to the limit (hintCap).
 */
function giveHint(){
  const canonical = state.current.canonical || '';
  if(!canonical) return;
  // if no hints allowed
  if(state.current.hintCap <= 0) return;

  // increment hint index, but do not exceed cap or full length
  state.current.hintIndex = Math.min(state.current.hintIndex + 1, state.current.hintCap, canonical.length);
  const prefix = canonical.slice(0, state.current.hintIndex);
  refs.answerInput.value = prefix; // optionally pre-fill input with hint prefix
  refs.hintBtn.textContent = `Hint (${state.current.hintIndex}/${state.current.hintCap})`;

  // disable hint if we've reached cap
  if(state.current.hintIndex >= state.current.hintCap) refs.hintBtn.disabled = true;
}

/**
 * Reveal full canonical answer and show a few accepted examples from the valid list.
 * Stops the round.
 */
function revealAnswer(reason){
  stopTimer();
  refs.answerInput.disabled = true;
  refs.hintBtn.disabled = true;
  refs.revealBtn.disabled = true;

  const canonical = state.current.canonical || '';
  // show canonical and some others
  const others = state.current.validList.filter(w => w !== canonical).slice(0,3);
  const display = [canonical].concat(others).join(' — ');
  showExample(display || '—');
}

/**
 * Show the example area with the provided text.
 * @param {string} text
 */
function showExample(text){
  if(!refs.exampleArea) return;
  refs.exampleAnswer.textContent = text || '—';
  refs.exampleArea.classList.remove('hidden');
}

/**
 * Hide the example area and clear its content.
 */
function hideExample(){
  if(!refs.exampleArea) return;
  refs.exampleAnswer.textContent = '';
  refs.exampleArea.classList.add('hidden');
}

/**
 * Handle when the timer reaches zero: disable typing and replace Hint/Reveal
 * with a Next Round button (no automatic reveal or 'time expired' message).
 */
function handleTimeout(){
  stopTimer();
  // disable typing
  refs.answerInput.disabled = true;
  // hide the hint/reveal buttons
  if(refs.hintBtn) refs.hintBtn.style.display = 'none';
  if(refs.revealBtn) refs.revealBtn.style.display = 'none';

  // create or show a Next Round button in the actions area
  let nextBtn = document.getElementById('nextRoundBtn');
  const actionsContainer = (refs.hintBtn && refs.hintBtn.closest) ? refs.hintBtn.closest('.actions') : document.querySelector('.actions');
  if(!actionsContainer) return;

  if(!nextBtn){
    nextBtn = document.createElement('button');
    nextBtn.id = 'nextRoundBtn';
    nextBtn.textContent = 'Next Round';
    // match action button styles by leaving class empty; CSS targets .actions button
    actionsContainer.appendChild(nextBtn);
    nextBtn.addEventListener('click', ()=>{
      // restore normal buttons and start a new round
      restoreActionButtons();
      nextRound();
    });
  }else{
    nextBtn.style.display = 'inline-block';
  }
}

/**
 * Restore the Hint/Reveal buttons (remove Next Round button if present).
 */
function restoreActionButtons(){
  const nextBtn = document.getElementById('nextRoundBtn');
  if(nextBtn) nextBtn.remove();
  if(refs.hintBtn){ refs.hintBtn.style.display = 'inline-block'; refs.hintBtn.disabled = (state.current.hintCap<=0); }
  if(refs.revealBtn){ refs.revealBtn.style.display = 'inline-block'; refs.revealBtn.disabled = false; }
}

// ----------------------------- Validation -----------------------------
/**
 * Validate user input. Normalizes and compares against the full valid list for current category+letter.
 * If correct, mark success and stop round.
 */
function submitAnswer(){
  const raw = refs.answerInput.value || '';
  const normalized = normalize(raw);
  if(!normalized) return;

  const valid = state.current.validList || [];
  const normMap = new Map(valid.map(w => [normalize(w), w]));

  if(normMap.has(normalized)){
    // correct
    const canonicalMatched = normMap.get(normalized);
    // handle correct match: show feedback, stop round, and schedule next round
    handleCorrectMatch(canonicalMatched, 'Correct');
  }else{
    // incorrect — give gentle feedback but allow retry
    refs.feedback.textContent = 'Incorrect — try again';
    refs.feedback.style.color = 'var(--danger)';
  }
}

/**
 * Handle a correct match: stop timer, display success, disable inputs, and
 * schedule an automatic Next Round after a short delay so the user sees feedback.
 * @param {string} matched - the canonical matched answer
 * @param {string} [reason] - optional short reason text to display
 */
function handleCorrectMatch(matched, reason){
  // ensure any timeout Next Round button is removed
  restoreActionButtons();
  stopTimer();
  clearNextTimeout();
  // Do not show a textual notice on correct answers; only reveal the example area.
  showExample(matched);
  refs.answerInput.disabled = true;
  refs.hintBtn.disabled = true;
  refs.revealBtn.disabled = true;

  // schedule auto-advance to next round after a short pause
  state.current.nextTimeout = setTimeout(()=>{
    state.current.nextTimeout = null;
    nextRound();
  }, 1000);
}

function clearNextTimeout(){
  if(state.current.nextTimeout){
    clearTimeout(state.current.nextTimeout);
    state.current.nextTimeout = null;
  }
}

function clearFeedback(){
  refs.feedback.textContent = '';
  refs.feedback.style.color = 'inherit';
}

// ----------------------------- Event wiring -----------------------------
refs.startBtn.addEventListener('click', ()=>{
  nextRound();
});

refs.hintBtn.addEventListener('click', ()=>{
  giveHint();
});

refs.revealBtn.addEventListener('click', ()=>{
  revealAnswer('User revealed answer');
});

refs.answerInput.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter'){
    e.preventDefault();
    submitAnswer();
  }
});

// Live validation: validate as the user types and auto-advance when a match is found.
refs.answerInput.addEventListener('input', ()=>{
  const raw = refs.answerInput.value || '';
  const normalized = normalize(raw);
  if(!normalized) {
    // clear subtle feedback while typing
    // (do not show 'incorrect' on partial input)
    // clearFeedback();
    return;
  }

  const valid = state.current.validList || [];
  const normMap = new Map(valid.map(w => [normalize(w), w]));
  if(normMap.has(normalized)){
    // immediate acceptance when a valid word is typed
    const matched = normMap.get(normalized);
    handleCorrectMatch(matched, 'Correct');
  }
});

// keyboard shortcuts: H for hint, R for reveal, N for next
document.addEventListener('keydown', (e)=>{
  if(e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')){
    // don't hijack typing
    return;
  }
  if(e.key.toLowerCase() === 'h') refs.hintBtn.click();
  if(e.key.toLowerCase() === 'r') refs.revealBtn.click();
  if(e.key.toLowerCase() === 'n') refs.startBtn.click();
});

// Theme toggle wiring: toggle light mode class on body and update icon
if(refs.themeToggle){
  // use onclick assignment so the handler is single and robust
  refs.themeToggle.onclick = function(){
    const isLight = document.body.classList.toggle('light-mode');
    refs.themeToggle.textContent = isLight ? '☀️' : '🌙';
    refs.themeToggle.setAttribute('aria-pressed', String(isLight));
  };
}

// --- Custom dropdown interactions (if present) ---
if(refs.categoryToggle && refs.categoryMenu && refs.categoryList){
  // open/close toggle
  refs.categoryToggle.addEventListener('click', (e)=>{
    const open = refs.categoryMenu.getAttribute('aria-hidden') === 'false';
    refs.categoryMenu.setAttribute('aria-hidden', String(open));
    refs.categoryMenu.style.display = open ? 'none' : 'block';
    refs.categoryToggle.setAttribute('aria-expanded', String(!open));
  });

  // item click
  refs.categoryList.addEventListener('click', (e)=>{
    const li = e.target.closest('li');
    if(!li) return;
    // mark selection
    Array.from(refs.categoryList.children).forEach(c=>c.classList.remove('selected'));
    li.classList.add('selected');
    const val = li.dataset.value || '__random__';
    refs.categoryToggle.dataset.value = val;
    refs.categoryToggle.textContent = (val === '__random__') ? 'Random Category ▾' : (li.textContent + ' ▾');
    // close menu
    refs.categoryMenu.setAttribute('aria-hidden', 'true');
    refs.categoryMenu.style.display = 'none';
    refs.categoryToggle.setAttribute('aria-expanded', 'false');
  });

  // close on outside click
  document.addEventListener('click', (e)=>{
    // close any open custom dropdowns when clicking outside
    if(refs.categoryMenu && !(refs.categoryMenu.contains(e.target) || (refs.categoryToggle && refs.categoryToggle.contains(e.target)))){
      refs.categoryMenu.setAttribute('aria-hidden', 'true');
      refs.categoryMenu.style.display = 'none';
      refs.categoryToggle.setAttribute('aria-expanded', 'false');
    }
    if(refs.timerMenu && !(refs.timerMenu.contains(e.target) || (refs.timerToggle && refs.timerToggle.contains(e.target)))){
      refs.timerMenu.setAttribute('aria-hidden', 'true');
      refs.timerMenu.style.display = 'none';
      refs.timerToggle.setAttribute('aria-expanded', 'false');
    }
    if(refs.modeMenu && !(refs.modeMenu.contains(e.target) || (refs.modeToggle && refs.modeToggle.contains(e.target)))){
      refs.modeMenu.setAttribute('aria-hidden', 'true');
      refs.modeMenu.style.display = 'none';
      refs.modeToggle.setAttribute('aria-expanded', 'false');
    }
  });
}

// Timer dropdown interactions
if(refs.timerToggle && refs.timerMenu && refs.timerList){
  refs.timerToggle.addEventListener('click', ()=>{
    const open = refs.timerMenu.getAttribute('aria-hidden') === 'false';
    refs.timerMenu.setAttribute('aria-hidden', String(open));
    refs.timerMenu.style.display = open ? 'none' : 'block';
    refs.timerToggle.setAttribute('aria-expanded', String(!open));
  });
  refs.timerList.addEventListener('click', (e)=>{
    const li = e.target.closest('li'); if(!li) return;
    Array.from(refs.timerList.children).forEach(c=>c.classList.remove('selected'));
    li.classList.add('selected');
    const val = li.dataset.value || '30';
    refs.timerToggle.dataset.value = val;
    refs.timerToggle.textContent = `${val}s ▾`;
    refs.timerMenu.setAttribute('aria-hidden','true'); refs.timerMenu.style.display='none'; refs.timerToggle.setAttribute('aria-expanded','false');
  });
}

// Mode dropdown interactions
if(refs.modeToggle && refs.modeMenu && refs.modeList){
  refs.modeToggle.addEventListener('click', ()=>{
    const open = refs.modeMenu.getAttribute('aria-hidden') === 'false';
    refs.modeMenu.setAttribute('aria-hidden', String(open));
    refs.modeMenu.style.display = open ? 'none' : 'block';
    refs.modeToggle.setAttribute('aria-expanded', String(!open));
  });
  refs.modeList.addEventListener('click', (e)=>{
    const li = e.target.closest('li'); if(!li) return;
    Array.from(refs.modeList.children).forEach(c=>c.classList.remove('selected'));
    li.classList.add('selected');
    const val = li.dataset.value || 'easy';
    refs.modeToggle.dataset.value = val;
    refs.modeToggle.textContent = `Mode: ${li.textContent} ▾`;
    refs.modeMenu.setAttribute('aria-hidden','true'); refs.modeMenu.style.display='none'; refs.modeToggle.setAttribute('aria-expanded','false');
  });
}

// initial load
loadData();

// Expose some helpers to the window for debugging in browser console
window.FastFacts = { state, nextRound, giveHint, revealAnswer, submitAnswer };
