import sys
import pandas as pd
import mysql.connector
import os
from dotenv import load_dotenv

# ✅ LOAD ENV
load_dotenv()

DB_HOST = os.getenv("DB_HOST")
DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_NAME = os.getenv("DB_NAME")

file_path = sys.argv[1]

# ✅ DB CONNECTION
conn = mysql.connector.connect(
    host=DB_HOST,
    user=DB_USER,
    password=DB_PASSWORD,
    database=DB_NAME
)
cursor = conn.cursor()

def clean_amount(val):
    if pd.isna(val):
        return 0
    try:
        return float(str(val).replace(",", "").strip())
    except:
        return 0

# =====================================
# 🔥 STEP 1: READ WITHOUT HEADER
# =====================================
df = pd.read_excel(file_path, header=None, engine='openpyxl')

# =====================================
# 🔥 STEP 2: FIND HEADER ROW
# =====================================
header_row_index = None

for i in range(len(df)):
    row = df.iloc[i].astype(str).str.strip().tolist()

    if "Txn Date" in row and "Balance" in row:
        header_row_index = i
        break

if header_row_index is None:
    raise Exception("Header row not found in Excel")

# =====================================
# 🔥 STEP 3: SET HEADER
# =====================================
df.columns = df.iloc[header_row_index]
df = df[(header_row_index + 1):]

# Clean column names
df.columns = [str(col).strip() for col in df.columns]

# =====================================
# 🔥 STEP 4: DEBUG (optional)
# =====================================
print("Detected Columns:", df.columns.tolist())

# =====================================
# 🔥 STEP 5: PROCESS ROWS
# =====================================
for index, row in df.iterrows():

    try:
        debit = clean_amount(row.get("Debit"))
        credit = clean_amount(row.get("Credit"))
        balance = clean_amount(row.get("Balance"))

        # ❌ skip debit rows
        if debit > 0:
            continue

        if credit <= 0:
            continue

        txn_date = row.get("Txn Date")
        value_date = row.get("Value Date")
        description = str(row.get("Description", "")).strip()
        ref_no = str(row.get("Ref No./Cheque No.", "")).strip()
        branch_code = str(row.get("Branch Code", "")).strip()

        # Handle NaN values
        if ref_no == "nan":
            ref_no = None

        if branch_code == "nan":
            branch_code = None

        # =====================================
        # 💾 INSERT INTO DB
        # =====================================
        cursor.execute("""
            INSERT INTO hostel_bank_statements
            (txn_date, value_date, description, ref_no, branch_code, debit, credit, balance)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            txn_date,
            value_date,
            description,
            ref_no,
            branch_code,
            debit,
            credit,
            balance
        ))

    except Exception as e:
        print(f"Error processing row {index}: {e}")

# =====================================
# ✅ SAVE & CLOSE
# =====================================
conn.commit()
cursor.close()
conn.close()

print("BANK STATEMENT (EXCEL) PROCESSED SUCCESSFULLY")