import express, { json } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import cors from 'cors';
import { createTransport } from 'nodemailer';
import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = 3003;

console.log("EMAIL_USER:", process.env.EMAIL_USER);
console.log("EMAIL_PASS:", process.env.EMAIL_PASS ? "******" : null);

app.use(cors());
app.use(json());

function getRndInteger(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}

async function getData(fileName) {
  try {
    const filePath = join(__dirname, 'data', fileName);
    const data = readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading file:', error.message);
    return {};
  }
}


// ========== ⬇️ كود إرسال الإيميل ⬇️ ==========

// خزن مؤقت للكود (RAM فقط)
const codes = new Map();

// توليد كود
const generateCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// إعداد الإيميل
const transporter = createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false // يخلي الاتصال يتجاوز self-signed error
  }
});

// Helper to load and fill the email template
function renderEmailTemplate({ code, firstName, lastName, email }) {
  const templatePath = join(__dirname, 'tamplate', 'email.html');
  let html = readFileSync(templatePath, 'utf8');
  html = html.replace(/\{\{CODE\}\}/g, code)
    .replace(/\{\{firstName\}\}/g, firstName || '')
    .replace(/\{\{lastName\}\}/g, lastName || '')
    .replace(/\{\{email\}\}/g, email || '');
  return html;
}

// API: إرسال الكود
app.post("/send-code", async (req, res) => {
  const { email, firstName, lastName } = req.body;
  if (!email) return res.status(400).json({ message: "Email is required" });

  const code = generateCode();
  const expires = Date.now() + 5 * 60 * 1000; // صالح 5 دقايق
  codes.set(email, { code, expires });

  try {
    const html = renderEmailTemplate({ code, firstName, lastName, email });

    await transporter.sendMail({
      from: `"My App" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Votre code de vérification",
      text: `Votre code est : ${code}`,
      html, // HTML version
    });

    res.status(200).json({ message: "Code envoyé à l'email." });
  } catch (error) {
    console.error("Erreur email:", error);
    res.status(500).json({ message: "Erreur lors de l'envoi du code." });
  }
});

// API: التحقق من الكود
app.post("/verify-code", (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ message: "Email et code requis." });

  const saved = codes.get(email);
  if (!saved) return res.status(400).json({ message: "Aucun code trouvé pour cet email." });
  if (saved.code !== code) return res.status(400).json({ message: "Code incorrect." });
  if (Date.now() > saved.expires) return res.status(400).json({ message: "Code expiré." });

  codes.delete(email);
  res.status(200).json({ message: "Code vérifié avec succès." });
});

// ========== ⬆️ كود الإيميل ⬆️ ==========

// API: /Test القديمة
app.post("/Test", async (req, res) => {
  try {
    const image = req.body.image;
    console.log(image, "image");

    console.log('Test endpoint hit');
    const page = Math.floor(Math.random() * 6) + 1;
    console.log(page);

    const data = await getData(`${page}.json`);
    const data2 = data["teeth"].map((item) => ({
      "tooth": item["toothNumber"],
      "Approve": true,
      "Hedding": false,
      "Comment": {}
    }));

    res.status(200).json({ data, data2 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// Démarrage du serveur
app.listen(port, () => {
  console.log(`🚀 Server is running on http://localhost:${port}`);
});
