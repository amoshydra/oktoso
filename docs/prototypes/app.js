const captureParam = new URLSearchParams(location.search).get("capture");
const captureMode =
  captureParam === "inbox" || captureParam === "session" ? captureParam : null;
const captureNow = captureMode ? Date.UTC(2026, 9, 27, 10, 52, 0) : undefined;
const now = captureNow ?? Date.now();
const nowMs = () => captureNow ?? Date.now();
const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

const icons = {
  inbox: '<path d="M4 5h16v14H4z"/><path d="M4 13h4l2 2h4l2-2h4"/>',
  sessions: '<path d="M5 5h14v10H9l-4 4V5z"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
  providers: '<path d="M4 7h16M7 4v6M4 17h16M17 14v6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  send: '<path d="m5 12 14-7-4 7 4 7-14-7z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
  moon: '<path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5z"/>',
  details: '<path d="M4 5h16v14H4z"/><path d="M15 5v14"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v6H4V6h6"/>',
  terminal: '<path d="m5 7 5 5-5 5M12 17h7"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  alert: '<path d="M12 3 2 21h20L12 3z"/><path d="M12 9v5M12 18h.01"/>',
  voice: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  attach: '<path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L14 3a3.5 3.5 0 0 1 5 5l-9.5 9.5a2 2 0 0 1-3-3L15 6"/>',
};

