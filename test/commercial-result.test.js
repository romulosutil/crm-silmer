import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commercialResult,
  comparisonRanges,
} from '../modules/orders/src/application/commercial-result.js';
import { summaryPeriod } from '../modules/orders/src/domain/order.js';

test('RFC 073: São Paulo cutoff, complete comparable days and shortened previous month', () => {
  const clock = new Date('2026-04-01T01:00:00Z');
  const month = summaryPeriod('mes', clock);
  assert.equal(month.to, '2026-03-31');
  assert.deepEqual(comparisonRanges(month), {
    partial: false,
    current: { from: '2026-03-01', to: '2026-03-28' },
    previous: { from: '2026-02-01', to: '2026-02-28' },
  });
  assert.deepEqual(comparisonRanges(summaryPeriod('7dias', clock)), {
    partial: false,
    current: { from: '2026-03-25', to: '2026-03-30' },
    previous: { from: '2026-03-19', to: '2026-03-24' },
  });
  assert.equal(
    comparisonRanges(summaryPeriod('mes', new Date('2026-04-01T12:00:00Z'))),
    null,
  );
  assert.equal(comparisonRanges(summaryPeriod('hoje', clock))?.partial, true);
});
test('RFC 073: all sources reconcile; unfinished day stays out of comparable totals', () => {
  const period = summaryPeriod('mes', new Date('2026-11-21T13:00:00Z'));
  const groups = [
    {
      day: '2026-11-03',
      source: 'equipe',
      confirmedCount: 1,
      soldAmountCents: 30000,
    },
    {
      day: '2026-11-21',
      source: 'equipe',
      confirmedCount: 1,
      soldAmountCents: 50000,
    },
    {
      day: '2026-11-05',
      source: 'loja',
      confirmedCount: 1,
      soldAmountCents: 20000,
    },
    {
      day: '2026-11-09',
      source: 'sem-atribuicao',
      confirmedCount: 1,
      soldAmountCents: 10000,
    },
  ];
  const report = commercialResult(period, comparisonRanges(period), groups);
  assert.equal(report.period.soldAmountCents, 110000);
  assert.equal(report.period.confirmedCount, 4);
  assert.equal(report.period.averageTicketCents, 27500);
  assert.equal(report.composition[0].soldAmountCents, 80000);
  assert.equal(
    report.daily.reduce((s, d) => s + d.soldAmountCents, 0),
    110000,
  );
  assert.equal(report.comparison?.current.soldAmountCents, 60000);
  assert.equal(report.comparison?.previous.soldAmountCents, 0);
  assert.equal(report.comparison?.previous.averageTicketCents, null);
});
