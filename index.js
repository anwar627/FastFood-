require('dotenv').config();
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
