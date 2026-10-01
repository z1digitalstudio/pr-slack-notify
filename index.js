// PR Slack Notify: un único mensaje por PR en Slack que cambia de color según su estado.
// Sin dependencias: usa fetch nativo de Node.

const fs = require('node:fs');

const METADATA_TYPE = 'pr_slack_notify';

// color: la línea lateral del mensaje. label: nota bajo el mensaje (null = sin nota).
const STATES = {
  open: { color: '#2f81f7', label: null },
  approved: { color: '#2da44e', label: 'Approved' },
  merged: { color: '#8250df', label: 'Merged' },
  closed: { color: '#cf222e', label: 'Closed without merging' },
};

function getInput(name, fallback = '') {
  const value = process.env[`INPUT_${name.toUpperCase()}`];
  return value === undefined || value === '' ? fallback : value.trim();
}

// Decide qué estado corresponde al evento. Devuelve null si el evento no nos interesa.
function resolveState(eventName, payload, { ignoreDrafts = true } = {}) {
  const pr = payload.pull_request;
  if (!pr) return null;

  if (eventName === 'pull_request' || eventName === 'pull_request_target') {
    switch (payload.action) {
      case 'opened':
      case 'reopened':
      case 'ready_for_review':
        if (ignoreDrafts && pr.draft) return null;
        return 'open';
      case 'closed':
        return pr.merged ? 'merged' : 'closed';
      default:
        return null;
    }
  }

  if (eventName === 'pull_request_review') {
    if (payload.action !== 'submitted') return null;
    if ((payload.review?.state || '').toLowerCase() !== 'approved') return null;
    if (pr.state !== 'open') return null; // no pisar el morado de una PR ya mergeada
    return 'approved';
  }

  return null;
}

// Acepta IDs de usuario (U…/W…) y de grupos de usuarios (S…), separados por comas o espacios.
function formatReviewers(raw) {
  return raw
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((id) => (id.startsWith('S') ? `<!subteam^${id}>` : `<@${id}>`))
    .join(' ');
}

function escapeSlack(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const GITHUB_ICON = 'https://github.githubassets.com/favicons/favicon.png';

// Mensaje con la misma forma que el de la app de GitHub: cabecera arriba y,
// dentro de la línea lateral de color, el título de la PR enlazado y los revisores.
// Al pie, el repo y el estado si la PR ya no está abierta.
function buildMessage(state, pr, reviewers, repo) {
  const { color, label } = STATES[state];
  const login = escapeSlack(pr.user.login);
  const author = `<${pr.user.html_url}|${login}>`;
  const title = `#${pr.number} ${pr.title}`;
  const mentions = formatReviewers(reviewers);

  const attachment = {
    color,
    fallback: title,
    title: escapeSlack(title),
    title_link: pr.html_url,
    mrkdwn_in: ['text'],
  };
  if (mentions) attachment.text = mentions;
  attachment.footer = `<${repo.html_url}|${escapeSlack(repo.full_name)}>${label ? ` · ${label}` : ''}`;
  attachment.footer_icon = GITHUB_ICON;

  return { text: `Pull request opened by ${author}`, attachments: [attachment] };
}

async function slack(token, method, body, { get = false } = {}) {
  const url = new URL(`https://slack.com/api/${method}`);
  const init = { headers: { Authorization: `Bearer ${token}` } };
  if (get) {
    for (const [k, v] of Object.entries(body)) if (v !== undefined) url.searchParams.set(k, String(v));
    init.method = 'GET';
  } else {
    init.method = 'POST';
    init.headers['Content-Type'] = 'application/json; charset=utf-8';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack ${method} falló: ${data.error}`);
  return data;
}

// Busca el mensaje de esta PR en el canal usando los metadatos que dejamos al publicarlo.
// Solo mira mensajes posteriores a la creación de la PR, así que la búsqueda es corta.
async function findMessage(token, channel, repo, pr) {
  const oldest = Math.floor(Date.parse(pr.created_at) / 1000) - 60;
  let cursor;
  do {
    const page = await slack(
      token,
      'conversations.history',
      { channel, oldest, limit: 200, include_all_metadata: true, cursor },
      { get: true },
    );
    const match = page.messages.find(
      (m) =>
        m.metadata?.event_type === METADATA_TYPE &&
        m.metadata.event_payload?.repo === repo &&
        Number(m.metadata.event_payload?.pr) === pr.number,
    );
    if (match) return match.ts;
    cursor = page.response_metadata?.next_cursor;
  } while (cursor);
  return null;
}

async function run() {
  const token = getInput('slack_bot_token');
  const channel = getInput('channel_id');
  const reviewers = getInput('reviewers');
  const ignoreDrafts = getInput('ignore_drafts', 'true') !== 'false';
  if (!token || !channel) throw new Error('Faltan los inputs slack_bot_token y/o channel_id');

  const eventName = process.env.GITHUB_EVENT_NAME;
  const payload = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const state = resolveState(eventName, payload, { ignoreDrafts });
  if (!state) {
    console.log(`Evento ${eventName}/${payload.action} ignorado.`);
    return;
  }

  const pr = payload.pull_request;
  const repo = payload.repository.full_name;
  const message = {
    channel,
    ...buildMessage(state, pr, reviewers, payload.repository),
    unfurl_links: false,
    unfurl_media: false,
    metadata: { event_type: METADATA_TYPE, event_payload: { repo, pr: pr.number } },
  };

  const ts = await findMessage(token, channel, repo, pr);
  if (ts) {
    await slack(token, 'chat.update', { ...message, ts });
    console.log(`Mensaje de ${repo}#${pr.number} actualizado a "${state}".`);
  } else if (state === 'open') {
    await slack(token, 'chat.postMessage', message);
    console.log(`Mensaje de ${repo}#${pr.number} publicado.`);
  } else {
    // PR anterior a la action (o mensaje borrado): no publicamos nada para no meter ruido.
    console.log(`No hay mensaje previo para ${repo}#${pr.number}; no se publica nada.`);
  }
}

module.exports = { resolveState, buildMessage, formatReviewers, escapeSlack, STATES };

if (require.main === module) {
  run().catch((err) => {
    console.log(`::error::${err.message}`);
    process.exitCode = 1;
  });
}
