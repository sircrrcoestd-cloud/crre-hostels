const express = require("express");
const nodemailer = require("nodemailer");
const bodyParser = require("body-parser");
const { exec } = require("child_process");
const path = require("path");
const app = express();
const crypto = require("crypto");
const QRCode = require("qrcode");
const bcrypt = require("bcrypt");
const multer = require("multer");
const PDFDocument = require("pdfkit");const cors = require("cors");
app.use(cors());
const upload = multer({ dest: "uploads/" });
console.log("SERVER FILE STARTED");
app.get("/test", (req, res) => {
    res.send("TEST WORKING");
});

console.log("ROUTES LOADED");
// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const publicPath = path.resolve(__dirname);

// Serve static files
app.use(express.static(publicPath));

const session = require("express-session");
app.set("trust proxy", 1);
app.use(session({
    secret: "hostel_secret_key",
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,   // IMPORTANT (since nginx handles https)
        httpOnly: true,
        sameSite: "lax"
    }
}));

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


// Configure the email transporter
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true, // use SSL
  auth: {
    user: "sircrrcoestd@sircrrengg.ac.in",
    pass: "eczr eaoo ruqa pwba",
  },
});

function getHostelType(req) {
    const userId = req.session?.user?.userId;

    if (!userId || typeof userId !== "string") {
        throw new Error("Invalid session");
    }

    return userId.startsWith("BH")
        ? "BOYS_HOSTEL"
        : "GIRLS_HOSTEL";
}
// ==========================
// HELPER FUNCTION (ADD HERE)
// ==========================
async function generateUserId(data, loggedUser) {
    let prefix = "ST";

    if (loggedUser.user_id.startsWith("BH")) prefix = "BH";
    else if (loggedUser.user_id.startsWith("GH")) prefix = "GH";

    let blockShort = data.block_name
        .split(" ")
        .map(w => w[0])
        .join("")
        .toUpperCase();

    let room = data.room_number;

    const [rows] = await db.execute(
        `SELECT COUNT(*) as count FROM users WHERE user_id LIKE ?`,
        [`${prefix}-%`]
    );

    let number = (rows[0].count + 1).toString().padStart(4, "0");

    return `${prefix}-${blockShort}-${room}-${number}`;
}