function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ''}</svg>`;
}

function brandMark(size = 36) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 512 512" aria-hidden="true" focusable="false">
    <rect width="512" height="512" rx="116" fill="var(--accent)"/>
    <path d="M 256 96 L 369 143 L 416 256 L 369 369 L 256 416 L 143 369 L 96 256 L 143 143 Z" fill="none" stroke="var(--on-accent)" stroke-width="44" stroke-linejoin="round"/>
    <circle cx="256" cy="256" r="44" fill="var(--on-accent)"/>
  </svg>`;
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function relative(ts) {
  const delta = nowMs() - ts;
  if (delta < minute) return 'now';
  const minutes = Math.floor(delta / minute);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(delta / hour);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(delta / day);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const providers = [
  {
    id: 'desktop-opencode',
    name: 'desktop-opencode',
    type: 'opencode',
    label: 'OpenCode',
    baseUrl: '192.0.2.2:4096',
    status: 'online',
    version: '2.0.22',
    caps: ['list', 'read', 'send', 'create', 'stream', 'permissions', 'forms'],
    mark: 'OC',
  },
  {
    id: 'laptop-opencode',
    name: 'laptop-opencode',
    type: 'opencode',
    label: 'OpenCode',
    baseUrl: '192.0.2.3:4096',
    status: 'online',
    version: '2.0.22',
    caps: ['list', 'read', 'send', 'create', 'stream', 'permissions', 'forms'],
    mark: 'OC',
  },
  {
    id: 'openwebui',
    name: 'openwebui',
    type: 'openwebui',
    label: 'Open WebUI',
    baseUrl: 'openwebui.example',
    status: 'auth-error',
    version: '0.6',
    caps: ['list', 'read', 'send', 'create', 'stream'],
    mark: 'OW',
    error: 'API key rejected. Update the provider token.',
  },
  {
    id: 'rpi-hermes',
    name: 'rpi-hermes',
    type: 'hermes',
    label: 'Hermes',
    baseUrl: '192.0.2.4:8642',
    status: 'offline',
    version: '0.9',
    caps: ['list', 'read', 'send', 'create', 'stream', 'interrupt', 'approvals'],
    mark: 'H',
    error: 'Last seen 4m ago.',
  },
];

function providerByID(id) {
  return providers.find((provider) => provider.id === id);
}

function providerClass(type) {
  return type === 'openwebui' ? 'openwebui' : type === 'hermes' ? 'hermes' : 'opencode';
}

function providerLabel(provider) {
  return provider ? provider.label : 'Unknown';
}

function sessionByRef(ref) {
  return sessions.find((session) => session.ref === ref);
}

function message(role, text, extra = {}) {
  return { role, text, time: now - 8 * minute, ...extra };
}

const sessions = [
  {
    ref: 'desktop-opencode:ses_auth',
    providerID: 'desktop-opencode',
    nativeID: 'ses_auth',
    title: 'Fix auth race in gateway',
    project: 'oktoso',
    directory: '/home/me/oktoso',
    agent: 'build',
    model: 'claude-sonnet',
    status: 'running',
    unread: false,
    pinned: true,
    updated: now - 2 * minute,
    createdAt: now - 46 * minute,
    attention: 'permission',
    cost: 0.42,
    tokens: '142k',
    messages: [
      message('user', 'Fix the auth race in the gateway. The refresh path has two writers and the token rotates while a request is reading it.', { time: now - 40 * minute }),
      message('assistant', 'The race comes from two writers sharing the refresh token. One rotates it while the other reads it. I will serialize rotation and add a test around the failing path.', {
        time: now - 38 * minute,
        reasoning: 'I checked the refresh path first. The token store has a read-modify-write pair without a lock. The test failure is deterministic when two requests land within the same tick.',
      }),
      message('tool', 'read src/auth/refresh.ts', {
        tool: 'read',
        status: 'completed',
        body: '// refresh token rotation\n// two callers can enter rotate() before the write',
        time: now - 37 * minute,
      }),
      message('user', 'Continue with the failing test.', { time: now - 6 * minute }),
      message('assistant', 'The failing test is in `auth.test.ts`. I am narrowing it to the double-refresh case first, then I will make rotation idempotent for the same token generation.', { time: now - 1 * minute, streaming: true }),
    ],
  },
  {
    ref: 'laptop-opencode:ses_index',
    providerID: 'laptop-opencode',
    nativeID: 'ses_index',
    title: 'Refactor session index',
    project: 'oktoso-api',
    directory: '/home/me/oktoso-api',
    agent: 'build',
    model: 'claude-sonnet',
    status: 'idle',
    unread: true,
    updated: now - 18 * minute,
    createdAt: now - 3 * hour,
    attention: 'unread',
    cost: 0.18,
    tokens: '68k',
    messages: [
      message('user', 'Make the session index tolerant of provider restarts.', { time: now - 70 * minute }),
      message('assistant', 'I moved provider discovery into its own loop and kept the session cache warm across reconnects. The index now reconciles by native session ID instead of assuming the list is complete.', { time: now - 18 * minute }),
    ],
  },
  {
    ref: 'openwebui:chat_q4',
    providerID: 'openwebui',
    nativeID: 'chat_q4',
    title: 'Q4 planning',
    project: 'Product',
    directory: '/openwebui/Product',
    agent: 'assistant',
    model: 'hermes-agent',
    status: 'idle',
    unread: true,
    updated: now - 22 * minute,
    createdAt: now - 5 * hour,
    attention: 'unread',
    cost: 0.03,
    tokens: '12k',
    messages: [
      message('user', 'Pull the launch risks into three buckets: product, platform, and go-to-market.', { time: now - 60 * minute }),
      message('assistant', 'I pulled the launch risks into three buckets. Product risks center on the onboarding flow; platform risks are mostly rate limits and the export path; go-to-market risks are pricing clarity and support load.', {
        time: now - 22 * minute,
        reasoning: 'I grouped the notes by the team that owns the mitigation, then collapsed duplicate risks from the launch review.',
      }),
    ],
  },
  {
    ref: 'rpi-hermes:hermes_pi',
    providerID: 'rpi-hermes',
    nativeID: 'hermes_pi',
    title: 'Pi deployment notes',
    project: 'rpi',
    directory: '/home/pi/hermes',
    agent: 'hermes',
    model: 'hermes-agent',
    status: 'idle',
    unread: false,
    updated: now - 58 * minute,
    createdAt: now - 2 * hour,
    attention: 'question',
    cost: 0.01,
    tokens: '4k',
    messages: [
      message('user', 'Write the deployment notes for the Pi gateway.', { time: now - 80 * minute }),
      message('assistant', 'I have the systemd unit and the environment file. Pick a default model and I will finish the notes with the exact gateway command.', { time: now - 58 * minute }),
    ],
  },
  {
    ref: 'desktop-opencode:ses_rust',
    providerID: 'desktop-opencode',
    nativeID: 'ses_rust',
    title: 'Port hub to Rust',
    project: 'oktoso',
    directory: '/home/me/oktoso',
    agent: 'build',
    model: 'claude-sonnet',
    status: 'error',
    unread: false,
    updated: now - 2 * hour,
    createdAt: now - 4 * hour,
    attention: 'error',
    cost: 0.09,
    tokens: '31k',
    messages: [
      message('user', 'Prototype the Rust provider adapter.', { time: now - 3 * hour }),
      message('assistant', 'The first pass compiles, but the SSE parser fails when the provider sends a comment frame.', { time: now - 2 * hour, error: true }),
    ],
  },
  {
    ref: 'openwebui:chat_launch',
    providerID: 'openwebui',
    nativeID: 'chat_launch',
    title: 'Launch risks review',
    project: 'Product',
    directory: '/openwebui/Product',
    agent: 'assistant',
    model: 'hermes-agent',
    status: 'idle',
    unread: false,
    updated: now - 28 * hour,
    createdAt: now - 2 * day,
    messages: [
      message('user', 'Review the launch checklist.', { time: now - 30 * hour }),
      message('assistant', 'The checklist is complete except for the rollback owner and the customer-facing status page copy.', { time: now - 28 * hour }),
    ],
  },
  {
    ref: 'laptop-opencode:ses_glasses',
    providerID: 'laptop-opencode',
    nativeID: 'ses_glasses',
    title: 'Even G2 inbox prototype',
    project: 'oktoso-glasses',
    directory: '/home/me/oktoso-glasses',
    agent: 'build',
    model: 'claude-sonnet',
    status: 'idle',
    unread: false,
    updated: now - 32 * hour,
    createdAt: now - 3 * day,
    messages: [
      message('user', 'Draft the glasses inbox flow.', { time: now - 33 * hour }),
      message('assistant', 'The inbox should show one blocking item at a time with the action in the footer. Long text belongs on the phone.', { time: now - 32 * hour }),
    ],
  },
  {
    ref: 'rpi-hermes:hermes_models',
    providerID: 'rpi-hermes',
    nativeID: 'hermes_models',
    title: 'Model inventory',
    project: 'rpi',
    directory: '/home/pi/hermes',
    agent: 'hermes',
    model: 'hermes-agent',
    status: 'offline',
    unread: false,
    updated: now - 2 * day,
    createdAt: now - 4 * day,
    messages: [
      message('user', 'List the local models the gateway can reach.', { time: now - 2 * day }),
      message('assistant', 'The Pi can reach the gateway but not the local model server. Check the WireGuard route and the model server bind address.', { time: now - 2 * day }),
    ],
  },
];

let attention = [
  {
    id: 'desktop-opencode:permission:per_123',
    sessionRef: 'desktop-opencode:ses_auth',
    type: 'permission',
    priority: 'blocking',
    title: 'Run shell command',
    summary: 'git push origin main',
    createdAt: now - 2 * minute,
    actions: [
      { id: 'approve_once', label: 'Allow once', style: 'primary' },
      { id: 'approve_always', label: 'Always allow' },
      { id: 'deny', label: 'Deny', style: 'danger' },
    ],
  },
  {
    id: 'rpi-hermes:question:frm_1',
    sessionRef: 'rpi-hermes:hermes_pi',
    type: 'question',
    priority: 'blocking',
    title: 'Which model should the gateway use?',
    summary: 'Hermes needs a default model for the Pi gateway.',
    createdAt: now - 14 * minute,
    options: ['Hermes 3 70B', 'Hermes 3 8B', 'Custom'],
    actions: [{ id: 'answer', label: 'Answer', style: 'primary' }],
  },
  {
    id: 'laptop-opencode:unread:ses_index',
    sessionRef: 'laptop-opencode:ses_index',
    type: 'unread',
    priority: 'normal',
    title: 'Refactor session index',
    summary: 'The index now reconciles by native session ID.',
    createdAt: now - 18 * minute,
    actions: [{ id: 'mark_read', label: 'Mark read' }],
  },
  {
    id: 'desktop-opencode:error:ses_rust',
    sessionRef: 'desktop-opencode:ses_rust',
    type: 'error',
    priority: 'high',
    title: 'Port hub to Rust',
    summary: 'SSE parser fails on a comment frame.',
    createdAt: now - 2 * hour,
    actions: [
      { id: 'retry', label: 'Retry', style: 'primary' },
      { id: 'dismiss', label: 'Dismiss' },
    ],
  },
];

const state = {
  view: 'inbox',
  selectedRef: 'desktop-opencode:ses_auth',
  providerFilter: 'all',
  sessionQuery: '',
  inboxFilter: 'all',
  searchQuery: '',
  detailsOpen: false,
  detailsClosed: false,
};

const app = document.getElementById('app');
const modalBackdrop = document.getElementById('modal-backdrop');
const toastEl = document.getElementById('toast');
let toastTimer;

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('oktoso-theme', theme);
}

