const express = require("express");

const bodyParser = require("body-parser");
const path = require("path");
const app = express();
const crypto = require("crypto");
const QRCode = require("qrcode");
const bcrypt = require("bcrypt");
const PDFDocument = require("pdfkit");const cors = require("cors");
app.use(cors());

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Serve frontend HTML
app.use(express.static(__dirname));

// Database connection
require('dotenv').config();
const mysql = require('mysql2/promise');

// Database connection
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

module.exports = db;

// ================================
//      POST - HOSTEL FORM SUBMIT
// ================================
app.post("/submit-hostel-form", async (req, res) => {
    try {
        const data = req.body;

        // =========================
        // 1️⃣ Hash the password
        // =========================
        const hashedPassword = await bcrypt.hash(data.password, 10);

        // =========================
        // 2️⃣ Insert into USERS table
        // =========================
        await db.execute(
            `INSERT INTO users (user_id, password, role)
             VALUES (?, ?, 'student')`,
            [data.user_id, hashedPassword]
        );

        // =========================
        // 3️⃣ Insert into HOSTEL_ADMISSIONS table
        // =========================
        const sql = `
            INSERT INTO hostel_admissions (
                academic_year,
                application_number,
                user_id,
                name,
                father_name,
                father_occupation,
                mother_name,
                mother_occupation,
                date_of_birth,
                blood_group,
                permanent_address,
                present_address,
                course_year,
                branch,
                roll_number,
                emergency_contact_father,
                emergency_contact_mother,
                emergency_contact_guardian,
                inmate_contact,
                local_guardian_contact,
                block_name,
                room_number,
                has_medical_issue,
                medical_drug_used,
                drug_allergy,
                student_declaration,
                parent_declaration
            ) 
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `;

        await db.execute(sql, [
            data.academic_year,
            data.application_number,
            data.user_id,
            data.name,
            data.father_name,
            data.father_occupation,
            data.mother_name,
            data.mother_occupation,
            data.date_of_birth,
            data.blood_group,
            data.permanent_address,
            data.present_address,
            data.course_year,
            data.branch,
            data.roll_number,
            data.emergency_contact_father,
            data.emergency_contact_mother,
            data.emergency_contact_guardian,
            data.inmate_contact,
            data.local_guardian_contact,
            data.block_name,
            data.room_number,
            data.has_medical_issue,
            data.medical_drug_used || "",
            data.drug_allergy || "",
            data.student_declaration ? 1 : 0,
            data.parent_declaration ? 1 : 0
        ]);

        // =========================
        // 4️⃣ Success Response
        // =========================
        res.json({
            success: true,
            message: "Hostel Admission Submitted & Student Account Created Successfully!"
        });

    } catch (error) {
        console.error("Hostel form error:", error);

        // Duplicate user_id handling
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(400).json({
                success: false,
                message: "User ID already exists. Please choose a different User ID."
            });
        }

        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
});


app.get("/get-rooms/:block", async (req, res) => {
    const block = req.params.block;
    try {
        const [rows] = await db.query(
            "SELECT DISTINCT room_number FROM hostel_admissions WHERE block_name = ? ORDER BY room_number ASC",
            [block]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: "Database Error" });
    }
});

app.get("/get-students/:block/:room", async (req, res) => {
    const { block, room } = req.params;

    try {
        const [rows] = await db.query(
            "SELECT name FROM hostel_admissions WHERE block_name = ? AND room_number = ?",
            [block, room]
        );

        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: "Database Error" });
    }
});

app.post("/submit-attendance", async (req, res) => {
    const { date, block_name, room_number, students } = req.body;

    try {
        const sql = `
            INSERT INTO hostel_attendance 
            (block_name, room_number, student_name, attendance, date)
            VALUES (?, ?, ?, ?, ?)
        `;

        for (let s of students) {
            await db.execute(sql, [
                block_name,
                room_number,
                s.name,
                s.attendance,
                date
            ]);
        }

        res.json({ success: true, message: "Attendance Saved Successfully!" });

    } catch (err) {
        res.status(500).json({ error: "Database Error" });
    }
});

app.post("/request-outpass", async (req, res) => {
    const { student_name, user_id, out_datetime, in_datetime, reason } = req.body;

    await db.execute(
        `INSERT INTO hostel_outpass_requests
        (student_name, user_id, out_datetime, in_datetime, reason)
        VALUES (?, ?, ?, ?, ?)`,
        [student_name, user_id, out_datetime, in_datetime, reason]
    );

    res.json({ success: true });
});

