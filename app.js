const logInput = document.getElementById('logInput');
const explainInput = document.getElementById('explainInput');
const indexesInput = document.getElementById('indexesInput');
const explainMode = document.getElementById('explainMode');
const modeWarning = document.getElementById('modeWarning');

const topQueriesTableBody = document.querySelector('#topQueriesTable tbody');
const logSummary = document.getElementById('logSummary');
const explainSummary = document.getElementById('explainSummary');
const indexesSummary = document.getElementById('indexesSummary');
const suggestionsList = document.getElementById('suggestionsList');

explainMode.addEventListener('change', renderModeWarning);
renderModeWarning();

document.getElementById('analyzeLogsBtn').addEventListener('click', analyzeLogs);
document.getElementById('analyzeExplainBtn').addEventListener('click', analyzeExplain);
document.getElementById('analyzeIndexesBtn').addEventListener('click', analyzeIndexes);
document.getElementById('sampleLogsBtn').addEventListener('click', loadSampleLogs);
document.getElementById('sampleExplainBtn').addEventListener('click', loadSampleExplain);
document.getElementById('sampleIndexesBtn').addEventListener('click', loadSampleIndexes);

function renderModeWarning() {
  if (explainMode.value === 'allPlansExecution') {
    modeWarning.classList.remove('hidden');
    modeWarning.textContent =
      "Warning: explain('allPlansExecution') can run candidate plans and may increase CPU/IO. Use on production with care and narrow filters/index hints.";
  } else {
    modeWarning.classList.add('hidden');
  }
}

function safeJSONParse(text) {
  return JSON.parse(text);
}

function analyzeLogs() {
  const lines = logInput.value.split('\n').map((l) => l.trim()).filter(Boolean);
  const groups = new Map();

  for (const line of lines) {
    const parsed = parseLogLine(line);
    if (!parsed) continue;

    const key = `${parsed.ns}|${parsed.command}|${parsed.shape}`;
    if (!groups.has(key)) {
      groups.set(key, { ...parsed, count: 0, totalMs: 0, samples: [] });
    }
    const g = groups.get(key);
    g.count += 1;
    g.totalMs += parsed.millis;
    g.samples.push(parsed.millis);
    g.maxMs = Math.max(g.maxMs || 0, parsed.millis);
  }

  const rows = [...groups.values()].map((g) => {
    g.samples.sort((a, b) => a - b);
    const p95 = g.samples[Math.floor(g.samples.length * 0.95)] || g.maxMs;
    return {
      fingerprint: `${g.ns} ${g.command} ${g.shape}`,
      count: g.count,
      totalMs: Math.round(g.totalMs),
      avgMs: +(g.totalMs / g.count).toFixed(2),
      maxMs: g.maxMs,
      p95Ms: p95,
      impactScore: g.totalMs * Math.log10(g.count + 1)
    };
  }).sort((a, b) => b.impactScore - a.impactScore);

  renderLogRows(rows);
  drawBarChart(rows.slice(0, 10));

  if (!rows.length) {
    logSummary.innerHTML = '<p>No parsable query lines found. Use JSON log format for best results.</p>';
    return;
  }

  const top = rows[0];
  logSummary.innerHTML = `
    <p><strong>Highest-impact query:</strong> ${escapeHtml(top.fingerprint)}</p>
    <p>Occurrences: <strong>${top.count}</strong>, Total time: <strong>${top.totalMs} ms</strong>, Avg: <strong>${top.avgMs} ms</strong>, Max: <strong>${top.maxMs} ms</strong>.</p>
    <p>Impact logic = total time weighted by occurrences. This prioritizes queries that are both frequent and slow.</p>
  `;
}

