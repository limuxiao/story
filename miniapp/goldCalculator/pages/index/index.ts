import { calc, Mode, CalcResult, fmt, fmtG, signed } from '../../utils/calc';

interface DetailItem {
  key: string;
  label: string;
  value: string;
  unit: string;
  cls: string;
}

interface PageData {
  cost: string;
  grams: string;
  price: string;
  amount: string;
  mode: Mode;
  amountLabel: string;
  amountHint: string;
  warning: string;
  heroLabel: string;
  heroSub: string;
  newCost: string;
  newGrams: string;
  gramsK: string;
  deltaK: string;
  delta: string;
  deltaCls: string;
  detailTitle: string;
  details: DetailItem[];
}

interface CustomMethods {
  calculate(): void;
  onCostInput(e: WechatMiniprogram.Input): void;
  onGramsInput(e: WechatMiniprogram.Input): void;
  onPriceInput(e: WechatMiniprogram.Input): void;
  onAmountInput(e: WechatMiniprogram.Input): void;
  onModeAdd(): void;
  onModeSell(): void;
  onExample(): void;
}

Page<PageData, CustomMethods>({
  data: {
    cost: '',
    grams: '',
    price: '',
    amount: '',
    mode: 'add',
    amountLabel: '加仓金额',
    amountHint: '本次买入投入金额',
    warning: '',
    heroLabel: '加仓后成本均价',
    heroSub: '请输入上方数据自动计算',
    newCost: '--',
    newGrams: '--',
    gramsK: '加仓后持有克数',
    deltaK: '均价变化',
    delta: '--',
    deltaCls: '',
    detailTitle: '加仓后明细',
    details: []
  },

  onLoad() {
    this.calculate();
  },

  onCostInput(e: WechatMiniprogram.Input) {
    this.setData({ cost: e.detail.value });
    this.calculate();
  },

  onGramsInput(e: WechatMiniprogram.Input) {
    this.setData({ grams: e.detail.value });
    this.calculate();
  },

  onPriceInput(e: WechatMiniprogram.Input) {
    this.setData({ price: e.detail.value });
    this.calculate();
  },

  onAmountInput(e: WechatMiniprogram.Input) {
    this.setData({ amount: e.detail.value });
    this.calculate();
  },

  onModeAdd() {
    this.setData({ mode: 'add' });
    this.calculate();
  },

  onModeSell() {
    this.setData({ mode: 'sell' });
    this.calculate();
  },

  onExample() {
    this.setData({ cost: '480', grams: '100', price: '560', amount: '10000' });
    this.calculate();
  },

  calculate() {
    const isAdd = this.data.mode === 'add';

    this.setData({
      amountLabel: isAdd ? '加仓金额' : '减仓金额',
      amountHint: isAdd ? '本次买入投入金额' : '本次卖出回收金额',
      heroLabel: isAdd ? '加仓后成本均价' : '减仓后成本均价',
      gramsK: isAdd ? '加仓后持有克数' : '减仓后持有克数',
      deltaK: isAdd ? '均价变化' : '已实现盈亏',
      detailTitle: isAdd ? '加仓后明细' : '减仓后明细'
    });

    const cost = parseFloat(this.data.cost);
    const grams = parseFloat(this.data.grams);
    const price = parseFloat(this.data.price);
    const amount = parseFloat(this.data.amount);

    if (![cost, grams, price, amount].every(isFinite) || cost <= 0 || grams <= 0 || price <= 0 || amount < 0) {
      this.setData({
        warning: '',
        newCost: '--',
        newGrams: '--',
        delta: '--',
        deltaCls: '',
        details: [],
        heroSub: '请完整填写上方数据（数值需大于 0）'
      });
      return;
    }

    const r: CalcResult = calc({ cost, grams, price, amount, mode: this.data.mode });
    if (!r.ok) {
      this.setData({
        warning: r.warning || r.error || '',
        newCost: '--',
        newGrams: '--',
        delta: '--',
        deltaCls: '',
        details: [],
        heroSub: r.error || ''
      });
      return;
    }

    const deltaCls = isAdd
      ? (r.delta < 0 ? 'pos' : r.delta > 0 ? 'neg' : '')
      : (r.delta > 0 ? 'pos' : r.delta < 0 ? 'neg' : '');

    const details: DetailItem[] = [
      { key: 'c1', label: '持仓成本', value: fmt(r.newTotalCost), unit: '元', cls: '' },
      { key: 'c2', label: '当前市值', value: fmt(r.newMarketValue), unit: '元', cls: '' },
      { key: 'c3', label: '浮动盈亏', value: signed(r.newFloatPL), unit: '元', cls: r.newFloatPL > 0 ? 'pos' : r.newFloatPL < 0 ? 'neg' : '' },
      { key: 'c4', label: '收益率', value: signed(r.newRate) + '%', unit: '', cls: r.newRate > 0 ? 'pos' : r.newRate < 0 ? 'neg' : '' },
      { key: 'c5', label: r.extra1Label, value: fmtG(r.extra1Val), unit: 'g', cls: '' },
      {
        key: 'c6',
        label: r.extra2Label,
        value: isAdd ? fmt(r.extra2Val) : signed(r.extra2Val),
        unit: '元',
        cls: isAdd ? '' : (r.extra2Val > 0 ? 'pos' : r.extra2Val < 0 ? 'neg' : '')
      }
    ];

    this.setData({
      warning: '',
      newCost: fmt(r.newCostAvg),
      newGrams: fmtG(r.newGrams),
      delta: signed(r.delta) + (isAdd ? ' 元/g' : ' 元'),
      deltaCls,
      details,
      heroSub: r.heroSub
    });
  }
});
