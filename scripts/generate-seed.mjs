// Generates rds_worker/seed.sql — a full DB reset + believable mock-data reseed.
// Run: node scripts/generate-seed.mjs   (from rds_worker/)
// Apply (destructive, remote prod D1 — run yourself, see CLAUDE.md):
//   wrangler d1 execute rds_factory_management --remote --file=./seed.sql
import { writeFileSync } from 'node:fs'

const TODAY = new Date('2026-10-16')
const START = new Date('2025-01-01')
const SETTLED_CUTOFF = new Date(TODAY)
SETTLED_CUTOFF.setMonth(SETTLED_CUTOFF.getMonth() - 3)

function sqlStr(v) {
  if (v === null || v === undefined) return 'NULL'
  return `'${String(v).replace(/'/g, "''")}'`
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10)
}

// ---------- Customers ----------
const PREFIXES = ['PT', 'CV', 'UD']
const NAME_PARTS_A = [
  'Sumber', 'Mitra', 'Cahaya', 'Berkah', 'Sinar', 'Karya', 'Indah', 'Maju',
  'Jaya', 'Abadi', 'Utama', 'Sejati', 'Bintang', 'Mandiri', 'Harapan', 'Prima',
  'Pelangi', 'Nusantara', 'Sentosa', 'Perkasa', 'Makmur', 'Lestari', 'Sakti',
  'Agung', 'Timur', 'Wijaya', 'Pratama', 'Sentra', 'Citra', 'Gemilang',
]
const NAME_PARTS_B = [
  'Makmur', 'Abadi', 'Sejahtera', 'Jaya', 'Logistik', 'Industri', 'Niaga',
  'Perkasa', 'Sentosa', 'Utama', 'Mandiri', 'Teknik', 'Metal', 'Plastik',
  'Kimia', 'Pangan', 'Agro', 'Elektrik', 'Kemasan', 'Raya',
]

function genCompanyNames(count) {
  const used = new Set()
  const result = []
  while (result.length < count) {
    const name = `${pick(PREFIXES)} ${pick(NAME_PARTS_A)} ${pick(NAME_PARTS_B)}`
    if (used.has(name)) continue
    used.add(name)
    result.push(name)
  }
  return result
}

const STREETS = [
  'Jl. Industri Raya', 'Jl. Raya Bekasi', 'Jl. Gatot Subroto', 'Jl. Ahmad Yani',
  'Jl. Sudirman', 'Jl. Pelabuhan', 'Jl. Pahlawan', 'Jl. Kawasan Industri MM2100',
  'Jl. Raya Cikarang', 'Jl. Pergudangan Margomulyo', 'Jl. Rungkut Industri',
  'Jl. Veteran', 'Jl. Daan Mogot', 'Jl. Raya Serang', 'Jl. Tanjung Priok',
]
const CITIES = [
  'Jakarta Utara', 'Jakarta Barat', 'Bekasi', 'Tangerang', 'Cikarang',
  'Surabaya', 'Bandung', 'Semarang', 'Cibitung', 'Karawang',
]

const FIRST_NAMES = [
  'Budi', 'Siti', 'Agus', 'Dewi', 'Hendra', 'Rahmat', 'Indah', 'Sukarno',
  'Wijaya', 'Susanto', 'Rahmawati', 'Kusuma', 'Santoso', 'Lestari', 'Wahyu',
  'Fitri', 'Hadi', 'Yuni', 'Sutrisno', 'Mega',
]
const LAST_NAMES = [
  'Santoso', 'Wijaya', 'Kusuma', 'Salim', 'Hartono', 'Gunawan', 'Setiawan',
  'Halim', 'Pratama', 'Sutanto', 'Wibowo', 'Saputra', 'Hidayat', 'Lesmana',
]

const CUSTOMER_COUNT = 30
const companyNames = genCompanyNames(CUSTOMER_COUNT)

const customers = companyNames.map((company_name, idx) => ({
  customer_id: idx + 1,
  company_name,
  address: `${pick(STREETS)} No. ${randInt(1, 200)}, ${pick(CITIES)}`,
}))

const usedPhones = new Set()
function genPhone() {
  let phone
  do {
    phone = `08${randInt(1, 9)}${String(randInt(0, 99999999)).padStart(8, '0')}`
  } while (usedPhones.has(phone))
  usedPhones.add(phone)
  return phone
}

const contacts = customers.map((c, idx) => ({
  contact_id: idx + 1,
  customer_id: c.customer_id,
  contact_name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
  phone_number: genPhone(),
}))

