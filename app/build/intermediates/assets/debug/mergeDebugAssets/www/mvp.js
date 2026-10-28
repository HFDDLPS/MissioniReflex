(() => {
  'use strict';

  const CFG = window.HPHOTO_CONFIG || { demoMode: true };
  const demoMode = CFG.demoMode !== false;
  let sb = null, sbPromise = null;
  let currentUser = null, currentProfile = null;
  let authMode = 'login', adminMode = false;
  let selectedPhoto = null, selectedPhotoBusy = false;
  let equippedCosmetic = 'none';
  let lastPointer = null;
  let adminQueueBusy = false;

  const $ = id => document.getElementById(id);
  const authForm = $('authForm');
  const authSubmit = $('authSubmit');
  const authMessage = $('authMessage');
  const authIntro = $('authIntro');
  const nameField = $('nameField');
  const adminCodeField = $('adminCodeField');
  const demoNote = $('demoNote');
  const welcome = $('welcome');
  const wardrobeOverlay = $('wardrobeOverlay');
  const adminOverlay = $('adminOverlay');
  const cameraInput = $('cameraInput');
  const galleryInput = $('galleryInput');
  const contextTutorial = $('contextTutorial');
  const tutorialQueue = [];
  const tutorialQueued = new Set();
  let activeTutorial = null;
  let missionOpening = false;
  let missionOpenToken = 0;

  function tutorialStorageKey(id) { return 'reflex-tutorial-v1:' + (currentUser ? currentUser.id : 'guest') + ':' + id; }
  function clearTutorialQueue() {
    tutorialQueue.length = 0; tutorialQueued.clear(); activeTutorial = null;
    if (contextTutorial) contextTutorial.hidden = true;
  }
  function displayNextTutorial() {
    if (activeTutorial || !tutorialQueue.length || !contextTutorial) return;
    activeTutorial = tutorialQueue.shift();
    $('contextTutorialKicker').textContent = activeTutorial.kicker || 'PRIMA VOLTA';
    $('contextTutorialTitle').textContent = activeTutorial.title;
    $('contextTutorialBody').textContent = activeTutorial.body;
    contextTutorial.hidden = false;
  }
  function queueContextTutorial(id, title, body, kicker='PICCOLO SUGGERIMENTO') {
    if (!currentUser || !contextTutorial) return;
    const key = tutorialStorageKey(id);
    try { if (localStorage.getItem(key) === '1') return; } catch (_) {}
    if ((activeTutorial && activeTutorial.id === id) || tutorialQueued.has(id)) return;
    tutorialQueue.push({ id, key, title, body, kicker }); tutorialQueued.add(id);
    displayNextTutorial();
  }
  $('contextTutorialDismiss').addEventListener('click', () => {
    if (activeTutorial) { try { localStorage.setItem(activeTutorial.key, '1'); } catch (_) {} tutorialQueued.delete(activeTutorial.id); }
    activeTutorial = null; contextTutorial.hidden = true; displayNextTutorial();
  });

  function setAuthMessage(message, kind='') {
    authMessage.textContent = message || '';
    authMessage.className = 'auth-message' + (kind ? ' ' + kind : '');
  }
  function isRealBackendConfigured() {
    return CFG.demoMode === false && typeof CFG.supabaseUrl === 'string' &&
      /^https:\/\/.+/.test(CFG.supabaseUrl) && !!CFG.supabaseAnonKey;
  }
  function loadSupabaseLibrary() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve(true);
    if (sbPromise) return sbPromise;
    sbPromise = new Promise(resolve => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.async = true;
      const timer = setTimeout(() => resolve(false), 9000);
      script.onload = () => { clearTimeout(timer); resolve(!!(window.supabase && window.supabase.createClient)); };
      script.onerror = () => { clearTimeout(timer); resolve(false); };
      document.head.appendChild(script);
    });
    return sbPromise;
  }
  async function getSupabase() {
    if (!isRealBackendConfigured()) throw new Error('Configura URL e chiave anonima Supabase in supabase-config.js e imposta demoMode=false.');
    if (sb) return sb;
    const loaded = await loadSupabaseLibrary();
    if (!loaded) throw new Error('Impossibile caricare il client Supabase. Controlla la connessione Internet e riprova.');
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    return sb;
  }
  function demoUsers() {
    try { return JSON.parse(localStorage.getItem('hphoto-demo-users-v1') || '{}'); } catch (_) { return {}; }
  }
  function saveDemoUsers(users) {
    localStorage.setItem('hphoto-demo-users-v1', JSON.stringify(users));
  }
  function demoSubmissions() {
    try { return JSON.parse(localStorage.getItem('hphoto-demo-submissions-v1') || '[]'); } catch (_) { return []; }
  }
  function saveDemoSubmissions(items) {
    // Keep the local-only test queue bounded so WebView localStorage does not fill up.
    localStorage.setItem('hphoto-demo-submissions-v1', JSON.stringify(items.slice(0, 12)));
  }
  function demoSessionId() {
    return localStorage.getItem('hphoto-demo-session-v1') || '';
  }
  async function passwordDigest(password) {
    try {
      const bytes = new TextEncoder().encode(password);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest)).map(v => v.toString(16).padStart(2, '0')).join('');
    } catch (_) {
      // Demo fallback only; it is not a production authentication mechanism.
      return btoa(unescape(encodeURIComponent(password)));
    }
  }
  function setProgressKey(userId) {
    progressKey = 'reflex-progress-v1:' + userId;
    try { P = JSON.parse(localStorage.getItem(progressKey) || '{}'); } catch (_) { P = {}; }
    M.forEach(m => {
      if (!P[m.id]) P[m.id] = { s: 'available', c: [], review_note: '' };
      if (P[m.id].s === 'todo') P[m.id].s = 'available';
      if (P[m.id].s === 'active') P[m.id].s = 'in_progress';
      if (P[m.id].s === 'done') P[m.id].s = 'approved';
      if (!Array.isArray(P[m.id].c)) P[m.id].c = [];
    });
    save();
  }
  function currentState(m) {
    const state = st(m);
    if (!state.s || state.s === 'todo') state.s = 'available';
    if (state.s === 'active') state.s = 'in_progress';
    if (state.s === 'done') state.s = 'approved';
    if (!('review_note' in state)) state.review_note = '';
    return state;
  }
  function statusLabel(status) {
    return ({
      available: 'Disponibile',
      in_progress: 'In corso',
      pending: 'In revisione',
      approved: 'Completata',
      retry: 'Da rifare'
    })[status] || 'Disponibile';
  }
  function statusClass(status) {
    if (status === 'approved') return 'done';
    if (status === 'in_progress') return 'active';
    if (status === 'pending') return 'pending';
    if (status === 'retry') return 'retry';
    return '';
  }
  function chapterStats(chapter) {
    const ids = chapter.ids || [];
    const count = ids.filter(id => { const m = M.find(x => x.id === id); return m && currentState(m).s === 'approved'; }).length;
    return { count, total: ids.length, complete: ids.length > 0 && count === ids.length };
  }
  function renderChapterProgress() {
    const root = $('chapterProgress');
    if (!root) return;
    root.innerHTML = '';
    (window.REFLEX_CHAPTERS || []).forEach(chapter => {
      const stats = chapterStats(chapter);
      const row = document.createElement('div'); row.className = 'chapter-meter' + (stats.complete ? ' complete' : '');
      addText(row, 'span', 'chapter-meter-label', chapter.short || chapter.label);
      const track = document.createElement('div'); track.className = 'chapter-meter-track';
      const fill = document.createElement('div'); fill.className = 'chapter-meter-fill';
      fill.style.width = (stats.total ? stats.count / stats.total * 100 : 0) + '%';
      track.appendChild(fill); row.appendChild(track);
      addText(row, 'span', 'chapter-meter-count', stats.count + '/' + stats.total);
      row.title = chapter.label + ': ' + stats.count + ' di ' + stats.total + ' missioni approvate';
      root.appendChild(row);
    });
  }

  function updateExperienceHUD() {
    const hud = $('rollHUD'), nav = $('bottomNav');
    if (!hud || !nav) return;
    const approved = M.filter(m => currentState(m).s === 'approved').length;
    const pending = M.filter(m => currentState(m).s === 'pending').length;
    const active = M.filter(m => currentState(m).s === 'in_progress' || currentState(m).s === 'retry').length;
    $('rollCount').textContent = approved + '/' + M.length + ' TIMBRI';
    const film = $('rollFrames');
    if (film.children.length !== M.length) {
      film.innerHTML = '';
      M.forEach(m => { const frame = document.createElement('span'); frame.title = 'Missione ' + m.order + ': ' + m.t; film.appendChild(frame); });
    }
    Array.from(film.children).forEach((frame, i) => {
      const mission = M[i];
      const developed = !!mission && currentState(mission).s === 'approved';
      frame.classList.toggle('developed', developed);
      frame.setAttribute('aria-label', mission ? 'Missione ' + mission.order + (developed ? ' approvata' : ' non ancora approvata') : 'Fotogramma');
    });
    renderChapterProgress();
    const chapters = window.REFLEX_CHAPTERS || [];
    const currentChapter = chapters.find(ch => !(ch.ids || []).every(id => { const mission = M.find(x => x.id === id); return mission && currentState(mission).s === 'approved'; }));
    let message = approved === M.length
      ? 'Rullino sviluppato: hai allenato il tuo sguardo.'
      : approved === 0 && pending === 0 && active === 0
        ? 'Comincia dal capitolo Composizione: cerca il protagonista.'
        : pending > 0
          ? pending + ' scatto' + (pending === 1 ? '' : 'i') + ' in laboratorio di revisione.'
          : active > 0
            ? 'Hai una missione aperta. Riprendila quando vuoi.'
            : currentChapter ? 'Prossima tappa: ' + currentChapter.label + '. Il feedback ti aiuta a migliorare.' : 'Continua a esplorare il rullino.';
    $('rollMessage').textContent = message;
    hud.hidden = !currentUser;
    nav.hidden = !currentUser;
    $('tabMissions').classList.toggle('selected', !wardrobeOverlay.classList.contains('on'));
    $('tabWardrobe').classList.toggle('selected', wardrobeOverlay.classList.contains('on'));
  }
  function refreshMissions() {
    M.forEach(m => {
      const state = currentState(m).s;
      const activeChapter = window.ACTIVE_CHAPTER_KEY || 'composition';
      m.el.className = 'tag ' + statusClass(state) + ((cur || m.chapterKey !== activeChapter) ? ' hide' : '');
      m.el.replaceChildren();
      const num = addText(m.el, 'span', 'tag-index', String(m.order).padStart(2, '0'));
      const copy = addText(m.el, 'span', 'tag-copy', '');
      addText(copy, 'span', 'tag-title', m.t);
      const status = state === 'approved' ? 'Completata · timbro' : state === 'pending' ? 'In revisione' : state === 'retry' ? 'Da rifare' : state === 'in_progress' ? 'In corso' : 'Da scoprire';
      addText(copy, 'span', 'tag-status', status);
      addText(m.el, 'span', 'tag-mark', state === 'approved' ? '✓' : state === 'pending' ? '…' : '');
      m.el.title = 'Missione ' + m.order + ' · ' + m.t + ' — ' + statusLabel(state);
      m.el.setAttribute('aria-label', 'Missione ' + m.order + ': ' + m.t + ', ' + statusLabel(state));
      m.el.onclick = () => openMission(m);
    });
    updateExperienceHUD();
  }
  window.refresh = refreshMissions;

  function addText(parent, tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text || '';
    parent.appendChild(node);
    return node;
  }
  function addSection(title, text) {
    const section = document.createElement('section');
    section.className = 'sec';
    addText(section, 'h3', '', title);
    addText(section, 'p', '', text);
    pb.appendChild(section);
    return section;
  }
  function addBanner(text, kind) {
    const banner = addText(pb, 'div', 'banner ' + (kind || ''), text);
    return banner;
  }
  function addReviewCriteria(parent, mission, compact=false) {
    if (!mission || !Array.isArray(mission.criteria) || !mission.criteria.length) return null;
    const wrap = document.createElement(compact ? 'div' : 'details');
    wrap.className = 'review-criteria' + (compact ? ' admin-review-criteria' : '');
    if (!compact) addText(wrap, 'summary', '', 'Cosa guarderà il revisore?');
    else addText(wrap, 'strong', '', 'Criteri di revisione');
    const list = document.createElement('ul');
    mission.criteria.forEach(item => addText(list, 'li', '', item));
    wrap.appendChild(list); parent.appendChild(wrap); return wrap;
  }
  function renderMission() {
    if (!cur) return;
    const m = cur, state = currentState(m);
    pm.textContent = 'MISSIONE ' + String(m.order).padStart(2, '0') + ' / ' + String(M.length).padStart(2, '0') + ' · ' + m.chapter.toUpperCase();
    pt.textContent = m.t;
    pb.innerHTML = '';
    const meta = addText(pb, 'div', 'mission-meta', '');
    addText(meta, 'span', '', '✦ ' + (state.s === 'approved' ? 'Tecnica acquisita' : state.s === 'pending' ? 'In laboratorio' : state.s === 'in_progress' || state.s === 'retry' ? 'Prova pratica' : 'Sfida fotografica'));
    addText(meta, 'span', 'reward', state.s === 'approved' ? '+1 TIMBRO' : 'RICOMPENSA · 1 TIMBRO');

    if (state.s === 'pending') {
      addBanner('SCATTO IN SVILUPPO · Hai fatto la tua parte. Un revisore sta guardando la foto e ti lascerà un feedback.', 'pending');
      addSection('Nel frattempo', 'La missione è al sicuro nel tuo rullino. Quando sarà revisionata, vedrai qui il risultato e cosa puoi migliorare.');
      if (state.review_note) addSection('Nota del revisore', state.review_note);
    } else if (state.s === 'approved') {
      addBanner('TIMBRO OTTENUTO · La foto è stata approvata e il rullino è avanzato di un fotogramma.', 'approved');
      addSection('Cosa hai allenato', m.learn);
      if (state.review_note) addSection('Il feedback del revisore', state.review_note);
      const next = M.find(x => currentState(x).s === 'available');
      addSection('Prossima scoperta', next ? 'Il prossimo dettaglio ti aspetta: ' + next.t + '.' : 'Hai sviluppato tutte le missioni di questo rullino. Ruota la fotocamera e ripercorri le tecniche che hai scoperto.');
    } else if (state.s === 'available') {
      addBanner('Non è un compito: è un modo diverso di guardare quello che hai davanti. Dai un’occhiata alla sfida e decidi se provarci.', 'challenge');
      addSection('La sfida', m.goal);
      const tip = addSection('Un piccolo indizio', m.tip);
      tip.classList.add('tip');
      const fold = document.createElement('details'); fold.className = 'mission-fold';
      addText(fold, 'summary', '', 'Perché questa tecnica cambia la foto?');
      addText(fold, 'p', '', m.learn);
      pb.appendChild(fold);
      addReviewCriteria(pb, m, false);
      addText(pb, 'p', 'note', 'Accetta per iniziare. Puoi anche tornare più tardi: la missione resterà qui.');
    } else {
      if (state.s === 'retry') {
        addBanner('SECONDO TENTATIVO · Ogni scatto è un esperimento. Usa il feedback e prova una strada diversa.', 'rejected');
        if (state.review_note) addSection('Il suggerimento del revisore', state.review_note);
      } else {
        addBanner('Missione avviata · Ora prova a mettere in pratica l’idea con la fotocamera.', '');
      }
      addSection('Obiettivo dello scatto', m.goal);
      const steps = document.createElement('section'); steps.className = 'sec';
      addText(steps, 'h3', '', 'Come provarci');
      const list = document.createElement('ol'); list.className = 'mission-instructions';
      m.steps.forEach(step => addText(list, 'li', '', step));
      steps.appendChild(list); pb.appendChild(steps);
      const fold = document.createElement('details'); fold.className = 'mission-fold';
      addText(fold, 'summary', '', 'Il principio fotografico dietro la sfida');
      addText(fold, 'p', '', m.learn); pb.appendChild(fold);
      const tip = addSection('Tieni a mente', m.tip); tip.classList.add('tip');
      addReviewCriteria(pb, m, false);
      const actions = document.createElement('div'); actions.className = 'photo-actions';
      const take = addText(actions, 'button', '', '◎  Scatta adesso'); take.type = 'button';
      take.onclick = () => { selectedPhoto = null; cameraInput.value = ''; cameraInput.click(); };
      const choose = addText(actions, 'button', '', '▧  Scegli dalla galleria'); choose.type = 'button';
      choose.onclick = () => { selectedPhoto = null; galleryInput.value = ''; galleryInput.click(); };
      pb.appendChild(actions);
      if (selectedPhoto && selectedPhoto.missionId === m.id) {
        const img = document.createElement('img'); img.className = 'photo-preview'; img.alt = 'Anteprima dello scatto selezionato'; img.src = selectedPhoto.dataUrl; pb.appendChild(img);
        addText(pb, 'p', 'note', 'Quando sei soddisfatto, invia lo scatto al laboratorio di revisione.');
      } else {
        addText(pb, 'p', 'note', 'La foto viene ridimensionata prima dell’invio. Dopo la consegna, sarà un revisore a decidere se la missione è completata o da rifare.');
      }
    }
    updateMissionButtons();
    pb.scrollTop = 0;
  }
  function updateMissionButtons() {
    if (!cur) return;
    can.disabled = false;
    const state = currentState(cur).s;
    if (state === 'available') {
      acc.textContent = 'Accetta';
      acc.disabled = false;
      can.textContent = 'Non ora';
    } else if (state === 'in_progress') {
      acc.textContent = selectedPhoto && selectedPhoto.missionId === cur.id ? 'Invia per revisione' : 'Seleziona una foto';
      acc.disabled = !(selectedPhoto && selectedPhoto.missionId === cur.id) || selectedPhotoBusy;
      can.textContent = 'Più tardi';
    } else if (state === 'retry') {
      acc.textContent = 'Riprova missione';
      acc.disabled = false;
      can.textContent = 'Non ora';
    } else if (state === 'pending') {
      acc.textContent = 'In revisione';
      acc.disabled = true;
      can.textContent = 'Chiudi';
    } else {
      acc.textContent = 'Completata';
      acc.disabled = true;
      can.textContent = 'Chiudi';
    }
  }
  window.render = renderMission;
  window.upd = updateMissionButtons;

  function openMission(m) {
    if (!currentUser) { welcome.classList.remove('dismissed'); welcome.style.display = 'grid'; return; }
    // Evita doppi tocchi durante il movimento della fotocamera.
    if (missionOpening) return;
    if (selectedPhoto && selectedPhoto.missionId !== m.id) selectedPhoto = null;
    cur = m;
    renderMission();
    refreshMissions();

    // Prima parte la transizione 3D. La scheda resta nascosta fino alla fine
    // dello zoom, così l'utente vede la fotocamera orientarsi verso il componente.
    const token = ++missionOpenToken;
    missionOpening = true;
    document.body.classList.add('mission', 'mission-opening');
    const revealMission = () => {
      if (token !== missionOpenToken || cur !== m) return;
      missionOpening = false;
      document.body.classList.remove('mission-opening');
      panel.classList.add('on');
    };
    if (window.HPHOTO_MODEL_READY && m.v && m.a && typeof window.fly === 'function') {
      window.fly(new THREE.Vector3(...m.v), new THREE.Vector3(...m.a), revealMission, true);
    } else {
      // Se il modello non è disponibile, non blocchiamo l'accesso alla missione.
      revealMission();
    }
  }
  function closeMission() {
    // Invalida anche una transizione eventualmente ancora in corso.
    missionOpenToken++;
    missionOpening = false;
    panel.classList.remove('on');
    document.body.classList.remove('mission', 'mission-opening');
    cur = null;
    refreshMissions();
    if (window.HPHOTO_MODEL_READY && typeof window.fly === 'function') fly(HOME.pos, HOME.tgt);
  }
  // Chapter tabs can close the mission before changing the visible labels.
  window.HPHOTO_BACK = closeMission;
  can.onclick = closeMission;
  M.forEach(m => { if (m.el) m.el.onclick = () => openMission(m); });

  async function startMission(m) {
    if (!currentUser) throw new Error('Accedi per iniziare una missione.');
    if (!demoMode) {
      const client = await getSupabase();
      const { error } = await client.rpc('start_mission', { p_mission_id: m.id });
      if (error) throw error;
    }
    const state = currentState(m);
    state.s = 'in_progress';
    state.review_note = '';
    state.c = [];
    save();
    refreshMissions();
  }
  function showBusy(message) {
    acc.disabled = true;
    acc.textContent = message;
    can.disabled = true;
  }
  function clearBusy() {
    can.disabled = false;
    if (cur) updateMissionButtons();
  }
  acc.onclick = async () => {
    if (!cur || !currentUser) return;
    const m = cur, state = currentState(m).s;
    try {
      if (state === 'available') {
        showBusy('Apro la missione…');
        await startMission(m);
        selectedPhoto = null;
        renderMission();
        queueContextTutorial('first-practice', 'La missione è iniziata', 'Scatta direttamente oppure scegli dalla galleria. Quando invii la foto, un revisore la valuterà e ti lascerà un suggerimento.', 'PRIMO SCATTO');
      } else if (state === 'retry') {
        showBusy('Preparo la nuova prova…');
        await startMission(m);
        selectedPhoto = null;
        renderMission();
        queueContextTutorial('first-practice', 'La missione è iniziata', 'Scatta direttamente oppure scegli dalla galleria. Quando invii la foto, un revisore la valuterà e ti lascerà un suggerimento.', 'PRIMO SCATTO');
      } else if (state === 'in_progress' && selectedPhoto && selectedPhoto.missionId === m.id) {
        await submitPhoto(m, selectedPhoto);
        selectedPhoto = null;
        renderMission();
        refreshMissions();
      }
    } catch (error) {
      clearBusy();
      const msg = error && error.message ? error.message : 'Operazione non riuscita.';
      addBanner(msg, 'rejected');
    }
  };

  async function compressPhoto(file) {
    if (!file || !file.type || !file.type.startsWith('image/')) throw new Error('Seleziona un file immagine valido.');
    if (file.size > 25 * 1024 * 1024) throw new Error('La foto supera 25 MB. Scegli un’immagine più leggera.');
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('Non riesco ad aprire questa foto.'));
        img.src = objectUrl;
      });
      const max = 1440;
      const ratio = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const canvasEl = document.createElement('canvas');
      canvasEl.width = Math.max(1, Math.round(img.naturalWidth * ratio));
      canvasEl.height = Math.max(1, Math.round(img.naturalHeight * ratio));
      const ctx = canvasEl.getContext('2d', { alpha: false });
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
      ctx.drawImage(img, 0, 0, canvasEl.width, canvasEl.height);
      const dataUrl = canvasEl.toDataURL('image/jpeg', 0.78);
      const blob = await (await fetch(dataUrl)).blob();
      return { blob, dataUrl, fileName: (file.name || 'scatto').replace(/[^\w.-]+/g, '_').slice(0, 80) + '.jpg' };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
  async function handleSelectedFile(event, missionId) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file || !cur || cur.id !== missionId) return;
    selectedPhotoBusy = true;
    updateMissionButtons();
    try {
      selectedPhoto = Object.assign(await compressPhoto(file), { missionId });
      renderMission();
    } catch (error) {
      selectedPhoto = null;
      addBanner(error.message || 'Non riesco a leggere la foto.', 'rejected');
    } finally {
      selectedPhotoBusy = false;
      updateMissionButtons();
    }
  }
  cameraInput.addEventListener('change', e => { if (cur) handleSelectedFile(e, cur.id); });
  galleryInput.addEventListener('change', e => { if (cur) handleSelectedFile(e, cur.id); });

  async function submitPhoto(m, photo) {
    showBusy('Invio in corso…');
    const state = currentState(m);
    if (demoMode) {
      const items = demoSubmissions();
      items.unshift({
        id: 'demo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        user_id: currentUser.id,
        email: currentUser.email,
        full_name: currentUser.full_name || currentUser.email,
        mission_id: m.id,
        status: 'pending',
        review_note: '',
        created_at: new Date().toISOString(),
        image: photo.dataUrl
      });
      try { saveDemoSubmissions(items); }
      catch (_) { throw new Error('Spazio locale esaurito. Elimina le vecchie foto demo o usa una foto più piccola.'); }
    } else {
      const client = await getSupabase();
      const filePath = currentUser.id + '/' + m.id + '/' + crypto.randomUUID() + '.jpg';
      const { error: uploadError } = await client.storage.from('mission-photos').upload(filePath, photo.blob, {
        contentType: 'image/jpeg', upsert: false, cacheControl: '3600'
      });
      if (uploadError) throw uploadError;
      const { error: insertError } = await client.from('mission_submissions').insert({
        user_id: currentUser.id,
        mission_id: m.id,
        storage_path: filePath,
        status: 'pending'
      });
      if (insertError) {
        // The object remains private in the bucket if the metadata insert failed.
        // Do not grant users broad delete access merely to clean this rare orphan case.
        throw insertError;
      }
    }
    state.s = 'pending';
    state.review_note = '';
    state.c = [];
    save();
    await syncProgressFromBackend();
    setAuthMessage('');
  }

  async function syncProgressFromBackend() {
    if (!currentUser || demoMode) return;
    const client = await getSupabase();
    const { data, error } = await client.from('mission_progress')
      .select('mission_id,status,review_note').eq('user_id', currentUser.id);
    if (error) throw error;
    M.forEach(m => { delete P[m.id]; });
    (data || []).forEach(row => {
      P[row.mission_id] = { s: row.status, c: [], review_note: row.review_note || '' };
    });
    M.forEach(m => { if (!P[m.id]) P[m.id] = { s: 'available', c: [], review_note: '' }; });
    save();
  }
  async function loadProgress() {
    setProgressKey(currentUser.id);
    if (!demoMode) await syncProgressFromBackend();
    refreshMissions();
  }

  // Un solo slot cosmetico: ogni oggetto sostituisce quello equipaggiato prima.
  // I tre GLB forniti sono inclusi localmente nel pacchetto Android, senza CDN.
  const COSMETIC_ASSETS = {
    camera_hat: './models/cosmetics/HatModificato.glb',
    wrapped_scarf: './models/cosmetics/scarf_soccer_-_tf2.glb',
    moka_pot: './models/cosmetics/moka_pot.glb'
  };
  const cosmeticTemplates = new Map();
  const cosmeticLoads = new Map();
  let cosmeticRenderToken = 0;
  const COSMETICS = [
    { id:'none', name:'Nessun accessorio', icon:'📷', desc:'La Pentax nella sua forma originale.' },
    { id:'camera_hat', name:'Cappello', icon:'🎩', desc:'Il modello 3D viene appoggiato sopra il pentaprisma.', rewardChapter:'composition' },
    { id:'wrapped_scarf', name:'Sciarpa', icon:'🧣', desc:'La sciarpa avvolge il corpo macchina con un unico accessorio.', rewardChapter:'light' },
    { id:'moka_pot', name:'Moka', icon:'☕', desc:'Una moka tridimensionale accompagna la fotocamera, alla sua stessa scala visiva.', rewardChapter:'technique' }
  ];
  function isCosmeticUnlocked(cosmetic) {
    if (cosmetic.id === 'none' || demoMode) return true; // In demo si provano tutti gli accessori.
    if (!cosmetic.rewardChapter) return true;
    const chapter = (window.REFLEX_CHAPTERS || []).find(c => c.key === cosmetic.rewardChapter);
    return !!chapter && chapterStats(chapter).complete;
  }
  function cosmeticRewardLabel(cosmetic) {
    if (!cosmetic.rewardChapter) return 'Sempre disponibile';
    const chapter = (window.REFLEX_CHAPTERS || []).find(c => c.key === cosmetic.rewardChapter);
    const stats = chapter ? chapterStats(chapter) : {count:0,total:4,complete:false};
    if (demoMode) return 'Disponibile in modalità test';
    return stats.complete ? 'Sbloccato · ' + (chapter ? chapter.label : 'capitolo') : 'Sblocco: ' + stats.count + '/' + stats.total + ' approvate';
  }
  function cosmeticKey() { return 'hphoto-cosmetic:' + (currentUser ? currentUser.id : 'guest'); }
  async function loadCosmetic() {
    equippedCosmetic = 'none';
    if (!currentUser) return;
    if (demoMode) {
      try { equippedCosmetic = localStorage.getItem(cosmeticKey()) || 'none'; } catch (_) { equippedCosmetic = 'none'; }
      if (!COSMETICS.some(c => c.id === equippedCosmetic)) { equippedCosmetic = 'none'; try { localStorage.setItem(cosmeticKey(), 'none'); } catch (_) {} }
    } else {
      const client = await getSupabase();
      const { data, error } = await client.from('user_cosmetics').select('equipped_item').eq('user_id', currentUser.id).maybeSingle();
      if (error) throw error;
      equippedCosmetic = data && data.equipped_item ? data.equipped_item : 'none';
      // Migrazione client dei vecchi ID, che non corrispondono più ai cosmetici attuali.
      if (!COSMETICS.some(c => c.id === equippedCosmetic)) equippedCosmetic = 'none';
    }
    applyCosmetic3D();
  }
  function cosmeticTemplate(id) {
    if (cosmeticTemplates.has(id)) return Promise.resolve(cosmeticTemplates.get(id));
    if (cosmeticLoads.has(id)) return cosmeticLoads.get(id);
    const url = COSMETIC_ASSETS[id];
    if (!url || !window.THREE || !THREE.GLTFLoader) return Promise.reject(new Error('Modello GLB non disponibile per: ' + id));
    const pending = new Promise((resolve, reject) => {
      const loader = new THREE.GLTFLoader();
      loader.load(url, gltf => {
        cosmeticTemplates.set(id, gltf.scene);
        resolve(gltf.scene);
      }, undefined, error => {
        cosmeticLoads.delete(id);
        reject(error || new Error('Impossibile caricare ' + url));
      });
    });
    cosmeticLoads.set(id, pending);
    return pending;
  }
  function partBox(model, name, fallback) {
    let found = null;
    model.traverse(o => { if (!found && o.name === name) found = o; });
    return found ? new THREE.Box3().setFromObject(found) : fallback.clone();
  }
  // Centra il GLB e lo adatta a dimensioni obiettivo in coordinate della Pentax.
  // Il posizionamento usa il centro del bounding box, non l'origine del file esportato.
  function fitCosmetic(asset, targetSize, targetCenter) {
    asset.updateMatrixWorld(true);
    const sourceBox = new THREE.Box3().setFromObject(asset);
    const sourceSize = sourceBox.getSize(new THREE.Vector3());
    const sourceCenter = sourceBox.getCenter(new THREE.Vector3());
    const sx = targetSize.x / Math.max(sourceSize.x, 0.0001);
    const sy = targetSize.y / Math.max(sourceSize.y, 0.0001);
    const sz = targetSize.z / Math.max(sourceSize.z, 0.0001);
    asset.scale.set(sx, sy, sz);
    asset.position.set(
      targetCenter.x - sourceCenter.x * sx,
      targetCenter.y - sourceCenter.y * sy,
      targetCenter.z - sourceCenter.z * sz
    );
    asset.updateMatrixWorld(true);
  }
  function clearCosmeticGroup() {
    // Rimuove il cosmetico attivo e ogni eventuale gruppo residuo da click rapidi
    // o da una sessione precedente. Tutti i cosmetici devono occupare uno slot solo.
    if (window.reflexCosmeticGroup && window.reflexCosmeticGroup.parent) {
      window.reflexCosmeticGroup.parent.remove(window.reflexCosmeticGroup);
    }
    if (window.scene && window.scene.children) {
      [...window.scene.children].forEach(child => {
        if (child.userData?.hphotoCosmetic || (child.name || '').startsWith('hphoto-cosmetic:')) {
          window.scene.remove(child);
        }
      });
    } else if (typeof scene !== 'undefined' && scene.children) {
      [...scene.children].forEach(child => {
        if (child.userData?.hphotoCosmetic || (child.name || '').startsWith('hphoto-cosmetic:')) {
          scene.remove(child);
        }
      });
    }
    // Geometrie/materiali rimangono nella cache dei template per poterli riutilizzare.
    window.reflexCosmeticGroup = null;
  }
  async function applyCosmetic3D() {
    const token = ++cosmeticRenderToken;
    const model = window.reflexModel;
    if (!model || !window.THREE) return;
    clearCosmeticGroup();
    window.HPHOTO_WIDE_FRAME = equippedCosmetic === 'moka_pot';
    if (!equippedCosmetic || equippedCosmetic === 'none') {
      if (window.HPHOTO_MODEL_READY && !cur && !missionOpening && typeof setHomeFrame === 'function') {
        setHomeFrame(); if (window.fly) window.fly(HOME.pos, HOME.tgt);
      }
      return;
    }
    let template;
    try {
      template = await cosmeticTemplate(equippedCosmetic);
    } catch (error) {
      console.error('HPhoto: caricamento cosmetico fallito', equippedCosmetic, error);
      if (token === cosmeticRenderToken) alert('Non riesco a caricare questo accessorio 3D. Controlla che i file GLB siano presenti nella cartella models/cosmetics.');
      return;
    }
    // Se nel frattempo è stato scelto un altro oggetto, ignora la risposta tardiva.
    if (token !== cosmeticRenderToken || equippedCosmetic === 'none' || !window.reflexModel) return;
    const group = new THREE.Group();
    group.name = 'hphoto-cosmetic:' + equippedCosmetic;
    group.userData.hphotoCosmetic = true;
    const overall = new THREE.Box3().setFromObject(model);
    const size = overall.getSize(new THREE.Vector3());
    const center = overall.getCenter(new THREE.Vector3());
    const bodyBox = partBox(model, 'Body_lowpoly', overall);
    const bodySize = bodyBox.getSize(new THREE.Vector3());
    const bodyCenter = bodyBox.getCenter(new THREE.Vector3());
    const finderBox = partBox(model, 'viewfinder_lowpoly', bodyBox);
    const asset = template.clone(true);
    // Alcuni GLB importati hanno bounding box originari non standard: non lasciare
    // che il frustum culling elimini mesh dell'accessorio dopo la trasformazione.
    asset.traverse(child => {
      if (!child.isMesh) return;
      child.visible = true;
      child.frustumCulled = false;
      if (Array.isArray(child.material)) child.material.forEach(mat => { if (mat) { mat.side = THREE.DoubleSide; mat.needsUpdate = true; } });
      else if (child.material) { child.material.side = THREE.DoubleSide; child.material.needsUpdate = true; }
    });

    if (equippedCosmetic === 'camera_hat') {
      // Mantiene le proporzioni originali del cappello; viene appoggiato sopra il corpo.
      asset.updateMatrixWorld(true);
      const rawBox = new THREE.Box3().setFromObject(asset);
      const rawSize = rawBox.getSize(new THREE.Vector3());
      const fitScale = (size.x * 0.32) / Math.max(rawSize.x, rawSize.y, rawSize.z);
      const hatSize = rawSize.clone().multiplyScalar(fitScale);
      const hatCenter = new THREE.Vector3(
        finderBox.getCenter(new THREE.Vector3()).x,
        bodyBox.max.y + hatSize.y * 0.5 + size.y * 0.012,
        finderBox.getCenter(new THREE.Vector3()).z
      );
      fitCosmetic(asset, hatSize, hatCenter);
    } else if (equippedCosmetic === 'wrapped_scarf') {
      // La fascia segue il volume del corpo macchina (non il cilindro dell'obiettivo).
      // Il bounding target è leggermente più grande del corpo, così la sciarpa resta
      // esterna alla scocca invece di avere superfici visibilmente compenetrate.
      const scarfSize = new THREE.Vector3(
        bodySize.x * 1.075,
        bodySize.y * 0.25,
        bodySize.z * 1.22
      );
      const scarfCenter = new THREE.Vector3(
        bodyCenter.x,
        bodyCenter.y - bodySize.y * 0.10,
        bodyCenter.z
      );
      fitCosmetic(asset, scarfSize, scarfCenter);
    } else if (equippedCosmetic === 'moka_pot') {
      // La moka mantiene le proporzioni GLB e viene visualizzata accanto alla K1000,
      // con altezza quasi equivalente alla fotocamera e una piccola distanza di sicurezza.
      asset.updateMatrixWorld(true);
      const rawBox = new THREE.Box3().setFromObject(asset);
      const rawSize = rawBox.getSize(new THREE.Vector3());
      const scale = (size.y * 0.92) / Math.max(rawSize.y, 0.0001);
      const mokaSize = rawSize.clone().multiplyScalar(scale);
      const mokaCenter = new THREE.Vector3(
        overall.max.x + mokaSize.x * 0.5 + size.x * 0.07,
        overall.min.y + mokaSize.y * 0.5,
        center.z + size.z * 0.18
      );
      fitCosmetic(asset, mokaSize, mokaCenter);
    }
    group.add(asset);
    window.reflexCosmeticGroup = group;
    scene.add(group);
    group.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);
    if (window.HPHOTO_MODEL_READY && !cur && !missionOpening && typeof setHomeFrame === 'function') {
      setHomeFrame(); if (window.fly) window.fly(HOME.pos, HOME.tgt);
    }
    window.dispatchEvent(new CustomEvent('reflex-cosmetic-ready', { detail: { id: equippedCosmetic } }));
  }
  window.applyCosmetic3D = applyCosmetic3D;

  function renderCosmeticGrid() {
    const grid = $('cosmeticGrid');
    grid.innerHTML = '';
    COSMETICS.forEach(cosmetic => {
      const unlocked = isCosmeticUnlocked(cosmetic);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cosmetic-item' + (equippedCosmetic === cosmetic.id ? ' selected' : '') + (!unlocked ? ' locked' : '');
      button.disabled = !unlocked;
      addText(button, 'span', 'cosmetic-icon', unlocked ? cosmetic.icon : '🔒');
      addText(button, 'span', 'cosmetic-name', cosmetic.name);
      addText(button, 'span', 'cosmetic-desc', cosmetic.desc);
      addText(button, 'span', 'cosmetic-reward', cosmeticRewardLabel(cosmetic));
      addText(button, 'span', 'cosmetic-state', equippedCosmetic === cosmetic.id ? 'INDOSSATO' : unlocked ? (demoMode ? 'DISPONIBILE · TEST' : 'INDOSSA') : 'BLOCCATO');
      button.onclick = async () => {
        if (!isCosmeticUnlocked(cosmetic)) return;
        try {
          if (!demoMode) {
            const client = await getSupabase();
            const { error } = await client.from('user_cosmetics').upsert({
              user_id: currentUser.id, equipped_item: cosmetic.id, updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });
            if (error) throw error;
          } else {
            localStorage.setItem(cosmeticKey(), cosmetic.id);
          }
          equippedCosmetic = cosmetic.id;
          applyCosmetic3D();
          renderCosmeticGrid();
        } catch (error) { alert(error.message || 'Non riesco a salvare l’accessorio.'); }
      };
      grid.appendChild(button);
    });
  }
  function openWardrobe() {
    if (!currentUser) return;
    const missionWasOpen = !!cur || missionOpening || panel.classList.contains('on');
    if (missionWasOpen) closeMission();
    else if (window.HPHOTO_MODEL_READY) fly(HOME.pos, HOME.tgt);
    renderCosmeticGrid();
    document.body.classList.add('wardrobe-open');
    wardrobeOverlay.classList.add('on');
    wardrobeOverlay.setAttribute('aria-hidden', 'false');
    updateExperienceHUD();
    queueContextTutorial('wardrobe', 'La tua fotocamera, il tuo stile', 'Scegli un accessorio: ne puoi indossare uno alla volta. Se ne scegli un altro, sostituisce quello attuale. In modalità test cappello, sciarpa e moka sono tutti disponibili.', 'PRIMA VOLTA NELL’ARMADIO');
  }
  function closeWardrobe() {
    wardrobeOverlay.classList.remove('on');
    document.body.classList.remove('wardrobe-open');
    wardrobeOverlay.setAttribute('aria-hidden', 'true');
    updateExperienceHUD();
  }
  $('wardrobeBtn').addEventListener('click', openWardrobe);
  $('closeWardrobe').addEventListener('click', closeWardrobe);
  wardrobeOverlay.addEventListener('click', e => { if (e.target === wardrobeOverlay) closeWardrobe(); });
  $('tabWardrobe').addEventListener('click', openWardrobe);
  $('tabMissions').addEventListener('click', () => {
    closeWardrobe();
    closeAdminPanel();
    const missionWasOpen = !!cur || missionOpening || panel.classList.contains('on');
    if (missionWasOpen) closeMission();
    else if (window.HPHOTO_MODEL_READY) fly(HOME.pos, HOME.tgt);
    refreshMissions();
  });

  // Tap the camera body itself to open the wardrobe; dragging still rotates the model.
  canvas.addEventListener('pointerdown', e => { lastPointer = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  canvas.addEventListener('pointerup', e => {
    if (!lastPointer || !currentUser || Date.now() - lastPointer.t > 700 ||
        Math.hypot(e.clientX - lastPointer.x, e.clientY - lastPointer.y) > 7 ||
        panel.classList.contains('on') || wardrobeOverlay.classList.contains('on') ||
        adminOverlay.classList.contains('on')) { lastPointer = null; return; }
    lastPointer = null;
    if (!window.reflexModel) return;
    const rect = canvas.getBoundingClientRect();
    const point = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(point, camera);
    const hits = ray.intersectObject(window.reflexModel, true);
    if (hits.length) openWardrobe();
  });

  async function getDemoAdminQueue() {
    return demoSubmissions().sort((a,b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (b.status === 'pending' && a.status !== 'pending') return 1;
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }
  async function getServerAdminQueue() {
    const client = await getSupabase();
    const { data, error } = await client.from('mission_submissions')
      .select('id,user_id,mission_id,storage_path,status,review_note,created_at,reviewed_at')
      .order('created_at', { ascending: false }).limit(80);
    if (error) throw error;
    const rows = data || [];
    const ids = [...new Set(rows.map(r => r.user_id))];
    let profiles = [];
    if (ids.length) {
      const result = await client.from('profiles').select('user_id,email,full_name').in('user_id', ids);
      if (result.error) throw result.error;
      profiles = result.data || [];
    }
    const byId = Object.fromEntries(profiles.map(p => [p.user_id, p]));
    for (const row of rows) {
      row.profile = byId[row.user_id] || {};
      const signed = await client.storage.from('mission-photos').createSignedUrl(row.storage_path, 3600);
      row.imageUrl = signed.data && signed.data.signedUrl ? signed.data.signedUrl : '';
    }
    return rows.sort((a,b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1));
  }
  function fmtDate(value) {
    try { return new Intl.DateTimeFormat('it-IT', { dateStyle:'medium', timeStyle:'short' }).format(new Date(value)); } catch (_) { return value || ''; }
  }
  async function openAdminPanel() {
    if (!currentUser || !currentProfile || currentProfile.role !== 'admin') {
      setAuthMessage('Il tuo account non ha i permessi di amministratore.', 'error');
      return;
    }
    adminOverlay.classList.add('on');
    adminOverlay.setAttribute('aria-hidden','false');
    $('adminQueue').innerHTML = '<div class="queue-empty">Caricamento delle foto…</div>';
    try {
      const rows = demoMode ? await getDemoAdminQueue() : await getServerAdminQueue();
      renderAdminQueue(rows);
    } catch (error) {
      $('adminQueue').innerHTML = '';
      addText($('adminQueue'), 'div', 'queue-empty', error.message || 'Non riesco a caricare le revisioni.');
    }
  }
  function buildReviewChecklist(parent, mission) {
    const box = document.createElement('section'); box.className = 'review-checklist';
    addText(box, 'strong', 'review-checklist-title', 'Controlla la foto');
    addText(box, 'p', 'review-checklist-help', 'Spunta i criteri che riconosci nello scatto. Per approvare devono essere presenti tutti; se ne manca uno, scegli “Da rifare” e dai un suggerimento.');
    const checks = [];
    (mission.criteria || []).forEach(text => {
      const label = document.createElement('label'); label.className = 'review-check';
      const input = document.createElement('input'); input.type = 'checkbox'; input.setAttribute('aria-label', text);
      label.appendChild(input);
      addText(label, 'span', '', text);
      box.appendChild(label); checks.push(input);
    });
    parent.appendChild(box);
    return { isComplete: () => checks.length > 0 && checks.every(input => input.checked), bind: button => {
      const update = () => { button.disabled = !checks.every(input => input.checked); };
      checks.forEach(input => input.addEventListener('change', update));
    }};
  }

  function renderAdminQueue(rows) {
    const queue = $('adminQueue');
    queue.innerHTML = '';
    const waiting = rows.filter(row => row.status === 'pending').length;
    $('adminSummary').textContent = waiting + ' foto in attesa · ' + rows.length + ' invii totali';
    if (!rows.length) {
      addText(queue, 'div', 'queue-empty', 'Non ci sono ancora foto inviate. Quando un utente consegna uno scatto, lo troverai qui.');
      return;
    }
    rows.forEach(row => {
      const card = document.createElement('article'); card.className = 'queue-item';
      const reviewMission = M.find(m => m.id === Number(row.mission_id));
      addText(card, 'div', 'queue-title', 'Missione ' + (reviewMission ? String(reviewMission.order).padStart(2,'0') : row.mission_id) + ' · ' + (reviewMission ? reviewMission.t : 'Missione'));
      if (reviewMission) addText(card, 'div', 'queue-meta', reviewMission.chapter + ' · ' + reviewMission.lvl);
      const profile = row.profile || {};
      const who = row.full_name || profile.full_name || row.email || profile.email || row.user_id || 'Utente';
      addText(card, 'div', 'queue-meta', who + ' · ' + (row.email || profile.email || '') + '\nInviata il ' + fmtDate(row.created_at) + '\nStato: ' + statusLabel(row.status));
      const imageUrl = row.image || row.imageUrl;
      if (imageUrl) {
        const img = document.createElement('img'); img.className = 'queue-photo'; img.alt = 'Foto inviata per la missione ' + row.mission_id; img.src = imageUrl; img.loading = 'lazy'; card.appendChild(img);
      } else addText(card, 'div', 'queue-empty', 'Anteprima foto non disponibile.');
      if (row.status === 'pending') {
        const rubric = reviewMission ? buildReviewChecklist(card, reviewMission) : null;
        const note = document.createElement('textarea'); note.className = 'queue-note'; note.maxLength = 800; note.placeholder = 'Un suggerimento concreto per il fotografo (facoltativo)…'; note.value = row.review_note || ''; card.appendChild(note);
        const actions = document.createElement('div'); actions.className = 'queue-actions';
        const approve = addText(actions, 'button', 'approve', 'Approva · completata'); approve.type = 'button';
        const redo = addText(actions, 'button', 'redo', 'Da rifare'); redo.type = 'button';
        approve.disabled = !!rubric && !rubric.isComplete();
        if (rubric) rubric.bind(approve);
        approve.onclick = () => reviewSubmission(row, 'approved', note.value, approve, redo);
        redo.onclick = () => reviewSubmission(row, 'retry', note.value, approve, redo);
        card.appendChild(actions);
      } else if (row.review_note) {
        addText(card, 'div', 'queue-meta', 'Feedback: ' + row.review_note);
      }
      queue.appendChild(card);
    });
  }
  async function reviewSubmission(row, status, note, buttonA, buttonB) {
    buttonA.disabled = buttonB.disabled = true;
    buttonA.textContent = 'Salvataggio…';
    try {
      if (demoMode) {
        const rows = demoSubmissions();
        const target = rows.find(x => x.id === row.id);
        if (!target) throw new Error('Invio non trovato sul dispositivo.');
        target.status = status;
        target.review_note = note.trim().slice(0,800);
        target.reviewed_at = new Date().toISOString();
        target.reviewed_by = currentUser.id;
        saveDemoSubmissions(rows);
        const progressKeyForUser = 'reflex-progress-v1:' + target.user_id;
        let progress = {};
        try { progress = JSON.parse(localStorage.getItem(progressKeyForUser) || '{}'); } catch (_) {}
        progress[target.mission_id] = { s: status, c: [], review_note: target.review_note };
        localStorage.setItem(progressKeyForUser, JSON.stringify(progress));
        if (currentUser.id === target.user_id) { P = progress; save(); refreshMissions(); }
      } else {
        const client = await getSupabase();
        const { error } = await client.from('mission_submissions').update({
          status, review_note: note.trim().slice(0,800), reviewed_at: new Date().toISOString(), reviewed_by: currentUser.id
        }).eq('id', row.id).eq('status', 'pending');
        if (error) throw error;
      }
      await openAdminPanel();
    } catch (error) {
      buttonA.disabled = buttonB.disabled = false;
      buttonA.textContent = 'Approva · completata';
      alert(error.message || 'Impossibile salvare la revisione.');
    }
  }
  function closeAdminPanel() {
    adminOverlay.classList.remove('on');
    adminOverlay.setAttribute('aria-hidden','true');
  }
  $('adminBtn').addEventListener('click', openAdminPanel);
  $('closeAdmin').addEventListener('click', closeAdminPanel);
  adminOverlay.addEventListener('click', e => { if (e.target === adminOverlay) closeAdminPanel(); });

  function showAppShell() {
    welcome.classList.add('dismissed');
    setTimeout(() => { if (currentUser) welcome.style.display = 'none'; }, 430);
    $('navUser').textContent = currentProfile.full_name || currentUser.email;
    $('navUser').hidden = false;
    $('wardrobeBtn').hidden = false;
    $('logoutBtn').hidden = false;
    $('adminBtn').hidden = currentProfile.role !== 'admin';
    document.body.classList.add('authenticated');
    $('rollHUD').hidden = false; $('bottomNav').hidden = false;
    refreshMissions();
  }
  async function enterSession(user, profile) {
    clearTutorialQueue();
    currentUser = user;
    currentProfile = Object.assign({ role:'student', full_name:user.email || 'Fotografo', email:user.email || '' }, profile || {});
    setAuthMessage('');
    $('demoNote').hidden = !demoMode;
    showAppShell();
    try {
      await loadProgress();
      await loadCosmetic();
    } catch (error) {
      setAuthMessage('Accesso effettuato, ma alcuni dati non si sono sincronizzati: ' + (error.message || ''), 'error');
    }
    refreshMissions();
    if (currentProfile.role !== 'admin') queueContextTutorial('mission-map', 'Questa fotocamera è la tua mappa', 'Tocca una targhetta per scoprire una missione. Puoi esplorare i capitoli Composizione, Luce e Tecnica; accetta una sfida solo quando ti va.', 'PRIMA VOLTA');
  }
  function showAuth() {
    welcome.style.display = 'grid';
    welcome.classList.remove('dismissed');
    document.body.classList.remove('authenticated');
    $('navUser').hidden = true;
    $('wardrobeBtn').hidden = true;
    $('adminBtn').hidden = true;
    $('logoutBtn').hidden = true;
    $('rollHUD').hidden = true; $('bottomNav').hidden = true;
    $('adminCode').value = '';
    $('authPassword').value = '';
    adminMode = false;
    authMode = 'login';
    updateAuthUI();
  }
  async function logout() {
    clearTutorialQueue();
    try {
      if (!demoMode && sb) await sb.auth.signOut();
    } catch (_) {}
    localStorage.removeItem('hphoto-demo-session-v1');
    currentUser = null;
    currentProfile = null;
    closeMission();
    closeWardrobe();
    closeAdminPanel();
    P = {};
    progressKey = 'reflex-progress-v1:guest';
    showAuth();
  }
  $('logoutBtn').addEventListener('click', logout);

  function updateAuthUI() {
    const isSignup = authMode === 'signup' && !adminMode;
    nameField.hidden = !isSignup;
    adminCodeField.hidden = !(adminMode && demoMode);
    if (isSignup) {
      authIntro.textContent = 'Crea il tuo account per inviare le missioni e seguire la revisione dei tuoi scatti.';
      authSubmit.textContent = 'Crea account';
      $('modeToggle').textContent = 'Ho già un account';
      $('adminModeBtn').textContent = 'Area admin';
    } else if (adminMode) {
      authIntro.textContent = 'Accesso riservato ai revisori. In modalità demo usa il codice amministratore indicato nel file di configurazione.';
      authSubmit.textContent = 'Accedi all’area admin';
      $('modeToggle').textContent = 'Accesso utente';
      $('adminModeBtn').textContent = 'Torna indietro';
    } else {
      authIntro.textContent = 'Accedi per vedere la fotocamera, scegliere una missione e inviare il tuo scatto alla revisione.';
      authSubmit.textContent = 'Accedi';
      $('modeToggle').textContent = 'Crea account';
      $('adminModeBtn').textContent = 'Area admin';
    }
    $('authPassword').autocomplete = isSignup ? 'new-password' : 'current-password';
    $('demoNote').hidden = !demoMode;
  }
  $('modeToggle').addEventListener('click', () => {
    adminMode = false;
    authMode = authMode === 'signup' ? 'login' : 'signup';
    setAuthMessage('');
    updateAuthUI();
  });
  $('adminModeBtn').addEventListener('click', () => {
    if (adminMode) adminMode = false;
    else { adminMode = true; authMode = 'login'; }
    setAuthMessage('');
    updateAuthUI();
  });

  async function handleDemoAuth(email, password, name) {
    const users = demoUsers();
    const existing = users[email];
    const digest = await passwordDigest(password);
    if (adminMode) {
      if (!$('adminCode').value || $('adminCode').value !== (CFG.demoAdminCode || '')) {
        throw new Error('Codice admin non valido. In demo è configurato in supabase-config.js.');
      }
      if (existing) {
        if (existing.passwordHash !== digest) throw new Error('Password non corretta per questo account.');
        existing.role = 'admin';
        users[email] = existing;
      } else {
        users[email] = { id: 'demo-' + cryptoRandomId(), email, full_name: name || email.split('@')[0], passwordHash: digest, role: 'admin', created_at: new Date().toISOString() };
      }
      saveDemoUsers(users);
      localStorage.setItem('hphoto-demo-session-v1', users[email].id);
      return users[email];
    }
    if (authMode === 'signup') {
      if (existing) throw new Error('Esiste già un account con questa email. Accedi.');
      if (password.length < 6) throw new Error('La password deve contenere almeno 6 caratteri.');
      const record = { id:'demo-' + cryptoRandomId(), email, full_name:name || email.split('@')[0], passwordHash:digest, role:'student', created_at:new Date().toISOString() };
      users[email] = record;
      saveDemoUsers(users);
      localStorage.setItem('hphoto-demo-session-v1', record.id);
      return record;
    }
    if (!existing || existing.passwordHash !== digest) throw new Error('Email o password non corretti.');
    localStorage.setItem('hphoto-demo-session-v1', existing.id);
    return existing;
  }
  function cryptoRandomId() {
    try { return crypto.randomUUID(); } catch (_) { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
  }
  async function fetchProfile(user) {
    const client = await getSupabase();
    const { data, error } = await client.from('profiles')
      .select('user_id,email,full_name,role').eq('user_id', user.id).single();
    if (error) throw error;
    return data;
  }
  authForm.addEventListener('submit', async event => {
    event.preventDefault();
    setAuthMessage('');
    const email = $('authEmail').value.trim().toLowerCase();
    const password = $('authPassword').value;
    const name = $('authName').value.trim();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setAuthMessage('Inserisci un indirizzo email valido.', 'error');
    if (!password || password.length < 6) return setAuthMessage('Inserisci una password di almeno 6 caratteri.', 'error');
    authSubmit.disabled = true;
    authSubmit.textContent = 'Un momento…';
    try {
      if (demoMode) {
        const user = await handleDemoAuth(email, password, name);
        await enterSession(user, { user_id:user.id, email:user.email, full_name:user.full_name, role:user.role });
        if (adminMode) await openAdminPanel();
        return;
      }
      const client = await getSupabase();
      let user;
      if (authMode === 'signup' && !adminMode) {
        const { data, error } = await client.auth.signUp({ email, password, options: { data: { full_name:name || email.split('@')[0] } } });
        if (error) throw error;
        if (!data.session || !data.user) {
          setAuthMessage('Account creato. Se hai attivato la conferma email, conferma l’indirizzo e poi accedi.', 'success');
          return;
        }
        user = data.user;
      } else {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        user = data.user;
      }
      const profile = await fetchProfile(user);
      if (adminMode && profile.role !== 'admin') {
        await client.auth.signOut();
        throw new Error('Questo account non è autorizzato come amministratore. Assegna role=admin nella tabella profiles.');
      }
      await enterSession(user, profile);
      if (adminMode) await openAdminPanel();
    } catch (error) {
      setAuthMessage(error.message || 'Accesso non riuscito. Riprova.', 'error');
    } finally {
      authSubmit.disabled = false;
      updateAuthUI();
    }
  });

  async function startup() {
    if (demoMode) {
      const id = demoSessionId();
      const users = demoUsers();
      const user = Object.values(users).find(x => x.id === id);
      if (user) {
        await enterSession(user, { user_id:user.id, email:user.email, full_name:user.full_name, role:user.role });
        return;
      }
      updateAuthUI();
      return;
    }
    if (!isRealBackendConfigured()) {
      setAuthMessage('Supabase non è configurato. Inserisci URL e anon key in supabase-config.js, oppure abilita la modalità demo.', 'error');
      return;
    }
    try {
      const client = await getSupabase();
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (data.session && data.session.user) {
        const profile = await fetchProfile(data.session.user);
        await enterSession(data.session.user, profile);
      }
    } catch (error) {
      setAuthMessage(error.message || 'Non riesco a controllare la sessione.', 'error');
    }
  }
  updateAuthUI();
  startup();
  if (!demoMode) {
    setInterval(async () => {
      if (!currentUser || document.hidden || adminOverlay.classList.contains('on')) return;
      try {
        await syncProgressFromBackend();
        refreshMissions();
        if (cur) renderMission();
      } catch (_) { /* transient network failures are retried on the next cycle */ }
    }, 25000);
  }

  // Android Back closes the topmost in-app sheet before leaving the activity.
  window.HPHOTO_BACK = function() {
    if (adminOverlay.classList.contains('on')) { closeAdminPanel(); return true; }
    if (wardrobeOverlay.classList.contains('on')) { closeWardrobe(); return true; }
    if (cur || missionOpening || panel.classList.contains('on')) { closeMission(); return true; }
    return false;
  };
})();