app.post("/warden/approve-outpass/:id", async (req, res) => {
    const id = req.params.id;
    const qrToken = crypto.randomBytes(25).toString("hex");

    await db.execute(
        `UPDATE hostel_outpass_requests
         SET status = 'Approved',
             qr_token = ?,
             approved_at = NOW(),
             expires_at = DATE_ADD(NOW(), INTERVAL 2 DAY)
         WHERE id = ?`,
        [qrToken, id]
    );

    res.json({ success: true });
});


app.post("/warden/reject-outpass/:id", async (req, res) => {
    await db.execute(
        `UPDATE hostel_outpass_requests 
         SET status='Rejected' 
         WHERE id=?`,
        [req.params.id]
    );

    res.json({ success: true });
});



app.get("/outpass-qr/:token", async (req, res) => {
    try {
        const token = req.params.token;

        const qrData = `http://localhost:3000/verify-outpass/${token}`;

        const qrImage = await QRCode.toDataURL(qrData);

        // Send image directly
        const img = Buffer.from(qrImage.split(",")[1], "base64");
        res.writeHead(200, {
            "Content-Type": "image/png",
            "Content-Length": img.length
        });
        res.end(img);

    } catch (err) {
        console.error("QR error:", err);
        res.status(500).send("QR generation failed");
    }
});


app.post("/scan-outpass/:token", async (req, res) => {
    const token = req.params.token;
    const { keycode } = req.body;

    // 🔐 Verify key code
    if (keycode !== "verifygh") {
        return res.send("<h2>❌ Invalid Verification Key</h2>");
    }

    const [rows] = await db.execute(
        `SELECT * FROM hostel_outpass_requests 
         WHERE qr_token = ? AND status = 'Approved'`,
        [token]
    );

    if (rows.length === 0) {
        return res.send("<h2>❌ Invalid or Expired Outpass</h2>");
    }

    if (rows[0].scanned_at) {
        return res.send("<h2>⚠️ Outpass already used</h2>");
    }

    await db.execute(
        `UPDATE hostel_outpass_requests
         SET scanned_at = NOW()
         WHERE qr_token = ?`,
        [token]
    );

    res.send(`
        <h2 style="color:green;">✅ Outpass Verified Successfully</h2>
        <p>This outpass is now invalid for further use.</p>
    `);
});



setInterval(async () => {
    await db.execute(`
        UPDATE hostel_outpass_requests
        SET status='Rejected'
        WHERE status='Approved'
        AND scanned_at IS NULL
        AND expires_at < NOW()
    `);
}, 60 * 60 * 1000); // every hour