function parseLogLine(line) {
  try {
    const obj = safeJSONParse(line);
    const attr = obj.attr || {};
    const command = attr.command || {};
    const op = command.find ? 'find' : command.aggregate ? 'aggregate' : command.count ? 'count' : obj.msg || 'unknown';
    const shape = JSON.stringify(command.filter || command.pipeline || command.query || {});
    return {
      ns: attr.ns || command.$db || 'unknown.ns',
      command: op,
      shape,
      millis: Number(attr.durationMillis || attr.millis || obj.durationMillis || 0)
    };
  } catch {
    const millisMatch = line.match(/(durationMillis|millis)[:= ](\d+)/i);
    const nsMatch = line.match(/(?:ns|namespace)[:= ]([\w.]+)/i);
    const cmdMatch = line.match(/command[:= ](find|aggregate|count|update|delete)/i);
    if (!millisMatch) return null;
    return {
      ns: nsMatch?.[1] || 'unknown.ns',
      command: cmdMatch?.[1] || 'unknown',
      shape: '{...}',
      millis: Number(millisMatch[2])
    };
  }
}

function renderLogRows(rows) {
  topQueriesTableBody.innerHTML = '';
  rows.slice(0, 25).forEach((r) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(r.fingerprint)}</td>
      <td>${r.count}</td>
      <td>${r.totalMs}</td>
      <td>${r.avgMs}</td>
      <td>${r.maxMs}</td>
      <td>${r.p95Ms}</td>
    `;
    topQueriesTableBody.appendChild(tr);
  });
}

function drawBarChart(rows) {
  const canvas = document.getElementById('topQueriesChart');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!rows.length) return;

  const maxTotal = Math.max(...rows.map((r) => r.totalMs));
  const barWidth = (canvas.width - 100) / rows.length;

  rows.forEach((r, i) => {
    const h = (r.totalMs / maxTotal) * (canvas.height - 50);
    const x = 50 + i * barWidth;
    const y = canvas.height - h - 25;

    ctx.fillStyle = '#0f766e';
    ctx.fillRect(x, y, barWidth - 8, h);
    ctx.fillStyle = '#1f2937';
    ctx.font = '11px sans-serif';
    ctx.fillText(String(r.totalMs), x, y - 5);
    ctx.fillText(String(i + 1), x, canvas.height - 8);
  });
}

function analyzeExplain() {
  suggestionsList.innerHTML = '';
  try {
    const explain = safeJSONParse(explainInput.value);
    const qp = explain.queryPlanner || {};
    const es = explain.executionStats || {};
    const winningPlan = qp.winningPlan || {};

    const totalDocsExamined = es.totalDocsExamined ?? null;
    const totalKeysExamined = es.totalKeysExamined ?? null;
    const nReturned = es.nReturned ?? null;
    const executionTimeMillis = es.executionTimeMillis ?? null;
    const stage = findPrimaryStage(winningPlan);

    explainSummary.innerHTML = `
      <p><strong>Winning stage:</strong> ${stage || 'Unknown'}</p>
      <p><strong>nReturned:</strong> ${nReturned ?? 'NA'} | <strong>Docs examined:</strong> ${totalDocsExamined ?? 'NA'} | <strong>Keys examined:</strong> ${totalKeysExamined ?? 'NA'} | <strong>Execution time:</strong> ${executionTimeMillis ?? 'NA'} ms</p>
    `;

    const suggestions = buildSuggestions({ stage, totalDocsExamined, totalKeysExamined, nReturned, executionTimeMillis, explainMode: explainMode.value });
    suggestions.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      suggestionsList.appendChild(li);
    });
  } catch (err) {
    explainSummary.innerHTML = `<p>Invalid JSON: ${escapeHtml(err.message)}</p>`;
  }
}

function findPrimaryStage(plan) {
  if (!plan || typeof plan !== 'object') return null;
  if (plan.stage) return plan.stage;
  if (Array.isArray(plan.inputStage)) return findPrimaryStage(plan.inputStage[0]);
  return findPrimaryStage(plan.inputStage || plan.queryPlan || plan.winningPlan || plan.leftChild || plan.rightChild);
}

function buildSuggestions(ctx) {
  const tips = [
    'Compare explain() and explain(\'executionStats\') to separate optimizer choice from runtime behavior.',
    'Use selective compound indexes with equality fields first, then range/sort fields where relevant.',
    'Validate with realistic production-like cardinality and query parameters before index rollout.'
  ];

  if (ctx.explainMode === 'allPlansExecution') {
    tips.unshift("allPlansExecution is diagnostic-heavy; run during low traffic or against sampled workload.");
  }
  if (ctx.stage === 'COLLSCAN') {
    tips.push('Winning plan is COLLSCAN: add or refine indexes aligned to filter + sort pattern.');
  }
  if (ctx.totalDocsExamined && ctx.nReturned && ctx.totalDocsExamined > ctx.nReturned * 50) {
    tips.push('High docsExamined/nReturned ratio: improve filter selectivity or add covering index.');
  }
  if (ctx.totalKeysExamined && ctx.nReturned && ctx.totalKeysExamined > ctx.nReturned * 100) {
    tips.push('High keysExamined suggests weak index bounds; review predicate order and index key order.');
  }
  if (ctx.executionTimeMillis && ctx.executionTimeMillis > 500) {
    tips.push('Execution time is high; check lock pressure, working set fit in RAM, and shard targeting.');
  }
  return tips;
}

function analyzeIndexes() {
  try {
    const parsed = safeJSONParse(indexesInput.value);
    const indexes = Array.isArray(parsed) ? parsed : parsed.indexes || [];
    const usage = parsed.usage || [];

    const redundantPairs = [];
    for (let i = 0; i < indexes.length; i += 1) {
      for (let j = 0; j < indexes.length; j += 1) {
        if (i === j) continue;
        const a = indexes[i];
        const b = indexes[j];
        if (isPrefixIndex(a.key, b.key)) {
          redundantPairs.push(`${a.name} may be redundant because ${b.name} has the same prefix.`);
        }
      }
    }

    const zeroUsage = usage
      .filter((u) => (u.accesses?.ops ?? 0) === 0)
      .map((u) => `${u.name || u.key} has 0 observed ops in $indexStats window.`);

    const all = [...new Set([...redundantPairs, ...zeroUsage])];
    indexesSummary.innerHTML = all.length
      ? `<ul>${all.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`
      : '<p>No obvious redundant indexes detected from provided data.</p>';
  } catch (err) {
    indexesSummary.innerHTML = `<p>Invalid JSON: ${escapeHtml(err.message)}</p>`;
  }
}

function isPrefixIndex(a, b) {
  const aKeys = Object.keys(a || {});
  const bKeys = Object.keys(b || {});
  if (aKeys.length >= bKeys.length || aKeys.length === 0) return false;
  return aKeys.every((k, i) => bKeys[i] === k && a[k] === b[k]);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function loadSampleLogs() {
  logInput.value = `{"t":{"$date":"2026-03-01T10:00:00.000+00:00"},"s":"I","c":"COMMAND","id":51803,"ctx":"conn1","msg":"Slow query","attr":{"type":"command","ns":"sales.orders","command":{"find":"orders","filter":{"status":"OPEN","region":"EU"}},"durationMillis":412}}
{"t":{"$date":"2026-03-01T10:00:01.000+00:00"},"s":"I","c":"COMMAND","id":51803,"ctx":"conn1","msg":"Slow query","attr":{"type":"command","ns":"sales.orders","command":{"find":"orders","filter":{"status":"OPEN","region":"EU"}},"durationMillis":455}}
{"t":{"$date":"2026-03-01T10:00:02.000+00:00"},"s":"I","c":"COMMAND","id":51803,"ctx":"conn1","msg":"Slow query","attr":{"type":"command","ns":"sales.orders","command":{"aggregate":"orders","pipeline":[{"$match":{"tenantId":11}},{"$sort":{"createdAt":-1}}]},"durationMillis":980}}`;
}

function loadSampleExplain() {
  explainInput.value = JSON.stringify({
    queryPlanner: { winningPlan: { stage: 'COLLSCAN' } },
    executionStats: {
      nReturned: 100,
      totalDocsExamined: 120000,
      totalKeysExamined: 0,
      executionTimeMillis: 740
    }
  }, null, 2);
}

function loadSampleIndexes() {
  indexesInput.value = JSON.stringify({
    indexes: [
      { name: 'status_1', key: { status: 1 } },
      { name: 'status_1_region_1', key: { status: 1, region: 1 } },
      { name: 'tenantId_1_createdAt_-1', key: { tenantId: 1, createdAt: -1 } }
    ],
    usage: [
      { name: 'status_1', accesses: { ops: 0 } },
      { name: 'status_1_region_1', accesses: { ops: 56 } }
    ]
  }, null, 2);
}
