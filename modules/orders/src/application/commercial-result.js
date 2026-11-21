import { shiftDay } from '../domain/order.js';

/** @typedef {{from: string, to: string}} Range */
/** @typedef {{day: string, source: string, confirmedCount: number, soldAmountCents: number}} SalesGroup */

/** @param {Range & {key: string}} period */
export function comparisonRanges(period) {
  const yesterday = shiftDay(period.to, -1);
  if (period.key === 'hoje') {
    return {
      current: period,
      previous: { from: yesterday, to: yesterday },
      partial: true,
    };
  }
  if (period.key === '7dias') {
    return {
      current: { from: period.from, to: yesterday },
      previous: {
        from: shiftDay(period.from, -6),
        to: shiftDay(period.from, -1),
      },
      partial: false,
    };
  }
  const previousEnd = shiftDay(period.from, -1);
  const commonDays = Math.min(
    Number(period.to.slice(-2)) - 1,
    Number(previousEnd.slice(-2)),
  );
  if (!commonDays) return null;
  const previousStart = previousEnd.slice(0, 8) + '01';
  return {
    current: { from: period.from, to: shiftDay(period.from, commonDays - 1) },
    previous: {
      from: previousStart,
      to: shiftDay(previousStart, commonDays - 1),
    },
    partial: false,
  };
}

/** @param {SalesGroup[]} groups */
function totals(groups) {
  let confirmedCount = 0;
  let soldAmountCents = 0;
  for (const group of groups) {
    confirmedCount += group.confirmedCount;
    soldAmountCents += group.soldAmountCents;
  }
  return {
    confirmedCount,
    soldAmountCents,
    averageTicketCents: confirmedCount
      ? Math.round(soldAmountCents / confirmedCount)
      : null,
  };
}

/** @param {Range & {key: string}} period @param {ReturnType<typeof comparisonRanges>} ranges @param {SalesGroup[]} groups */
export function commercialResult(period, ranges, groups) {
  /** @param {Range} range */
  const during = (range) =>
    groups.filter(({ day }) => day >= range.from && day <= range.to);
  const selected = during(period);
  const daily = [];
  for (let day = period.from; day <= period.to; day = shiftDay(day, 1)) {
    daily.push({ day, ...totals(selected.filter((row) => row.day === day)) });
  }
  return {
    period: { ...period, ...totals(selected) },
    daily,
    composition: ['equipe', 'loja', 'sem-atribuicao'].map((source) => ({
      source,
      ...totals(selected.filter((row) => row.source === source)),
    })),
    comparison: ranges && {
      partial: ranges.partial,
      current: { ...ranges.current, ...totals(during(ranges.current)) },
      previous: { ...ranges.previous, ...totals(during(ranges.previous)) },
    },
  };
}