app.get("/verify-outpass/:token", async (req, res) => {
    const token = req.params.token;

    const [rows] = await db.execute(`
        SELECT 
            o.id,
            o.student_name,
            o.user_id,
            o.out_datetime,
            o.approved_at,
            o.scanned_at,
            h.course_year,
            h.block_name,
            h.room_number
        FROM hostel_outpass_requests o
        JOIN hostel_admissions h ON o.user_id = h.user_id
        WHERE o.qr_token = ?
        AND o.status = 'Approved'
    `, [token]);

    if (rows.length === 0) {
        return res.send("<h2>❌ Invalid or Expired Outpass</h2>");
    }

    const o = rows[0];

    if (o.scanned_at) {
        return res.send("<h2>⚠️ Outpass already used</h2>");
    }

    res.send(`
        <html>
        <head>
            <title>Verify Outpass</title>
            <style>
                body { font-family: Arial; background:#eef2f7; padding:30px; }
                .card {
                    max-width:500px;
                    margin:auto;
                    background:white;
                    padding:25px;
                    border-radius:10px;
                    box-shadow:0 0 10px #ccc;
                }
                input {
                    width:100%;
                    padding:10px;
                    margin:12px 0;
                }
                button {
                    width:100%;
                    padding:12px;
                    background:green;
                    color:white;
                    border:none;
                    font-size:16px;
                    border-radius:5px;
                    cursor:pointer;
                }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>Outpass Verification</h2>

                <p><b>Name:</b> ${o.student_name}</p>
                <p><b>User ID:</b> ${o.user_id}</p>
                <p><b>Course:</b> ${o.course_year}</p>
                <p><b>Block:</b> ${o.block_name}</p>
                <p><b>Room:</b> ${o.room_number}</p>
                <p><b>Out Time:</b> ${new Date(o.out_datetime).toLocaleString()}</p>
                <p><b>Approved At:</b> ${new Date(o.approved_at).toLocaleString()}</p>

                <form method="POST" action="/scan-outpass/${token}">
                    <label><b>Verification Key</b></label>
                    <input type="password" name="keycode" placeholder="Enter verification key" required>

                    <button type="submit">VERIFY OUTPASS</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

// =====================================
//   GET ALL OUTPASS REQUESTS (WARDEN)
// =====================================
app.get("/warden/outpass-requests", async (req, res) => {
    try {
        const [rows] = await db.execute(`
            SELECT 
                id,
                student_name,
                out_datetime,
                in_datetime,
                reason,
                status,
                qr_token
            FROM hostel_outpass_requests
            ORDER BY created_at DESC
        `);

        res.json(rows);
    } catch (err) {
        console.error("Fetch outpass requests error:", err);
        res.status(500).json({ error: "Failed to fetch outpass requests" });
    }
});

// =========================
//        LOGIN ROUTE
// =========================
app.post("/login", async (req, res) => {
    try {
        const { user_id, password } = req.body;

        // 1️⃣ Check user exists
        const [rows] = await db.execute(
            "SELECT * FROM users WHERE user_id = ?",
            [user_id]
        );

        if (rows.length === 0) {
            return res.json({
                success: false,
                message: "Invalid User ID or Password"
            });
        }

        const user = rows[0];

        // 2️⃣ Compare password
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.json({
                success: false,
                message: "Invalid User ID or Password"
            });
        }

        // 3️⃣ Success → send role
        res.json({
            success: true,
            role: user.role,
            user_id: user.user_id
        });

    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
});

// =======================================
//   GET STUDENT DETAILS FOR DASHBOARD
// =======================================
app.get("/student/details/:user_id", async (req, res) => {
    try {
        const user_id = req.params.user_id;

        const [rows] = await db.execute(
            `SELECT 
                academic_year,
                application_number,
                user_id,
                name,
                father_name,
                mother_name,
                date_of_birth,
                blood_group,
                course_year,
                branch,
                roll_number,
                block_name,
                room_number,
                inmate_contact
             FROM hostel_admissions
             WHERE user_id = ?`,
            [user_id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: "Student not found" });
        }

        res.json(rows[0]);

    } catch (err) {
        console.error("Student details error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

app.get("/student/outpasses/:user_id", async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT *
             FROM hostel_outpass_requests
             WHERE user_id = ?
             ORDER BY created_at DESC`,
            [req.params.user_id]
        );

        res.json(rows);
    } catch (err) {
        console.error("Outpass fetch error:", err);
        res.status(500).json([]);
    }
});

