export type Mode = 'add' | 'sell';

export interface CalcInput {
  cost: number;
  grams: number;
  price: number;
  amount: number;
  mode: Mode;
}

export interface CalcResult {
  ok: boolean;
  error?: string;
  warning?: string;
  newCostAvg: number;
  newGrams: number;
  delta: number;
  deltaUnit: string;
  newTotalCost: number;
  newMarketValue: number;
  newFloatPL: number;
  newRate: number;
  extra1Val: number;
  extra1Label: string;
  extra2Val: number;
  extra2Label: string;
  heroSub: string;
}

function empty(): CalcResult {
  return {
    ok: false,
    newCostAvg: NaN,
    newGrams: NaN,
    delta: NaN,
    deltaUnit: '',
    newTotalCost: NaN,
    newMarketValue: NaN,
    newFloatPL: NaN,
    newRate: NaN,
    extra1Val: NaN,
    extra1Label: '',
    extra2Val: NaN,
    extra2Label: '',
    heroSub: ''
  };
}

export function calc(input: CalcInput): CalcResult {
  const { cost, grams, price, amount, mode } = input;

  if (![cost, grams, price, amount].every(isFinite) || cost <= 0 || grams <= 0 || price <= 0 || amount < 0) {
    const r = empty();
    r.error = '请完整填写上方数据（数值需大于 0）';
    return r;
  }

  const totalCost = cost * grams;
  const marketValueBefore = price * grams;

  if (mode === 'add') {
    const buyGrams = amount / price;
    const newGrams = grams + buyGrams;
    const newTotalCost = totalCost + amount;
    const newCostAvg = newGrams > 0 ? newTotalCost / newGrams : 0;
    const newMarketValue = price * newGrams;
    const newFloatPL = newMarketValue - newTotalCost;
    const newRate = newTotalCost > 0 ? (newFloatPL / newTotalCost) * 100 : 0;

    return {
      ok: true,
      newCostAvg,
      newGrams,
      delta: newCostAvg - cost,
      deltaUnit: '元/g',
      newTotalCost,
      newMarketValue,
      newFloatPL,
      newRate,
      extra1Val: buyGrams,
      extra1Label: '本次买入克数',
      extra2Val: amount,
      extra2Label: '投入金额',
      heroSub: '摊薄后成本均价（越低越好）'
    };
  }

  if (amount > marketValueBefore) {
    const r = empty();
    r.warning = '减仓金额不能超过当前持仓市值 ' + fmt(marketValueBefore) + ' 元';
    return r;
  }

  const sellGrams = amount / price;
  const realized = (price - cost) * sellGrams;
  const newGrams = grams - sellGrams;
  const newCostAvg = cost;
  const newTotalCost = newGrams * cost;
  const newMarketValue = price * newGrams;
  const newFloatPL = newMarketValue - newTotalCost;
  const newRate = newTotalCost > 0 ? (newFloatPL / newTotalCost) * 100 : 0;

  return {
    ok: true,
    newCostAvg,
    newGrams,
    delta: realized,
    deltaUnit: '元',
    newTotalCost,
    newMarketValue,
    newFloatPL,
    newRate,
    extra1Val: sellGrams,
    extra1Label: '本次卖出克数',
    extra2Val: realized,
    extra2Label: '已实现盈亏',
    heroSub: '平均成本法：减仓后成本均价不变'
  };
}

function group(intStr: string): string {
  const neg = intStr.charAt(0) === '-';
  const digits = neg ? intStr.slice(1) : intStr;
  return (neg ? '-' : '') + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function fmt(n: number, d = 2): string {
  if (!isFinite(n)) return '--';
  const parts = n.toFixed(d).split('.');
  return group(parts[0]) + (parts[1] ? '.' + parts[1] : '');
}

export function fmtG(n: number): string {
  if (!isFinite(n)) return '--';
  const parts = n.toFixed(4).split('.');
  let dec = parts[1];
  while (dec.length > 2 && dec.charAt(dec.length - 1) === '0') {
    dec = dec.slice(0, -1);
  }
  return group(parts[0]) + '.' + dec;
}

export function signed(n: number, d = 2): string {
  return (n > 0 ? '+' : '') + fmt(n, d);
}
