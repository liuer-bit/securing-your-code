const test = require('node:test');
const assert = require('node:assert/strict');
const { Store, parseCSV, stringifyCSV } = require('../dist/core.js');

function memory(initial) {
  let value = initial ?? null;
  return { getItem: () => value, setItem: (_k, v) => { value = String(v); }, read: () => value };
}
function blankStore() {
  const s = new Store({ storage: memory() });
  s.startBlank();
  const f = s.saveEntity('factories', { name: '测试工厂', status: '运行中' });
  const w1 = s.saveEntity('warehouses', { name: '测试仓一', factoryId: f.id, type: '综合仓', status: '使用中' });
  const w2 = s.saveEntity('warehouses', { name: '测试仓二', factoryId: f.id, type: '综合仓', status: '使用中' });
  const p = s.saveEntity('people', { name: '测试经办人', factoryId: f.id, role: '仓库人员', status: '在职' });
  const i = s.saveEntity('items', { name: '测试物品', category: '成品', unit: '件', safetyStock: 0, status: '使用中' });
  return { s, f, w1, w2, p, i };
}

test('入库、出库、调拨和盘点只在确认后影响库存', () => {
  const { s, w1, w2, p, i } = blankStore();
  const opening = s.recordFlow({ type: '期初', warehouseId: w1.id, itemId: i.id, operator: p.id, date: '2026-01-01', quantity: 10 });
  assert.equal(s.quantity(i.id, w1.id), 0);
  s.confirmFlow(opening.id);
  const inbound = s.recordFlow({ type: '入库', warehouseId: w1.id, itemId: i.id, operator: p.id, date: '2026-01-02', quantity: 2 });
  s.confirmFlow(inbound.id);
  const transfer = s.recordFlow({ type: '调拨', warehouseId: w1.id, targetWarehouseId: w2.id, itemId: i.id, operator: p.id, date: '2026-01-03', quantity: 4 });
  s.confirmFlow(transfer.id);
  assert.equal(s.quantity(i.id, w1.id), 8);
  assert.equal(s.quantity(i.id, w2.id), 4);
  const check = s.recordFlow({ type: '盘点', warehouseId: w2.id, itemId: i.id, operator: p.id, date: '2026-01-04', quantity: 7 });
  s.confirmFlow(check.id);
  assert.equal(s.quantity(i.id, w2.id), 7);
  assert.equal(s.state.flows.find(f => f.id === check.id).delta, 3);
});

test('待审核出库确认时才校验负库存', () => {
  const { s, w1, p, i } = blankStore();
  const out = s.recordFlow({ type: '出库', warehouseId: w1.id, itemId: i.id, operator: p.id, date: '2026-01-01', quantity: 1 });
  assert.equal(s.quantity(i.id, w1.id), 0);
  assert.throws(() => s.confirmFlow(out.id), /库存不足/);
  assert.equal(s.state.flows.find(f => f.id === out.id).status, '待审核');
});

test('六位小数边界不允许确认后出现负库存', () => {
  const { s, w1, p, i } = blankStore();
  const opening = s.recordFlow({ type: '期初', warehouseId: w1.id, itemId: i.id, operator: p.id, date: '2026-01-01', quantity: 1 });
  s.confirmFlow(opening.id);
  const out = s.recordFlow({ type: '出库', warehouseId: w1.id, itemId: i.id, operator: p.id, date: '2026-01-02', quantity: 1.000001 });
  assert.throws(() => s.confirmFlow(out.id), /库存不足/);
  assert.equal(s.quantity(i.id, w1.id), 1);
});

test('期初重复和已有业务后的期初会被拒绝', () => {
  const { s, w1, p, i } = blankStore();
  const a = s.recordFlow({ type: '期初', warehouseId: w1.id, itemId: i.id, operator: p.id, date: '2026-01-01', quantity: 1 });
  assert.throws(() => s.recordFlow({ type: '期初', warehouseId: w1.id, itemId: i.id, operator: p.id, date: '2026-01-01', quantity: 2 }), /期初/);
  s.confirmFlow(a.id);
  const inbound = s.recordFlow({ type: '入库', warehouseId: w1.id, itemId: i.id, operator: p.id, date: '2026-01-02', quantity: 1 });
  s.confirmFlow(inbound.id);
  assert.throws(() => s.recordFlow({ type: '期初', warehouseId: w1.id, itemId: i.id, operator: p.id, date: '2026-01-02', quantity: 2 }), /期初/);
});