const savedTheme = captureMode ? 'dark' : localStorage.getItem('oktoso-theme') || 'dark';
setTheme(savedTheme);

function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1900);
}

function selectedSession() {
  return sessionByRef(state.selectedRef) || sessions[0];
}

function attentionForSession(ref) {
  return attention.find((item) => item.sessionRef === ref);
}

function filteredSessions() {
  const query = state.sessionQuery.trim().toLowerCase();
  return sessions
    .filter((session) => {
      const provider = providerByID(session.providerID);
      if (state.providerFilter !== 'all' && provider?.type !== state.providerFilter) return false;
      if (!query) return true;
      return [session.title, session.project, session.directory, provider?.label, provider?.name]
        .join(' ')
        .toLowerCase()
        .includes(query);
    })
    .sort((a, b) => b.updated - a.updated);
}

function groupSessions(list) {
  const groups = new Map();
  for (const session of list) {
    const label = session.pinned
      ? 'Pinned'
      : nowMs() - session.updated < day
        ? 'Today'
        : nowMs() - session.updated < 2 * day
          ? 'Yesterday'
          : 'Earlier';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(session);
  }
  return groups;
}

function renderRail() {
  const items = [
    ['inbox', 'Inbox', 'inbox'],
    ['sessions', 'Sessions', 'sessions'],
    ['search', 'Search', 'search'],
    ['providers', 'Providers', 'providers'],
    ['settings', 'Settings', 'settings'],
  ];
  const count = attention.filter((item) => item.priority === 'blocking').length;

  document.getElementById('rail').innerHTML = `
    <div class="rail-logo" role="img" aria-label="Oktoso" title="Oktoso">${brandMark(36)}</div>
    ${items
      .map(
        ([view, label, iconName]) => `
        <button class="rail-btn ${state.view === view ? 'active' : ''}" data-view="${view}" title="${label}">
          ${icon(iconName, 18)}
          <span class="label">${label}</span>
          ${view === 'inbox' && count ? `<span class="count">${count}</span>` : ''}
        </button>`,
      )
      .join('')}
    <div class="rail-footer">
      <div class="rail-status">
        <span><i style="background:var(--success)"></i>${providers.filter((provider) => provider.status === 'online').length} live</span>
        <span><i style="background:var(--faint)"></i>${providers.filter((provider) => provider.status !== 'online').length} down</span>
      </div>
      <button class="theme-btn" data-theme-toggle title="Toggle theme" aria-label="Toggle theme">
        ${icon(document.documentElement.dataset.theme === 'light' ? 'moon' : 'sun', 15)}
      </button>
    </div>
  `;
}

function renderBottomNav() {
  const items = [
    ['inbox', 'Inbox', 'inbox'],
    ['sessions', 'Sessions', 'sessions'],
    ['search', 'Search', 'search'],
    ['settings', 'Settings', 'settings'],
  ];
  const count = attention.filter((item) => item.priority === 'blocking').length;

  document.getElementById('bottom-nav').innerHTML = items
    .map(
      ([view, label, iconName]) => `
      <button class="bottom-btn ${state.view === view ? 'active' : ''}" data-view="${view}">
        ${icon(iconName, 19)}
        <span>${label}</span>
        ${view === 'inbox' && count ? `<span class="count">${count}</span>` : ''}
      </button>`,
    )
    .join('');
}

function renderSidebar() {
  const list = filteredSessions();
  const groups = groupSessions(list);
  const filters = [
    ['all', 'All'],
    ['opencode', 'OpenCode'],
    ['openwebui', 'Open WebUI'],
    ['hermes', 'Hermes'],
  ];

  document.getElementById('sidebar').innerHTML = `
    <div class="sidebar-head">
      <div class="sidebar-title">Sessions</div>
      <button class="icon-btn" data-new-session title="New session" aria-label="New session">${icon('plus', 16)}</button>
    </div>
    <div class="sidebar-search">
      <input id="session-search" placeholder="Search sessions" value="${esc(state.sessionQuery)}" aria-label="Search sessions" />
    </div>
    <div class="filters">
      ${filters
        .map(
          ([value, label]) =>
            `<button class="chip ${state.providerFilter === value ? 'active' : ''}" data-provider-filter="${value}">${label}</button>`,
        )
        .join('')}
    </div>
    <div class="session-list" id="session-list">
      ${renderSessionListInner(groups)}
    </div>
  `;
}

function renderSessionListInner(groups) {
  if (groups.size === 0) {
    return '<div class="empty" style="margin:12px 4px"><strong>No sessions</strong>Adjust the filter or start a new session.</div>';
  }
  const order = ['Pinned', 'Today', 'Yesterday', 'Earlier'];
  const entries = [...groups.entries()].sort((left, right) => {
    const leftIndex = order.indexOf(left[0]);
    const rightIndex = order.indexOf(right[0]);
    return (leftIndex === -1 ? order.length : leftIndex) - (rightIndex === -1 ? order.length : rightIndex);
  });
  return entries
    .map(([label, rows]) => {
      return `
        <div class="list-label">${esc(label)}</div>
        ${rows
          .map((session) => {
            const provider = providerByID(session.providerID);
            const item = attentionForSession(session.ref);
            const active = state.selectedRef === session.ref;
            return `
              <button class="session-row ${active ? 'active' : ''} ${session.unread ? 'unread' : ''}" data-session="${esc(session.ref)}">
                <span class="session-dot ${esc(session.status)}" aria-hidden="true"></span>
                <span class="session-main">
                  <span class="session-title">${esc(session.title)}</span>
                  <span class="session-meta">
                    <span class="provider-badge ${providerClass(provider?.type || '')}"><i></i>${esc(providerLabel(provider))}</span>
                    <span>${esc(session.project)}</span>
                  </span>
                </span>
                <span class="session-flags">
                  <span class="session-time">${relative(session.updated)}</span>
                  ${item ? '<span class="attention-mini" role="img" aria-label="Needs attention" title="Needs attention"></span>' : ''}
                </span>
                <span class="sr-only">${esc(session.status)}${session.unread ? ', unread' : ''}${item ? ', needs attention' : ''}</span>
              </button>`;
          })
          .join('')}
      `;
    })
    .join('');
}