// ================================
//      POST - HOSTEL FORM SUBMIT
// ================================
app.post("/submit-hostel-form", async (req, res) => {
    try {
        const data = req.body;
        const loggedUser = req.session.user;

        let finalUserId = data.user_id;

        // =========================
        // GENERATE USER ID IF EMPTY
        // =========================
        if (!finalUserId || finalUserId.trim() === "") {
            finalUserId = await generateUserId(data, loggedUser);
        }

        // =========================
        // PASSWORD = USER ID
        // =========================
        const plainPassword = finalUserId;
        const hashedPassword = await bcrypt.hash(plainPassword, 10);
        const rollNumber = data.roll_number?.trim() || null;

        // =========================
        // 🔥 DETERMINE RESIDENCE TYPE
        // =========================
        let residence_type = null;

        if (loggedUser?.user_id?.startsWith("BH")) {
            residence_type = "BOYS_HOSTEL";
        } else if (loggedUser?.user_id?.startsWith("GH")) {
            residence_type = "GIRLS_HOSTEL";
        } else {
            return res.status(400).json({
                success: false,
                message: "Invalid warden type"
            });
        }

        // =========================
        // INSERT INTO USERS
        // =========================
        await db.execute(
            `INSERT INTO users (user_id, password, role)
             VALUES (?, ?, 'student')`,
            [finalUserId, hashedPassword]
        );

        // =========================
        // INSERT INTO ADMISSIONS
        // =========================
        await db.execute(
            `INSERT INTO hostel_admissions (
                academic_year,
                application_number,
                user_id,
                residence_type,   -- ✅ added
                name,
                email,
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
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
                data.academic_year,
                data.application_number,
                finalUserId,
                residence_type,   // ✅ inserted here
                data.name,
                data.email,
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
                rollNumber,
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
            ]
        );

        // =========================
        // SEND EMAIL
        // =========================
        await transporter.sendMail({
            from: "yourmail@gmail.com",
            to: data.email,
            subject: "Hostel Admission Successful",
            html: `
                <h3>Welcome to Hostel</h3>
                <p>Your account has been created.</p>
                <p><b>User ID:</b> ${finalUserId}</p>
                <p><b>Password:</b> ${plainPassword}</p>
                <p><b>Hostel Type:</b> ${residence_type}</p>
            `
        });

        res.json({
            success: true,
            message: "Admission Successful & Credentials sent to email!"
        });

    } catch (error) {
        console.error(error);

        if (error.code === "ER_DUP_ENTRY") {
            return res.status(400).json({
                success: false,
                message: "User ID already exists"
            });
        }

        res.status(500).json({ success: false, message: "Server Error" });
    }
});

app.get("/get-blocks", async (req, res) => {
    try {
        const role = req.query.role;

        let query = `
            SELECT DISTINCT block_name
            FROM hostel_admissions
        `;

        let values = [];

        // If role is provided → filter
        if (role) {
            const hostelType =
                role === "BHWARDEN" ? "BOYS_HOSTEL" : "GIRLS_HOSTEL";

            query += " WHERE residence_type = ?";
            values.push(hostelType);
        }

        query += " ORDER BY block_name ASC";

        const [rows] = await db.query(query, values);

        res.json(rows);

    } catch (err) {
        console.error("GET BLOCKS ERROR:", err);
        res.status(500).json({ error: "Server Error" });
    }
});

app.get("/get-rooms/:block", async (req, res) => {
    const block = req.params.block;

    try {
        const role = req.query.role || "BHWARDEN";

        const hostelType =
            role === "BHWARDEN" ? "BOYS_HOSTEL" : "GIRLS_HOSTEL";

        const [rows] = await db.query(`
            SELECT DISTINCT room_number
            FROM hostel_management_system.hostel_admissions
            WHERE block_name = ?
            AND residence_type = ?
            ORDER BY room_number ASC
        `, [block, hostelType]);

        res.json(rows || []);

    } catch (err) {
        console.error("GET ROOMS ERROR:", err);
        res.json([]);
    }
});

app.get("/get-students/:block/:room", async (req, res) => {
    const { block, room } = req.params;

    try {
        const role = req.query.role || "BHWARDEN";

        const hostelType =
            role === "BHWARDEN" ? "BOYS_HOSTEL" : "GIRLS_HOSTEL";

        const [rows] = await db.query(`
            SELECT user_id, name
            FROM hostel_management_system.hostel_admissions
            WHERE block_name = ?
            AND room_number = ?
            AND residence_type = ?
            ORDER BY name ASC
        `, [block, room, hostelType]);

        res.json(rows || []);

    } catch (err) {
        console.error("GET STUDENTS ERROR:", err);
        res.json([]);
    }
});

app.post("/submit-attendance", async (req, res) => {
    const { date, block_name, room_number, students } = req.body;

    try {
        const sql = `
            INSERT INTO hostel_attendance 
            (block_name, room_number, user_id, student_name, attendance, date)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
            attendance = VALUES(attendance)
        `;

        for (let s of students) {
            if (!s.attendance) continue;

            // 🔥 SAFETY LOG
            console.log("Inserting:", s);

            await db.execute(sql, [
                block_name || null,
                room_number || null,
                s.userId || null,   // 🔥 IMPORTANT FIX
                s.name || null,
                s.attendance || null,
                date || null
            ]);
        }

        res.json({ success: true });

    } catch (err) {
        console.error("Attendance Error:", err);
        res.status(500).json({ error: "Database Error" });
    }
});

app.get("/get-attendance/:block/:room/:date", async (req, res) => {
    const { block, room, date } = req.params;

    try {
        const [rows] = await db.query(
            `SELECT user_id, student_name, attendance
             FROM hostel_attendance
             WHERE block_name = ? AND room_number = ? AND date = ?`,
            [block, room, date]
        );

        res.json(rows);
    } catch (err) {
        res.json([]);
    }
});



// ================================
//      STUDENT REQUEST OUTPASS
// ================================
app.post("/request-outpass", async (req, res) => {
  try {
    const { student_name, user_id, out_datetime, in_datetime, reason } = req.body;

    // Get residence_type from admissions
    const [student] = await db.execute(
      `SELECT residence_type 
       FROM hostel_admissions 
       WHERE user_id = ?`,
      [user_id]
    );

    if (!student || student.length === 0) {
      return res.status(404).json({ error: "Student not found" });
    }

    // ✅ FIXED HERE
    const residence_type = student[0].residence_type;

    if (!residence_type) {
      return res.status(400).json({ error: "Residence type missing" });
    }

    // Insert request
    await db.execute(
      `INSERT INTO hostel_outpass_requests
       (student_name, user_id, out_datetime, in_datetime, reason, residence_type, status)
       VALUES (?, ?, ?, ?, ?, ?, 'Pending')`,
      [student_name, user_id, out_datetime, in_datetime, reason, residence_type]
    );

    res.json({ success: true });

  } catch (err) {
    console.error("Outpass request error:", err);
    res.status(500).json({ error: "Failed to submit outpass" });
  }
});


// =====================================
//   GET OUTPASS REQUESTS (WARDEN FILTER)
// =====================================
app.get("/warden/outpass-requests", async (req, res) => {
  try {
    const loggedUser = req.session.user;

    if (!loggedUser) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    let residence_type = null;

    if (loggedUser.user_id.startsWith("BH")) {
      residence_type = "BOYS_HOSTEL";
    } else if (loggedUser.user_id.startsWith("GH")) {
      residence_type = "GIRLS_HOSTEL";
    } else {
      return res.status(400).json({ error: "Invalid warden" });
    }

    const [rows] = await db.execute(
      `SELECT 
         id,
         student_name,
         user_id,
         out_datetime,
         in_datetime,
         reason,
         status,
         qr_token
       FROM hostel_outpass_requests
       WHERE residence_type = ?
       ORDER BY created_at DESC`,
      [residence_type]
    );

    res.json(rows);
  } catch (err) {
    console.error("Fetch outpass requests error:", err);
    res.status(500).json({ error: "Failed to fetch outpass requests" });
  }
});


// ================================
//      APPROVE OUTPASS + EMAIL
// ================================
app.post("/warden/approve-outpass/:id", async (req, res) => {
    try {
        const id = req.params.id;
        const loggedUser = req.session.user;

        // 🔐 AUTH CHECK
        if (!loggedUser) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        let residence_type = null;

        if (loggedUser.user_id.startsWith("BH")) {
            residence_type = "BOYS_HOSTEL";
        } else if (loggedUser.user_id.startsWith("GH")) {
            residence_type = "GIRLS_HOSTEL";
        } else {
            return res.status(400).json({ error: "Invalid warden type" });
        }

        // 🔑 GENERATE QR TOKEN
        const qrToken = crypto.randomBytes(25).toString("hex");

        // ✅ UPDATE OUTPASS
        const [result] = await db.execute(
            `UPDATE hostel_outpass_requests
             SET status = 'Approved',
                 qr_token = ?,
                 approved_at = NOW(),
                 expires_at = DATE_ADD(NOW(), INTERVAL 2 DAY)
             WHERE id = ? AND residence_type = ?`,
            [qrToken, id, residence_type]
        );

        if (result.affectedRows === 0) {
            return res.status(400).json({
                error: "Approval failed (wrong hostel or request not found)"
            });
        }

        // ✅ GET STUDENT DETAILS
        const [rows] = await db.execute(
            `SELECT o.student_name, o.user_id, h.email
             FROM hostel_outpass_requests o
             JOIN hostel_admissions h ON o.user_id = h.user_id
             WHERE o.id = ?`,
            [id]
        );

        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: "Student data not found" });
        }

        const student = rows[0];

        // ✅ GENERATE QR (BUFFER)
        const qrData = `/verify-outpass/${qrToken}`;
        const qrBuffer = await QRCode.toBuffer(qrData);

        // ✅ SEND EMAIL WITH QR
        await transporter.sendMail({
            from: "yourmail@gmail.com",
            to: student.email,
            subject: "Outpass Approved ✅",

            html: `
                <h2>Outpass Approved</h2>
                <p>Dear ${student.student_name},</p>

                <p>Your outpass request has been <b>approved</b>.</p>

                <p><b>User ID:</b> ${student.user_id}</p>

                <p><b>Scan this QR at the hostel gate:</b></p>
                <img src="cid:qrimage" width="200"/>

                <p>This QR is valid for <b>one-time use only</b>.</p>

                <p>
                    Or click to verify:
                    <a href="/verify-outpass/${qrToken}">
                        Verify Outpass
                    </a>
                </p>
            `,

            attachments: [
                {
                    filename: "outpass-qr.png",
                    content: qrBuffer,
                    cid: "qrimage" // must match img src
                }
            ]
        });

        res.json({ success: true });

    } catch (err) {
        console.error("Approve error:", err);
        res.status(500).json({ error: "Approval failed" });
    }
});

// ================================
//      REJECT OUTPASS + EMAIL
// ================================
app.post("/warden/reject-outpass/:id", async (req, res) => {
    try {
        const id = req.params.id;
        const loggedUser = req.session.user;

        // 🔐 AUTH CHECK
        if (!loggedUser) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        let residence_type = null;

        if (loggedUser.user_id.startsWith("BH")) {
            residence_type = "BOYS_HOSTEL";
        } else if (loggedUser.user_id.startsWith("GH")) {
            residence_type = "GIRLS_HOSTEL";
        } else {
            return res.status(400).json({ error: "Invalid warden type" });
        }

        // ✅ UPDATE STATUS
        const [result] = await db.execute(
            `UPDATE hostel_outpass_requests
             SET status = 'Rejected'
             WHERE id = ? AND residence_type = ?`,
            [id, residence_type]
        );

        if (result.affectedRows === 0) {
            return res.status(400).json({
                error: "Reject failed (wrong hostel or request not found)"
            });
        }

        // ✅ GET STUDENT EMAIL
        const [rows] = await db.execute(
            `SELECT o.student_name, o.user_id, h.email
             FROM hostel_outpass_requests o
             JOIN hostel_admissions h ON o.user_id = h.user_id
             WHERE o.id = ?`,
            [id]
        );

        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: "Student data not found" });
        }

        const student = rows[0];

        // ✅ SEND EMAIL
        await transporter.sendMail({
            from: "yourmail@gmail.com",
            to: student.email,
            subject: "Outpass Rejected ❌",

            html: `
                <h2>Outpass Rejected</h2>
                <p>Dear ${student.student_name},</p>

                <p>Your outpass request has been <b>rejected</b> by the warden.</p>

                <p>If needed, please contact hostel office.</p>
            `
        });

        res.json({ success: true });

    } catch (err) {
        console.error("Reject error:", err);
        res.status(500).json({ error: "Reject failed" });
    }
});

// =====================================
//   GENERATE QR IMAGE FOR OUTPASS
// =====================================
app.get("/outpass-qr/:token", async (req, res) => {
    try {
        const token = req.params.token;

        const qrData = `/verify-outpass/${token}`;

        const qrBuffer = await QRCode.toBuffer(qrData);

        res.setHeader("Content-Type", "image/png");
        res.send(qrBuffer);

    } catch (err) {
        console.error("QR error:", err);
        res.status(500).send("QR generation failed");
    }
});


// =====================================
//   SCAN / CONSUME OUTPASS (SECURITY)
// =====================================
app.post("/scan-outpass/:token", async (req, res) => {
  try {
    const token = req.params.token;
    const { keycode } = req.body;

    const [rows] = await db.execute(
      `SELECT o.*, h.residence_type
       FROM hostel_outpass_requests o
       JOIN hostel_admissions h ON o.user_id = h.user_id
       WHERE o.qr_token = ? AND o.status = 'Approved'`,
      [token]
    );

    if (!rows || rows.length === 0) {
      return res.send("<h2>❌ Invalid or Expired Outpass</h2>");
    }

    const data = rows[0];

    // ❌ Already used
    if (data.scanned_at) {
      return res.send("<h2>⚠️ Outpass already used</h2>");
    }

    // 🔥 TIME VALIDATION
    const now = new Date();
    const inTime = new Date(data.in_datetime);

    if (now > inTime) {
      // ⏰ EXPIRED
      await db.execute(
        `UPDATE hostel_outpass_requests
         SET status = 'EXPIRED'
         WHERE qr_token = ?`,
        [token]
      );

      return res.send("<h2>⏰ Outpass Expired</h2>");
    }

    // 🔑 KEY VALIDATION
    let validKey = data.residence_type === "BOYS_HOSTEL" ? "verifybh" : "verifygh";

    if (keycode !== validKey) {
      return res.send("<h2>❌ Invalid Verification Key</h2>");
    }

    // ✅ SUCCESS → MARK USED
    await db.execute(
      `UPDATE hostel_outpass_requests
       SET scanned_at = NOW(),
           status = 'USED'
       WHERE qr_token = ?`,
      [token]
    );

    res.send(`
      <h2 style="color:green;">✅ Outpass Verified Successfully</h2>
      <p>Valid entry recorded.</p>
    `);

  } catch (err) {
    console.error("Scan error:", err);
    res.status(500).send("Scan failed");
  }
});

// =====================================
//   AUTO-EXPIRE OLD APPROVED OUTPASSES
// =====================================
setInterval(async () => {
  try {
    await db.execute(`
      UPDATE hostel_outpass_requests
      SET status = 'EXPIRED'
      WHERE status = 'Approved'
        AND scanned_at IS NULL
        AND in_datetime < NOW()
    `);
  } catch (err) {
    console.error("Auto-expire outpass error:", err);
  }
}, 60 * 60 * 1000);

// =====================================
//   VERIFY OUTPASS (INFO + SCAN FORM)
// =====================================
app.get("/verify-outpass/:token", async (req, res) => {
  try {
    const token = req.params.token;

    const [rows] = await db.execute(
      `SELECT 
        o.id,
        o.student_name,
        o.user_id,
        o.in_datetime,
        o.out_datetime,
        o.approved_at,
        o.scanned_at,
        h.course_year,
        h.block_name,
        h.room_number,
        h.residence_type
      FROM hostel_outpass_requests o
      JOIN hostel_admissions h ON o.user_id = h.user_id
      WHERE o.qr_token = ?
        AND o.status = 'Approved'`,
      [token]
    );

    if (!rows || rows.length === 0) {
      return res.send("<h2>❌ Invalid or Expired Outpass</h2>");
    }

    const o = rows[0];

    // ✅ CHECK USED FIRST
    if (o.scanned_at) {
      return res.send("<h2>⚠️ Outpass already used</h2>");
    }

    // ✅ THEN CHECK EXPIRY
    const now = new Date();
    const inTime = new Date(o.in_datetime);

    if (now > inTime) {
      return res.send("<h2>⏰ Outpass Expired</h2>");
    }

    let keyHint = o.residence_type === "BOYS_HOSTEL" ? "verifybh" : "verifygh";

    res.send(`
      <html>
      <head>
        <title>Verify Outpass</title>
      </head>
      <body>
        <h2>Outpass Verification</h2>

        <p><b>Name:</b> ${o.student_name}</p>
        <p><b>User ID:</b> ${o.user_id}</p>
        <p><b>Course:</b> ${o.course_year}</p>
        <p><b>Block:</b> ${o.block_name}</p>
        <p><b>Room:</b> ${o.room_number}</p>
        <p><b>Out Time:</b> ${new Date(o.out_datetime).toLocaleString()}</p>
        <p><b>Approved At:</b> ${new Date(o.approved_at).toLocaleString()}</p>

        <form method="POST" action="/scan-outpass/${token}">
          <input type="password" name="keycode" placeholder="Enter key" required>
          <small>Hint: ${keyHint}</small>
          <button type="submit">VERIFY</button>
        </form>
      </body>
      </html>
    `);

  } catch (err) {
    console.error("Verify outpass error:", err);
    res.status(500).send("Verification failed");
  }
});

app.post("/login", async (req, res) => {
    try {
        const { user_id, password } = req.body;

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

        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.json({
                success: false,
                message: "Invalid User ID or Password"
            });
        }

        // 🔥🔥🔥 ADD THIS (MOST IMPORTANT)
        req.session.user = {
            user_id: user.user_id,
            role: user.role
        };

        // Send response
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



app.get("/get-rooms", async (req, res) => {
    try {
        const { block } = req.query;

        const [rows] = await db.execute(
            `SELECT DISTINCT room_number 
             FROM hostel_admissions 
             WHERE block_name = ?`,
            [block]
        );

        res.json(rows);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server Error" });
    }
});

app.get("/get-students", async (req, res) => {
    try {
        const { block, room } = req.query;

        const [rows] = await db.execute(
            `SELECT id, name, user_id, roll_number 
             FROM hostel_admissions
             WHERE block_name = ? AND room_number = ?`,
            [block, room]
        );

        res.json(rows);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server Error" });
    }
});


app.post("/update-reg-no", async (req, res) => {
    const connection = await db.getConnection();

    try {
        const { id, roll_number } = req.body;

        if (!roll_number) {
            return res.json({
                success: false,
                message: "Reg Number is required"
            });
        }

        // 🔐 SECURITY
        if (!req.session.user || req.session.user.role !== "warden") {
            return res.status(403).json({ message: "Unauthorized" });
        }

        await connection.beginTransaction();

        // 1️⃣ Get old user_id
        const [rows] = await connection.execute(
            `SELECT user_id FROM hostel_admissions WHERE id = ?`,
            [id]
        );

        if (rows.length === 0) {
            throw new Error("Student not found");
        }

        const oldUserId = rows[0].user_id;
        const newUserId = roll_number;

        // 2️⃣ Check if new user_id already exists
        const [check] = await connection.execute(
            `SELECT * FROM users WHERE user_id = ?`,
            [newUserId]
        );

        if (check.length > 0) {
            return res.json({
                success: false,
                message: "This Reg Number already exists as User ID"
            });
        }

        // 3️⃣ Update hostel_admissions
        await connection.execute(
            `UPDATE hostel_admissions
             SET roll_number = ?, user_id = ?
             WHERE id = ?`,
            [roll_number, newUserId, id]
        );

        // 4️⃣ Update users table
        await connection.execute(
            `UPDATE users
             SET user_id = ?
             WHERE user_id = ?`,
            [newUserId, oldUserId]
        );

        await connection.commit();

        res.json({
            success: true,
            message: "Reg No & User ID updated successfully"
        });

    } catch (err) {
        await connection.rollback();
        console.error(err);

        res.status(500).json({
            success: false,
            message: "Server Error"
        });

    } finally {
        connection.release();
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

// GET complaints for logged-in warden
app.get("/api/warden/complaints", (req, res) => {

  const { warden_id } = req.query;

  console.log("👉 Warden ID:", warden_id);

  if (!warden_id) {
    return res.status(400).json({
      success: false,
      error: "Warden ID required"
    });
  }

  let residenceType;

  if (warden_id.startsWith("BH")) {
    residenceType = "BOYS_HOSTEL";
  } 
  else if (warden_id.startsWith("GH")) {
    residenceType = "GIRLS_HOSTEL";
  } 
  else {
    return res.status(400).json({
      success: false,
      error: "Invalid Warden ID"
    });
  }

  console.log("👉 Residence Type:", residenceType);

  const sql = `
    SELECT 
      hc.id,
      hc.user_id,
      hc.student_name,
      hc.category,
      hc.location,
      hc.description,
      hc.status,
      hc.created_at,
      hc.is_viewed,
      ha.block_name,
      ha.room_number
    FROM hostel_complaints hc
    INNER JOIN hostel_admissions ha 
      ON hc.user_id = ha.user_id
    WHERE ha.residence_type = ?
    ORDER BY hc.created_at DESC
  `;

  console.log("👉 Running query...");

  db.query(sql, [residenceType], (err, rows) => {

    if (err) {
      console.error("❌ DB ERROR:", err);

      return res.status(500).json({
        success: false,
        error: err.message
      });
    }

    console.log("✅ Rows fetched:", rows.length);

    res.json({
      success: true,
      complaints: rows
    });

  });

});


app.put("/api/warden/complaints/view/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const sql = `
      UPDATE hostel_complaints
      SET is_viewed = 1, updated_at = NOW()
      WHERE id = ?
    `;

    await db.promise().query(sql, [id]);

    res.json({ success: true, message: "Marked as viewed" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/warden/complaints/status/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const sql = `
      UPDATE hostel_complaints
      SET status = ?, updated_at = NOW()
      WHERE id = ?
    `;

    await db.promise().query(sql, [status, id]);

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.get('/api/getStudentInfo/:user_id', async (req, res) => {
    try {
        const { user_id } = req.params;

        const [rows] = await db.query(
            `SELECT user_id, course_year, academic_year, name 
             FROM hostel_management_system.hostel_admissions 
             WHERE user_id = ?`,
            [user_id]
        );

        if (!rows.length) {
            return res.status(404).json({ error: "Student not found" });
        }

        res.json(rows[0]);

    } catch (err) {
        console.error("Student info error:", err);
        res.status(500).json({ error: err.message });
    }
});


app.get('/api/getFees/:user_id', async (req, res) => {
    try {
        const { user_id } = req.params;

        // 🔹 get all fee structures
        const [fees] = await db.query(
            `SELECT year, room_rent, mess_deposit_1, mess_deposit_2, academic_year
             FROM hostel_management_system.hostel_fee_structure
             WHERE user_id = ?
             ORDER BY year ASC`,
            [user_id]
        );

        if (!fees.length) {
            return res.json([]);
        }

        // 🔹 get verified payments
        const [payments] = await db.query(
            `SELECT fee_type, SUM(amount) as paid
             FROM hostel_management_system.student_transactions
             WHERE user_id = ? AND status = 'VERIFIED'
             GROUP BY fee_type`,
            [user_id]
        );

        const paidMap = {};
        payments.forEach(p => {
            paidMap[p.fee_type] = p.paid;
        });

        // 🔹 format response year-wise
        const result = fees.map(f => {
            return {
                year: f.year,
                academic_year: f.academic_year,
                fees: [
                    {
                        type: "ROOM_RENT",
                        total: f.room_rent,
                        paid: paidMap["ROOM_RENT"] || 0,
                        pending: f.room_rent - (paidMap["ROOM_RENT"] || 0)
                    },
                    {
                        type: "MESS_1",
                        total: f.mess_deposit_1,
                        paid: paidMap["MESS_1"] || 0,
                        pending: f.mess_deposit_1 - (paidMap["MESS_1"] || 0)
                    },
                    {
                        type: "MESS_2",
                        total: f.mess_deposit_2,
                        paid: paidMap["MESS_2"] || 0,
                        pending: f.mess_deposit_2 - (paidMap["MESS_2"] || 0)
                    }
                ]
            };
        });

        res.json(result);

    } catch (err) {
        console.error("Get Fees error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/addTransaction', async (req, res) => {
    try {
        const { user_id, fee_type, amount, transaction_id } = req.body;

        if (!user_id || !fee_type || !amount || !transaction_id) {
            return res.status(400).json({ error: "Missing fields" });
        }

        // ✅ GET ACADEMIC YEAR (FINAL)
        const [admissionData] = await db.query(
            `SELECT academic_year 
             FROM hostel_management_system.hostel_admissions 
             WHERE user_id = ?`,
            [user_id]
        );

        if (admissionData.length === 0) {
            return res.status(404).json({ error: "Student admission not found" });
        }

        const academic_year = admissionData[0].academic_year;

        // 🔥 MATCH WITH BANK
        const [bankMatch] = await db.query(
            `SELECT * FROM hostel_management_system.hostel_bank_statements
             WHERE ref_no LIKE CONCAT('%', ?, '%')
             AND credit = ?`,
            [transaction_id, amount]
        );

        let status = "PENDING";
        let verified_at = null;

        if (bankMatch.length > 0) {
            status = "VERIFIED";
            verified_at = new Date();
        }

        // ✅ INSERT WITH ACADEMIC YEAR
        await db.query(
            `INSERT INTO hostel_management_system.student_transactions
            (user_id, academic_year, fee_type, amount, transaction_id, status, verified_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [user_id, academic_year, fee_type, amount, transaction_id, status, verified_at]
        );

        res.json({
            success: true,
            message: status === "VERIFIED"
                ? "Transaction auto verified"
                : "Transaction submitted (pending verification)"
        });

    } catch (err) {
        console.error("Transaction error:", err);

        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: "Transaction ID already used" });
        }

        res.status(400).json({ error: "Something went wrong" });
    }
});

