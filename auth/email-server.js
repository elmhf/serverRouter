const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const nodemailer = require("nodemailer");
require("dotenv").config();

const app = express();
const port = 3003;

app.use(cors());
app.use(express.json());

const codes = new Map(); // email => { code, expires, lastSent }

// ======= Helpers =======
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function renderEmailTemplate({ code, firstName, lastName, email }) {
  const templatePath = path.join(__dirname, "tamplate", "email.html");
  let html = fs.readFileSync(templatePath, "utf8");
  return html
    .replace(/\{\{CODE\}\}/g, code)
    .replace(/\{\{firstName\}\}/g, firstName || "")
    .replace(/\{\{lastName\}\}/g, lastName || "")
    .replace(/\{\{email\}\}/g, email || "");
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ========== API: Send Code ==========
app.post("/send-code", async (req, res) => {
  const { email, firstName, lastName } = req.body;
  if (!email) return res.status(400).json({ message: "Email requis." });

  const now = Date.now();
  const existing = codes.get(email);

  if (existing && now - existing.lastSent < 60000) {
    return res.status(429).json({ message: "Attendez avant de redemander un code." });
  }

  const code = generateCode();
  const html = renderEmailTemplate({ code, firstName, lastName, email });

  try {
    await transporter.sendMail({
      from: `"Xdantel" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Votre code de vérification",
      text: `Votre code est : ${code}`,
      html,
    });

    codes.set(email, { code, expires: now + 5 * 60 * 1000, lastSent: now });
    res.status(200).json({ message: "Code envoyé avec succès." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur lors de l'envoi de l'email." });
  }
});

// ========== API: Verify Code ==========
app.post("/verify-code", (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ message: "Email et code requis." });

  const entry = codes.get(email);
  if (!entry) return res.status(404).json({ message: "Aucun code trouvé." });
  if (Date.now() > entry.expires) return res.status(400).json({ message: "Code expiré." });
  if (entry.code !== code) return res.status(400).json({ message: "Code incorrect." });

  codes.delete(email);
  res.status(200).json({ message: "Code vérifié avec succès." });
});

// ========== Start Server ==========
app.listen(port, () => {
  console.log(`📩 Email Code Server running at http://localhost:${port}`);
});