test('盘点按确认顺序取库存，日期只作业务日期', () => {
  const { s, w1, p, i } = blankStore();
  const opening = s.recordFlow({ type: '期初', warehouseId: w1.id, itemId: i.id, operator: p.id, date: '2026-01-10', quantity: 10 });
  s.confirmFlow(opening.id);
  const check = s.recordFlow({ type: '盘点', warehouseId: w1.id, itemId: i.id, operator: p.id, date: '2026-01-05', quantity: 12 });
  const inbound = s.recordFlow({ type: '入库', warehouseId: w1.id, itemId: i.id, operator: p.id, date: '2026-01-20', quantity: 5 });
  s.confirmFlow(inbound.id);
  s.confirmFlow(check.id);
  assert.equal(s.quantity(i.id, w1.id), 12);
  assert.equal(s.state.flows.find(f => f.id === check.id).delta, -3);
  const confirmations = s.state.flows.filter(f => f.status === '已确认');
  assert.ok(Date.parse(confirmations.find(f => f.id === inbound.id).confirmedAt) < Date.parse(confirmations.find(f => f.id === check.id).confirmedAt));
  const restored = new Store({ storage: memory() });
  restored.restoreBackup(s.exportBackup());
  assert.equal(restored.quantity(i.id, w1.id), 12);
});

test('先创建业务待审核，再确认期初和业务可正常回放', () => {
  const { s, w1, p, i } = blankStore();
  const inbound = s.recordFlow({ type: '入库', warehouseId: w1.id, itemId: i.id, operator: p.id, date: '2026-01-02', quantity: 5 });
  const opening = s.recordFlow({ type: '期初', warehouseId: w1.id, itemId: i.id, operator: p.id, date: '2026-01-01', quantity: 10 });
  s.confirmFlow(opening.id);
  s.confirmFlow(inbound.id);
  assert.equal(s.quantity(i.id, w1.id), 15);
});

test('停用后的历史流水仍可回放，历史仓库归属和物品单位不可改', () => {
  const { s, f, w1, p, i } = blankStore();
  const opening = s.recordFlow({ type: '期初', warehouseId: w1.id, itemId: i.id, operator: p.id, date: '2026-01-01', quantity: 6 });
  s.confirmFlow(opening.id);
  s.saveEntity('factories', { id: f.id, status: '停用' });
  s.saveEntity('warehouses', { id: w1.id, status: '停用' });
  s.saveEntity('items', { id: i.id, status: '停用' });
  assert.equal(s.quantity(i.id, w1.id), 6);
  assert.throws(() => s.saveEntity('items', { id: i.id, unit: '箱' }), /历史流水/);
  const otherFactory = s.saveEntity('factories', { name: '另一个工厂', status: '运行中' });
  assert.throws(() => s.saveEntity('warehouses', { id: w1.id, factoryId: otherFactory.id }), /历史流水/);
  const restored = new Store({ storage: memory() });
  restored.restoreBackup(s.exportBackup());
  assert.equal(restored.quantity(i.id, w1.id), 6);
  assert.equal(restored.state.items.find(x => x.id === i.id).status, '停用');
});

