// =============================================
// server/lib/email.js - Brevo API Helper
// =============================================
const SibApiV3Sdk = require('sib-api-v3-sdk');
const supabase = require('./supabase');
const { logError } = require('./logger');

const APP_URL = process.env.APP_URL || 'https://coelgu-system.engineer';

// Lazy init Brevo client
let _brevoApi = null;
function getBrevoApi() {
  if (!_brevoApi) {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      console.warn('[Email] Skipping: BREVO_API_KEY missing. Please add it to Render Environment settings.');
      return null;
    }

    const defaultClient = SibApiV3Sdk.ApiClient.instance;
    const apiKeyInstance = defaultClient.authentications['api-key'];
    apiKeyInstance.apiKey = apiKey;

    _brevoApi = new SibApiV3Sdk.TransactionalEmailsApi();
    defaultClient.timeout = 10000;
  }
  return _brevoApi;
}

/**
 * Fetches all registered student emails via the profiles table.
 * Specifically filters for Gmail/Google Workspace accounts.
 */
async function getAllStudentEmails() {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('email')
      .neq('role', 'admin')
      .or('email.ilike.%@gmail.com,email.ilike.%@g.cjc.edu.ph');

    if (error) throw error;
    
    return (data || []).map(p => p.email).filter(Boolean);
  } catch (err) {
    console.error('[Email] Failed to fetch student emails:', err.message);
    return [];
  }
}

/**
 * Wraps email contents into a minimalist COE Orange Palette template.
 */
