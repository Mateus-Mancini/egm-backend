const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const port = 3000;

// Middleware
app.use(express.json());

// PostgreSQL Pool Setup
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  ssl: {
    rejectUnauthorized: false,
  },
});

app.get('/api/students', async (req, res) => {
    let query = `SELECT STUDENT.*, yearId, gradeId FROM STUDENT 
        JOIN CLASS ON CLASS.id = STUDENT.classId
        JOIN SCHOOLYEAR ON SCHOOLYEAR.id = CLASS.yearId
        JOIN GRADE ON GRADE.id = CLASS.gradeId`;

    try {
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database query failed' });
    }
});

app.get('/api/years', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM SCHOOLYEAR');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database query failed' });
    }
});

app.get('/api/grades', async (req, res) => {
    const { yearId } = req.query;

    let query = `
        SELECT GRADE.* FROM GRADE
        JOIN CLASS ON CLASS.gradeId = GRADE.id
        JOIN SCHOOLYEAR ON SCHOOLYEAR.id = CLASS.yearId
    `;
    const queryParams = [];

    if (yearId) {
        query += ' WHERE SCHOOLYEAR.id = $1';
        queryParams.push(yearId);
    }

    try {
        const result = await pool.query(query, queryParams);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database query failed' });
    }
});

app.get('/api/classes', async (req, res) => {
    const { yearId, gradeId } = req.query;

    let query = `
        SELECT CLASS.* FROM CLASS
        JOIN GRADE ON CLASS.gradeId = GRADE.id
        JOIN SCHOOLYEAR ON SCHOOLYEAR.id = CLASS.yearId
    `;
    const queryParams = [];
    let conditions = [];

    if (yearId) {
        queryParams.push(yearId);
        conditions.push(`SCHOOLYEAR.id = $${queryParams.length}`);
    }
    if (gradeId) {
        queryParams.push(gradeId);
        conditions.push(`GRADE.id = $${queryParams.length}`);
    }

    if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
    }

    try {
        const result = await pool.query(query, queryParams);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database query failed' });
    }
});

// Start Server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
