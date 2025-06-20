// ... existing imports
require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const pool = require('./config/db');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// WhatsApp client setup
const client = new Client({ 
  authStrategy: new LocalAuth(),
  puppeteer: { args: ['--no-sandbox'] }
});

client.on('qr', async qr => {
  const qrCode = await QRCode.toDataURL(qr);
  io.emit('qr', qrCode);
});

client.on('ready', () => {
  console.log('✅ WhatsApp Connected');
  io.emit('ready');
});

client.initialize();

// --- API Endpoints ---

// Get all categories
app.get('/api/categories', async (_, res) => {
  const result = await pool.query('SELECT * FROM categories ORDER BY name');
  res.json(result.rows);
});

// ✅ NEW: Get contacts for a specific category
app.get('/api/categories/:id/contacts', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'SELECT id, name, number FROM contacts WHERE category = $1 ORDER BY name',
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error fetching contacts by category:', err);
    res.status(500).json({ error: 'Failed to fetch contacts by category' });
  }
});

// Add category
app.post('/api/categories', async (req, res) => {
  const { name } = req.body;
  const result = await pool.query(
    'INSERT INTO categories (name) VALUES ($1) RETURNING *',
    [name]
  );
  res.json(result.rows[0]);
});

// Update category
app.put('/api/categories/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const { name } = req.body;

  if (!name) return res.status(400).json({ error: 'Name is required' });

  try {
    const result = await pool.query(
      'UPDATE categories SET name = $1 WHERE id = $2 RETURNING *',
      [name, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error updating category:', err);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// Delete category
app.delete('/api/categories/:id', async (req, res) => {
  const id = parseInt(req.params.id);

  try {
    const result = await pool.query('DELETE FROM categories WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error deleting category:', err);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// Get contacts
app.get('/api/contacts', async (_, res) => {
  const result = await pool.query(`
    SELECT contacts.id, contacts.name, contacts.number,
      categories.id AS category_id, categories.name AS category_name
    FROM contacts
    LEFT JOIN categories ON contacts.category::int = categories.id
    ORDER BY categories.name NULLS FIRST, contacts.name
  `);

  const contacts = result.rows.map(c => ({
    id: c.id,
    name: c.name,
    number: c.number,
    category: c.category_id
      ? { id: c.category_id, name: c.category_name }
      : null
  }));

  res.json(contacts);
});

// Add contact
app.post('/api/contacts', async (req, res) => {
  const { name, number, category } = req.body;
  const categoryId = category === '' ? null : category;

  const result = await pool.query(
    'INSERT INTO contacts (name, number, category) VALUES ($1, $2, $3) RETURNING *',
    [name, number, categoryId]
  );
  res.json(result.rows[0]);
});

// ✅ Send message and store in DB
app.post('/api/send', async (req, res) => {
  const { numbers, message, category } = req.body;
  let contactsNumbers = numbers || [];

  if (category) {
    const result = await pool.query('SELECT number FROM contacts WHERE category = $1', [category]);
    contactsNumbers = result.rows.map(r => r.number);
  }

  for (const number of contactsNumbers) {
    const cleaned = number.replace(/\D/g, '');
    if (!cleaned) continue;

    const formatted = cleaned + '@c.us';

    try {
      await client.sendMessage(formatted, message);

      await pool.query(
        `INSERT INTO messages (message, numbers, category_id) VALUES ($1, $2, $3)`,
        [message, [number], category || null]
      );
    } catch (error) {
      console.error('❌ Failed to send message to', formatted, error);
    }
  }

  res.json({ success: true });
});

// ✅ Get message history
app.get('/api/messages', async (_, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        m.id,
        m.message,
        m.numbers,
        m.sent_at,
        m.category_id,
        c.name AS category,
        json_agg(json_build_object('number', n.number, 'name', ct.name)) AS recipients
      FROM messages m
      LEFT JOIN categories c ON m.category_id = c.id
      LEFT JOIN LATERAL unnest(m.numbers) AS n(number) ON TRUE
      LEFT JOIN contacts ct ON ct.number = n.number
      GROUP BY m.id, c.name
      ORDER BY m.sent_at DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error fetching messages:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Update contact
app.put('/api/contacts/:id', async (req, res) => {
  const { id } = req.params;
  const { name, number, category } = req.body;
  const categoryId = category === '' ? null : category;

  try {
    const result = await pool.query(
      'UPDATE contacts SET name = $1, number = $2, category = $3 WHERE id = $4 RETURNING *',
      [name, number, categoryId, id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error updating contact:', error);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

// Delete contact
app.delete('/api/contacts/:id', async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query('DELETE FROM contacts WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error deleting contact:', error);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