function topbar(title, sub, actions = '', back = false) {
  return `
    <div class="topbar">
      ${back ? `<button class="icon-btn mobile-back" data-view="sessions" aria-label="Back">${icon('back', 17)}</button>` : ''}
      <div style="min-width:0">
        <h1 class="topbar-title">${esc(title)}</h1>
        ${sub ? `<div class="topbar-sub">${esc(sub)}</div>` : ''}
      </div>
      <div class="topbar-spacer"></div>
      <div class="topbar-actions">${actions}</div>
    </div>
  `;
}

function renderInbox() {
  const filtered = attention.filter((item) => {
    if (state.inboxFilter === 'all') return true;
    if (state.inboxFilter === 'approvals') return item.type === 'permission' || item.type === 'approval';
    if (state.inboxFilter === 'questions') return item.type === 'question';
    if (state.inboxFilter === 'unread') return item.type === 'unread';
    if (state.inboxFilter === 'errors') return item.type === 'error';
    return true;
  });

  const groups = [
    ['Blocking', filtered.filter((item) => item.priority === 'blocking')],
    ['Unread', filtered.filter((item) => item.type === 'unread')],
    ['Errors', filtered.filter((item) => item.type === 'error')],
  ];

  const filters = [
    ['all', `All ${attention.length}`],
    ['approvals', 'Approvals'],
    ['questions', 'Questions'],
    ['unread', 'Unread'],
    ['errors', 'Errors'],
  ];

  const blocking = attention.filter((item) => item.priority === 'blocking').length;
  const sub = blocking ? `${blocking} need you` : 'Nothing needs you';

  return `
    ${topbar(
      'Inbox',
      sub,
      `<button class="btn small" data-new-session>${icon('plus', 14)} New session</button>`,
    )}
    <div class="content">
      <div class="page">
        <div class="inbox-tabs">
          ${filters
            .map(
              ([value, label]) =>
                `<button class="chip ${state.inboxFilter === value ? 'active' : ''}" data-inbox-filter="${value}">${label}</button>`,
            )
            .join('')}
        </div>
        ${groups
          .filter(([, items]) => items.length)
          .map(
            ([label, items]) => `
            <section class="inbox-group">
              <div class="inbox-group-head"><span>${label}</span><span class="line"></span><span>${items.length}</span></div>
              ${items.map(renderAttentionCard).join('')}
            </section>`,
          )
          .join('')}
        ${
          filtered.length === 0
            ? '<div class="empty"><strong>Nothing here</strong>Try another filter or browse sessions.</div>'
            : ''
        }
      </div>
    </div>
  `;
}

function renderAttentionCard(item) {
  const session = sessionByRef(item.sessionRef);
  const provider = session ? providerByID(session.providerID) : undefined;
  const typeLabel =
    item.type === 'permission'
      ? 'Permission'
      : item.type === 'question'
        ? 'Question'
        : item.type === 'error'
          ? 'Error'
          : 'Unread';

  const options =
    item.type === 'question' && item.options
      ? `<div class="question-options">${item.options
          .map(
            (option, index) =>
              `<button class="option-btn" data-answer-option="${index}" data-attention="${esc(item.id)}">${esc(option)}</button>`,
          )
          .join('')}</div>`
      : '';

  return `
    <article class="attention-card ${item.priority === 'blocking' ? 'blocking' : ''}">
      <div class="attention-top">
        <span class="type-badge ${esc(item.type)}">${typeLabel}</span>
        <span class="attention-provider">${esc(providerLabel(provider))}<span class="provider-host"> · ${esc(provider?.name || '')}</span></span>
        <span class="attention-age">${relative(item.createdAt)}</span>
      </div>
      <div class="attention-title">${esc(item.title)}</div>
      <div class="attention-summary">${esc(item.summary)}</div>
      ${options}
      <div class="attention-actions">
        ${item.actions
          .filter((action) => !(item.type === 'question' && action.id === 'answer'))
          .map(
            (action) =>
              `<button class="btn small ${action.style === 'primary' ? 'primary' : action.style === 'danger' ? 'danger' : ''}" data-attention-action="${esc(action.id)}" data-attention="${esc(item.id)}">${esc(action.label)}</button>`,
          )
          .join('')}
        <button class="attention-open" data-open-session="${esc(item.sessionRef)}">Open session</button>
      </div>
    </article>
  `;
}

function renderSessions() {
  const list = filteredSessions();
  const sub = `${list.length} session${list.length === 1 ? '' : 's'}`;

  return `
    ${topbar('Sessions', sub, `<button class="btn small" data-new-session>${icon('plus', 14)} New session</button>`)}
    <div class="content">
      <div class="page wide">
        <div class="page-head">
          <p class="page-desc">Every session across your providers. Open one to read the transcript, reply, or inspect details.</p>
        </div>
        <div class="session-table">
          <div class="session-table-head">
            <span>Session</span><span>Provider</span><span>Project</span><span>Status</span><span>Updated</span>
          </div>
          ${list
            .map((session) => {
              const provider = providerByID(session.providerID);
              const item = attentionForSession(session.ref);
              return `
                <div class="session-table-row ${session.unread ? 'unread' : ''}" data-session="${esc(session.ref)}">
                  <div class="session-table-title">
                    <span class="session-dot ${esc(session.status)}" aria-hidden="true"></span>
                    <strong>${esc(session.title)}</strong>
                    ${item ? '<span class="attention-mini" role="img" aria-label="Needs attention" title="Needs attention"></span>' : ''}
                    ${session.unread ? '<span class="sr-only">Unread</span>' : ''}
                  </div>
                  <span class="provider-badge ${providerClass(provider?.type || '')} hide-mobile"><i></i>${esc(providerLabel(provider))}</span>
                  <span class="project-label hide-mobile">${esc(session.project)}</span>
                  <span class="status-chip ${esc(session.status)}"><i></i>${esc(session.status)}</span>
                  <span class="session-time">${relative(session.updated)}</span>
                </div>`;
            })
            .join('')}
        </div>
      </div>
    </div>
  `;
}