function buildEmailTemplate({ subject, preheader, content }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#fff7ed;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>
  
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#fff7ed;padding:36px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:500px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #fed7aa;overflow:hidden;box-shadow:0 6px 24px rgba(234, 88, 12, 0.12);">
          
          <!-- COE Orange Top Header -->
          <tr>
            <td style="background:linear-gradient(135deg, #ea580c 0%, #c2410c 100%);padding:22px 24px;text-align:left;">
              <span style="color:#ffedd5;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;display:block;margin-bottom:2px;">COR JESU COLLEGE</span>
              <h1 style="margin:0;color:#ffffff;font-size:16px;font-weight:700;letter-spacing:0.2px;">College of Engineering LGU Portal</h1>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding:32px 24px;text-align:center;">
              ${content}
            </td>
          </tr>

          <!-- Orange Minimalist Footer -->
          <tr>
            <td style="background:#fff7ed;border-top:1px solid #ffedd5;padding:18px 24px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#c2410c;font-weight:700;line-height:1.5;">
                College of Engineering Local Government Unit<br/>
                <span style="color:#9a3412;font-weight:400;">Cor Jesu College, Digos City</span>
              </p>
            </td>
          </tr>

        </table>

        <!-- Outer Sub-footer -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:500px;margin:14px auto 0;">
          <tr>
            <td align="center">
              <p style="margin:0;font-size:11px;color:#9a3412;opacity:0.8;">
                Automated notification from COE Transparency Portal.
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Sends an announcement notification email via Brevo API (HTTP).
 */
async function sendAnnouncementEmail(title, body) {
  try {
    const apiInstance = getBrevoApi();
    if (!apiInstance) return { sent: 0 };

    const emails = await getAllStudentEmails();
    if (!emails.length) return { sent: 0 };

    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    sendSmtpEmail.subject = `[COE LGU] ${title}`;
    sendSmtpEmail.htmlContent = buildEmailTemplate({
      subject: `Announcement: ${title}`,
      preheader: body.slice(0, 100),
      content: `
        <div style="margin-bottom:18px;">
          <span style="display:inline-block;background:#ffedd5;color:#c2410c;border:1px solid #fed7aa;padding:4px 14px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">Announcement</span>
        </div>
        <h2 style="margin:0 0 16px;color:#7c2d12;font-size:20px;font-weight:700;line-height:1.3;">${title}</h2>
        <div style="background:#fff7ed;border-radius:8px;padding:18px;margin-bottom:24px;border:1px solid #ffedd5;text-align:left;">
          <p style="margin:0;color:#431407;line-height:1.6;white-space:pre-wrap;font-size:14px;">${body}</p>
        </div>
        <div>
          <a href="${APP_URL}" style="display:inline-block;background:#ea580c;color:#ffffff;padding:12px 30px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;box-shadow:0 3px 12px rgba(234, 88, 12, 0.25);">Open Portal</a>
        </div>
      `
    });

    sendSmtpEmail.sender = { 
      name: "COE Financial Transparency System", 
      email: process.env.BREVO_SENDER_EMAIL || "coebudget@gmail.com" 
    };
    
    sendSmtpEmail.to = [{ email: process.env.BREVO_SENDER_EMAIL || "coebudget@gmail.com" }];
    sendSmtpEmail.bcc = emails.map(email => ({ email }));

    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log(`[Email] Announcement sent via Brevo: ${data.messageId}`);
    return { sent: emails.length };
  } catch (err) {
    logError('Email Announcement Error', err);
    return { sent: 0, error: err.message };
  }
}

/**
 * Sends a new event notification email via Brevo API (HTTP).
 */
async function sendNewEventEmail(event) {
  try {
    const apiInstance = getBrevoApi();
    if (!apiInstance) return { sent: 0 };

    const emails = await getAllStudentEmails();
    if (!emails.length) return { sent: 0 };

    const formattedDate = event.event_date 
      ? new Date(event.event_date).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })
      : null;

    const formattedBudget = Number(event.allocated_budget || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 });

    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    sendSmtpEmail.subject = `New Event: ${event.event_name}`;
    sendSmtpEmail.htmlContent = buildEmailTemplate({
      subject: `New Event: ${event.event_name}`,
      preheader: `A new event has been scheduled: ${event.event_name}.`,
      content: `
        <div style="margin-bottom:18px;">
          <span style="display:inline-block;background:#ffedd5;color:#c2410c;border:1px solid #fed7aa;padding:4px 14px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">New Event</span>
        </div>
        <h2 style="margin:0 0 8px;color:#7c2d12;font-size:20px;font-weight:700;line-height:1.3;">${event.event_name}</h2>
        <p style="margin:0 0 20px;color:#9a3412;font-size:13px;">A new event has been posted to the council calendar.</p>

        <div style="background:#fff7ed;border-radius:8px;padding:20px;margin-bottom:24px;border:1px solid #ffedd5;text-align:left;">
          ${formattedDate ? `
            <div style="margin-bottom:12px;">
              <span style="display:block;font-size:11px;font-weight:700;color:#c2410c;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">Scheduled Date</span>
              <span style="font-size:14px;font-weight:600;color:#431407;">${formattedDate}</span>
            </div>
          ` : ''}
          <div style="margin-bottom:${event.description ? '12px' : '0'};">
            <span style="display:block;font-size:11px;font-weight:700;color:#c2410c;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">Allocated Budget</span>
            <span style="font-size:18px;font-weight:700;color:#ea580c;">PHP ${formattedBudget}</span>
          </div>
          ${event.description ? `
            <div style="border-top:1px solid #fed7aa;padding-top:12px;margin-top:12px;">
              <span style="display:block;font-size:11px;font-weight:700;color:#c2410c;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">Description</span>
              <p style="margin:0;font-size:13px;color:#431407;line-height:1.5;">${event.description}</p>
            </div>
          ` : ''}
        </div>

        <div>
          <a href="${APP_URL}" style="display:inline-block;background:#ea580c;color:#ffffff;padding:12px 30px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;box-shadow:0 3px 12px rgba(234, 88, 12, 0.25);">View Event Details</a>
        </div>
      `
    });

    sendSmtpEmail.sender = { 
      name: "COE Financial Transparency System", 
      email: process.env.BREVO_SENDER_EMAIL || "coebudget@gmail.com" 
    };
    
    sendSmtpEmail.to = [{ email: process.env.BREVO_SENDER_EMAIL || "coebudget@gmail.com" }];
    sendSmtpEmail.bcc = emails.map(email => ({ email }));

    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log(`[Email] Event notification sent via Brevo: ${data.messageId}`);
    return { sent: emails.length };
  } catch (err) {
    logError('Email Event Notification Error', err);
    return { sent: 0, error: err.message };
  }
}

/**
 * Sends an account approval notification email via Brevo API (HTTP).
 */
