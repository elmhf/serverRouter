import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "jihadchaabani80@gmail.com",
    pass: "kvactkcznenvpkup" // App Password من Gmail (موش كلمة السرّ العادية)
  },
  tls: {
    rejectUnauthorized: false // يخلي الاتصال يتجاوز self-signed error
  }
});

export async function sendEmail({ to, subject, text, html }) {
    console.log("to", to, "subject", subject, "text", text, "html", html);
  const mailOptions = {
    from: `"Xdantel" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text,
  };

  return transporter.sendMail(mailOptions);
} 