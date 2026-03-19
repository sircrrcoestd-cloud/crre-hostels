const express = require("express");
const multer = require("multer");
const csv = require("csv-parser");
const fs = require("fs");
const mysql = require("mysql2");

require("dotenv").config();

const app = express();
const PORT = 3000;

// ✅ MySQL Connection (RAILWAY DB)
const db = mysql.createPool({
  host: process.env.DB_HOST || "147.93.96.24",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASS || "Sircrrcoestd@2025",
  database: process.env.DB_NAME || "railway"
});

// 🔍 Check DB connection
db.query("SELECT DATABASE()", (err, result) => {
  if (err) {
    console.error("DB Connection Error:", err);
  } else {
    console.log("Connected to DB:", result[0]["DATABASE()"]);
  }
});

// ✅ Multer setup
const upload = multer({ dest: "uploads/" });

// ✅ Route: Upload & Process CSV
app.post("/upload-hostel", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const results = [];

    let total = 0;
    let matched = 0;
    let notMatched = 0;
    let errors = 0;

    fs.createReadStream(req.file.path)
      .pipe(csv())
      .on("data", (row) => {
        results.push(row);
      })
      .on("end", () => {
        total = results.length;

        if (total === 0) {
          fs.unlinkSync(req.file.path);
          return res.json({ message: "CSV is empty" });
        }

        let processed = 0;

        results.forEach((row) => {
          const regNo = row.student_id?.trim();

          if (!regNo) {
            notMatched++;
            processed++;
            checkDone();
            return;
          }

          const query = `
            UPDATE students 
            SET residence_type = 'BOYS_HOSTEL'
            WHERE reg_no = ?
          `;

          db.query(query, [regNo], (err, result) => {
            if (err) {
              console.error("DB Error:", err);
              errors++;
            } else {
              if (result.affectedRows > 0) {
                matched++;
              } else {
                notMatched++;
              }
            }

            processed++;
            checkDone();
          });
        });

        function checkDone() {
          if (processed === total) {
            fs.unlink(req.file.path, () => {});

            return res.json({
              total_rows: total,
              matched_updated: matched,
              not_matched: notMatched,
              errors: errors,
              message: "✅ Processing Completed"
            });
          }
        }
      })
      .on("error", (err) => {
        console.error("CSV Error:", err);
        return res.status(500).json({ message: "CSV parsing failed" });
      });

  } catch (err) {
    console.error("Server Crash:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// ✅ Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});