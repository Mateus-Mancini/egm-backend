const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const { Pool } = require('pg');
const cheerio = require('cheerio');

const cors = require('cors');
require('dotenv').config();

const app = express();
const upload = multer({ dest: 'uploads/' })
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

app.use(cors());

app.get('/api/students', async (req, res) => {
    let query = `SELECT STUDENT.*, year_id, grade_id FROM STUDENT 
        JOIN CLASS ON CLASS.id = STUDENT.class_id
        JOIN SCHOOL_YEAR ON SCHOOL_YEAR.id = CLASS.year_id
        JOIN GRADE ON GRADE.id = CLASS.grade_id
        ORDER BY STUDENT.name`;
    try {
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database query failed' });
    }
});

app.get('/api/ra', async (req, res) => {
    const { url } = req.query;

    const response = await fetch(url);
    const html = await response.text();

    const $ = cheerio.load(html);

    const targetDiv = $('label').filter((_, el) => $(el).text().trim() === 'Número da RA:').first();

    const nextDiv = targetDiv.next('label');
    if (nextDiv.length) {
        res.json({ ra: nextDiv.text().split('-')[0].trim() })
    } else {
        res.status(500).json({ error: 'RA not found.' });
    }
});

app.get('/api/years', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM SCHOOL_YEAR');
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
        JOIN CLASS ON CLASS.grade_id = GRADE.id
        JOIN SCHOOL_YEAR ON SCHOOL_YEAR.id = CLASS.year_id
    `;
    const queryParams = [];

    if (yearId) {
        query += ' WHERE SCHOOL_YEAR.id = $1';
        queryParams.push(yearId);
    }

    query += ' GROUP BY GRADE.ID ORDER BY GRADE.NUMBER';

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
        JOIN GRADE ON CLASS.grade_id = GRADE.id
        JOIN SCHOOL_YEAR ON SCHOOL_YEAR.id = CLASS.year_id
    `;
    const queryParams = [];
    let conditions = [];

    if (yearId) {
        queryParams.push(yearId);
        conditions.push(`SCHOOL_YEAR.id = $${queryParams.length}`);
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

app.post("/api/upload/classes", upload.single("file"), async (req, res) => {
    try {
      const filePath = req.file.path;
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
  
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
  
        const batchSize = 100; // Number of rows per batch
        for (let i = 0; i < sheetData.length; i += batchSize) {
          const batch = sheetData.slice(i, i + batchSize);
  
          // Prepare the data for insertion
          const values = batch.map(row => [
            row.id,
            row.name,
            row.grade_id,
            row.year_id,
            row.course_id,
          ]);
  
          // Generate placeholders for the query
          const placeholders = values
            .map(
              (_, index) =>
                `($${index * 5 + 1}, $${index * 5 + 2}, $${index * 5 + 3}, $${index * 5 + 4}, $${index * 5 + 5})`
            )
            .join(", ");
  
          // Flatten the values array for query parameters
          const flatValues = values.flat();
  
          // Insert into the database
          await client.query(
            `INSERT INTO class (id, name, grade_id, year_id, course_id) VALUES ${placeholders}`,
            flatValues
          );
        }
  
        await client.query("COMMIT");
        res.status(200).json({ message: "Data inserted successfully!" });
      } catch (error) {
        await client.query("ROLLBACK");
        console.error(error);
        res.status(500).json({ error: "Failed to insert data" });
      } finally {
        client.release();
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error processing file" });
    }
});

app.post("/api/upload/students", upload.single("file"), async (req, res) => {
  try {
    const filePath = req.file.path;
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const batchSize = 100; // Number of rows per batch
      for (let i = 0; i < sheetData.length; i += batchSize) {
        const batch = sheetData.slice(i, i + batchSize);

        // Prepare the data for insertion
        const values = batch.map(row => [
          row.ra,
          row.name,
          row.digit,
          row.class_id,
        ]);

        // Generate placeholders for the query
        const placeholders = values
          .map(
            (_, index) =>
              `($${index * 4 + 1}, $${index * 4 + 2}, $${index * 4 + 3}, $${index * 4 + 4})`
          )
          .join(", ");

        // Flatten the values array for query parameters
        const flatValues = values.flat();

        // Insert into the database
        const query = `INSERT INTO student (ra, name, digit, class_id) VALUES ${placeholders}`;
        await client.query(query, flatValues);
      }

      await client.query("COMMIT");
      res.status(200).json({ message: "Data inserted successfully!" });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Transaction Error:", error);
      res.status(500).json({ error: "Failed to insert data" });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("File Processing Error:", error);
    res.status(500).json({ error: "Error processing file" });
  }
});

app.post("/api/mark-attendance", async (req, res) => {
  const { ra, userId } = req.body;
  const command = `insert into attendance (date, time, student_ra, user_id) values(current_date, current_time, ${ra}, ${userId})`

  try {
    await pool.query(command);
    res.status(200).json({ message: "Data inserted successfully!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database query failed' });
  }
});

app.get("/api/attendances", async (req, res) => {
  const { startDate, endDate, classId } = req.query

  const query = `select attendance.date "Data", attendance.time at time zone 'Brazil/East' "Horário", student.ra "RA do Aluno", student.name "Nome do Aluno", class.name "Nome da Sala" from attendance 
  join student on student.ra = attendance.student_ra 
  join class on class.id = student.class_id
  where '${startDate}' <= date and date <= '${endDate}'
  and class.id = '${classId}'`

  try {
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database query failed' });
  }
})

// Start Server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
