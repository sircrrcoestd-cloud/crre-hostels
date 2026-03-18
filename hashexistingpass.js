const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");

// 🔧 Update with your DB credentials
const db = mysql.createPool({
  host: "localhost",     // or "127.0.0.1"
  user: "root",
  password: "tarun123",
  database: "hostel_management_system",
  port: 3306 // Default MySQL port
});

async function hashExistingPasswords() {
  try {
    const [users] = await db.query("SELECT user_id, password FROM users");

    for (const user of users) {
      const { user_id, password } = user;

      // 🛑 Skip if already hashed (basic check: bcrypt hashes start with $2b$ or $2a$)
      if (password.startsWith("$2b$") || password.startsWith("$2a$")) {
        console.log(`⚠️ Already hashed: ${user_id}`);
        continue;
      }

      const hashed = await bcrypt.hash(password, 10);

      await db.query(
        "UPDATE users SET password = ? WHERE user_id = ?",
        [hashed, user_id]
      );

      console.log(`🔐 Hashed password for user: ${user_id}`);
    }

    console.log("✅ All applicable passwords hashed.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  }
}

hashExistingPasswords();