// ---------- Products ----------
const products = [
  { sku_name: 'Plat Besi Hitam 4mm', unit: 'lembar', suggested_price: 850000 },
  { sku_name: 'Plat Besi Galvanis 2mm', unit: 'lembar', suggested_price: 620000 },
  { sku_name: 'Besi Hollow 40x40', unit: 'batang', suggested_price: 145000 },
  { sku_name: 'Besi Siku 50x50', unit: 'batang', suggested_price: 98000 },
  { sku_name: 'Pipa Besi 2 inch', unit: 'batang', suggested_price: 210000 },
  { sku_name: 'Kawat Las 2.6mm', unit: 'kg', suggested_price: 42000 },
  { sku_name: 'Mur Baut M12', unit: 'pack', suggested_price: 65000 },
  { sku_name: 'Cat Besi Anti Karat', unit: 'kaleng', suggested_price: 125000 },
  { sku_name: 'Kabel NYY 4x2.5mm', unit: 'meter', suggested_price: 38000 },
  { sku_name: 'Bearing 6204', unit: 'pcs', suggested_price: 55000 },
  { sku_name: 'Karton Box Double Wall', unit: 'pcs', suggested_price: 12000 },
  { sku_name: 'Lakban Bening 2 inch', unit: 'roll', suggested_price: 9500 },
  { sku_name: 'Plastik Wrap Industri', unit: 'roll', suggested_price: 85000 },
  { sku_name: 'Drum Plastik 200L', unit: 'pcs', suggested_price: 340000 },
  { sku_name: 'Pallet Kayu Standar', unit: 'pcs', suggested_price: 95000 },
  { sku_name: 'Sarung Tangan Safety', unit: 'pack', suggested_price: 28000 },
  { sku_name: 'Oli Hidrolik 20L', unit: 'drum', suggested_price: 680000 },
  { sku_name: 'Baut Anchor 12mm', unit: 'pack', suggested_price: 52000 },
]

const productRows = products.map((p, idx) => ({ sku_id: idx + 1, ...p }))

// ---------- Months (Jan 2025 .. current month) ----------
const months = []
{
  const cursor = new Date(START)
  while (cursor <= TODAY) {
    months.push({ year: cursor.getFullYear(), month: cursor.getMonth() + 1 })
    cursor.setMonth(cursor.getMonth() + 1)
  }
}

function monthDayRange(year, month) {
  const lastDay = new Date(year, month, 0).getDate()
  const isCurrentMonth = year === TODAY.getFullYear() && month === TODAY.getMonth() + 1
  return { min: 1, max: isCurrentMonth ? TODAY.getDate() : lastDay }
}

// ---------- Generate nota + items + payments ----------
const notaRows = []
const notaItemRows = []
const paymentRows = []

let globalSeq = 0
const customerSeqCounter = new Map()

for (const { year, month } of months) {
  const { min, max } = monthDayRange(year, month)
  if (min > max) continue
  const yymm = `${String(year).slice(2, 4)}${String(month).padStart(2, '0')}`

  for (const customer of customers) {
    const contact = contacts[customer.customer_id - 1]
    const day = randInt(min, max)
    const notaDate = new Date(year, month - 1, day)
    const notaDateStr = fmtDate(notaDate)

    globalSeq += 1
    const customerSeq = (customerSeqCounter.get(customer.customer_id) ?? 0) + 1
    customerSeqCounter.set(customer.customer_id, customerSeq)
    const notaNumber = `INV/${yymm}/${customer.customer_id}-${customerSeq}/${globalSeq}`

    const itemCount = randInt(2, 4)
    const chosenSkus = new Set()
    while (chosenSkus.size < itemCount) chosenSkus.add(pick(productRows).sku_id)

    let totalPrice = 0
    const items = []
    for (const skuId of chosenSkus) {
      const product = productRows[skuId - 1]
      const qty = randInt(1, 20)
      const priceVariance = 1 + (randInt(-8, 8) / 100)
      const price = Math.round((product.suggested_price * priceVariance) / 1000) * 1000
      const lineTotal = qty * price
      totalPrice += lineTotal
      items.push({
        sku_id: skuId,
        item_name_snapshot: product.sku_name,
        unit_snapshot: product.unit,
        qty,
        price,
        total_price: lineTotal,
      })
    }

    const notaId = globalSeq
    notaRows.push({
      nota_id: notaId,
      nota_number: notaNumber,
      nota_date: notaDateStr,
      customer_id: customer.customer_id,
      customer_company_name_snapshot: customer.company_name,
      customer_address_snapshot: customer.address,
      contact_id: contact.contact_id,
      contact_name_snapshot: contact.contact_name,
      contact_phone_number_snapshot: contact.phone_number,
      total_price: totalPrice,
    })
    for (const item of items) notaItemRows.push({ nota_id: notaId, ...item })

    // ---- payments ----
    const isRecent = notaDate >= SETTLED_CUTOFF
    let settlement = 'paid'
    if (isRecent) {
      const r = Math.random()
      settlement = r < 0.4 ? 'paid' : r < 0.7 ? 'partial' : 'unpaid'
    }

    if (settlement === 'paid') {
      const payDate = new Date(notaDate)
      payDate.setDate(payDate.getDate() + randInt(2, 12))
      if (payDate > TODAY) payDate.setTime(TODAY.getTime())
      paymentRows.push({
        nota_id: notaId,
        payment_date: fmtDate(payDate),
        amount: totalPrice,
        method: pick(['Cash', 'Bank Transfer', 'QRIS', 'Check', 'Other']),
      })
    } else if (settlement === 'partial') {
      const payDate = new Date(notaDate)
      payDate.setDate(payDate.getDate() + randInt(2, 12))
      if (payDate > TODAY) payDate.setTime(TODAY.getTime())
      const fraction = randInt(30, 70) / 100
      const amount = Math.max(1000, Math.round((totalPrice * fraction) / 1000) * 1000)
      paymentRows.push({
        nota_id: notaId,
        payment_date: fmtDate(payDate),
        amount,
        method: pick(['Cash', 'Bank Transfer', 'QRIS', 'Check', 'Other']),
      })
    }
    // 'unpaid' -> no payment rows
  }
}