test('停用或离职阻止新业务及待审核确认，恢复状态后可继续确认', () => {
  const cases = [
    { type: 'factories', pick: 'f', status: '停用', active: '运行中', message: /所属工厂已停用/ },
    { type: 'warehouses', pick: 'w1', status: '停用', active: '使用中', message: /流水仓库已停用/ },
    { type: 'warehouses', pick: 'w2', status: '停用', active: '使用中', message: /调拨目标仓库已停用/ },
    { type: 'items', pick: 'i', status: '停用', active: '使用中', message: /流水物品已停用/ },
    { type: 'people', pick: 'p', status: '离职', active: '在职', message: /流水经办人已离职/ },
  ];
  cases.forEach(check => {
    const context = blankStore();
    const { s, w1, w2, p, i } = context;
    s.recordFlow({ type: '期初', warehouseId: w1.id, itemId: i.id, operator: p.id, date: '2026-01-01', quantity: 6, status: '已确认' });
    const data = { type: '调拨', warehouseId: w1.id, targetWarehouseId: w2.id, itemId: i.id, operator: p.id, date: '2026-01-02', quantity: 2 };
    const pending = s.recordFlow(data);
    s.saveEntity(check.type, { id: context[check.pick].id, status: check.status });
    const before = s.exportBackup();
    assert.throws(() => s.recordFlow(data), check.message);
    assert.throws(() => s.confirmFlow(pending.id), check.message);
    assert.equal(s.exportBackup(), before);
    const restored = new Store({ storage: memory() });
    restored.restoreBackup(before);
    assert.equal(restored.quantity(i.id, w1.id), 6);
    assert.equal(restored.state.flows.find(f => f.id === pending.id).status, '待审核');
    s.saveEntity(check.type, { id: context[check.pick].id, status: check.active });
    s.confirmFlow(pending.id);
    assert.equal(s.quantity(i.id, w1.id), 4);
    assert.equal(s.quantity(i.id, w2.id), 2);
  });
});

test('尚无流水的仓库归属和单位可编辑，有待审调拨的目标仓归属锁定', () => {
  const { s, w1, w2, p, i } = blankStore();
  const otherFactory = s.saveEntity('factories', { name: '另一工厂', status: '运行中' });
  s.saveEntity('warehouses', { id: w2.id, factoryId: otherFactory.id });
  s.saveEntity('items', { id: i.id, unit: '箱' });
  s.recordFlow({ type: '调拨', warehouseId: w1.id, targetWarehouseId: w2.id, itemId: i.id, operator: p.id, date: '2026-01-01', quantity: 1 });
  assert.throws(() => s.saveEntity('warehouses', { id: w2.id, factoryId: s.state.factories[0].id }), /历史流水/);
  assert.throws(() => s.saveEntity('items', { id: i.id, unit: '件' }), /历史流水/);
  s.saveEntity('items', { id: i.id, unit: ' 箱 ', name: '更新名称' });
  assert.equal(s.state.items.find(x => x.id === i.id).unit, '箱');
});

test('批量导入失败时全部回滚，关系可用编码映射', () => {
  const { s, f } = blankStore();
  const before = s.state.factories.length;
  assert.throws(() => s.importRecords('warehouses', [
    { code: 'W900', name: '导入仓', factoryCode: f.code, type: '综合仓' },
    { code: 'W900', name: '重复仓', factoryCode: f.code, type: '综合仓' },
  ]), /编码重复/);
  assert.equal(s.state.warehouses.length, 2);
  assert.equal(s.state.factories.length, before);
});

test('备份严格拒绝非法关系、负库存和篡改，并保持原状态', () => {
  const { s, w1, p, i } = blankStore();
  const f = JSON.parse(s.exportBackup());
  f.flows.push({ id: 'L999', code: 'L999', type: '入库', warehouseId: 'W-nope', itemId: i.id, targetWarehouseId: '', quantity: 2, delta: 2, operator: p.id, date: '2026-01-01', note: '', status: '已确认', createdAt: new Date().toISOString(), confirmedAt: new Date().toISOString() });
  assert.throws(() => s.restoreBackup(JSON.stringify(f)), /仓库/);
  assert.equal(s.state.flows.length, 0);
  const o = s.recordFlow({ type: '入库', warehouseId: w1.id, itemId: i.id, operator: p.id, date: '2026-01-01', quantity: 1 });
  s.confirmFlow(o.id);
  const tampered = JSON.parse(s.exportBackup());
  tampered.flows[0].delta = 99;
  assert.throws(() => s.restoreBackup(JSON.stringify(tampered)), /差值/);
  assert.equal(s.quantity(i.id, w1.id), 1);
});

test('持久化失败不暴露成功状态', () => {
  const store = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  assert.throws(() => new Store({ storage: store }), /保存数据失败/);
});

test('CSV 双引号、逗号、换行、BOM 和公式注入', () => {
  const csv = stringifyCSV([['姓名', '备注'], ['甲', 'a,b\nc'], ['乙', '=1+1']]);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.match(csv, /'=1\+1/);
  assert.deepEqual(parseCSV(csv), [['姓名', '备注'], ['甲', 'a,b\nc'], ['乙', "'=1+1"]]);
});