async function sendAccountApprovalEmail(userEmail, userName = 'COE Member') {
  try {
    const apiInstance = getBrevoApi();
    if (!apiInstance) return { sent: 0, reason: 'Brevo API key missing' };
    if (!userEmail) return { sent: 0, reason: 'No recipient email provided' };

    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    sendSmtpEmail.subject = `Account Verified: COE LGU Portal`;
    sendSmtpEmail.htmlContent = buildEmailTemplate({
      subject: `Account Verified`,
      preheader: `Your account has been verified by the admin. You can now log into the portal.`,
      content: `
        <div style="margin-bottom:18px;">
          <span style="display:inline-block;background:#ffedd5;color:#c2410c;border:1px solid #fed7aa;padding:4px 14px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">Account Verified</span>
        </div>
        <h2 style="margin:0 0 10px;color:#7c2d12;font-size:20px;font-weight:700;line-height:1.3;">Welcome, ${userName}</h2>
        <p style="margin:0 0 28px;color:#431407;font-size:14px;line-height:1.6;max-width:420px;margin-left:auto;margin-right:auto;">Your account has been verified by the council admin. You may now log in to access the student portal.</p>
        <div>
          <a href="${APP_URL}" style="display:inline-block;background:#ea580c;color:#ffffff;padding:12px 30px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;box-shadow:0 3px 12px rgba(234, 88, 12, 0.25);">Log In to Portal</a>
        </div>
      `
    });

    sendSmtpEmail.sender = {
      name: "COE Financial Transparency System",
      email: process.env.BREVO_SENDER_EMAIL || "coebudget@gmail.com"
    };
    sendSmtpEmail.to = [{ email: userEmail, name: userName }];

    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log(`[Email] Approval email sent to ${userEmail} via Brevo: ${data.messageId}`);
    return { sent: 1, messageId: data.messageId };
  } catch (err) {
    logError('Email Approval Notification Error', err);
    return { sent: 0, error: err.message };
  }
}

/**
 * Sends a load approval status email to a student via Brevo API (HTTP).
 * status: 'approved' | 'returned' | 'rejected' | 'encoded'
 */
async function sendLoadStatusEmail({ to, name = 'COE Student', status, studentName, term, lines = [], changes = null }) {
  try {
    const apiInstance = getBrevoApi();
    if (!apiInstance) return { sent: 0, reason: 'Brevo API key missing' };
    if (!to) return { sent: 0, reason: 'No recipient email provided' };

    const headlines = {
      approved: 'Load Approved',
      returned: 'Load Returned for Changes',
      rejected: 'Load Rejected',
      encoded:  'Load Encoded',
    };
    const changeHtml = changes
      ? `<p style="margin:8px 0;"><strong>Changes by your Program Head:</strong></p>
         <ul style="margin:8px 0;padding-left:20px;">${changes.map(c => `<li>${c}</li>`).join('')}</ul>`
      : '';
    const listHtml = lines.length
      ? `<ul style="margin:8px 0;padding-left:20px;">${lines.map(l => `<li>${l}</li>`).join('')}</ul>`
      : '';

    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    sendSmtpEmail.subject = `${headlines[status] || 'Load Update'}: COE LGU Portal`;
    sendSmtpEmail.htmlContent = buildEmailTemplate({
      subject: headlines[status] || 'Load Update',
      preheader: `${studentName} - load for ${term}`,
      content: `
        <div style="margin-bottom:18px;">
          <span style="display:inline-block;background:#ffedd5;color:#c2410c;border:1px solid #fed7aa;padding:4px 14px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">${headlines[status] || 'Load Update'}</span>
        </div>
        <p style="margin:0 0 12px;color:#431407;font-size:14px;">Hi ${studentName},</p>
        <p style="margin:0 0 12px;color:#431407;font-size:14px;line-height:1.6;">Your submitted load for <strong>${term}</strong> was <strong>${headlines[status] || status}</strong>.</p>
        ${changeHtml}
        ${listHtml}
        <div style="margin-top:16px;">
          <a href="${APP_URL}" style="display:inline-block;background:#ea580c;color:#ffffff;padding:12px 30px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;box-shadow:0 3px 12px rgba(234, 88, 12, 0.25);">Open the portal</a>
        </div>`
    });

    sendSmtpEmail.sender = {
      name: "COE Financial Transparency System",
      email: process.env.BREVO_SENDER_EMAIL || "coebudget@gmail.com"
    };
    sendSmtpEmail.to = [{ email: to, name }];

    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log(`[Email] Load status email (${status}) sent to ${to} via Brevo: ${data.messageId}`);
    return { sent: 1, messageId: data.messageId };
  } catch (err) {
    logError('Email Load Status Error', err);
    return { sent: 0, error: err.message };
  }
}

module.exports = { sendAnnouncementEmail, sendNewEventEmail, sendAccountApprovalEmail, sendLoadStatusEmail };
