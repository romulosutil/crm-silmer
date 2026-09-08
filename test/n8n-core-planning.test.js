import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} relativePath */
async function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

test('mantém o n8n obrigatório, fora do banco e com WhatsApp como primeiro canal', async () => {
  const canonicalPaths = [
    'ABOUT.md',
    'ARCHITECTURE.md',
    'CRM-MVP-ESPECIFICACAO.md',
    'EASYPANEL-TOPOLOGY.md',
    'README.md',
    'RULES.md',
    'TECHNICAL-DESIGN.md',
    '.specs/features/crm-mvp/context.md',
    '.specs/features/crm-mvp/spec.md',
    '.specs/features/crm-mvp/tasks.md',
  ];
  const entries = await Promise.all(
    canonicalPaths.map(async (relativePath) => [
      relativePath,
      await read(relativePath),
    ]),
  );

  for (const [relativePath, content] of entries) {
    assert.doesNotMatch(
      content,
      /n8n[^\n]{0,80}(?:opcional|fora do caminho crítico)|(?:opcional|fora do caminho crítico)[^\n]{0,80}n8n/iu,
      `${relativePath} ainda descreve o n8n como opcional ou periférico`,
    );
  }

  const rules = await read('RULES.md');
  assert.match(rules, /n8n é obrigatório/iu);
  assert.match(rules, /nunca acessa diretamente o banco/iu);

  const spec = await read('.specs/features/crm-mvp/spec.md');
  assert.match(spec, /ORC-01/);
  assert.match(spec, /mensagem recebida[^\n]+dispara[^\n]+n8n/iu);
  assert.match(spec, /OpenAI[^\n]+Gemini|Gemini[^\n]+OpenAI/iu);
  assert.match(
    spec,
    /Instagram[^\n]+(?:fase posterior|não bloqueia)|(?:fase posterior|não bloqueia)[^\n]+Instagram/iu,
  );
  assert.match(spec, /@instagram[^\n]+telefone|telefone[^\n]+@instagram/iu);
  assert.match(spec, /migr(?:a|ar|ação)[^\n]+canal/iu);
});

test('organiza o lançamento em três objetivos que convergem', async () => {
  const tasks = await read('.specs/features/crm-mvp/tasks.md');

  assert.match(tasks, /Objetivo 1[^\n]+CRM/iu);
  assert.match(tasks, /Objetivo 2[^\n]+Inbox Multicanal/iu);
  assert.match(tasks, /Objetivo 3[^\n]+Agente Vendedor Silmer no n8n/iu);
  assert.match(tasks, /Integração e lançamento/iu);
  assert.match(
    tasks,
    /CRM[^\n]+Inbox Multicanal[^\n]+Agente Vendedor Silmer/iu,
  );
});
