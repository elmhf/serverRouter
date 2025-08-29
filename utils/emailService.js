import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: "jihadchaabani75@gmail.com",
    pass: "rpyftsyyccvyoofk",
  },
});

export async function sendEmail({ to, subject, text, html }) {
    
  const mailOptions = {
    from: `"Xdantel" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text,
    html,
  };

  return transporter.sendMail(mailOptions);
} 