function messageBody(text) {
  return text
    .split('\n\n')
    .map((paragraph) => `<p>${esc(paragraph).replace(/`([^`]+)`/g, '<code>$1</code>')}</p>`)
    .join('');
}

function renderInlineAttention(item) {
  if (!item) return '';
  if (item.type === 'permission') {
    return `
      <div class="inline-attention">
        <div class="label">Permission requested</div>
        <div class="title">${esc(item.title)}</div>
        <div class="command">${esc(item.summary)}</div>
        <div class="attention-actions">
          ${item.actions
            .map(
              (action) =>
                `<button class="btn small ${action.style === 'primary' ? 'primary' : action.style === 'danger' ? 'danger' : ''}" data-attention-action="${esc(action.id)}" data-attention="${esc(item.id)}">${esc(action.label)}</button>`,
            )
            .join('')}
        </div>
      </div>`;
  }
  if (item.type === 'question') {
    return `
      <div class="inline-attention">
        <div class="label">Question</div>
        <div class="title">${esc(item.title)}</div>
        <div class="question-options" style="margin-top:var(--space-3)">
          ${(item.options || [])
            .map(
              (option, index) =>
                `<button class="option-btn" data-answer-option="${index}" data-attention="${esc(item.id)}">${esc(option)}</button>`,
            )
            .join('')}
        </div>
      </div>`;
  }
  if (item.type === 'error') {
    return `
      <div class="inline-attention" style="border-color:color-mix(in srgb,var(--danger) 34%,var(--border))">
        <div class="label" style="color:var(--danger)">Run failed</div>
        <div class="title">${esc(item.summary)}</div>
        <div class="attention-actions" style="margin-top:var(--space-3)">
          <button class="btn small" data-attention-action="retry" data-attention="${esc(item.id)}">Retry</button>
        </div>
      </div>`;
  }
  return '';
}

function renderMessage(msg) {
  if (msg.role === 'tool') {
    return `
      <div class="tool-card">
        <div class="tool-head">${icon('terminal', 13)} <span class="tool-name">${esc(msg.tool || 'tool')}</span> <span class="tool-status">${esc(msg.status || 'completed')}</span></div>
        <div class="tool-body">${esc(msg.body || msg.text)}</div>
      </div>`;
  }
  const isUser = msg.role === 'user';
  return `
    <div class="message ${isUser ? 'user' : 'assistant'}">
      <div class="message-role">
        <span class="avatar">${isUser ? 'Y' : 'A'}</span>
        ${isUser ? 'You' : 'Agent'}
      </div>
      <div class="message-body">
        ${msg.reasoning ? `<details class="reasoning"><summary>${icon('details', 12)} Reasoning</summary><div class="reasoning-body">${esc(msg.reasoning)}</div></details>` : ''}
        ${messageBody(msg.text)}
        ${msg.streaming ? '<span class="streaming-cursor"></span>' : ''}
      </div>
    </div>`;
}

function renderChat() {
  const session = selectedSession();
  const provider = providerByID(session.providerID);
  const item = attentionForSession(session.ref);
  const meta = `${providerLabel(provider)} <span class="dot-sep">·</span> ${esc(session.project)} <span class="dot-sep">·</span> ${esc(session.agent)} <span class="dot-sep">·</span> ${esc(session.model)}`;

  return `
    ${topbar(
      session.title,
      '',
      `<button class="icon-btn" data-open-details title="Session details" aria-label="Session details">${icon('details', 16)}</button>
       <a class="icon-btn" href="#" data-open-provider title="Open in provider" aria-label="Open in provider">${icon('external', 16)}</a>
       <button class="icon-btn" data-more title="More" aria-label="More">${icon('more', 16)}</button>`,
      true,
    )}
    <div class="chat-wrap">
      <div class="transcript" id="transcript">
        <div class="transcript-inner">
          <div class="chat-session-head">
            <div class="chat-session-title">${esc(session.title)}</div>
            <div class="chat-session-meta">
              <span class="provider-badge ${providerClass(provider?.type || '')}"><i></i>${esc(providerLabel(provider))}</span>
              <span class="dot-sep">·</span><span>${esc(session.project)}</span>
              <span class="dot-sep">·</span><span>${esc(session.agent)}</span>
              <span class="dot-sep">·</span><span>${esc(session.model)}</span>
              <span class="dot-sep">·</span><span class="status-chip ${esc(session.status)}"><i></i>${esc(session.status)}</span>
            </div>
          </div>
          ${session.messages.map(renderMessage).join('')}
          ${renderInlineAttention(item)}
          ${session.status === 'error' && !item ? renderInlineAttention({ type: 'error', summary: 'The last run failed.', actions: [] }) : ''}
        </div>
      </div>
      <div class="composer-wrap">
        <form class="composer" id="composer-form">
          <textarea id="composer" placeholder="Reply to ${esc(session.title)}…" rows="1"></textarea>
          <div class="composer-bar">
            <button class="icon-btn" type="button" title="Attach" aria-label="Attach" data-attach>${icon('attach', 15)}</button>
            <select class="composer-select" id="composer-agent" name="agent" aria-label="Agent"><option>${esc(session.agent)}</option></select>
            <select class="composer-select" id="composer-model" name="model" aria-label="Model"><option>${esc(session.model)}</option></select>
            <span class="spacer"></span>
            <button class="icon-btn" type="button" title="Voice" aria-label="Voice">${icon('voice', 15)}</button>
            <button class="send-btn" type="submit" title="Send" aria-label="Send">${icon('send', 15)}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderDetails() {
  const session = selectedSession();
  const provider = providerByID(session.providerID);
  const item = attentionForSession(session.ref);

  return `
    <div class="details-head">
      <div class="details-title">Session details</div>
      <button class="icon-btn" data-close-details title="Close details" aria-label="Close details">${icon('close', 15)}</button>
    </div>
    <div class="details-section">
      <div class="details-label">Provider</div>
      <div class="details-value"><span class="provider-badge ${providerClass(provider?.type || '')}"><i></i>${esc(providerLabel(provider))}</span></div>
      <div class="details-value mono" style="margin-top:3px">${esc(provider?.baseUrl || '')}</div>
    </div>
    <div class="details-section">
      <div class="details-label">Session</div>
      <div class="details-value">${esc(session.title)}</div>
      <div class="details-value mono" style="margin-top:3px">${esc(session.ref)}</div>
    </div>
    <div class="details-section">
      <div class="details-label">Workspace</div>
      <div class="details-value">${esc(session.project)}</div>
      <div class="details-value mono" style="margin-top:3px">${esc(session.directory)}</div>
    </div>
    <div class="details-section">
      <div class="details-label">Run</div>
      <div class="detail-stat"><span>Status</span><span class="status-chip ${esc(session.status)}"><i></i>${esc(session.status)}</span></div>
      <div class="detail-stat"><span>Agent</span><span>${esc(session.agent)}</span></div>
      <div class="detail-stat"><span>Model</span><span>${esc(session.model)}</span></div>
      <div class="detail-stat"><span>Updated</span><span>${relative(session.updated) === 'now' ? 'now' : relative(session.updated) + ' ago'}</span></div>
      <div class="detail-stat"><span>Cost</span><span>$${Number(session.cost || 0).toFixed(2)}</span></div>
      <div class="detail-stat"><span>Tokens</span><span>${esc(session.tokens || '-')}</span></div>
    </div>
    ${
      item
        ? `<div class="details-section"><div class="details-label">Attention</div><div class="details-value">${esc(item.summary)}</div></div>`
        : ''
    }
    <div class="details-actions">
      <button class="btn small" data-open-provider>${icon('external', 13)} Open in ${esc(providerLabel(provider))}</button>
      <button class="btn small" data-copy-ref>Copy session reference</button>
      <button class="btn small" data-interrupt>Interrupt session</button>
    </div>
  `;
}

function renderProviders() {
  return `
    ${topbar('Providers', `${providers.filter((provider) => provider.status === 'online').length} online`, `<button class="btn small" data-add-provider>${icon('plus', 14)} Add provider</button>`)}
    <div class="content">
      <div class="page wide">
        <div class="page-head">
          <div>
            <p class="page-desc">The hub connects to each provider over the URL you configure. Credentials stay on the hub. Networking and TLS are yours to manage.</p>
          </div>
        </div>
        <div class="provider-list">
          ${providers
            .map((provider) => {
              const status = provider.status === 'online' ? 'running' : provider.status === 'auth-error' ? 'error' : 'offline';
              return `
                <article class="provider-card">
                  <div class="provider-main">
                    <div class="provider-mark ${providerClass(provider.type)}">${esc(provider.mark)}</div>
                    <div style="min-width:0">
                      <div class="provider-name">${esc(provider.name)}</div>
                      <div class="provider-address">${esc(provider.label)} · ${esc(provider.baseUrl)} · v${esc(provider.version)}</div>
                    </div>
                    <div class="provider-actions">
                      <span class="status-chip ${status}"><i></i>${provider.status === 'auth-error' ? 'Auth error' : provider.status}</span>
                      <button class="btn small" data-check-provider="${esc(provider.id)}">Check</button>
                    </div>
                  </div>
                  ${provider.error ? `<div class="provider-error">${esc(provider.error)}</div>` : ''}
                  <div class="provider-caps">
                    ${provider.caps.map((cap) => `<span class="cap">${esc(cap)}</span>`).join('')}
                  </div>
                </article>`;
            })
            .join('')}
        </div>
      </div>
    </div>
  `;
}

function renderSettings() {
  return `
    ${topbar('Settings', 'Hub and client preferences')}
    <div class="content">
      <div class="page wide">
        <div class="page-head">
          <div>
            <p class="page-desc">Client preferences and hub information. Provider connections live under Providers.</p>
          </div>
        </div>
        <div class="settings-grid">
          <section class="settings-card">
            <h3>Providers</h3>
            <p>Manage OpenCode, Open WebUI, and Hermes connections.</p>
            <button class="btn small" data-view="providers">Open providers</button>
          </section>
          <section class="settings-card">
            <h3>Appearance</h3>
            <p>Theme follows the operating system by default. You can pin it here.</p>
            <div class="settings-row"><span>Theme</span><button class="btn small" data-theme-toggle>${document.documentElement.dataset.theme === 'light' ? 'Light' : 'Dark'}</button></div>
            <div class="settings-row"><span>Message width</span><span>Comfortable</span></div>
          </section>
          <section class="settings-card">
            <h3>Notifications</h3>
            <p>Attention badge and desktop notifications are local to this client.</p>
            <div class="settings-row"><span>Attention badge</span><span>On</span></div>
            <div class="settings-row"><span>Desktop notifications</span><span>Off</span></div>
          </section>
          <section class="settings-card">
            <h3>Networking</h3>
            <p>The hub binds a host and port. WireGuard, Tailscale, DNS, and TLS sit outside the hub. Configure provider URLs directly.</p>
            <div class="settings-row"><span>Hub bind</span><span class="mono">127.0.0.1:8787</span></div>
            <div class="settings-row"><span>Client auth</span><span>Pairing cookie or bearer token</span></div>
          </section>
          <section class="settings-card">
            <h3>About</h3>
            <p>Oktoso prototype. Design phase, mock data only.</p>
            <div class="settings-row"><span>Version</span><span>0.0.0</span></div>
            <div class="settings-row"><span>Providers</span><span>${providers.length}</span></div>
          </section>
        </div>
      </div>
    </div>
  `;
}

function renderSearch() {
  const query = state.searchQuery.trim().toLowerCase();
  const results = query
    ? sessions.filter((session) =>
        [session.title, session.project, session.directory, providerLabel(providerByID(session.providerID))]
          .join(' ')
          .toLowerCase()
          .includes(query),
      )
    : sessions.slice(0, 5);

  return `
    ${topbar('Search', 'Sessions and projects')}
    <div class="content">
      <div class="page">
        <div class="search-page">
          <p class="page-desc">Search sessions by title, project, directory, or provider. Message search is planned for a later milestone.</p>
          <input id="search-input" placeholder="Search sessions…" value="${esc(state.searchQuery)}" autofocus />
          <div class="search-results" id="search-results">
            ${renderSearchResults(results, query)}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderSearchResults(results, query) {
  if (!results.length) {
    return `<div class="empty" style="border:0"><strong>No matches</strong>Try a different title or project.</div>`;
  }
  return results
    .map((session) => {
      const provider = providerByID(session.providerID);
      return `
        <div class="search-row" data-session="${esc(session.ref)}">
          <span class="session-dot ${esc(session.status)}" aria-hidden="true"></span>
          <div class="search-row-main">
            <div class="search-row-title">${esc(session.title)}</div>
            <div class="search-row-meta">${esc(providerLabel(provider))} · ${esc(session.project)} · ${esc(session.directory)}</div>
          </div>
          <span class="session-time">${relative(session.updated)}</span>
          <span class="sr-only">${esc(session.status)}</span>
        </div>`;
    })
    .join('');
}

function renderMain() {
  if (state.view === 'inbox') return renderInbox();
  if (state.view === 'sessions') return renderSessions();
  if (state.view === 'chat') return renderChat();
  if (state.view === 'providers') return renderProviders();
  if (state.view === 'settings') return renderSettings();
  if (state.view === 'search') return renderSearch();
  return renderInbox();
}

function renderDetailsPanel() {
  document.getElementById('details').innerHTML = renderDetails();
}

function renderApp() {
  app.className = `app view-${state.view}${state.detailsOpen ? ' details-open' : ''}${state.detailsClosed ? ' details-closed' : ''}`;
  renderRail();
  renderBottomNav();
  renderSidebar();
  document.getElementById('main').innerHTML = renderMain();
  renderDetailsPanel();
  if (state.view === 'chat') {
    requestAnimationFrame(() => {
      const transcript = document.getElementById('transcript');
      if (transcript) {
        transcript.scrollTop = captureMode === 'session' ? 0 : transcript.scrollHeight;
      }
    });
  }
  if (state.view === 'search') {
    requestAnimationFrame(() => document.getElementById('search-input')?.focus());
  }
}

function openSession(ref) {
  state.selectedRef = ref;
  state.view = 'chat';
  state.detailsOpen = false;
  renderApp();
}

function replaceAttention(item, message) {
  attention = attention.filter((entry) => entry.id !== item.id);
  const session = sessionByRef(item.sessionRef);
  if (session) {
    session.attention = undefined;
    if (item.type === 'unread') session.unread = false;
  }
  renderApp();
  toast(message);
}

function handleAttentionAction(action, id) {
  const item = attention.find((entry) => entry.id === id);
  if (!item) return;
  if (action === 'approve_once') replaceAttention(item, 'Permission allowed once');
  else if (action === 'approve_always') replaceAttention(item, 'Permission allowed for this session');
  else if (action === 'deny') replaceAttention(item, 'Permission denied');
  else if (action === 'mark_read') replaceAttention(item, 'Marked read');
  else if (action === 'dismiss') replaceAttention(item, 'Attention dismissed');
  else if (action === 'retry') {
    const session = sessionByRef(item.sessionRef);
    if (session) {
      session.status = 'running';
      session.messages.push({
        role: 'assistant',
        text: 'Retrying with the last prompt. The SSE parser now skips comment frames.',
        time: nowMs(),
        streaming: true,
      });
    }
    replaceAttention(item, 'Retry started');
  } else {
    toast('Action recorded');
  }
}

function answerQuestion(id, index) {
  const item = attention.find((entry) => entry.id === id);
  if (!item) return;
  const answer = item.options?.[index] || 'Answer';
  replaceAttention(item, `Answered: ${answer}`);
}

function sendMessage(text) {
  const session = selectedSession();
  if (!text.trim()) return;
  session.messages.push({ role: 'user', text: text.trim(), time: nowMs() });
  session.status = 'running';
  session.updated = nowMs();
  renderApp();
  toast('Message sent');

  setTimeout(() => {
    session.messages.push({
      role: 'assistant',
      text: 'I picked that up. The next step is to verify the change against the failing case, then report back with the diff and the test result.',
      time: nowMs(),
      streaming: false,
    });
    session.status = 'idle';
    session.updated = nowMs();
    renderApp();
    toast('Reply received');
  }, 1100);
}

function openNewSession() {
  const online = providers.filter((provider) => provider.status === 'online');
  modalBackdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="new-session-title">
      <div class="modal-head">
        <h2 id="new-session-title">New session</h2>
        <div style="flex:1"></div>
        <button class="icon-btn" data-close-modal aria-label="Close">${icon('close', 15)}</button>
      </div>
      <form id="new-session-form">
        <div class="modal-body">
          <div class="field">
            <label for="new-provider">Provider</label>
            <select id="new-provider">${online
              .map((provider) => `<option value="${esc(provider.id)}">${esc(provider.name)} · ${esc(provider.label)}</option>`)
              .join('')}</select>
          </div>
          <div class="field">
            <label for="new-title">Title</label>
            <input id="new-title" placeholder="Investigate auth race" required />
          </div>
          <div class="field">
            <label for="new-project">Project directory</label>
            <input id="new-project" value="/home/me/oktoso" />
          </div>
          <div class="field">
            <label for="new-agent">Agent</label>
            <input id="new-agent" value="build" />
          </div>
          <div class="field">
            <label for="new-model">Model</label>
            <input id="new-model" value="claude-sonnet" />
          </div>
          <div class="field">
            <label for="new-prompt">First prompt</label>
            <textarea id="new-prompt" placeholder="Start by reading the auth middleware."></textarea>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn small" type="button" data-close-modal>Cancel</button>
          <button class="btn small primary" type="submit">Create session</button>
        </div>
      </form>
    </div>
  `;
  modalBackdrop.hidden = false;
  document.getElementById('new-title').focus();
}

function closeModal() {
  modalBackdrop.hidden = true;
  modalBackdrop.innerHTML = '';
}

function createSessionFromForm() {
  const providerID = document.getElementById('new-provider').value;
  const title = document.getElementById('new-title').value.trim() || 'Untitled session';
  const project = document.getElementById('new-project').value.trim() || 'oktoso';
  const agent = document.getElementById('new-agent').value.trim() || 'build';
  const model = document.getElementById('new-model').value.trim() || 'claude-sonnet';
  const prompt = document.getElementById('new-prompt').value.trim();
  const provider = providerByID(providerID);
  const ref = `${providerID}:ses_${nowMs()}`;

  sessions.unshift({
    ref,
    providerID,
    nativeID: ref.split(':')[1],
    title,
    project,
    directory: project,
    agent,
    model,
    status: 'running',
    unread: false,
    updated: nowMs(),
    createdAt: nowMs(),
    cost: 0,
    tokens: '0',
    messages: [
      ...(prompt ? [{ role: 'user', text: prompt, time: nowMs() }] : []),
      {
        role: 'assistant',
        text: `Starting ${title} in ${provider?.name || providerID}. I will read the project first, then report back.`,
        time: nowMs(),
        streaming: true,
      },
    ],
  });
  closeModal();
  state.selectedRef = ref;
  state.view = 'chat';
  renderApp();
  toast('Session created');
}

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('Copied')).catch(() => toast('Copy failed'));
  } else {
    toast('Copy unavailable');
  }
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('button, [data-session], [data-view], [data-provider-filter], [data-inbox-filter], [data-attention-action], [data-answer-option], [data-open-session], [data-open-details], [data-close-details], [data-theme-toggle], [data-check-provider], [data-add-provider], [data-open-provider], [data-copy-ref], [data-interrupt], [data-close-modal], [data-new-session], [data-more], [data-attach]');
  if (!target) return;

  if (target.matches('[data-view]')) {
    state.view = target.dataset.view;
    state.detailsOpen = false;
    renderApp();
    return;
  }
  if (target.matches('[data-session]')) {
    openSession(target.dataset.session);
    return;
  }
  if (target.matches('[data-open-session]')) {
    openSession(target.dataset.openSession);
    return;
  }
  if (target.matches('[data-provider-filter]')) {
    state.providerFilter = target.dataset.providerFilter;
    renderApp();
    return;
  }
  if (target.matches('[data-inbox-filter]')) {
    state.inboxFilter = target.dataset.inboxFilter;
    renderApp();
    return;
  }
  if (target.matches('[data-attention-action]')) {
    handleAttentionAction(target.dataset.attentionAction, target.dataset.attention);
    return;
  }
  if (target.matches('[data-answer-option]')) {
    answerQuestion(target.dataset.attention, Number(target.dataset.answerOption));
    return;
  }
  if (target.matches('[data-open-details]')) {
    if (window.matchMedia('(max-width: 1320px)').matches) {
      state.detailsOpen = true;
      state.detailsClosed = false;
    } else {
      state.detailsClosed = false;
    }
    renderApp();
    return;
  }
  if (target.matches('[data-close-details]')) {
    if (window.matchMedia('(max-width: 1320px)').matches) state.detailsOpen = false;
    else state.detailsClosed = true;
    renderApp();
    return;
  }
  if (target.matches('[data-theme-toggle]')) {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    renderApp();
    toast(`${next === 'light' ? 'Light' : 'Dark'} theme`);
    return;
  }
  if (target.matches('[data-check-provider]')) {
    const provider = providerByID(target.dataset.checkProvider);
    if (!provider) return;
    target.textContent = 'Checking…';
    setTimeout(() => {
      provider.status = 'online';
      provider.error = undefined;
      renderApp();
      toast(`${provider.name} is online`);
    }, 700);
    return;
  }
  if (target.matches('[data-add-provider]')) {
    toast('Provider setup lands in Milestone 5');
    return;
  }
  if (target.matches('[data-open-provider]')) {
    event.preventDefault();
    toast(`Opening ${providerLabel(providerByID(selectedSession().providerID))}…`);
    return;
  }
  if (target.matches('[data-copy-ref]')) {
    copyText(selectedSession().ref);
    return;
  }
  if (target.matches('[data-interrupt]')) {
    selectedSession().status = 'idle';
    renderApp();
    toast('Session interrupted');
    return;
  }
  if (target.matches('[data-close-modal]')) {
    closeModal();
    return;
  }
  if (target.matches('[data-new-session]')) {
    openNewSession();
    return;
  }
  if (target.matches('[data-more]')) {
    toast('More actions are in the design doc');
    return;
  }
  if (target.matches('[data-attach]')) {
    toast('Attachments are planned for a later milestone');
  }
});

