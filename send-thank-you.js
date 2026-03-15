const nodemailer = require('nodemailer');

// ====== 请在这里填入你的 163 SMTP 授权码 ======
const AUTH_CODE = process.argv[2] || '';
if (!AUTH_CODE) {
  console.error('Usage: node send-thank-you.js <163-smtp-auth-code>');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: 'smtp.163.com',
  port: 465,
  secure: true,
  auth: {
    user: 'kill.136@163.com',
    pass: AUTH_CODE,
  },
});

const mailOptions = {
  from: '"Will Wang" <kill.136@163.com>',
  to: 'jack@jackdarcy.com.au',
  subject: 'Thank you for supporting Axon!',
  text: `Hi Jack,

Thanks so much for your support! It really means a lot.

To answer your question — we don't maintain a private Claude Code source. Our CLI module stays in sync with official npm releases, and all the extra features (Web IDE, multi-agent Blueprint, self-evolution, IM integrations, etc.) are built on top of that CLI foundation. Everything is in the public repo.

The fe34631 commit you found was a point-in-time snapshot before the Axon rebrand. Since then, the project has evolved with its own architecture.

I've added you to the Sponsors section in the README as a thank-you. If you have any ideas or feature requests, feel free to open an issue or reach out anytime.

Cheers,
Will
https://github.com/kill136/axon`,
};

transporter.sendMail(mailOptions).then(info => {
  console.log('Email sent successfully:', info.messageId);
}).catch(err => {
  console.error('Failed to send:', err.message);
});
