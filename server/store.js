const fs = require('fs');
const path = require('path');
const { AppError } = require('./errors');

const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'db.json');

const DEFAULT_SETTINGS = {
  volumetricDivisor: 6000,
  minChargeYuan: 8,
  oversizeWeightKg: 30,
  oversizePieces: 3,
  oversizeFeeYuan: 20,
  insurancePermille: 20,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function emptyData() {
  return {
    meta: { name: '运单计费与账单核对台', currency: 'CNY', updatedAt: null },
    settings: clone(DEFAULT_SETTINGS),
    zones: [],
    customers: [],
    waybills: [],
    bills: [],
  };
}

const WEIGH_SOURCES = ['初次登记', '现场复称', '客户送检'];

// 老数据只有 weightKg 一个数：补出一条「初次登记」称重记录，并保证 weightKg 始终等于当前在用记录的数值
function migrateWeighings(waybill) {
  if (!Array.isArray(waybill.weighings)) waybill.weighings = [];
  waybill.weighings = waybill.weighings.filter((item) => item && Number(item.weightKg) > 0);
  waybill.weighings.forEach((item, index) => {
    item.weightKg = Number(item.weightKg);
    if (!item.id) item.id = 'w-' + String(index + 1).padStart(4, '0');
    if (!WEIGH_SOURCES.includes(item.source)) item.source = '初次登记';
    if (!item.weighedAt) item.weighedAt = waybill.createdAt || '';
  });
  if (waybill.weighings.length === 0 && Number(waybill.weightKg) > 0) {
    waybill.weighings.push({
      id: 'w-0001',
      weightKg: Number(waybill.weightKg),
      source: '初次登记',
      weighedAt: waybill.createdAt || '',
    });
  }
  const active = waybill.weighings.find((item) => item.id === waybill.activeWeighingId);
  if (!active && waybill.weighings.length > 0) {
    waybill.activeWeighingId = waybill.weighings[waybill.weighings.length - 1].id;
  }
  const current = waybill.weighings.find((item) => item.id === waybill.activeWeighingId);
  if (current) waybill.weightKg = current.weightKg;
}

function normalize(raw) {
  const base = emptyData();
  const data = raw && typeof raw === 'object' ? raw : {};
  const out = {
    meta: Object.assign({}, base.meta, data.meta || {}),
    settings: Object.assign({}, base.settings, data.settings || {}),
    zones: Array.isArray(data.zones) ? data.zones.filter((item) => item && item.id) : [],
    customers: Array.isArray(data.customers) ? data.customers.filter((item) => item && item.id) : [],
    waybills: Array.isArray(data.waybills) ? data.waybills.filter((item) => item && item.id) : [],
    bills: Array.isArray(data.bills) ? data.bills.filter((item) => item && item.id) : [],
  };
  out.zones.forEach((zone) => {
    if (!Array.isArray(zone.cities)) zone.cities = [];
    if (!zone.aliases || typeof zone.aliases !== 'object') zone.aliases = {};
  });
  out.waybills.forEach((waybill) => {
    if (!Array.isArray(waybill.services)) waybill.services = [];
    migrateWeighings(waybill);
  });
  out.bills.forEach((bill) => {
    if (!Array.isArray(bill.waybillIds)) bill.waybillIds = [];
  });
  return out;
}

function ensureDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

function load() {
  ensureDir();
  if (!fs.existsSync(dataFile)) {
    const seeded = normalize(null);
    save(seeded);
    return seeded;
  }
  const text = fs.readFileSync(dataFile, 'utf8');
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new AppError(500, 'DATA_UNREADABLE', '数据文件读不出来，请检查 data/db.json 的内容是否完整');
  }
  return normalize(parsed);
}

function save(data) {
  ensureDir();
  const next = normalize(data);
  next.meta.updatedAt = new Date().toISOString();
  fs.writeFileSync(dataFile, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function nextId(prefix, list) {
  let max = 0;
  list.forEach((item) => {
    const match = String(item.id || '').match(/(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  });
  return prefix + '-' + String(max + 1).padStart(4, '0');
}

module.exports = { load, save, normalize, nextId, dataFile, DEFAULT_SETTINGS, WEIGH_SOURCES };
