/* 三鑫库存数据层：可直接以 file:// 加载的 classic script，也可被 Node require。 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SanxinCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = 2;
  var TYPE_NAMES = ['factories', 'warehouses', 'people', 'items'];
  var FLOW_TYPES = ['期初', '入库', '出库', '调拨', '盘点'];
  var ENUMS = {
    factoryStatus: ['运行中', '待补资料', '停用'],
    warehouseType: ['成品仓', '物料仓', '综合仓', '项目仓'],
    warehouseStatus: ['使用中', '停用'],
    personRole: ['总公司管理员', '工厂负责人', '仓库人员', '查询人员'],
    personStatus: ['在职', '离职'],
    itemCategory: ['成品', '半成品', '外购商品', '原材料', '辅料', '设备工具', '其他'],
    itemStatus: ['使用中', '停用']
  };

  function fail(message) { throw new Error('三鑫数据错误：' + message); }
  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function round6(n) { var r = Math.round((Number(n) + Number.EPSILON) * 1000000) / 1000000; return Object.is(r, -0) ? 0 : r; }
  function now() { return new Date().toISOString(); }
  function validDate(x) {
    if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
    var d = new Date(x + 'T00:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === x;
  }
  function validTimestamp(x) { return typeof x === 'string' && !Number.isNaN(Date.parse(x)); }
  function text(x) { return x === null || x === undefined ? '' : String(x).trim(); }
  function idFor(prefix, list) {
    var max = 0;
    list.forEach(function (x) {
      var m = String(x.id || '').match(new RegExp('^' + prefix + '(\\d+)$', 'i'));
      if (m) max = Math.max(max, Number(m[1]));
    });
    return prefix + String(max + 1).padStart(3, '0');
  }
  function codeFor(prefix, list) {
    var max = 0;
    list.forEach(function (x) {
      var m = String(x.code || '').match(new RegExp('^' + prefix + '(\\d+)$', 'i'));
      if (m) max = Math.max(max, Number(m[1]));
    });
    return prefix + String(max + 1).padStart(3, '0');
  }
  function deepFreeze(x) {
    if (!x || typeof x !== 'object' || Object.isFrozen(x)) return x;
    Object.keys(x).forEach(function (k) { deepFreeze(x[k]); });
    return Object.freeze(x);
  }
  function enumValue(v, allowed, label, required) {
    if (v === undefined || v === null || v === '') {
      if (required) fail(label + '不能为空');
      return allowed[0];
    }
    if (allowed.indexOf(v) < 0) fail(label + '不合法');
    return v;
  }
  function numberValue(v, label, allowZero) {
    if (v === '' || v === null || v === undefined || typeof v === 'boolean') fail(label + '必须是数字');
    var n = Number(v);
    if (!Number.isFinite(n) || n < (allowZero ? 0 : 0)) fail(label + '不能为负数');
    return round6(n);
  }
  function assertPlainKeys(obj, keys, label) {
    Object.keys(obj || {}).forEach(function (k) { if (keys.indexOf(k) < 0) fail(label + '含未知字段：' + k); });
  }
  function allIdsUnique(state) {
    var seen = Object.create(null);
    TYPE_NAMES.forEach(function (t) { state[t].forEach(function (x) { if (!x.id || seen[x.id]) fail('ID重复或为空'); seen[x.id] = true; }); });
    state.flows.forEach(function (x) { if (!x.id || seen[x.id]) fail('流水ID重复或为空'); seen[x.id] = true; });
    state.logs.forEach(function (x) { if (!x.id || seen[x.id]) fail('日志ID重复或为空'); seen[x.id] = true; });
  }
  function uniqueCodes(state) {
    TYPE_NAMES.forEach(function (t) {
      var seen = Object.create(null);
      state[t].forEach(function (x) { if (!x.code) fail(t + '编码不能为空'); var c = String(x.code).toUpperCase(); if (seen[c]) fail(t + '编码重复：' + x.code); seen[c] = true; });
    });
  }
  function find(state, type, id) { return state[type].find(function (x) { return x.id === id; }); }
  function requireFind(state, type, id, label) { var x = find(state, type, id); if (!x) fail(label + '不存在'); return x; }
  function emptyState(mode) {
    return { schemaVersion: VERSION, mode: mode === 'real' ? 'real' : 'demo', factories: [], warehouses: [], people: [], items: [], flows: [], logs: [], updatedAt: now() };
  }
  function demoState() {
    var s = emptyState('demo'), at = now();
    s.factories = [{ id: 'F001', code: 'F001', name: '示例工厂一号', address: '示例地址一号', owner: '示例负责人甲', phone: '000-00000001', status: '运行中', updatedAt: at }];
    s.warehouses = [
      { id: 'W001', code: 'W001', name: '示例成品仓', factoryId: 'F001', type: '成品仓', owner: '示例仓管甲', status: '使用中', updatedAt: at },
      { id: 'W002', code: 'W002', name: '示例综合仓', factoryId: 'F001', type: '综合仓', owner: '示例仓管乙', status: '使用中', updatedAt: at }
    ];
    s.people = [
      { id: 'P001', code: 'P001', name: '示例人员甲', factoryId: 'F001', department: '示例生产部', position: '示例负责人', phone: '000-00000002', role: '工厂负责人', status: '在职', updatedAt: at },
      { id: 'P002', code: 'P002', name: '示例人员乙', factoryId: 'F001', department: '示例仓储部', position: '示例仓库员', phone: '000-00000003', role: '仓库人员', status: '在职', updatedAt: at }
    ];
    s.items = [
      { id: 'G001', code: 'G001', name: '示例成品球', category: '成品', spec: '示例规格A', unit: '打', safetyStock: 10, status: '使用中', updatedAt: at },
      { id: 'G002', code: 'G002', name: '示例半成品件', category: '半成品', spec: '示例规格B', unit: '件', safetyStock: 20, status: '使用中', updatedAt: at },
      { id: 'M001', code: 'M001', name: '示例原材料', category: '原材料', spec: '示例规格C', unit: '千克', safetyStock: 30, status: '使用中', updatedAt: at }
    ];
    s.flows = [
      { id: 'L001', code: 'L001', type: '期初', warehouseId: 'W001', itemId: 'G001', targetWarehouseId: '', quantity: 120, delta: 120, operator: 'P002', date: '2026-01-01', note: '示例期初数据', status: '已确认', createdAt: at, confirmedAt: at },
      { id: 'L002', code: 'L002', type: '期初', warehouseId: 'W002', itemId: 'G002', targetWarehouseId: '', quantity: 80, delta: 80, operator: 'P002', date: '2026-01-01', note: '示例期初数据', status: '已确认', createdAt: at, confirmedAt: at },
      { id: 'L003', code: 'L003', type: '期初', warehouseId: 'W002', itemId: 'M001', targetWarehouseId: '', quantity: 200, delta: 200, operator: 'P002', date: '2026-01-01', note: '示例期初数据', status: '已确认', createdAt: at, confirmedAt: at }
    ];
    s.logs = [{ id: 'LOG001', at: at, action: '初始化示例数据', entity: 'state', detail: '示例工厂、仓库、人员、物品和期初库存' }];
    return s;
  }
  function createState(mode) { return deepFreeze(clone(mode === 'real' ? emptyState('real') : demoState())); }

  function validateEntity(state, type, input, opts) {
    opts = opts || {};
    if (!isObj(input)) fail('实体必须是对象');
    var at = input.updatedAt || now(), id = input.id || idFor(type === 'factories' ? 'F' : type === 'warehouses' ? 'W' : type === 'people' ? 'P' : (['成品', '半成品', '外购商品'].indexOf(input.category) >= 0 ? 'G' : 'M'), state[type]);
    if (typeof id !== 'string' || !id.trim()) fail('ID不能为空');
    if (!validTimestamp(at)) fail('更新时间不合法');
    var out;
    if (type === 'factories') {
      assertPlainKeys(input, ['id', 'code', 'name', 'address', 'owner', 'phone', 'status', 'updatedAt'], '工厂');
      out = { id: id, code: text(input.code) || codeFor('F', state.factories), name: text(input.name), address: text(input.address), owner: text(input.owner), phone: text(input.phone), status: enumValue(input.status, ENUMS.factoryStatus, '工厂状态', false), updatedAt: at };
      if (!out.name) fail('工厂名称不能为空');
    } else if (type === 'warehouses') {
      assertPlainKeys(input, ['id', 'code', 'name', 'factoryId', 'factoryCode', 'type', 'owner', 'status', 'updatedAt'], '仓库');
      var fid = input.factoryId || (input.factoryCode && state.factories.find(function (f) { return f.code.toUpperCase() === String(input.factoryCode).toUpperCase(); }) || {}).id;
      out = { id: id, code: text(input.code) || codeFor('W', state.warehouses), name: text(input.name), factoryId: fid || '', type: enumValue(input.type, ENUMS.warehouseType, '仓库类型', true), owner: text(input.owner), status: enumValue(input.status, ENUMS.warehouseStatus, '仓库状态', false), updatedAt: at };
      if (!out.name) fail('仓库名称不能为空');
      requireFind(state, 'factories', out.factoryId, '仓库所属工厂');
    } else if (type === 'people') {
      assertPlainKeys(input, ['id', 'code', 'name', 'factoryId', 'factoryCode', 'department', 'position', 'phone', 'role', 'status', 'updatedAt'], '人员');
      var pfid = input.factoryId || (input.factoryCode && state.factories.find(function (f) { return f.code.toUpperCase() === String(input.factoryCode).toUpperCase(); }) || {}).id;
      out = { id: id, code: text(input.code) || codeFor('P', state.people), name: text(input.name), factoryId: pfid || '', department: text(input.department), position: text(input.position), phone: text(input.phone), role: enumValue(input.role, ENUMS.personRole, '人员角色', true), status: enumValue(input.status, ENUMS.personStatus, '人员状态', false), updatedAt: at };
      if (!out.name) fail('人员姓名不能为空');
      requireFind(state, 'factories', out.factoryId, '人员所属工厂');
    } else if (type === 'items') {
      assertPlainKeys(input, ['id', 'code', 'name', 'category', 'spec', 'unit', 'safetyStock', 'status', 'updatedAt'], '物品');
      var category = enumValue(input.category, ENUMS.itemCategory, '物品分类', true);
      var iprefix = ['成品', '半成品', '外购商品'].indexOf(category) >= 0 ? 'G' : 'M';
      if (!input.id) id = idFor(iprefix, state.items);
      out = { id: id, code: text(input.code) || codeFor(iprefix, state.items), name: text(input.name), category: category, spec: text(input.spec), unit: text(input.unit), safetyStock: numberValue(input.safetyStock === undefined ? 0 : input.safetyStock, '安全库存', true), status: enumValue(input.status, ENUMS.itemStatus, '物品状态', false), updatedAt: at };
      if (!out.name || !out.unit) fail('物品名称和单位不能为空');
    } else fail('不支持的实体类型');
    var old = state[type].find(function (x) { return x.id === out.id; });
    var codeUpper = out.code.toUpperCase();
    state[type].forEach(function (x) { if (x.id !== out.id && x.code.toUpperCase() === codeUpper) fail(type + '编码重复：' + out.code); });
    if (old && !opts.update) fail(type + 'ID已存在');
    if (!old && state[type].some(function (x) { return x.id === out.id; })) fail(type + 'ID已存在');
    return out;
  }

  function stockMap(state, excludeId) {
    var map = Object.create(null);
    function key(w, i) { return w + '|' + i; }
    state.flows.forEach(function (f) {
      if (f.id === excludeId || f.status !== '已确认') return;
      var k = key(f.warehouseId, f.itemId);
      map[k] = round6((map[k] || 0) + Number(f.delta || 0));
      if (f.type === '调拨') {
        var tk = key(f.targetWarehouseId, f.itemId);
        map[tk] = round6((map[tk] || 0) + Number(f.quantity || 0));
      }
    });
    return map;
  }
  function assertNoNegative(map, warehouseId, itemId, amount) {
    if (round6((map[warehouseId + '|' + itemId] || 0) + amount) < 0) fail('库存不足，不能确认流水');
  }
  function assertFlowAvailable(state, flow) {
    function availableWarehouse(id, label) {
      var warehouse = requireFind(state, 'warehouses', id, label);
      if (warehouse.status === '停用') fail(label + '已停用');
      var factory = requireFind(state, 'factories', warehouse.factoryId, label + '所属工厂');
      if (factory.status === '停用') fail(label + '所属工厂已停用');
    }
    availableWarehouse(flow.warehouseId, '流水仓库');
    if (flow.type === '调拨') availableWarehouse(flow.targetWarehouseId, '调拨目标仓库');
    if (requireFind(state, 'items', flow.itemId, '流水物品').status === '停用') fail('流水物品已停用');
    if (requireFind(state, 'people', flow.operator, '流水经办人').status === '离职') fail('流水经办人已离职');
  }
  function validateFlowInput(state, data) {
    if (!isObj(data)) fail('流水必须是对象');
    assertPlainKeys(data, ['id', 'code', 'type', 'warehouseId', 'itemId', 'targetWarehouseId', 'quantity', 'delta', 'operator', 'date', 'note', 'status', 'createdAt', 'confirmedAt'], '流水');
    var type = data.type;
    if (FLOW_TYPES.indexOf(type) < 0) fail('流水类型不合法');
    var w = requireFind(state, 'warehouses', data.warehouseId, '流水仓库');
    var item = requireFind(state, 'items', data.itemId, '流水物品');
    var op = find(state, 'people', data.operator) || state.people.find(function (p) { return p.code.toUpperCase() === String(data.operator || '').toUpperCase(); });
    if (!op) fail('流水经办人不存在');
    if (!validDate(data.date)) fail('流水日期必须为YYYY-MM-DD');
    var q = numberValue(data.quantity, '流水数量', true);
    var target = text(data.targetWarehouseId);
    if (type === '调拨') {
      if (!target) fail('调拨目标仓库不能为空');
      requireFind(state, 'warehouses', target, '调拨目标仓库');
      if (target === w.id) fail('调拨目标不能与源仓库相同');
    } else if (target) fail('只有调拨允许目标仓库');
    if (type === '期初') {
      var duplicate = state.flows.some(function (f) { return f.type === '期初' && f.warehouseId === w.id && f.itemId === item.id; });
      if (duplicate) fail('同仓库同物品的期初库存只能有一条');
      var hasOtherConfirmed = state.flows.some(function (f) { return f.status === '已确认' && f.type !== '期初' && (f.warehouseId === w.id && f.itemId === item.id || f.type === '调拨' && f.targetWarehouseId === w.id && f.itemId === item.id); });
      if (hasOtherConfirmed) fail('已有确认业务，不能补录期初库存');
    }
    var status = data.status === undefined || data.status === '' ? '待审核' : data.status;
    if (status !== '待审核' && status !== '已确认') fail('流水状态不合法');
    var flow = { id: data.id || idFor('L', state.flows), code: text(data.code) || codeFor('L', state.flows), type: type, warehouseId: w.id, itemId: item.id, targetWarehouseId: target, quantity: q, delta: 0, operator: op.id, date: data.date, note: text(data.note), status: status, createdAt: data.createdAt || now() };
    assertFlowAvailable(state, flow);
    return flow;
  }
  function checkAndConfirm(state, flow) {
    assertFlowAvailable(state, flow);
    var map = stockMap(state, flow.id), amount;
    if (flow.type === '期初') {
      var hasBusiness = state.flows.some(function (f) {
        return f.id !== flow.id && f.status === '已确认' && f.type !== '期初' &&
          (f.itemId === flow.itemId && (f.warehouseId === flow.warehouseId || f.type === '调拨' && f.targetWarehouseId === flow.warehouseId));
      });
      if (hasBusiness) fail('已有确认业务，不能确认期初库存');
      if (round6(map[flow.warehouseId + '|' + flow.itemId] || 0) !== 0) fail('已有库存，不能确认期初库存');
    }
    if (flow.type === '盘点') {
      amount = round6(flow.quantity - (map[flow.warehouseId + '|' + flow.itemId] || 0));
      flow.delta = amount;
    } else if (flow.type === '出库' || flow.type === '调拨') {
      amount = -flow.quantity;
      assertNoNegative(map, flow.warehouseId, flow.itemId, amount);
      flow.delta = amount;
    } else {
      flow.delta = flow.quantity;
    }
    if (flow.type === '盘点' && round6((map[flow.warehouseId + '|' + flow.itemId] || 0) + amount) < 0) fail('盘点数量不能为负数');
    flow.status = '已确认'; flow.confirmedAt = nextConfirmationAt(state);
    return flow;
  }
  function nextConfirmationAt(state) {
    var candidate = Date.now();
    state.flows.forEach(function (f) {
      if (f.status === '已确认' && validTimestamp(f.confirmedAt)) candidate = Math.max(candidate, Date.parse(f.confirmedAt) + 1);
    });
    return new Date(candidate).toISOString();
  }
  function addLog(state, action, entity, detail) { state.logs.push({ id: idFor('LOG', state.logs), at: now(), action: action, entity: entity, detail: detail }); }
  function validateFlowRecord(state, f, strictConfirmed) {
    var got = validateFlowInputForBackup(state, f);
    if (strictConfirmed && f.status === '已确认') {
      var expected = stockMap(state, f.id);
      var val = f.type === '盘点' ? round6(f.quantity - (expected[f.warehouseId + '|' + f.itemId] || 0)) : (f.type === '出库' || f.type === '调拨' ? -f.quantity : f.quantity);
      if (round6(f.delta) !== round6(val)) fail('流水差值与业务不一致');
      if ((f.type === '出库' || f.type === '调拨') && round6((expected[f.warehouseId + '|' + f.itemId] || 0) + val) < 0) fail('备份含负库存');
      if (f.type === '调拨') expected[f.targetWarehouseId + '|' + f.itemId] = round6((expected[f.targetWarehouseId + '|' + f.itemId] || 0) + f.quantity);
    }
    return got;
  }
  function validateFlowInputForBackup(state, f) {
    if (!isObj(f)) fail('流水记录不合法');
    assertPlainKeys(f, ['id', 'code', 'type', 'warehouseId', 'itemId', 'targetWarehouseId', 'quantity', 'delta', 'operator', 'date', 'note', 'status', 'createdAt', 'confirmedAt'], '流水');
    if (typeof f.id !== 'string' || !f.id || typeof f.code !== 'string' || !f.code) fail('流水编号不合法');
    if (FLOW_TYPES.indexOf(f.type) < 0) fail('流水类型不合法');
    requireFind(state, 'warehouses', f.warehouseId, '流水仓库'); requireFind(state, 'items', f.itemId, '流水物品'); requireFind(state, 'people', f.operator, '流水经办人');
    if (!validDate(f.date) || !validTimestamp(f.createdAt)) fail('流水时间不合法');
    if (f.confirmedAt !== undefined && f.confirmedAt !== '' && !validTimestamp(f.confirmedAt)) fail('确认时间不合法');
    numberValue(f.quantity, '流水数量', true);
    if (round6(f.quantity) !== f.quantity) fail('流水数量最多六位小数');
    if (typeof f.delta !== 'number' || !Number.isFinite(f.delta) || Math.abs(f.delta - round6(f.delta)) > 0.000000001) fail('流水差值不合法');
    if (f.type === '调拨') { if (!f.targetWarehouseId || f.targetWarehouseId === f.warehouseId) fail('调拨目标不合法'); requireFind(state, 'warehouses', f.targetWarehouseId, '调拨目标仓库'); }
    else if (f.targetWarehouseId) fail('非调拨流水不能有目标仓库');
    if (f.status !== '待审核' && f.status !== '已确认') fail('流水状态不合法');
    if (f.status === '待审核' && (f.delta !== 0 || f.confirmedAt)) fail('待审核流水被篡改');
    if (f.status === '已确认' && !f.confirmedAt) fail('已确认流水缺少确认时间');
    return f;
  }
  function validateState(input) {
    if (!isObj(input)) fail('备份必须是对象');
    assertPlainKeys(input, ['schemaVersion', 'mode', 'factories', 'warehouses', 'people', 'items', 'flows', 'logs', 'updatedAt'], '状态');
    if (input.schemaVersion !== VERSION || (input.mode !== 'demo' && input.mode !== 'real') || !validTimestamp(input.updatedAt)) fail('状态版本或模式不合法');
    TYPE_NAMES.forEach(function (t) { if (!Array.isArray(input[t])) fail(t + '必须是数组'); });
    if (!Array.isArray(input.flows) || !Array.isArray(input.logs)) fail('流水或日志必须是数组');
    var s = clone(input);
    var entityFields = {
      factories: ['id', 'code', 'name', 'address', 'owner', 'phone', 'status', 'updatedAt'],
      warehouses: ['id', 'code', 'name', 'factoryId', 'type', 'owner', 'status', 'updatedAt'],
      people: ['id', 'code', 'name', 'factoryId', 'department', 'position', 'phone', 'role', 'status', 'updatedAt'],
      items: ['id', 'code', 'name', 'category', 'spec', 'unit', 'status', 'updatedAt']
    };
    TYPE_NAMES.forEach(function (t) {
      s[t].forEach(function (x) {
        if (!isObj(x)) fail(t + '记录不合法');
        entityFields[t].forEach(function (k) { if (typeof x[k] !== 'string') fail(t + '字段类型不合法：' + k); });
        if (t === 'items' && (typeof x.safetyStock !== 'number' || !Number.isFinite(x.safetyStock) || x.safetyStock < 0 || round6(x.safetyStock) !== x.safetyStock)) fail('物品安全库存字段不合法');
      });
    });
    s.flows.forEach(function (f) {
      if (!isObj(f) || typeof f.quantity !== 'number' || typeof f.delta !== 'number') fail('流水数量字段类型不合法');
      ['id', 'code', 'type', 'warehouseId', 'itemId', 'targetWarehouseId', 'operator', 'date', 'note', 'status', 'createdAt'].forEach(function (k) { if (typeof f[k] !== 'string') fail('流水字段类型不合法：' + k); });
      if (f.confirmedAt !== undefined && typeof f.confirmedAt !== 'string') fail('流水确认时间字段类型不合法');
    });
    TYPE_NAMES.forEach(function (t) { s[t] = s[t].map(function (x) { return validateEntity(s, t, x, { update: true }); }); });
    allIdsUnique(s); uniqueCodes(s);
    s.logs.forEach(function (x) { assertPlainKeys(x, ['id', 'at', 'action', 'entity', 'detail'], '日志'); if (!x || typeof x.id !== 'string' || typeof x.at !== 'string' || typeof x.action !== 'string' || typeof x.entity !== 'string' || typeof x.detail !== 'string' || !x.id || !validTimestamp(x.at) || !text(x.action) || !text(x.entity)) fail('日志不合法'); });
    var seenFlowCodes = Object.create(null), openings = Object.create(null);
    s.flows.forEach(function (f) {
      validateFlowRecord(s, f, false);
      var c = f.code.toUpperCase(); if (seenFlowCodes[c]) fail('流水编号重复'); seenFlowCodes[c] = true;
      if (f.type === '期初') { var ok = f.warehouseId + '|' + f.itemId; if (openings[ok]) fail('期初重复'); openings[ok] = true; }
    });
    var map = Object.create(null);
    var confirmed = s.flows.map(function (f, index) { return { flow: f, index: index }; })
      .filter(function (x) { return x.flow.status === '已确认'; })
      .sort(function (a, b) {
        var byTime = Date.parse(a.flow.confirmedAt) - Date.parse(b.flow.confirmedAt);
        return byTime || a.index - b.index;
      });
    confirmed.forEach(function (entry, confirmationIndex) {
      var f = entry.flow;
      if (f.status !== '已确认') return;
      var k = f.warehouseId + '|' + f.itemId, cur = map[k] || 0;
      if (f.type === '期初') {
        var hadBusiness = confirmed.slice(0, confirmationIndex).some(function (priorEntry) { var prior = priorEntry.flow; return prior.type !== '期初' && prior.itemId === f.itemId && (prior.warehouseId === f.warehouseId || prior.type === '调拨' && prior.targetWarehouseId === f.warehouseId); });
        if (hadBusiness) fail('已有确认业务，不能补录期初库存');
      }
      var d = f.type === '盘点' ? round6(f.quantity - cur) : (f.type === '出库' || f.type === '调拨' ? -f.quantity : f.quantity);
      if (round6(f.delta) !== d) fail('流水差值与业务不一致');
      if (d < 0 && round6(cur + d) < 0) fail('备份含负库存');
      map[k] = round6(cur + d);
      if (f.type === '调拨') { var tk = f.targetWarehouseId + '|' + f.itemId; map[tk] = round6((map[tk] || 0) + f.quantity); }
    });
    return s;
  }

  function MemoryStorage() { this.data = Object.create(null); }
  MemoryStorage.prototype.getItem = function (k) { return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null; };
  MemoryStorage.prototype.setItem = function (k, v) { this.data[k] = String(v); };

  function Store(options) {
    options = options || {};
    this.key = options.key || 'sanxin-workbench-v2';
    if (options.storage) this.storage = options.storage;
    else {
      var browserStorage;
      try { browserStorage = typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined; }
      catch (e) { fail('访问浏览器存储失败：' + (e.message || e)); }
      this.storage = browserStorage || new MemoryStorage();
    }
    var raw;
    try { raw = this.storage.getItem(this.key); } catch (e) { fail('读取持久化数据失败：' + (e.message || e)); }
    if (raw !== null && raw !== undefined && raw !== '') {
      try { this._state = deepFreeze(validateState(JSON.parse(raw))); } catch (e) { fail('持久化数据损坏：' + (e.message || e)); }
    } else {
      this._state = deepFreeze(demoState());
      this._persist(this._state);
    }
  }
  Store.prototype._persist = function (state) {
    try { this.storage.setItem(this.key, JSON.stringify(state)); } catch (e) { fail('保存数据失败：' + (e.message || e)); }
  };
  Store.prototype._commit = function (next) { next.updatedAt = now(); validateState(next); this._persist(next); this._state = deepFreeze(clone(next)); return this._state; };
  Object.defineProperty(Store.prototype, 'state', { get: function () { return this._state; } });
  Store.prototype.saveEntity = function (type, data, id) {
    if (TYPE_NAMES.indexOf(type) < 0) fail('不支持的实体类型');
    var next = clone(this._state), input = clone(data || {}); if (id) input.id = id;
    var existingIndex = next[type].findIndex(function (x) { return x.id === input.id; });
    if (existingIndex >= 0) input = Object.assign({}, next[type][existingIndex], input);
    input.updatedAt = now();
    var entity = validateEntity(next, type, input, { update: existingIndex >= 0 });
    if (existingIndex >= 0) {
      var previous = next[type][existingIndex];
      if (type === 'warehouses' && previous.factoryId !== entity.factoryId && next.flows.some(function (f) { return f.warehouseId === previous.id || f.targetWarehouseId === previous.id; })) fail('已有历史流水，不能变更仓库所属工厂');
      if (type === 'items' && previous.unit !== entity.unit && next.flows.some(function (f) { return f.itemId === previous.id; })) fail('已有历史流水，不能变更物品单位');
    }
    if (existingIndex >= 0) next[type][existingIndex] = entity; else next[type].push(entity);
    addLog(next, existingIndex >= 0 ? '更新' : '新增', type, entity.code + ' ' + entity.name);
    this._commit(next); return clone(entity);
  };
  Store.prototype.recordFlow = function (data) {
    var next = clone(this._state), flow = validateFlowInput(next, data);
    next.flows.push(flow);
    if (flow.status === '已确认') checkAndConfirm(next, flow);
    addLog(next, flow.status === '已确认' ? '新增并确认' : '新增', 'flows', flow.code + ' ' + flow.type); this._commit(next); return clone(flow);
  };
  Store.prototype.confirmFlow = function (id) {
    var next = clone(this._state), flow = next.flows.find(function (x) { return x.id === id || x.code === id; });
    if (!flow) fail('流水不存在'); if (flow.status !== '待审核') fail('只能确认待审核流水');
    checkAndConfirm(next, flow); addLog(next, '确认', 'flows', flow.code); this._commit(next); return clone(flow);
  };
  Store.prototype.stockRows = function () {
    var map = stockMap(this._state), out = [], self = this;
    this._state.warehouses.forEach(function (w) { self._state.items.forEach(function (item) {
      var factory = find(self._state, 'factories', w.factoryId);
      out.push({ itemId: item.id, warehouseId: w.id, quantity: round6(map[w.id + '|' + item.id] || 0), item: clone(item), warehouse: clone(w), factory: clone(factory) });
    }); });
    return out;
  };
  Store.prototype.quantity = function (itemId, warehouseId) { requireFind(this._state, 'items', itemId, '物品'); requireFind(this._state, 'warehouses', warehouseId, '仓库'); var m = stockMap(this._state); return round6(m[warehouseId + '|' + itemId] || 0); };
  Store.prototype.importRecords = function (type, rows) {
    if (!Array.isArray(rows)) fail('导入数据必须是数组');
    var next = clone(this._state), result = [];
    rows.forEach(function (row) {
      if (!isObj(row)) fail('导入行必须是对象');
      if (TYPE_NAMES.indexOf(type) >= 0) { var e = validateEntity(next, type, row, { update: false }); next[type].push(e); result.push(clone(e)); }
      else if (type === 'opening') {
        var r = clone(row), w = r.warehouseId || (r.warehouseCode && (next.warehouses.find(function (x) { return x.code.toUpperCase() === String(r.warehouseCode).toUpperCase(); }) || {}).id), i = r.itemId || (r.itemCode && (next.items.find(function (x) { return x.code.toUpperCase() === String(r.itemCode).toUpperCase(); }) || {}).id);
        r.type = '期初'; r.warehouseId = w; r.itemId = i;
        if (r.factoryCode) {
          var importFactory = next.factories.find(function (x) { return x.code.toUpperCase() === String(r.factoryCode).toUpperCase(); });
          if (!importFactory) fail('导入工厂不存在');
          var importWarehouse = next.warehouses.find(function (x) { return x.id === w; });
          if (!importWarehouse || importWarehouse.factoryId !== importFactory.id) fail('导入工厂与仓库关系不一致');
        }
        if (!r.operator && r.operatorCode) r.operator = (next.people.find(function (x) { return x.code.toUpperCase() === String(r.operatorCode).toUpperCase(); }) || {}).id;
        r.operator = r.operator || r.personId; r.date = r.date || new Date().toISOString().slice(0, 10);
        delete r.factoryCode; delete r.warehouseCode; delete r.itemCode; delete r.operatorCode; delete r.personId;
        var f = validateFlowInput(next, r); next.flows.push(f); if (f.status === '已确认') checkAndConfirm(next, f); result.push(clone(f));
      } else fail('不支持的导入类型');
    });
    addLog(next, '批量导入', type, '共' + rows.length + '行'); this._commit(next); return result;
  };
  Store.prototype.exportBackup = function () { return JSON.stringify(this._state); };
  Store.prototype.restoreBackup = function (json) {
    if (typeof json !== 'string' || json.length > 50 * 1024 * 1024) fail('备份文本不合法');
    var parsed; try { parsed = JSON.parse(json); } catch (e) { fail('备份不是有效JSON'); }
    var next = validateState(parsed); addLog(next, '恢复备份', 'state', '严格校验通过'); this._commit(next); return clone(this._state);
  };
  Store.prototype.startBlank = function () {
    var next = emptyState('real'); next.logs = clone(this._state.logs || []); addLog(next, '清空示例数据', 'state', '已开始真实数据录入'); this._commit(next); return clone(this._state);
  };

  function parseCSV(input) {
    if (typeof input !== 'string') fail('CSV必须是文本');
    var s = input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input, rows = [], row = [], cell = '', quoted = false;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (quoted) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c; }
      else if (c === '"' && cell === '') quoted = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (quoted) fail('CSV引号未闭合');
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  function safeCSVCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function stringifyCSV(rows) {
    if (!Array.isArray(rows)) fail('CSV数据必须是数组');
    var arr = rows;
    if (rows.length && isObj(rows[0])) { var keys = Object.keys(rows[0]); arr = [keys].concat(rows.map(function (r) { return keys.map(function (k) { return r[k]; }); })); }
    return '\uFEFF' + arr.map(function (r) { if (!Array.isArray(r)) fail('CSV每行必须是数组或对象'); return r.map(safeCSVCell).join(','); }).join('\r\n') + (arr.length ? '\r\n' : '');
  }
  return { Store: Store, createState: createState, parseCSV: parseCSV, stringifyCSV: stringifyCSV };
}));