document.addEventListener('submit', (event) => {
  if (event.target.id === 'composer-form') {
    event.preventDefault();
    const textarea = document.getElementById('composer');
    sendMessage(textarea.value);
    textarea.value = '';
    textarea.style.height = 'auto';
    return;
  }
  if (event.target.id === 'new-session-form') {
    event.preventDefault();
    createSessionFromForm();
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'session-search') {
    state.sessionQuery = event.target.value;
    const list = filteredSessions();
    const container = document.getElementById('session-list');
    if (container) container.innerHTML = renderSessionListInner(groupSessions(list));
    return;
  }
  if (event.target.id === 'search-input') {
    state.searchQuery = event.target.value;
    const query = state.searchQuery.trim().toLowerCase();
    const results = query
      ? sessions.filter((session) =>
          [session.title, session.project, session.directory, providerLabel(providerByID(session.providerID))]
            .join(' ')
            .toLowerCase()
            .includes(query),
        )
      : sessions.slice(0, 5);
    const container = document.getElementById('search-results');
    if (container) container.innerHTML = renderSearchResults(results, query);
  }
});

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    state.view = 'search';
    renderApp();
    requestAnimationFrame(() => document.getElementById('search-input')?.focus());
    return;
  }
  if (event.key === 'Escape') {
    if (!modalBackdrop.hidden) {
      closeModal();
      return;
    }
    if (state.detailsOpen) {
      state.detailsOpen = false;
      renderApp();
    }
    return;
  }
  if (event.target.id === 'composer' && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    document.getElementById('composer-form').requestSubmit();
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'composer') {
    event.target.style.height = 'auto';
    event.target.style.height = `${Math.min(event.target.scrollHeight, 180)}px`;
  }
});

modalBackdrop.addEventListener('click', (event) => {
  if (event.target === modalBackdrop) closeModal();
});

if (captureMode === 'session') {
  state.view = 'chat';
  state.selectedRef = 'desktop-opencode:ses_auth';
  state.detailsOpen = false;
  state.detailsClosed = false;
}
if (captureMode) {
  document.documentElement.dataset.capture = captureMode;
}
renderApp();
