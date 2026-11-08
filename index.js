// backend/server.js — Node.js + Express + PostgreSQL (pg) Backend API
// Create more route files in backend/routes/*.js using the "+ File" button!
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/fastfood_db',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// 1. Health Check Route
app.get('/api/health', async (req, res) => {
  const usersCount = await pool.query('SELECT * FROM users');
  const ordersCount = await pool.query('SELECT * FROM orders');
  res.status(200).json({
    status: 'online',
    engine: 'Node.js v20 + Express + PostgreSQL 16',
    tables: {
      users: usersCount.rowCount,
      orders: ordersCount.rowCount,
    },
  });
});

// 2. Get All Registered Users from PostgreSQL
app.get('/api/users', async (req, res) => {
  const result = await pool.query('SELECT * FROM users ORDER BY id DESC');
  res.status(200).json({
    ok: true,
    count: result.rowCount,
    users: result.rows,
  });
});

// 3. Register / Sign-In User from Flutter -> PostgreSQL
app.post('/api/auth/register', async (req, res) => {
  const { country, dial_code, phone, email } = req.body || {};
  const cleanPhone = String(phone || '911234567').trim();
  const cleanEmail = String(email || 'user@fastfood.et').trim();
  const cleanCountry = String(country || 'Ethiopia').trim();
  const cleanDial = String(dial_code || '+251').trim();

  const insertResult = await pool.query(
    'INSERT INTO users (country, dial_code, phone, email) VALUES ($1, $2, $3, $4) RETURNING *',
    [cleanCountry, cleanDial, cleanPhone, cleanEmail]
  );

  res.status(201).json({
    ok: true,
    message: 'User saved to PostgreSQL!',
    user:insertResult.rows[0],
  });
});

// 4. Get Fast Food Menu Items from PostgreSQL
app.get('/api/menu', async (req, res) => {
  const result = await pool.query('SELECT * FROM menu_items ORDER BY id ASC');
  res.status(200).json({
    ok: true,
    menu: result.rows,
  });
});

// 5. Get Orders & Create New Fast Food Order in PostgreSQL
app.get('/api/orders', async (req, res) => {
  const result = await pool.query('SELECT * FROM orders ORDER BY id DESC');
  res.status(200).json({
    ok: true,
    orders: result.rows,
  });
});

app.post('/api/orders', async (req, res) => {
  const { customer_email, item_name, total_etb, status } = req.body || {};
  const insertOrder = await pool.query(
    'INSERT INTO orders (customer_email, item_name, total_etb, status) VALUES ($1, $2, $3, $4) RETURNING *',
    [customer_email || 'abebe@fastfood.et', item_name || 'Double Cheese Burger', total_etb || 450, status || 'Preparing']
  );
  res.status(201).json({
    ok: true,
    order: insertOrder.rows[0],
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('🚀 Node.js + PostgreSQL API listening on port ' + PORT);
});
('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const SECRET = process.env.JWT_SECRET;
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'መግባት ያስፈልጋል' });
  }
}

app.get('/', (req, res) => res.send('FastFoodApp API ✅'));

app.post('/auth/register', wrap(async (req, res) => {
  const { name, phone, password, role } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (name, phone, password, role) VALUES ($1,$2,$3,$4) RETURNING id, name, role',
      [name, phone, hash, role || 'customer']
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e.message);
    res.status(400).json({ error: 'ስልኩ ተመዝግቧል ወይም መረጃው ትክክል አይደለም' });
  }
}));

app.post('/auth/login', wrap(async (req, res) => {
  const { phone, password } = req.body;
  const { rows } = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'ስልክ ወይም የይለፍ ቃል ትክክል አይደለም' });
  }
  const token = jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
}));

app.get('/restaurants', auth, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, address FROM restaurants ORDER BY name');
  res.json(rows);
}));

app.get('/restaurants/:id/menu', auth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, price FROM menu_items WHERE restaurant_id = $1',
    [req.params.id]
  );
  res.json(rows);
}));

app.post('/orders', auth, wrap(async (req, res) => {
  const { restaurant_id, items, delivery_lat, delivery_lng } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO orders (customer_id, restaurant_id, delivery_lat, delivery_lng)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.id, restaurant_id, delivery_lat, delivery_lng]
    );
    const order = rows[0];
    for (const it of items) {
      await client.query(
        'INSERT INTO order_items (order_id, menu_item_id, qty) VALUES ($1, $2, $3)',
        [order.id, it.menu_item_id, it.qty]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(order);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e.message);
    res.status(500).json({ error: 'ትዕዛዙ አልተመዘገበም' });
  } finally {
    client.release();
  }
}));

app.get('/orders/mine', auth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC',
    [req.user.id]
  );
  res.json(rows);
}));

app.patch('/orders/:id/status', auth, wrap(async (req, res) => {
  const allowed = ['pending', 'accepted', 'assigned', 'on_the_way', 'delivered', 'cancelled'];
  const { status } = req.body;
  if (!allowed.includes(status)) return res.status(400).json({ error: 'ልክ ያልሆነ ሁኔታ' });
  const { rows } = await pool.query(
    'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
    [status, req.params.id]
  );
  res.json(rows[0]);
}));

app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(err.status || 500).json({ error: 'የአገልጋይ ስህተት' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('API ዝግጁ ነው: port', port));