app.post('/api/verifyTransaction', async (req, res) => {
    try {
        const { transaction_id } = req.body;

        if (!req.session.user || req.session.user.role !== "warden") {
            return res.status(403).json({ error: "Unauthorized" });
        }

        const [result] = await db.query(
            `UPDATE hostel_management_system.student_transactions
             SET status = 'VERIFIED', verified_at = NOW()
             WHERE transaction_id = ? AND status = 'PENDING'`,
            [transaction_id]
        );

        res.json({
            success: true,
            message: result.affectedRows > 0 
                ? "Transaction Verified"
                : "Already verified or not found"
        });

    } catch (err) {
        console.error("Verification error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/pendingTransactions', async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT * FROM hostel_management_system.student_transactions
             WHERE status = 'PENDING'
             ORDER BY created_at DESC`
        );

        res.json(rows);

    } catch (err) {
        console.error("Pending tx error:", err);
        res.status(500).json({ error: err.message });
    }
});


app.post("/upload-bank-statement", upload.single("file"), async (req, res) => {
    try {

        // ✅ 1. FILE CHECK
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        // ✅ 2. SAFE SESSION ACCESS (MATCH YOUR LOGIN STRUCTURE)
        const user = req.session?.user;

        if (!user || !user.user_id || typeof user.user_id !== "string") {
            return res.status(401).json({
                error: "Unauthorized - Invalid session"
            });
        }

        const userId = user.user_id;   // ✅ IMPORTANT FIX

        // ✅ 3. DETERMINE HOSTEL TYPE SAFELY
        let residenceType;

        if (userId.startsWith("BH")) {
            residenceType = "BOYS_HOSTEL";
        } else if (userId.startsWith("GH")) {
            residenceType = "GIRLS_HOSTEL";
        } else {
            return res.status(400).json({
                error: "Invalid userId format"
            });
        }

        console.log("User:", userId);
        console.log("Residence:", residenceType);

        const filePath = path.resolve(req.file.path);

        // ✅ 4. RUN PYTHON
        exec(`python hostel_bank_extract.py "${filePath}"`, async (error, stdout, stderr) => {

            console.log("PYTHON STDOUT:", stdout);
            console.log("PYTHON STDERR:", stderr);

            if (error) {
                console.error("Python Error:", error);
                return res.status(500).json({
                    error: "Python processing failed",
                    details: stderr
                });
            }

            try {

                // ✅ 5. UPDATE residence_type
                await db.query(`
                    UPDATE hostel_bank_statements
                    SET residence_type = ?
                    WHERE residence_type IS NULL OR residence_type = ''
                `, [residenceType]);

                // ✅ 6. AUTO VERIFY
                const [result] = await db.query(`
                    UPDATE hostel_bank_statements bs
                    JOIN student_transactions st
                    ON TRIM(bs.ref_no) LIKE CONCAT('%', TRIM(st.transaction_id), '%')
                    AND ABS(st.amount - bs.credit) <= 5
                    SET 
                        bs.verification_status = 'VERIFIED',
                        st.status = 'VERIFIED',
                        st.verified_at = NOW()
                    WHERE st.status = 'PENDING'
                    AND bs.residence_type = ?
                `, [residenceType]);

                console.log("Verified Rows:", result.affectedRows);

                // ✅ 7. SUCCESS RESPONSE
                res.json({
                    success: true,
                    message: `Excel processed. ${result.affectedRows} transactions verified`,
                    residenceType
                });

            } catch (dbErr) {
                console.error("DB ERROR:", dbErr);
                return res.status(500).json({
                    error: "Database error",
                    details: dbErr.message
                });
            }

        });

    } catch (err) {
        console.error("SERVER ERROR:", err);
        res.status(500).json({
            error: "Server error",
            details: err.message
        });
    }
});

app.get("/get-bank-verifications", async (req, res) => {
    try {
        // ✅ SAFE SESSION CHECK
        const user = req.session?.user;

        if (!user || !user.user_id || typeof user.user_id !== "string") {
            return res.status(401).json({
                error: "Unauthorized - Invalid session"
            });
        }

        const userId = user.user_id; // ✅ FIXED

        // ✅ DETERMINE HOSTEL
        let residenceType;

        if (userId.startsWith("BH")) {
            residenceType = "BOYS_HOSTEL";
        } else if (userId.startsWith("GH")) {
            residenceType = "GIRLS_HOSTEL";
        } else {
            return res.status(400).json({
                error: "Invalid userId format"
            });
        }

        // ✅ FILTER FROM QUERY
        const status = req.query.status;

        let query = `
            SELECT 
                id,
                txn_date,
                value_date,
                description,
                ref_no,
                branch_code,
                debit,
                credit,
                verification_status
            FROM hostel_bank_statements
            WHERE residence_type = ?
        `;

        let params = [residenceType];

        // ✅ STATUS FILTER
        if (status && status !== "all") {
            query += " AND verification_status = ?";
            params.push(status);
        }

        query += " ORDER BY id DESC";

        const [rows] = await db.query(query, params);

        res.json({
            success: true,
            residenceType,
            count: rows.length,
            records: rows
        });

    } catch (err) {
        console.error("GET BANK ERROR:", err);
        res.status(500).json({
            error: "Server error",
            details: err.message
        });
    }
});

app.get("/get-bank-verification-stats", async (req, res) => {
    try {
        const user = req.session?.user;

        if (!user || !user.user_id || typeof user.user_id !== "string") {
            return res.status(401).json({
                error: "Unauthorized - Invalid session"
            });
        }

        const userId = user.user_id; // ✅ FIXED

        let residenceType;

        if (userId.startsWith("BH")) {
            residenceType = "BOYS_HOSTEL";
        } else if (userId.startsWith("GH")) {
            residenceType = "GIRLS_HOSTEL";
        } else {
            return res.status(400).json({
                error: "Invalid userId format"
            });
        }

        const [rows] = await db.query(`
            SELECT 
                COUNT(*) AS total,
                SUM(verification_status = 'VERIFIED') AS verified,
                SUM(verification_status = 'NOT_VERIFIED') AS not_verified
            FROM hostel_bank_statements
            WHERE residence_type = ?
        `, [residenceType]);

        res.json({
            success: true,
            stats: rows[0]
        });

    } catch (err) {
        console.error("STATS ERROR:", err);
        res.status(500).json({
            error: "Server error",
            details: err.message
        });
    }
});

app.get("/admin-dashboard-data", (req, res) => {
    try {
        const user = req.session?.user;

        if (!user || !user.user_id) {
            return res.status(401).json({
                error: "Unauthorized"
            });
        }

        const userId = user.user_id;

        const hostelType = userId.startsWith("BH")
            ? "BOYS_HOSTEL"
            : "GIRLS_HOSTEL";

        res.json({
            userId,
            hostelType
        });

    } catch (err) {
        console.error("ADMIN DATA ERROR:", err);
        res.status(500).json({
            error: "Server error"
        });
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

app.post("/apply-fee-structure", async (req, res) => {
    const connection = await db.getConnection(); // transaction

    try {
        const { current_year, next_year, residence_type, room_rent, mess1, mess2, academic_year } = req.body;

        if (!req.session.user || req.session.user.role !== "warden") {
            return res.status(403).json({ message: "Unauthorized" });
        }

        await connection.beginTransaction();

        // 🔍 get students
        const [students] = await connection.execute(
            `SELECT user_id FROM hostel_management_system.hostel_admissions 
             WHERE course_year = ?`,
            [current_year]
        );

        if (students.length === 0) {
            return res.json({ message: "No students found" });
        }

        for (let stu of students) {
            if (!stu.user_id) continue;

            // ✅ INSERT / UPDATE FEE
            await connection.execute(
                `INSERT INTO hostel_management_system.hostel_fee_structure 
                (user_id, year, residence_type, room_rent, mess_deposit_1, mess_deposit_2, academic_year)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                room_rent = VALUES(room_rent),
                mess_deposit_1 = VALUES(mess_deposit_1),
                mess_deposit_2 = VALUES(mess_deposit_2),
                residence_type = VALUES(residence_type),
                academic_year = VALUES(academic_year)
                `,
                [
                    stu.user_id,   // 🔥 FIXED (was roll_number)
                    next_year,
                    residence_type,
                    room_rent,
                    mess1,
                    mess2,
                    academic_year
                ]
            );
        }

        // ✅ UPDATE STUDENTS YEAR
        await connection.execute(
            `UPDATE hostel_management_system.hostel_admissions
             SET course_year = ?, academic_year = ?
             WHERE course_year = ?`,
            [next_year, academic_year, current_year]
        );

        await connection.commit();

        res.json({
            success: true,
            message: `✅ Fee applied & students promoted (${current_year} → ${next_year})`
        });

    } catch (err) {
        await connection.rollback();
        console.error(err);
        res.status(500).json({ message: "Server Error" });
    } finally {
        connection.release();
    }
});
app.get("/get-students-for-renewal", async (req, res) => {
    try {
        const { year } = req.query;

        const [rows] = await db.execute(`
            SELECT 
                id,
                name,
                roll_number,
                block_name,
                room_number,
                course_year
            FROM hostel_admissions
            WHERE course_year LIKE ?
        `, [`${year}%`]);

        res.json(rows);

    } catch (err) {
        console.error(err);
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
});

app.post("/renew-students", async (req, res) => {
    const connection = await db.getConnection();

    try {
        const { ids } = req.body;

        if (!req.session.user || req.session.user.role !== "warden") {
            return res.status(403).json({ message: "Unauthorized" });
        }

        await connection.beginTransaction();

        for (let id of ids) {

            const [rows] = await connection.execute(`
                SELECT roll_number, course_year
                FROM hostel_admissions
                WHERE id = ?
            `, [id]);

            if (rows.length === 0) continue;

            const regNo = rows[0].roll_number;
            const currentYear = parseInt(rows[0].course_year);
            const nextYear = currentYear + 1;

            // 🔥 UPDATE YEAR
            await connection.execute(`
                UPDATE hostel_admissions
                SET course_year = ?
                WHERE id = ?
            `, [nextYear, id]);

            // 🔥 INSERT FEE (DEFAULT)
            await connection.execute(`
                INSERT INTO hostel_fee_structure
                (reg_no, year, residence_type, room_rent, mess_deposit_1, mess_deposit_2)
                VALUES (?, ?, 'BOYS_HOSTEL', 0, 0, 0)
                ON DUPLICATE KEY UPDATE year = VALUES(year)
            `, [
                regNo,
                nextYear
            ]);
        }

        await connection.commit();

        res.json({
            success: true,
            message: "Renewal completed successfully"
        });

    } catch (err) {
        await connection.rollback();
        console.error(err);

        res.status(500).json({
            success: false,
            message: err.message
        });

    } finally {
        connection.release();
    }
});
app.get("/get-students-by-year", async (req, res) => {
    try {
        const { year } = req.query;

        const [rows] = await db.execute(
            `SELECT id, name, roll_number 
             FROM hostel_admissions
             WHERE course_year = ?`,
            [year]
        );

        res.json(rows);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server Error" });
    }
});


app.use((err, req, res, next) => {
    console.error("GLOBAL ERROR:", err);
    res.status(500).send("Something broke!");
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});
// Start server
app.listen(3001, () => console.log("Hostel Management Server running on port 3001"));