// ===============================
//   WARDEN AUTH MIDDLEWARE
// ===============================
const requireWarden = async (req, res, next) => {
    try {
        const userId = req.headers["x-user-id"];

        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const [rows] = await db.execute(
            "SELECT role FROM users WHERE user_id = ?",
            [userId]
        );

        if (rows.length === 0 || rows[0].role !== "warden") {
            return res.status(403).json({ error: "Access denied" });
        }

        next();
    } catch (err) {
        console.error("Warden auth error:", err);
        res.status(500).json({ error: "Server error" });
    }
};
app.post("/student/submit-complaint", async (req, res) => {
    try {
        const { user_id, student_name, category, location, description } = req.body;

        if (!user_id || !student_name || !category || !location || !description) {
            return res.status(400).json({
                success: false,
                message: "All fields are required"
            });
        }

        await db.execute(
            `INSERT INTO hostel_complaints
             (user_id, student_name, category, location, description)
             VALUES (?, ?, ?, ?, ?)`,
            [user_id, student_name, category, location, description]
        );

        res.json({
            success: true,
            message: "Complaint submitted successfully"
        });

    } catch (err) {
        console.error("Complaint submit error:", err);
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});


app.get('/api/getFees', async (req, res) => {
    const { reg_no } = req.query;

    const [rows] = await db.query(
        `SELECT room_rent, mess_deposit_1, mess_deposit_2 
         FROM hostel_fee_structure 
         WHERE reg_no = ?`,
        [reg_no]
    );

    if (!rows.length) return res.json([]);

    const r = rows[0];

    res.json([
        { type: 'ROOM_RENT', amount: r.room_rent },
        { type: 'MESS_1', amount: r.mess_deposit_1 },
        { type: 'MESS_2', amount: r.mess_deposit_2 }
    ]);
});

app.post('/api/addTransaction', async (req, res) => {
    const { reg_no, fee_type, amount, transaction_id } = req.body;

    try {
        await db.query(
            `INSERT INTO student_transactions 
            (reg_no, fee_type, amount, transaction_id) 
            VALUES (?, ?, ?, ?)`,
            [reg_no, fee_type, amount, transaction_id]
        );

        res.json({ success: true });

    } catch (err) {
        res.status(400).json({ error: "Duplicate or invalid transaction" });
    }
});

app.get('/api/getRegNo/:user_id', async (req, res) => {
    try {
        const { user_id } = req.params;

        const [rows] = await db.query(
            `SELECT reg_no FROM railway.students WHERE userId = ?`,
            [user_id]
        );

        if (!rows.length) {
            return res.status(404).json({ error: "Student not found" });
        }

        res.json({ reg_no: rows[0].reg_no });

    } catch (err) {
        console.error("getRegNo error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/getStudentInfo/:user_id', async (req, res) => {
    try {
        const { user_id } = req.params;

        const [rows] = await db.query(
            `SELECT reg_no, uniqueId 
             FROM railway.students 
             WHERE userId = ?`,
            [user_id]
        );

        if (!rows.length) {
            return res.status(404).json({ error: "Student not found" });
        }

        res.json({
            reg_no: rows[0].reg_no,
            unique_id: rows[0].uniqueId
        });

    } catch (err) {
        console.error("Student info error:", err);
        res.status(500).json({ error: err.message });
    }
});


app.post('/api/addTransaction', async (req, res) => {
    const { reg_no, unique_id, fee_type, amount, transaction_id } = req.body;

    try {
        await db.query(
            `INSERT INTO student_transactions 
            (reg_no, unique_id, fee_type, amount, transaction_id) 
            VALUES (?, ?, ?, ?, ?)`,
            [reg_no, unique_id, fee_type, amount, transaction_id]
        );

        res.json({ success: true });

    } catch (err) {
        console.error("Transaction error:", err);
        res.status(400).json({ error: "Duplicate or invalid transaction" });
    }
});

// routes/hostel.js
app.get("/api/hostel/students", async (req, res) => {
    try {
        const userId = req.headers["x-user-id"];
        const { year, branch } = req.query;

        if (!userId) {
            return res.status(401).json({ message: "User ID missing" });
        }

        let hostelType;

        if (userId.startsWith("BH")) {
            hostelType = "BOYS_HOSTEL";
        } else if (userId.startsWith("GH")) {
            hostelType = "GIRLS_HOSTEL";
        } else {
            return res.status(403).json({ message: "Unauthorized Access" });
        }

        let filters = "WHERE s.residence_type = ?";
        let params = [hostelType];

        if (year && year !== "ALL") {
            filters += " AND s.year LIKE ?";
            params.push(`%${year}%`);
        }

        if (branch && branch !== "ALL") {
            filters += " AND s.course = ?";
            params.push(branch);
        }

        const query = `
            SELECT 
                s.id,
                s.name,
                s.reg_no,
                s.course,
                s.year,
                s.section,
                s.mobile_no,
                s.photo_url,
                s.residence_type,
                COALESCE(b.total_backlogs, 0) AS backlogs
            FROM railway.students s
            LEFT JOIN (
                SELECT regno, COUNT(*) AS total_backlogs
                FROM (
                    SELECT regno FROM railway.results
                    WHERE grade IN ('F','Ab','NOT_COMPLETED')

                    UNION ALL

                    SELECT regno FROM railway.autonomous_results
                    WHERE grade IN ('F','Ab','-Ab-')
                ) x
                GROUP BY regno
            ) b ON s.reg_no = b.regno
            ${filters}
            ORDER BY backlogs DESC
        `;

        const [students] = await db.execute(query, params);

        res.json(students);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: err.message });
    }
});
app.get("/api/hostel/student/:reg_no", async (req, res) => {
    try {
        const userId = req.headers["x-user-id"];
        const reg_no = req.params.reg_no;

        if (!userId) {
            return res.status(401).json({ message: "User ID missing" });
        }

        let hostelType;

        if (userId.startsWith("BH")) {
            hostelType = "BOYS_HOSTEL";
        } else if (userId.startsWith("GH")) {
            hostelType = "GIRLS_HOSTEL";
        } else {
            return res.status(403).json({ message: "Unauthorized" });
        }

        const query = `
            SELECT 
                s.*,
                COALESCE(b.total_backlogs, 0) AS backlogs
            FROM railway.students s
            LEFT JOIN (
                SELECT regno, COUNT(*) AS total_backlogs
                FROM (
                    SELECT regno FROM railway.results
                    WHERE grade IN ('F','Ab','NOT_COMPLETED')

                    UNION ALL

                    SELECT regno FROM railway.autonomous_results
                    WHERE grade IN ('F','Ab','-Ab-')
                ) x
                GROUP BY regno
            ) b ON s.reg_no = b.regno
            WHERE s.reg_no = ?
            AND s.residence_type = ?
        `;

        const [rows] = await db.execute(query, [reg_no, hostelType]);

        if (!rows.length) {
            return res.status(404).json({ message: "Student not found" });
        }

        res.json(rows[0]);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: err.message });
    }
});

