// POST /auth/continue   body: { phone: "+2519XXXXXXXX", email: "name@example.com" }
// Finds the account by phone number, or creates it. Answers like /auth/login does.
app.post('/auth/continue', async (req, res) => {
  try {
    const phone = String(req.body.phone || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();

    if (!/^\+251[79]\d{8}$/.test(phone)) {
      return res.status(400).json({ error: 'Enter a valid Ethiopian phone number' });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email' });
    }

    // 1) is the phone number already registered?
    const found = await pool.query(
      'SELECT id, name, role, email FROM users WHERE phone = $1',
      [phone]
    );
    let user = found.rows[0];

    if (user) {
      // the email must match the one saved for this phone number
      if (user.email && user.email.toLowerCase() !== email) {
        return res.status(401).json({ error: 'This phone number is registered with a different email' });
      }
      if (!user.email) {
        await pool.query('UPDATE users SET email = $1 WHERE id = $2', [email, user.id]);
      }
    } else {
      // 2) new phone number: the email must not belong to someone else
      const taken = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1', [email]);
      if (taken.rows.length > 0) {
        return res.status(409).json({ error: 'This email is already used by another account' });
      }
      const created = await pool.query(
        "INSERT INTO users (name, phone, email, role) VALUES ('', $1, $2, 'customer') RETURNING id, name, role",
        [phone, email]
      );
      user = created.rows[0];
    }

    // 3) token: use the same jwt.sign(...) line that your /auth/login route uses
    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.json({ token, user: { id: user.id, name: user.name || '', role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});
