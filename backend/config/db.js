const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();
const pool = new Pool({
  host: 'localhost',
  user: 'attendance_app',
  password: 'attendance_app',
  database: 'Whatsapp_App',
  port: 5432,
});

module.exports = pool;
