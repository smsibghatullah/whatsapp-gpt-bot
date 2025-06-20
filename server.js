const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(bodyParser.json());
app.use(express.static('public')); // Serve static HTML files

// MongoDB connection
mongoose.connect('mongodb://localhost:27017/whatsapp', {
 
});

const Message = mongoose.model('Message', {
  number: String,
  message: String,
  category: String,
  timestamp: Date
});

// API to send a message and store it
app.post('/send-message', async (req, res) => {
  const { number, message, category } = req.body;

  const newMsg = new Message({
    number,
    message,
    category,
    timestamp: new Date()
  });

  await newMsg.save();
  console.log('Saved message:', newMsg);

  res.json({ success: true });
});

// API to fetch all messages
app.get('/api/message-history', async (req, res) => {
  const messages = await Message.find().sort({ timestamp: -1 });
  res.json(messages);
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server is running: http://localhost:${PORT}`);
});