app.get("/api/hostel/branches", async (req, res) => {
    try {
        const userId = req.headers["x-user-id"];

        if (!userId) {
            return res.status(401).json({ message: "User ID missing" });
        }

        let hostelType;

        if (userId.startsWith("BH")) {
            hostelType = "BOYS_HOSTEL";
        } else if (userId.startsWith("GH")) {
            hostelType = "GIRLS_HOSTEL";
        } else {
            return res.status(403).json({ message: "Unauthorized" });
        }

        const [rows] = await db.execute(`
            SELECT DISTINCT course 
            FROM railway.students
            WHERE residence_type = ?
            ORDER BY course
        `, [hostelType]);

        res.json(rows);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: err.message });
    }
});

app.get("/api/hostel/download-pdf", async (req, res) => {
    try {
        const userId = req.headers["x-user-id"];
        const year = req.query.year;

        if (!userId) {
            return res.status(401).json({ message: "User ID missing" });
        }

        let hostelType;

        if (userId.startsWith("BH")) {
            hostelType = "BOYS_HOSTEL";
        } else if (userId.startsWith("GH")) {
            hostelType = "GIRLS_HOSTEL";
        } else {
            return res.status(403).json({ message: "Unauthorized" });
        }

        // ✅ QUERY WITH FILTER
        let yearFilter = "";
        let params = [hostelType];

       const branch = req.query.branch;

if (branch && branch !== "ALL") {
    yearFilter += " AND s.course = ?";
    params.push(branch);
}

        const query = `
            SELECT 
                s.reg_no,
                s.name,
                s.course,
                COALESCE(b.total_backlogs, 0) AS backlogs
            FROM railway.students s
            LEFT JOIN (
                SELECT regno, COUNT(*) AS total_backlogs
                FROM (
                    SELECT regno FROM railway.results
                    WHERE grade IN ('F','Ab','NOT_COMPLETED')

                    UNION ALL

                    SELECT regno FROM railway.autonomous_results
                    WHERE grade IN ('F','Ab','-Ab-')
                ) x
                GROUP BY regno
            ) b ON s.reg_no = b.regno
            WHERE s.residence_type = ?
            ${yearFilter}
            ORDER BY backlogs DESC
        `;

        const [students] = await db.execute(query, params);

        // ✅ CREATE PDF
        const doc = new PDFDocument({ margin: 30, size: "A4" });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
            "Content-Disposition",
            "attachment; filename=backlog_report.pdf"
        );

        doc.pipe(res);

        // ✅ TITLE
        doc.fontSize(18).text("Hostel Backlog Report", { align: "center" });
        doc.moveDown();

        doc.fontSize(12).text(`Hostel: ${hostelType}`);
        doc.text(`Year: ${year || "ALL"}`);
        doc.moveDown();

        // TABLE HEADER
        doc.fontSize(11).text(
            "Reg No        Name                Course          Backlogs     Signature"
        );
        doc.moveDown(0.5);

        doc.moveTo(30, doc.y).lineTo(570, doc.y).stroke();

        // TABLE ROWS
        students.forEach((s, i) => {
            doc.moveDown(0.5);

            doc.text(
                `${s.reg_no.padEnd(12)} ${s.name.substring(0,15).padEnd(18)} ${s.course.substring(0,10).padEnd(15)} ${String(s.backlogs).padEnd(10)} __________`
            );
        });

        doc.end();

    } catch (err) {
        console.error("PDF Error:", err);
        res.status(500).json({ message: err.message });
    }
});


// Start server
app.listen(3000, () => console.log("Hostel Management Server running on port 3000"));
