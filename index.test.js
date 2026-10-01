const test = require('node:test');
const assert = require('node:assert');
const { resolveState, buildMessage, formatReviewers } = require('./index');

const pr = (extra = {}) => ({
  number: 42,
  title: 'Add <login> & stuff',
  html_url: 'https://github.com/acme/web/pull/42',
  user: { login: 'ana', html_url: 'https://github.com/ana' },
  state: 'open',
  draft: false,
  merged: false,
  ...extra,
});

test('abrir una PR la pone en azul', () => {
  assert.equal(resolveState('pull_request', { action: 'opened', pull_request: pr() }), 'open');
  assert.equal(resolveState('pull_request', { action: 'reopened', pull_request: pr() }), 'open');
});

test('los drafts se ignoran hasta ready_for_review', () => {
  assert.equal(resolveState('pull_request', { action: 'opened', pull_request: pr({ draft: true }) }), null);
  assert.equal(resolveState('pull_request', { action: 'ready_for_review', pull_request: pr() }), 'open');
  assert.equal(
    resolveState('pull_request', { action: 'opened', pull_request: pr({ draft: true }) }, { ignoreDrafts: false }),
    'open',
  );
});

test('una aprobación la pone en verde', () => {
  const payload = { action: 'submitted', review: { state: 'approved' }, pull_request: pr() };
  assert.equal(resolveState('pull_request_review', payload), 'approved');
});

test('comentarios y cambios solicitados no cambian nada', () => {
  for (const state of ['commented', 'changes_requested']) {
    const payload = { action: 'submitted', review: { state }, pull_request: pr() };
    assert.equal(resolveState('pull_request_review', payload), null);
  }
});

test('una aprobación sobre una PR cerrada no pisa el morado', () => {
  const payload = { action: 'submitted', review: { state: 'approved' }, pull_request: pr({ state: 'closed' }) };
  assert.equal(resolveState('pull_request_review', payload), null);
});

test('merge en morado, cierre sin merge en negro', () => {
  assert.equal(resolveState('pull_request', { action: 'closed', pull_request: pr({ merged: true }) }), 'merged');
  assert.equal(resolveState('pull_request', { action: 'closed', pull_request: pr() }), 'closed');
});

test('otros eventos se ignoran', () => {
  assert.equal(resolveState('pull_request', { action: 'synchronize', pull_request: pr() }), null);
  assert.equal(resolveState('push', {}), null);
});

test('menciona usuarios y grupos', () => {
  assert.equal(formatReviewers('U111, U222 S333'), '<@U111> <@U222> <!subteam^S333>');
  assert.equal(formatReviewers(''), '');
});

const repo = { full_name: 'acme/web', html_url: 'https://github.com/acme/web' };

test('mensaje abierto: cabecera, título enlazado, revisores y línea azul', () => {
  const msg = buildMessage('open', pr(), 'S333', repo);
  assert.equal(msg.text, 'Pull request opened by <https://github.com/ana|ana>');
  assert.deepEqual(msg.attachments, [
    {
      color: '#2f81f7',
      fallback: '#42 Add <login> & stuff',
      title: '#42 Add &lt;login&gt; &amp; stuff',
      title_link: 'https://github.com/acme/web/pull/42',
      mrkdwn_in: ['text'],
      text: '<!subteam^S333>',
      footer: '<https://github.com/acme/web|acme/web>',
      footer_icon: 'https://github.githubassets.com/favicons/favicon.png',
    },
  ]);
});

test('cada estado cambia el color de la línea y añade una nota', () => {
  const att = (state) => buildMessage(state, pr(), 'U111', repo).attachments[0];
  assert.equal(att('approved').color, '#2da44e');
  assert.equal(att('approved').footer, '<https://github.com/acme/web|acme/web> · Approved');
  assert.equal(att('merged').color, '#8250df');
  assert.equal(att('merged').footer, '<https://github.com/acme/web|acme/web> · Merged');
  assert.equal(att('closed').color, '#cf222e');
  assert.equal(att('closed').footer, '<https://github.com/acme/web|acme/web> · Closed without merging');
});

test('sin revisores no hay menciones', () => {
  assert.equal(buildMessage('open', pr(), '', repo).attachments[0].text, undefined);
});

