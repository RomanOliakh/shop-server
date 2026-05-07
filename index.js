require('dotenv').config()
const express = require('express')
const cors = require('cors')
const crypto = require('crypto')
const { Pool } = require('pg')

const app = express()
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

app.use(cors({ origin: process.env.WEBFLOW_URL }))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

function liqpaySign(data) {
  return crypto
    .createHash('sha1')
    .update(process.env.LIQPAY_PRIVATE_KEY + data + process.env.LIQPAY_PRIVATE_KEY)
    .digest('base64')
}

// Створення платежу
app.post('/create-payment', async (req, res) => {
  const { order_id, amount, description, items } = req.body

  await pool.query(
    'INSERT INTO orders (order_id, items, amount, status) VALUES ($1, $2, $3, $4)',
    [order_id, JSON.stringify(items), amount, 'pending']
  )

  const params = {
    version: 3,
    public_key: process.env.LIQPAY_PUBLIC_KEY,
    action: 'pay',
    amount,
    currency: 'UAH',
    description,
    order_id,
    sandbox: 1,
    result_url: process.env.WEBFLOW_URL + '/success',
    server_url: 'https://shop-server-production-73ba.up.railway.app/callback'
  }

  const data = Buffer.from(JSON.stringify(params)).toString('base64')
  const signature = liqpaySign(data)

  res.json({ data, signature })
})

// Callback від LiqPay
app.post('/callback', async (req, res) => {
  const { data, signature } = req.body

  const expectedSig = liqpaySign(data)
  if (expectedSig !== signature) {
    return res.status(400).send('Invalid signature')
  }

  const payload = JSON.parse(Buffer.from(data, 'base64').toString('utf8'))
  const { order_id, status } = payload

  const mappedStatus = status === 'success' ? 'paid' : 'failed'

  await pool.query(
    'UPDATE orders SET status = $1 WHERE order_id = $2',
    [mappedStatus, order_id]
  )

  console.log(`Order ${order_id} → ${mappedStatus}`)
  res.send('OK')
})

app.listen(process.env.PORT, () => {
  console.log('Server running on port ' + process.env.PORT)
})