// ---------- Emit SQL ----------
const out = []
out.push('-- Generated by scripts/generate-seed.mjs — full reseed of customer/product/nota/payment data.')
out.push('-- Keeps business and user rows intact.')
out.push('PRAGMA defer_foreign_keys = TRUE;')
out.push('')
out.push('DELETE FROM payment;')
out.push('DELETE FROM nota_item;')
out.push('DELETE FROM nota;')
out.push('DELETE FROM customer_contact;')
out.push('DELETE FROM customer;')
out.push('DELETE FROM product;')
out.push(
  "DELETE FROM sqlite_sequence WHERE name IN ('payment','nota_item','nota','customer_contact','customer','product');",
)
out.push('')

out.push('-- Customers')
for (const c of customers) {
  out.push(
    `INSERT INTO customer (customer_id, company_name, address, is_active) VALUES (${c.customer_id}, ${sqlStr(c.company_name)}, ${sqlStr(c.address)}, 1);`,
  )
}
out.push('')

out.push('-- Contacts')
for (const ct of contacts) {
  out.push(
    `INSERT INTO customer_contact (contact_id, customer_id, contact_name, phone_number, is_primary, is_active) VALUES (${ct.contact_id}, ${ct.customer_id}, ${sqlStr(ct.contact_name)}, ${sqlStr(ct.phone_number)}, 1, 1);`,
  )
}
out.push('')

out.push('-- Products')
for (const p of productRows) {
  out.push(
    `INSERT INTO product (sku_id, sku_name, unit, suggested_price, is_active) VALUES (${p.sku_id}, ${sqlStr(p.sku_name)}, ${sqlStr(p.unit)}, ${p.suggested_price}, 1);`,
  )
}
out.push('')

out.push('-- Nota')
for (const n of notaRows) {
  out.push(
    `INSERT INTO nota (nota_id, nota_number, nota_date, customer_id, customer_company_name_snapshot, customer_address_snapshot, contact_id, contact_name_snapshot, contact_phone_number_snapshot, total_price, created_by) VALUES (${n.nota_id}, ${sqlStr(n.nota_number)}, ${sqlStr(n.nota_date)}, ${n.customer_id}, ${sqlStr(n.customer_company_name_snapshot)}, ${sqlStr(n.customer_address_snapshot)}, ${n.contact_id}, ${sqlStr(n.contact_name_snapshot)}, ${sqlStr(n.contact_phone_number_snapshot)}, ${n.total_price}, (SELECT user_id FROM user ORDER BY user_id LIMIT 1));`,
  )
}
out.push('')

out.push('-- Nota items')
for (const it of notaItemRows) {
  out.push(
    `INSERT INTO nota_item (nota_id, sku_id, item_name_snapshot, unit_snapshot, qty, price, discount_amount, discount_percent, total_price) VALUES (${it.nota_id}, ${it.sku_id}, ${sqlStr(it.item_name_snapshot)}, ${sqlStr(it.unit_snapshot)}, ${it.qty}, ${it.price}, 0, 0, ${it.total_price});`,
  )
}
out.push('')

out.push('-- Payments')
for (const p of paymentRows) {
  out.push(
    `INSERT INTO payment (nota_id, payment_date, amount, method, reference, is_void) VALUES (${p.nota_id}, ${sqlStr(p.payment_date)}, ${p.amount}, ${sqlStr(p.method)}, NULL, 0);`,
  )
}
out.push('')

writeFileSync(new URL('../seed.sql', import.meta.url), out.join('\n') + '\n')

console.log(`Generated seed.sql: ${customers.length} customers, ${productRows.length} products, ${notaRows.length} nota, ${notaItemRows.length} nota items, ${paymentRows.length} payments.`)
